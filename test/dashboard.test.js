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
  assert.match(html, /Online/);
  assert.match(html, /:3456/);         // port
});

test('renderDashboard reflects starting / no-token state', () => {
  const html = render({ hasToken: false, stats: { startTime: Date.now(), requests: 0, errors: 0, ready: false } });
  assert.match(html, /Starting/);
  assert.match(html, /No token/);
});

test('renderDashboard leaves n8n {{ $json.text }} untouched', () => {
  const html = render();
  assert.match(html, /\{\{ \$json\.text \}\}/);
});

test('open access: examples use "any" and show open badge', () => {
  const html = render({ authRequired: false });
  assert.match(html, /Bearer any/);
  assert.match(html, /api_key="any"/);
  assert.match(html, /Open access/);
  assert.doesNotMatch(html, /YOUR_API_KEY/);
});

test('API_KEY set: examples require the key and show locked badge', () => {
  const html = render({ authRequired: true });
  assert.match(html, /Bearer YOUR_API_KEY/);
  assert.match(html, /api_key="YOUR_API_KEY"/);
  assert.match(html, /API key required/);
  assert.match(html, /Required —/);        // the api_key note
  assert.doesNotMatch(html, /Bearer any/);
});
