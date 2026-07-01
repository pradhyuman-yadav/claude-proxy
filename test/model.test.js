'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistry, normalizeModel, stripParams } = require('../lib/model');

// Mirrors SUPPORTED_PARAMS in server.js
const SUPPORTED = new Set(['model', 'messages', 'max_tokens', 'temperature', 'stream', 'stop']);

const MODELS = [
  { id: 'claude-sonnet-4' },
  { id: 'claude-opus-4' },
  { id: 'claude-haiku-4' },
];
const REGISTRY = buildRegistry(MODELS);

test('buildRegistry creates family, claude-family, and versioned aliases', () => {
  assert.equal(REGISTRY['sonnet'], 'claude-sonnet-4');
  assert.equal(REGISTRY['claude-sonnet'], 'claude-sonnet-4');
  assert.equal(REGISTRY['claude-sonnet-4'], 'claude-sonnet-4');
  assert.equal(REGISTRY['opus'], 'claude-opus-4');
});

test('buildRegistry ignores malformed ids', () => {
  const r = buildRegistry([{ id: 'gpt-4' }, { id: 'claude-sonnet' }, { id: '' }]);
  assert.deepEqual(r, {});
});

test('buildRegistry tolerates empty / missing input', () => {
  assert.deepEqual(buildRegistry(), {});
  assert.deepEqual(buildRegistry([]), {});
});

test('normalizeModel resolves shorthand aliases', () => {
  assert.equal(normalizeModel('sonnet', REGISTRY), 'claude-sonnet-4');
  assert.equal(normalizeModel('claude-opus', REGISTRY), 'claude-opus-4');
});

test('normalizeModel strips dot-notation minor version', () => {
  assert.equal(normalizeModel('claude-sonnet-4.6', REGISTRY), 'claude-sonnet-4');
});

test('normalizeModel strips hyphenated minor version', () => {
  assert.equal(normalizeModel('claude-sonnet-4-6', REGISTRY), 'claude-sonnet-4');
});

test('normalizeModel passes through unknown models unchanged', () => {
  assert.equal(normalizeModel('gpt-4o', REGISTRY), 'gpt-4o');
});

test('normalizeModel handles empty input', () => {
  assert.equal(normalizeModel('', REGISTRY), '');
  // default param coerces undefined → '' (matches server behavior)
  assert.equal(normalizeModel(undefined, REGISTRY), '');
});

test('stripParams keeps only supported keys', () => {
  const body = {
    model: 'sonnet',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
    temperature: 0,
    stream: true,
    stop: ['x'],
    tools: [{ type: 'function' }],
    top_p: 0.9,
    n: 2,
    response_format: { type: 'json_object' },
  };
  const { stripped, dropped } = stripParams(body, SUPPORTED);
  assert.deepEqual(Object.keys(stripped).sort(),
    ['max_tokens', 'messages', 'model', 'stop', 'stream', 'temperature']);
  assert.deepEqual(dropped.sort(), ['n', 'response_format', 'tools', 'top_p']);
});

test('stripParams tolerates null/empty body', () => {
  assert.deepEqual(stripParams(null, SUPPORTED), { stripped: {}, dropped: [] });
  assert.deepEqual(stripParams({}, SUPPORTED), { stripped: {}, dropped: [] });
});
