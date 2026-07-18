'use strict';

// Single source of truth for what the proxy forwards to claude-max-api.
// The request-stripping logic AND the dashboard table both derive from this
// list, so behavior and documentation cannot drift apart.
//
// Note: models are discovered live from /v1/models at startup. Parameter
// support cannot be discovered the same way — claude-max-api exposes no
// capabilities endpoint — so this table is the one place to update.
const CAPABILITIES = [
  { keys: ['model'],        supported: true,  note: 'Normalized to canonical ID' },
  { keys: ['messages'],     supported: true,  note: 'system / user / assistant roles' },
  { keys: ['max_tokens'],   supported: true,  note: 'max_completion_tokens accepted as alias' },
  { keys: ['temperature'],  supported: true,  note: '0 – 1' },
  { keys: ['stream'],       supported: true,  note: 'SSE streaming' },
  { keys: ['stop'],         supported: true,  note: 'Stop sequences' },
  { keys: ['tools', 'tool_choice'],  supported: false, note: 'Function calling unsupported' },
  { keys: ['top_p', 'top_k'],        supported: false, note: 'Stripped' },
  { keys: ['n'],                     supported: false, note: 'One completion per request' },
  { keys: ['presence_penalty', 'frequency_penalty'], supported: false, note: 'Stripped' },
  { keys: ['logprobs', 'logit_bias'],                supported: false, note: 'Stripped' },
  { keys: ['response_format'],       supported: false, note: 'Use prompt instructions' },
  { keys: [], label: 'Vision / image inputs', supported: false, note: 'Text only' },
];

// The set consumed by the request-body stripper.
const SUPPORTED_PARAMS = new Set(
  CAPABILITIES.filter(c => c.supported).flatMap(c => c.keys),
);

// Dashboard table rows, rendered from the same data.
function renderParamRows() {
  return CAPABILITIES.map(c => {
    const name = c.label ?? c.keys.map(k => `<code>${k}</code>`).join(' / ');
    const support = c.supported
      ? '<span class="yes">yes</span>'
      : '<span class="no">no</span>';
    return `<tr><td>${name}</td><td>${support}</td><td>${c.note}</td></tr>`;
  }).join('');
}

module.exports = { CAPABILITIES, SUPPORTED_PARAMS, renderParamRows };
