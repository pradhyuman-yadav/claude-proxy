'use strict';

const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

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
  env: process.env,
});

proxyProc.on('spawn', () => {
  // Give it a few seconds to bind and authenticate
  setTimeout(() => {
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

app.get('/favicon.ico', (_req, res) => res.status(204).end());

// JSON health endpoint — used by Docker HEALTHCHECK and monitoring tools
app.get('/health', (_req, res) => {
  const status = stats.ready ? 'ok' : 'starting';
  res
    .status(stats.ready ? 200 : 503)
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
app.get('/', (_req, res) => {
  const sec = Math.floor((Date.now() - stats.startTime) / 1000);
  const uptime = `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  const online = stats.ready;
  const hasToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const dotColor = online ? '#22c55e' : '#f59e0b';
  const tokenBg = hasToken ? '#052e16' : '#450a0a';
  const tokenFg = hasToken ? '#4ade80' : '#f87171';
  const tokenBorder = hasToken ? '#166534' : '#7f1d1d';
  const errorFg = stats.errors > 0 ? '#f87171' : '#fafafa';

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
      display: grid;
      place-items: center;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 40px 48px;
      width: min(480px, 95vw);
    }
    .header { display: flex; align-items: center; gap: 14px; margin-bottom: 32px; }
    .icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
      border-radius: 12px;
      display: grid; place-items: center;
      font-size: 22px; flex-shrink: 0;
    }
    .title { font-size: 20px; font-weight: 650; color: #fafafa; letter-spacing: -.3px; }
    .subtitle { font-size: 12px; color: #71717a; margin-top: 3px; }
    .status-pill {
      display: flex; align-items: center; gap: 10px;
      background: #09090b; border: 1px solid #27272a;
      border-radius: 10px; padding: 14px 18px; margin-bottom: 16px;
    }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: ${dotColor}; box-shadow: 0 0 8px ${dotColor};
      flex-shrink: 0; animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .6; }
    }
    .status-label { font-size: 15px; font-weight: 500; flex: 1; }
    .badge {
      font-size: 11px; padding: 3px 9px; border-radius: 5px;
      background: ${tokenBg}; color: ${tokenFg};
      border: 1px solid ${tokenBorder};
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .metric {
      background: #09090b; border: 1px solid #27272a;
      border-radius: 10px; padding: 14px 16px;
    }
    .metric-label {
      font-size: 10px; color: #71717a;
      text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px;
    }
    .metric-value {
      font-size: 24px; font-weight: 650; color: #fafafa;
      font-variant-numeric: tabular-nums;
    }
    .metric-value.small { font-size: 16px; }
    .footer { font-size: 11px; color: #52525b; text-align: center; }
    .footer a { color: #71717a; text-decoration: none; }
    .footer a:hover { color: #a1a1aa; }
  </style>
</head>
<body>
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
        <div class="metric-value small">${uptime}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Port</div>
        <div class="metric-value small">:${PORT}</div>
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

    <div class="footer">
      Auto-refreshes every 30s &nbsp;&middot;&nbsp;
      <a href="/health">/health JSON</a>
    </div>
  </div>
</body>
</html>`);
});

// ── Proxy all other requests to the internal claude-max-api ───────────────────
const proxyMiddleware = createProxyMiddleware({
  target: `http://127.0.0.1:${INTERNAL_PORT}`,
  changeOrigin: false,
  ws: true,
  on: {
    proxyReq: () => { stats.requests++; },
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
