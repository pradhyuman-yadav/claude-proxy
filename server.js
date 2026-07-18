'use strict';

const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');
const { buildRegistry, normalizeModel: resolveModel, stripParams, openaiError } = require('./lib/model');
const { renderDashboard } = require('./lib/dashboard');

// ── Dynamic model registry ────────────────────────────────────────────────────
// Built at startup by querying /v1/models from the internal proxy.
// Maps family aliases → latest canonical model id reported by claude-max-api.
//   "sonnet"            → "claude-sonnet-4"
//   "claude-sonnet"     → "claude-sonnet-4"
//   "claude-sonnet-4-6" → "claude-sonnet-4"  (strip minor, then alias lookup)
// When a new model family is added upstream, it appears here automatically.

let modelRegistry = {}; // populated after internal proxy starts

// Returns true when the registry was populated with at least one model.
async function buildModelRegistry() {
  try {
    const res = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/v1/models`);
    const { data = [] } = await res.json();
    const registry = buildRegistry(data);
    modelRegistry = registry;
    const count = Object.keys(registry).length;
    if (count === 0) {
      console.warn('[claude-proxy] Model registry empty — upstream returned no models yet');
      return false;
    }
    console.log('[claude-proxy] Model registry built:', JSON.stringify(registry));
    return true;
  } catch (err) {
    console.warn('[claude-proxy] Could not build model registry:', err.message);
    return false;
  }
}

function normalizeModel(name = '') {
  return resolveModel(name, modelRegistry);
}

const PORT = parseInt(process.env.PORT ?? '3456', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT ?? '13456', 10);

// Fail fast: without an OAuth token the internal proxy authenticates against
// nothing and every completion silently 4xxs. Better to crash loudly at boot.
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error('[claude-proxy] CLAUDE_CODE_OAUTH_TOKEN is not set. Refusing to start.');
  process.exit(1);
}

// How long to wait for the internal proxy to bind + authenticate before the
// first registry attempt, and how aggressively to retry if it is not ready.
const PROXY_STARTUP_DELAY_MS = 5000;
const REGISTRY_RETRY_MS = 3000;
const REGISTRY_MAX_ATTEMPTS = 10;

const stats = {
  startTime: Date.now(),
  requests: 0,
  errors: 0,
  ready: false,          // internal proxy has been given time to come up
  registryReady: false,  // /v1/models returned at least one model
};

// ── Spawn the underlying claude-max-api proxy on an internal port ────────────
const proxyProc = spawn('claude-max-api', [String(INTERNAL_PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: String(INTERNAL_PORT) },
});

proxyProc.on('spawn', () => {
  // Give it a few seconds to bind and authenticate, then poll /v1/models until
  // it answers. Mark ready as soon as the internal proxy responds so /health
  // flips green; keep retrying the registry in the background if it is empty.
  setTimeout(() => waitForRegistry(0), PROXY_STARTUP_DELAY_MS);
});

async function waitForRegistry(attempt) {
  const ok = await buildModelRegistry();
  stats.ready = true; // internal proxy has had its startup window
  if (ok) {
    stats.registryReady = true;
    console.log(`[claude-proxy] Internal proxy ready on :${INTERNAL_PORT}`);
    return;
  }
  if (attempt + 1 < REGISTRY_MAX_ATTEMPTS) {
    setTimeout(() => waitForRegistry(attempt + 1), REGISTRY_RETRY_MS);
  } else {
    console.warn('[claude-proxy] Giving up on model registry after '
      + `${REGISTRY_MAX_ATTEMPTS} attempts — aliases will not resolve`);
  }
}

proxyProc.on('error', (err) => {
  console.error('[claude-proxy] Failed to start proxy process:', err.message);
  process.exit(1);
});

proxyProc.on('exit', (code, signal) => {
  console.error(`[claude-proxy] Proxy exited (code=${code} signal=${signal})`);
  process.exit(code ?? 1);
});

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Auth middleware ───────────────────────────────────────────────────────────
// Set API_KEY env var to enable. Protects /v1/* only.
// /health and the dashboard (/) are always open — health for Docker
// HEALTHCHECK, dashboard for external uptime probes (e.g. Pangolin).
const API_KEY = process.env.API_KEY || '';

function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // no key set → open access
  // Accept both OpenAI style (Authorization: Bearer <key>) and Azure/OpenAI
  // module style (api-key: <key>) so generic connectors work unmodified.
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  const key = bearer || req.headers['api-key'] || '';
  if (key !== API_KEY) {
    // OpenAI error shape — connectors read error.message
    return res.status(401).json(openaiError(
      'Incorrect API key provided. Set your key in the Authorization: Bearer header (or api-key header).',
      'invalid_request_error',
      'invalid_api_key',
    ));
  }
  // Strip our key before forwarding — claude-max-api uses its own token
  delete req.headers['authorization'];
  delete req.headers['api-key'];
  next();
}

// ── CORS for browser-based OpenAI-compatible clients ─────────────────────────
// Tools like OpenWebUI / Flowise call from the browser: the preflight OPTIONS
// carries no Authorization header, so it must short-circuit BEFORE auth.
function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, api-key');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

app.get('/favicon.ico', (_req, res) => res.status(204).end());

// JSON health endpoint — used by Docker HEALTHCHECK and monitoring tools.
// 200 once the internal proxy is up; 503 while still starting.
app.get('/health', (_req, res) => {
  const status = stats.ready ? 'ok' : 'starting';
  res
    .status(stats.ready ? 200 : 503)
    .json({
      status,
      uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000),
      requests: stats.requests,
      errors: stats.errors,
      auth_configured: !!process.env.CLAUDE_CODE_OAUTH_TOKEN, // upstream OAuth token present
      api_key_required: !!API_KEY,                            // clients must send Bearer API_KEY
      registry_ready: stats.registryReady,
      models: Object.keys(modelRegistry).length,
      port: PORT,
    });
});

// HTML status dashboard — public (no auth needed, it's just a status page).
// Markup lives in public/dashboard.html; see lib/dashboard.js for substitution.
app.get('/', (req, res) => {
  res.send(renderDashboard({
    stats,
    modelRegistry,
    port: PORT,
    hasToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
    authRequired: !!API_KEY,
    baseUrl: `${req.protocol}://${req.get('host')}`,
  }));
});

// ── Proxy all other requests to the internal claude-max-api ───────────────────
// CORS first (preflight must not hit auth), then auth on all /v1/* routes
app.use('/v1', cors, requireAuth);

// Parameters claude-max-api-proxy actually supports.
// Everything else is silently stripped to avoid errors.
const SUPPORTED_PARAMS = new Set([
  'model', 'messages', 'max_tokens', 'temperature', 'stream', 'stop',
]);

// Intercept /v1/chat/completions — normalize model + strip unsupported params.
// Cap the body so a giant POST can't exhaust memory.
app.use('/v1/chat/completions', express.json({ limit: '10mb' }), (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    // Strip unsupported params (keep only what claude-max-api understands)
    const { stripped, dropped } = stripParams(req.body, SUPPORTED_PARAMS);
    if (dropped.length) {
      console.warn(`[claude-proxy] Stripped unsupported params: ${dropped.join(', ')}`);
    }
    // Normalize model name
    if (stripped.model) {
      req._requestedModel = normalizeModel(stripped.model);
      stripped.model = req._requestedModel;
    }
    const raw = JSON.stringify(stripped);
    req.headers['content-length'] = String(Buffer.byteLength(raw));
    req.rawBody = raw;
  }
  next();
});

const { Transform } = require('stream');

const proxyMiddleware = createProxyMiddleware({
  target: `http://127.0.0.1:${INTERNAL_PORT}`,
  changeOrigin: false,
  ws: true,
  selfHandleResponse: true,
  // Generous — LLM completions stream for a long time. Guards against a wedged
  // upstream leaving client sockets open forever.
  timeout: 600000,
  proxyTimeout: 600000,
  on: {
    proxyReq: (proxyReq, req) => {
      stats.requests++;
      if (req.rawBody) {
        proxyReq.write(req.rawBody);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
      // If the upstream socket dies mid-response, don't leave the client hanging.
      proxyRes.on('error', (err) => {
        stats.errors++;
        console.error('[claude-proxy] Upstream response error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify(openaiError(
            `Upstream response error: ${err.message}`, 'api_error', 'upstream_error',
          )));
        } else {
          res.end();
        }
      });
      // If the client goes away, stop pulling from upstream.
      res.on('close', () => proxyRes.destroy());

      const model = req._requestedModel;
      const isCompletion = req.path && req.path.includes('/v1/chat/completions');

      if (!model || !isCompletion) {
        // Pass through unchanged
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }

      const contentType = proxyRes.headers['content-type'] || '';

      // Strip content-length — body size changes when we rewrite the model field
      const headers = { ...proxyRes.headers };
      delete headers['content-length'];
      res.writeHead(proxyRes.statusCode, headers);

      if (contentType.includes('text/event-stream')) {
        // Streaming SSE — replace model field in each chunk
        const fixer = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, chunk.toString().replace(/"model"\s*:\s*"[^"]*"/g, `"model":"${model}"`));
          },
        });
        proxyRes.pipe(fixer).pipe(res);
      } else {
        // Non-streaming — buffer, parse, fix, send
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          const buf = Buffer.concat(chunks);
          try {
            const json = JSON.parse(buf.toString());
            json.model = model;
            res.end(JSON.stringify(json));
          } catch (err) {
            console.error('[claude-proxy] Could not parse upstream JSON:', err.message);
            res.end(buf);
          }
        });
      }
    },
    error: (_err, _req, res) => {
      stats.errors++;
      if (res && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify(openaiError(
          stats.ready
            ? 'Upstream error — check container logs'
            : 'Proxy is still starting, retry in a few seconds',
          'api_error',
          'proxy_unavailable',
        )));
      }
    },
  },
});

app.use(proxyMiddleware);

// ── HTTP server (WebSocket-aware) ─────────────────────────────────────────────
const server = http.createServer(app);
server.on('upgrade', proxyMiddleware.upgrade);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[claude-proxy] Listening on :${PORT}`);
  console.log(`[claude-proxy] Dashboard → http://localhost:${PORT}/`);
  console.log(`[claude-proxy] Health    → http://localhost:${PORT}/health`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On docker stop / scale-down, stop accepting connections and kill the child
// proxy so it doesn't outlive us. Force-exit if it hangs.
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[claude-proxy] Received ${sig}, shutting down…`);
  const done = () => process.exit(0);
  server.close(done);
  try { proxyProc.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => process.exit(0), 10000).unref();
}
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => shutdown(sig)));
