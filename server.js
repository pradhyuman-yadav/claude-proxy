'use strict';

const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

// ── Dynamic model registry ────────────────────────────────────────────────────
// Built at startup by querying /v1/models from the internal proxy.
// Maps family aliases → latest canonical model id reported by claude-max-api.
//   "sonnet"            → "claude-sonnet-4"
//   "claude-sonnet"     → "claude-sonnet-4"
//   "claude-sonnet-4-6" → "claude-sonnet-4"  (strip minor, then alias lookup)
// When a new model family is added upstream, it appears here automatically.

let modelRegistry = {}; // populated after internal proxy starts

async function buildModelRegistry() {
  try {
    const res = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/v1/models`);
    const { data = [] } = await res.json();
    const registry = {};
    for (const { id } of data) {
      // id e.g. "claude-sonnet-4"
      // Extract family = "sonnet", major = "4"
      const m = id.match(/^claude-([a-z]+)-(\d+)$/i);
      if (!m) continue;
      const [, family, major] = m;
      // Alias: "sonnet" → id, "claude-sonnet" → id, "claude-sonnet-4" → id
      registry[family]                    = id;
      registry[`claude-${family}`]        = id;
      registry[`claude-${family}-${major}`] = id;
    }
    modelRegistry = registry;
    console.log('[claude-proxy] Model registry built:', JSON.stringify(registry));
  } catch (err) {
    console.warn('[claude-proxy] Could not build model registry:', err.message);
  }
}

function normalizeModel(name = '') {
  if (!name) return name;
  // 1. Strip dot notation:  claude-sonnet-4.6 → claude-sonnet-4
  // 2. Strip minor version: claude-sonnet-4-6 → claude-sonnet-4
  const base = name
    .replace(/^(claude-[a-z]+-\d+)\.\d+$/i, '$1')
    .replace(/^(claude-[a-z]+-\d+)-\d+$/i, '$1');
  // 3. Lookup in registry (covers shorthand like "sonnet", "claude-sonnet")
  return modelRegistry[base.toLowerCase()] ?? modelRegistry[name.toLowerCase()] ?? base;
}

const PORT = parseInt(process.env.PORT ?? '3456', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT ?? '13456', 10);

const stats = {
  startTime: Date.now(),
  requests: 0,
  errors: 0,
  ready: false,
};

// ── Spawn the underlying claude-max-api proxy on an internal port ────────────
const proxyProc = spawn('claude-max-api', [String(INTERNAL_PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: String(INTERNAL_PORT) },
});

proxyProc.on('spawn', () => {
  // Give it a few seconds to bind and authenticate
  setTimeout(async () => {
    await buildModelRegistry();
    stats.ready = true;
    console.log(`[claude-proxy] Internal proxy ready on :${INTERNAL_PORT}`);
  }, 5000);
});

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
// Set API_KEY env var to enable. Protects /v1/* and the dashboard.
// /health is always open (needed for Docker HEALTHCHECK).
const API_KEY = process.env.API_KEY || '';

function requireAuth(req, res, next) {
  if (!API_KEY) return next(); // no key set → open access
  const auth = req.headers['authorization'] || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (key === API_KEY) return next();
  res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key.' });
}

app.get('/favicon.ico', (_req, res) => res.status(204).end());

// JSON health endpoint — used by Docker HEALTHCHECK and monitoring tools
app.get('/health', (_req, res) => {
  const status = stats.ready ? 'ok' : 'starting';
  res
    .status(200)
    .json({
      status,
      uptime_seconds: Math.floor((Date.now() - stats.startTime) / 1000),
      requests: stats.requests,
      errors: stats.errors,
      auth_configured: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
      port: PORT,
    });
});

// HTML status dashboard
app.get('/', requireAuth, (req, res) => {
  const sec = Math.floor((Date.now() - stats.startTime) / 1000);
  const uptime = `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  const online = stats.ready;
  const hasToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const dotColor = online ? '#22c55e' : '#f59e0b';
  const tokenBg = hasToken ? '#052e16' : '#450a0a';
  const tokenFg = hasToken ? '#4ade80' : '#f87171';
  const tokenBorder = hasToken ? '#166534' : '#7f1d1d';
  const errorFg = stats.errors > 0 ? '#f87171' : '#fafafa';

  // Build model list from registry (deduplicate to canonical ids)
  const canonicalModels = [...new Set(Object.values(modelRegistry))].sort();
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  // Build alias display: canonical → all accepted aliases
  const aliasMap = {};
  for (const [alias, canonical] of Object.entries(modelRegistry)) {
    if (!aliasMap[canonical]) aliasMap[canonical] = [];
    if (alias !== canonical) aliasMap[canonical].push(alias);
  }

  const modelRows = canonicalModels.length
    ? canonicalModels.map(m => {
        const aliases = (aliasMap[m] || []).map(a => `<code>${a}</code>`).join(' ');
        return `<tr><td><code>${m}</code></td><td>${aliases}</td></tr>`;
      }).join('')
    : '<tr><td colspan="2" style="color:#71717a">Loading…</td></tr>';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Claude Proxy — Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #e4e4e7;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      padding: 40px 16px;
    }
    .wrap { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 28px 32px;
    }
    .header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
    .icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
      border-radius: 12px; display: grid; place-items: center;
      font-size: 22px; flex-shrink: 0;
    }
    .title { font-size: 20px; font-weight: 650; color: #fafafa; letter-spacing: -.3px; }
    .subtitle { font-size: 12px; color: #71717a; margin-top: 3px; }
    .status-pill {
      display: flex; align-items: center; gap: 10px;
      background: #09090b; border: 1px solid #27272a;
      border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;
    }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: ${dotColor}; box-shadow: 0 0 8px ${dotColor};
      flex-shrink: 0; animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
    .status-label { font-size: 15px; font-weight: 500; flex: 1; }
    .badge {
      font-size: 11px; padding: 3px 9px; border-radius: 5px;
      background: ${tokenBg}; color: ${tokenFg}; border: 1px solid ${tokenBorder};
    }
    .grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
    @media(max-width:520px){ .grid { grid-template-columns: 1fr 1fr; } }
    .metric {
      background: #09090b; border: 1px solid #27272a;
      border-radius: 10px; padding: 12px 14px;
    }
    .metric-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing:.06em; margin-bottom:5px; }
    .metric-value { font-size: 20px; font-weight: 650; color: #fafafa; font-variant-numeric: tabular-nums; }
    .metric-value.sm { font-size: 14px; }
    .section-title {
      font-size: 11px; font-weight: 600; color: #71717a;
      text-transform: uppercase; letter-spacing: .08em; margin-bottom: 12px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-size: 10px; color: #71717a; text-transform: uppercase;
         letter-spacing:.06em; padding: 0 0 8px; border-bottom: 1px solid #27272a; }
    td { padding: 8px 0; border-bottom: 1px solid #1c1c1f; vertical-align: top; }
    td:first-child { padding-right: 16px; white-space: nowrap; }
    tr:last-child td { border-bottom: none; }
    code {
      background: #09090b; border: 1px solid #27272a;
      border-radius: 4px; padding: 1px 6px; font-size: 12px;
      font-family: 'Cascadia Code', 'Fira Code', monospace; color: #a78bfa;
    }
    pre {
      background: #09090b; border: 1px solid #27272a;
      border-radius: 8px; padding: 14px 16px; overflow-x: auto;
      font-size: 12px; font-family: 'Cascadia Code', 'Fira Code', monospace;
      color: #a1a1aa; line-height: 1.6;
    }
    .url-box {
      display: flex; align-items: center; gap: 8px;
      background: #09090b; border: 1px solid #27272a;
      border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;
    }
    .url-label { font-size: 11px; color: #71717a; white-space: nowrap; }
    .url-val { font-family: monospace; font-size: 13px; color: #c4b5fd; flex: 1; }
    .footer { font-size: 11px; color: #52525b; text-align: center; padding-top: 4px; }
    .footer a { color: #71717a; text-decoration: none; }
    .footer a:hover { color: #a1a1aa; }
    .tag { display:inline-block; font-size:10px; padding:1px 6px; border-radius:3px;
           background:#1e1b4b; color:#818cf8; border:1px solid #312e81; margin-right:3px; }
  </style>
</head>
<body>
<div class="wrap">

  <!-- Header + status -->
  <div class="card">
    <div class="header">
      <div class="icon">&#x26A1;</div>
      <div>
        <div class="title">Claude Proxy</div>
        <div class="subtitle">OpenAI-compatible API &middot; Claude Max/Pro subscription</div>
      </div>
    </div>

    <div class="status-pill">
      <div class="dot"></div>
      <span class="status-label">${online ? 'Online' : 'Starting&hellip;'}</span>
      <span class="badge">${hasToken ? '&#x2713; Auth configured' : '&#x2717; No token'}</span>
    </div>

    <div class="grid">
      <div class="metric">
        <div class="metric-label">Uptime</div>
        <div class="metric-value sm">${uptime}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Port</div>
        <div class="metric-value sm">:${PORT}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Requests</div>
        <div class="metric-value">${stats.requests}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Errors</div>
        <div class="metric-value" style="color:${errorFg}">${stats.errors}</div>
      </div>
    </div>
  </div>

  <!-- Models -->
  <div class="card">
    <div class="section-title">Available Models</div>
    <table>
      <thead><tr><th>Model ID</th><th>Accepted aliases</th></tr></thead>
      <tbody>${modelRows}</tbody>
    </table>
  </div>

  <!-- Usage -->
  <div class="card">
    <div class="section-title">How to Use</div>

    <div class="url-box">
      <span class="url-label">Base URL</span>
      <span class="url-val">${baseUrl}/v1</span>
    </div>

    <div style="margin-bottom:10px;font-size:12px;color:#71717a">
      <span class="tag">api_key</span> Any value — ignored by proxy, auth via subscription token.
    </div>

    <div style="margin-bottom:8px;font-size:12px;color:#a1a1aa;font-weight:500">curl</div>
<pre>curl -X POST ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer any" \\
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</pre>

    <div style="margin:12px 0 8px;font-size:12px;color:#a1a1aa;font-weight:500">Python (openai SDK)</div>
<pre>from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="any",
)
resp = client.chat.completions.create(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)</pre>

    <div style="margin:12px 0 8px;font-size:12px;color:#a1a1aa;font-weight:500">n8n HTTP node</div>
<pre>Method: POST
URL:    ${baseUrl}/v1/chat/completions
Body (JSON):
{
  "model": "claude-sonnet-4",
  "messages": [{"role":"user","content":"={{ $json.text }}"}],
  "temperature": 0,
  "max_tokens": 100
}</pre>
  </div>

  <div class="footer">
    Auto-refreshes every 30s &nbsp;&middot;&nbsp;
    <a href="/health">/health JSON</a> &nbsp;&middot;&nbsp;
    <a href="/v1/models">/v1/models</a>
  </div>

</div>
</body>
</html>`);
});

// ── Proxy all other requests to the internal claude-max-api ───────────────────
// Auth on all /v1/* routes
app.use('/v1', requireAuth);

// Intercept /v1/chat/completions to normalize model name and fix response.
app.use('/v1/chat/completions', express.json(), (req, _res, next) => {
  if (req.body && req.body.model) {
    req._requestedModel = normalizeModel(req.body.model); // store for response fixup
    req.body.model = req._requestedModel;
    const raw = JSON.stringify(req.body);
    req.headers['content-length'] = Buffer.byteLength(raw);
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
  on: {
    proxyReq: (proxyReq, req) => {
      stats.requests++;
      if (req.rawBody) {
        proxyReq.write(req.rawBody);
        proxyReq.end();
      }
    },
    proxyRes: (proxyRes, req, res) => {
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
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            json.model = model;
            res.end(JSON.stringify(json));
          } catch {
            res.end(Buffer.concat(chunks));
          }
        });
      }
    },
    error: (_err, _req, res) => {
      stats.errors++;
      if (res && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: 'proxy_unavailable',
          message: stats.ready
            ? 'Upstream error — check container logs'
            : 'Proxy is still starting, retry in a few seconds',
        }));
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
