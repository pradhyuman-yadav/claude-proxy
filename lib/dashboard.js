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
function renderDashboard({ stats, modelRegistry, port, hasToken, baseUrl }) {
  const sec = Math.floor((Date.now() - stats.startTime) / 1000);
  const online = stats.ready;

  const vars = {
    dotColor: online ? '#22c55e' : '#f59e0b',
    tokenBg: hasToken ? '#052e16' : '#450a0a',
    tokenFg: hasToken ? '#4ade80' : '#f87171',
    tokenBorder: hasToken ? '#166534' : '#7f1d1d',
    errorFg: stats.errors > 0 ? '#f87171' : '#fafafa',
    statusLabel: online ? 'Online' : 'Starting&hellip;',
    tokenBadge: hasToken ? '&#x2713; Auth configured' : '&#x2717; No token',
    uptime: `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`,
    port: String(port),
    requests: String(stats.requests),
    errors: String(stats.errors),
    modelRows: renderModelRows(modelRegistry),
    baseUrl,
  };

  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
  );
}

module.exports = { renderDashboard, renderModelRows };
