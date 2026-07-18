'use strict';

// Pure, side-effect-free helpers shared by the server and its tests.

// Compare dotted/hyphenated version parts numerically: [4,5] > [4,1] > [4].
// Date suffixes (20250929) are just large numbers and sort naturally.
function versionParts(v) {
  return v.split(/[-.]/).map(Number).filter(n => !Number.isNaN(n));
}
function versionGte(a, b) {
  const pa = versionParts(a), pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// Build an alias→canonical-id map from the /v1/models `data` array.
// Handles any version shape upstream reports — "claude-sonnet-4",
// "claude-sonnet-4-5", "claude-opus-4-1-20250805" — and points family
// shorthand at the NEWEST version so new releases win automatically:
//   sonnet            → newest claude-sonnet-*
//   claude-sonnet     → newest claude-sonnet-*
//   claude-sonnet-4-5 → itself (exact ids always resolve)
function buildRegistry(data = []) {
  const registry = {};
  const latest = {}; // family → version string of current winner
  for (const { id } of data) {
    const m = String(id).match(/^claude-([a-z]+)-(\d[\d.-]*)$/i);
    if (!m) continue;
    const [, family, version] = m;
    registry[id.toLowerCase()] = id; // exact id → itself
    if (latest[family] === undefined || versionGte(version, latest[family])) {
      latest[family] = version;
      registry[family] = id;
      registry[`claude-${family}`] = id;
    }
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
