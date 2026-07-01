'use strict';

const fs = require('fs');
const path = require('path');

// Loaded once at startup; the dashboard is static markup with {{placeholder}}s.
const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'dashboard.html'),
  'utf8',
);

// Build the "Available Models" table rows from the registry.
function renderModelRows(modelRegistry) {
  const canonicalModels = [...new Set(Object.values(modelRegistry))].sort();
  if (!canonicalModels.length) {
    return '<tr><td colspan="2" style="color:#71717a">Loading…</td></tr>';
  }
  // canonical id → list of aliases pointing at it
  const aliasMap = {};
  for (const [alias, canonical] of Object.entries(modelRegistry)) {
    if (!aliasMap[canonical]) aliasMap[canonical] = [];
    if (alias !== canonical) aliasMap[canonical].push(alias);
  }
  return canonicalModels.map(m => {
    const aliases = (aliasMap[m] || []).map(a => `<code>${a}</code>`).join(' ');
    return `<tr><td><code>${m}</code></td><td>${aliases}</td></tr>`;
  }).join('');
}

// Render the status dashboard. Only substitutes {{word}} tokens, so literal
// double-brace content in examples (e.g. n8n's {{ $json.text }}) is left alone.
//
//   hasToken     — a Claude subscription OAuth token is configured (upstream auth)
//   authRequired — an API_KEY is set, so clients MUST send it as a Bearer token
function renderDashboard({ stats, modelRegistry, port, hasToken, authRequired, baseUrl }) {
  const sec = Math.floor((Date.now() - stats.startTime) / 1000);
  const online = stats.ready;

  // Placeholder used in the copy-paste examples. When an API_KEY is set the
  // examples must show a real key is required, not "any".
  const apiKeyValue = authRequired ? 'YOUR_API_KEY' : 'any';
  const apiKeyNote = authRequired
    ? 'required — your <code>API_KEY</code>, sent as the bearer token (else 401).'
    : 'any value; no <code>API_KEY</code> is set, so client keys are ignored.';

  const GREEN = '#2f6b3a';
  const RED = '#b23b2e';
  const AMBER = '#b45309';
  const INK = '#17150f';

  const vars = {
    statusLabel: online ? 'ONLINE' : 'STARTING',
    statusColor: online ? GREEN : AMBER,
    tokenLabel: hasToken ? 'CONFIGURED' : 'ABSENT',
    tokenColor: hasToken ? GREEN : RED,
    authLabel: authRequired ? 'REQUIRED' : 'OPEN',
    authColor: authRequired ? GREEN : RED,
    errorColor: stats.errors > 0 ? RED : INK,
    apiKeyValue,
    apiKeyNote,
    uptime: `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`,
    port: String(port),
    requests: String(stats.requests),
    errors: String(stats.errors),
    modelCount: String(new Set(Object.values(modelRegistry)).size),
    modelRows: renderModelRows(modelRegistry),
    baseUrl,
  };

  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
  );
}

module.exports = { renderDashboard, renderModelRows };
