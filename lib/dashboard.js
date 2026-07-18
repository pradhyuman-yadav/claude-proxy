'use strict';

const fs = require('fs');
const path = require('path');
const { renderParamRows } = require('./capabilities');

// Loaded once at startup; the dashboard is static markup with {{placeholder}}s.
const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'dashboard.html'),
  'utf8',
);

// Build the "Available Models" table rows: Claude registry + Gemini list.
function renderModelRows(modelRegistry, geminiModels = []) {
  const canonicalModels = [...new Set(Object.values(modelRegistry))].sort();
  if (!canonicalModels.length && !geminiModels.length) {
    return '<tr><td colspan="3" style="color:#71717a">Loading…</td></tr>';
  }
  // canonical id → list of aliases pointing at it
  const aliasMap = {};
  for (const [alias, canonical] of Object.entries(modelRegistry)) {
    if (!aliasMap[canonical]) aliasMap[canonical] = [];
    if (alias !== canonical) aliasMap[canonical].push(alias);
  }
  const claudeRows = canonicalModels.map(m => {
    const aliases = (aliasMap[m] || []).map(a => `<code>${a}</code>`).join(' ');
    return `<tr><td><code>${m}</code></td><td>claude</td><td>${aliases}</td></tr>`;
  });
  const geminiRows = geminiModels
    .map(m => String(m.id).replace(/^models\//, ''))
    .sort()
    .map(id => `<tr><td><code>${id}</code></td><td>gemini</td><td></td></tr>`);
  return [...claudeRows, ...geminiRows].join('');
}

// Render the status dashboard. Only substitutes {{word}} tokens, so literal
// double-brace content in examples (e.g. n8n's {{ $json.text }}) is left alone.
//
//   hasToken     — a Claude subscription OAuth token is configured (upstream auth)
//   authRequired — an API_KEY is set, so clients MUST send it as a Bearer token
function renderDashboard({ stats, modelRegistry, port, hasToken, authRequired, baseUrl, cliVersion, setupMode, geminiEnabled, geminiMode, geminiModels }) {
  const sec = Math.floor((Date.now() - stats.startTime) / 1000);
  const online = stats.ready;

  const setupNotice = setupMode
    ? `<div class="notice">
        <div class="t">Setup required</div>
        No Claude credentials found. Open <a href="/terminal/">/terminal</a> to run the
        interactive login in your browser (no token pasting needed), then use
        <em>restart proxy</em> in the footer. Alternatively set
        <code>CLAUDE_CODE_OAUTH_TOKEN</code> and redeploy.
      </div>`
    : '';

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
    statusLabel: setupMode ? 'SETUP REQUIRED' : (online ? 'ONLINE' : 'STARTING'),
    statusColor: setupMode ? RED : (online ? GREEN : AMBER),
    cliVersion: cliVersion || 'unknown',
    setupNotice,
    paramRows: renderParamRows(),
    tokenLabel: hasToken ? 'CONFIGURED' : 'ABSENT',
    tokenColor: hasToken ? GREEN : RED,
    authLabel: authRequired ? 'REQUIRED' : 'OPEN',
    authColor: authRequired ? GREEN : RED,
    geminiLabel: geminiEnabled ? `ENABLED (${(geminiMode || 'api').toUpperCase()})` : 'DISABLED',
    geminiColor: geminiEnabled ? GREEN : '#6f6a5c',
    errorColor: stats.errors > 0 ? RED : INK,
    apiKeyValue,
    apiKeyNote,
    uptime: `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`,
    port: String(port),
    requests: String(stats.requests),
    errors: String(stats.errors),
    modelCount: String(new Set(Object.values(modelRegistry)).size + (geminiModels?.length || 0)),
    modelRows: renderModelRows(modelRegistry, geminiModels),
    baseUrl,
  };

  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
  );
}

module.exports = { renderDashboard, renderModelRows };
