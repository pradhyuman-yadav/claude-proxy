'use strict';

// Gemini backend — two modes, selected via GEMINI_BACKEND:
//
//   "api" — Google's official OpenAI-compatible endpoint using GEMINI_API_KEY.
//           ToS-clean, free tier. https://ai.google.dev/gemini-api/docs/openai
//   "cli" — CLIProxyAPI wrapping an Antigravity OAuth login (subscription).
//           NOTE: Google has suspended accounts using CLI/Antigravity OAuth
//           through third-party proxies. Use at your own risk.
//   "off" — Gemini disabled; gemini-* requests get a 400.
//
// Default when unset: "api" if GEMINI_API_KEY is present, else "cli".
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

function resolveGeminiMode(env = {}) {
  const raw = String(env.GEMINI_BACKEND || '').toLowerCase();
  if (raw === 'api' || raw === 'cli' || raw === 'off') return raw;
  return env.GEMINI_API_KEY ? 'api' : 'cli';
}

// CLIProxyAPI can list models from any provider the user logged in — keep
// only the Gemini family so the merged /v1/models has no duplicate ids.
function filterGeminiModels(data = []) {
  return data.filter(m => /^(models\/)?gemini/i.test(String(m?.id || '')));
}

// Google sometimes reports ids as "models/gemini-2.5-pro" — normalize.
function normalizeGeminiId(id) {
  return String(id).replace(/^models\//, '');
}

// Routing predicate: does this model belong to the Gemini backend?
function isGeminiModel(name) {
  return /^(models\/)?gemini/i.test(String(name || ''));
}

// Merge the two backends' /v1/models payloads into one OpenAI list.
function mergedModels(claudeData = [], geminiData = []) {
  return {
    object: 'list',
    data: [
      ...claudeData,
      ...geminiData.map(m => ({ ...m, id: normalizeGeminiId(m.id) })),
    ],
  };
}

module.exports = {
  GEMINI_BASE, normalizeGeminiId, isGeminiModel, mergedModels,
  resolveGeminiMode, filterGeminiModels,
};
