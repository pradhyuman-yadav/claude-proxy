'use strict';

// Gemini backend — via Google's OFFICIAL OpenAI-compatible endpoint.
// https://ai.google.dev/gemini-api/docs/openai
//
// Deliberately NOT a Gemini-CLI OAuth proxy: Google actively suspends
// accounts that piggyback CLI/Antigravity OAuth tokens through third-party
// proxies (Feb 2026 enforcement). The official API key path is ToS-clean
// and has a free tier.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

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

module.exports = { GEMINI_BASE, normalizeGeminiId, isGeminiModel, mergedModels };
