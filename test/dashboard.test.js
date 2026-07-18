'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboard, renderModelRows } = require('../lib/dashboard');

const REGISTRY = {
  sonnet: 'claude-sonnet-4',
  'claude-sonnet': 'claude-sonnet-4',
  'claude-sonnet-4': 'claude-sonnet-4',
};

function render(overrides = {}) {
  return renderDashboard({
    stats: { startTime: Date.now(), requests: 3, errors: 0, ready: true },
    modelRegistry: REGISTRY,
    port: 3456,
    hasToken: true,
    authRequired: false,
    baseUrl: 'http://example.com',
    ...overrides,
  });
}

test('renderModelRows lists canonical ids with aliases', () => {
  const rows = renderModelRows(REGISTRY);
  assert.match(rows, /claude-sonnet-4/);
  assert.match(rows, /<code>sonnet<\/code>/);
});

test('renderModelRows shows Loading when registry empty', () => {
  assert.match(renderModelRows({}), /Loading/);
});

test('renderDashboard substitutes every {{placeholder}}', () => {
  const html = render();
  // No unresolved word-token placeholders should remain
  assert.doesNotMatch(html, /\{\{\w+\}\}/);
});

test('renderDashboard injects dynamic values', () => {
  const html = render({ stats: { startTime: Date.now(), requests: 42, errors: 0, ready: true } });
  assert.match(html, /http:\/\/example\.com\/v1/);
  assert.match(html, />42</);          // request count
  assert.match(html, /ONLINE/);
  assert.match(html, /3456/);          // port
});

test('renderDashboard reflects starting / absent-token state', () => {
  const html = render({ hasToken: false, stats: { startTime: Date.now(), requests: 0, errors: 0, ready: false } });
  assert.match(html, /STARTING/);
  assert.match(html, /ABSENT/);
});

test('gemini models render with backend column when provided', () => {
  const html = render({
    geminiEnabled: true,
    geminiModels: [{ id: 'models/gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }],
  });
  assert.match(html, /<code>gemini-2\.5-pro<\/code>/);
  assert.match(html, /<td>gemini<\/td>/);
  assert.match(html, /ENABLED/);
});

test('gemini disabled shows DISABLED and no gemini rows', () => {
  const html = render({ geminiEnabled: false, geminiModels: [] });
  assert.match(html, /DISABLED/);
  assert.doesNotMatch(html, /<td>gemini<\/td>/);
});

test('renderDashboard renders param rows from capabilities', () => {
  const html = render();
  assert.match(html, /<code>max_tokens<\/code>/);
  assert.match(html, /max_completion_tokens accepted as alias/);
  assert.match(html, /Function calling unsupported/);
  assert.doesNotMatch(html, /\{\{paramRows\}\}/);
});

test('setup mode shows the notice and SETUP REQUIRED status', () => {
  const html = render({ setupMode: true, hasToken: false });
  assert.match(html, /SETUP REQUIRED/);
  assert.match(html, /Setup required/);
  assert.match(html, /\/terminal/);
});

test('normal mode has no setup notice', () => {
  const html = render();
  assert.doesNotMatch(html, /Setup required/);
});

test('renderDashboard shows CLI version when provided', () => {
  assert.match(render({ cliVersion: '2.1.0 (Claude Code)' }), /2\.1\.0 \(Claude Code\)/);
  assert.match(render(), /Claude Code unknown/);
});

test('renderDashboard contains no emoji', () => {
  const html = render({ authRequired: true, hasToken: false });
  // No characters outside the Basic Multilingual Plane (emoji live in astral planes)
  assert.doesNotMatch(html, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2713}\u{2717}]/u);
});

test('renderDashboard leaves n8n {{ $json.text }} untouched', () => {
  const html = render();
  assert.match(html, /\{\{ \$json\.text \}\}/);
});

test('open access: examples use "any" and show OPEN label', () => {
  const html = render({ authRequired: false });
  assert.match(html, /Bearer any/);
  assert.match(html, /api_key="any"/);
  assert.match(html, /OPEN/);
  assert.doesNotMatch(html, /YOUR_API_KEY/);
});

test('API_KEY set: examples require the key and show REQUIRED label', () => {
  const html = render({ authRequired: true });
  assert.match(html, /Bearer YOUR_API_KEY/);
  assert.match(html, /api_key="YOUR_API_KEY"/);
  assert.match(html, /REQUIRED/);
  assert.match(html, /required — your/);    // the api_key note
  assert.doesNotMatch(html, /Bearer any/);
});
