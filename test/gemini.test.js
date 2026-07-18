'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGeminiId, isGeminiModel, mergedModels } = require('../lib/gemini');

test('isGeminiModel routes gemini names to the Gemini backend', () => {
  assert.equal(isGeminiModel('gemini-2.5-pro'), true);
  assert.equal(isGeminiModel('models/gemini-2.5-flash'), true);
  assert.equal(isGeminiModel('Gemini-2.5-pro'), true);
});

test('isGeminiModel leaves Claude names on the Claude path', () => {
  assert.equal(isGeminiModel('claude-sonnet-4'), false);
  assert.equal(isGeminiModel('sonnet'), false);
  assert.equal(isGeminiModel(''), false);
  assert.equal(isGeminiModel(undefined), false);
});

test('normalizeGeminiId strips the models/ prefix', () => {
  assert.equal(normalizeGeminiId('models/gemini-2.5-pro'), 'gemini-2.5-pro');
  assert.equal(normalizeGeminiId('gemini-2.5-pro'), 'gemini-2.5-pro');
});

test('mergedModels combines both backends into one OpenAI list', () => {
  const out = mergedModels(
    [{ id: 'claude-sonnet-4', object: 'model' }],
    [{ id: 'models/gemini-2.5-pro', object: 'model' }],
  );
  assert.equal(out.object, 'list');
  assert.deepEqual(out.data.map(m => m.id), ['claude-sonnet-4', 'gemini-2.5-pro']);
});

test('mergedModels tolerates empty inputs', () => {
  assert.deepEqual(mergedModels(), { object: 'list', data: [] });
  assert.deepEqual(mergedModels([], []).data, []);
});
