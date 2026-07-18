'use strict';

// Pure, side-effect-free helpers shared by the server and its tests.

// Build an alias→canonical-id map from the /v1/models `data` array.
//   [{ id: "claude-sonnet-4" }] →
//     { sonnet: "...", "claude-sonnet": "...", "claude-sonnet-4": "..." }
function buildRegistry(data = []) {
  const registry = {};
  for (const { id } of data) {
    // id e.g. "claude-sonnet-4" → family "sonnet", major "4"
    const m = String(id).match(/^claude-([a-z]+)-(\d+)$/i);
    if (!m) continue;
    const [, family, major] = m;
    registry[family] = id;
    registry[`claude-${family}`] = id;
    registry[`claude-${family}-${major}`] = id;
  }
  return registry;
}

// Resolve a requested model name to a canonical id using the registry.
//   claude-sonnet-4.6 → claude-sonnet-4   (strip dot minor)
//   claude-sonnet-4-6 → claude-sonnet-4   (strip hyphen minor)
//   sonnet            → claude-sonnet-4   (registry lookup)
function normalizeModel(name = '', registry = {}) {
  if (!name) return name;
  const base = name
    .replace(/^(claude-[a-z]+-\d+)\.\d+$/i, '$1')
    .replace(/^(claude-[a-z]+-\d+)-\d+$/i, '$1');
  return registry[base.toLowerCase()] ?? registry[name.toLowerCase()] ?? base;
}

// OpenAI-compatible spellings we translate before stripping.
// Newer OpenAI SDKs send max_completion_tokens instead of max_tokens.
const PARAM_ALIASES = {
  max_completion_tokens: 'max_tokens',
};

// Keep only supported keys, translating aliased spellings first.
// Returns { stripped, dropped }. An alias never overwrites an explicit value.
function stripParams(body, supported) {
  const stripped = {};
  const dropped = [];
  for (const key of Object.keys(body || {})) {
    const target = PARAM_ALIASES[key] ?? key;
    if (!supported.has(target)) {
      dropped.push(key);
    } else if (stripped[target] === undefined || target === key) {
      stripped[target] = body[key];
    }
  }
  return { stripped, dropped };
}

// OpenAI-style error body: { error: { message, type, code } }.
// Connectors parse error.message — a flat string there breaks them.
function openaiError(message, type, code) {
  return { error: { message, type, param: null, code } };
}

module.exports = { buildRegistry, normalizeModel, stripParams, openaiError };
