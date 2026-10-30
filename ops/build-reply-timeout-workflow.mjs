#!/usr/bin/env node
/**
 * Builds docs/n8n/fridgegraph-reply-timeout.workflow.json from ops/reply-parser.mjs.
 *
 * Why generated: D3's parser must be tested and deployed as the SAME text. The builder copies the
 * region between `// #region parser` and `// #endregion parser` verbatim into the Code node, and
 * ops/reply-parser.test.mjs fails if the committed JSON no longer contains it.
 *
 * D1: both webhooks authenticate with the "FridgeGraph GHL Action" header credential; n8n then
 *     stamps a fresh timestamp and calls https://fridgegraph.loomz.stream/voice-turn with the
 *     "FridgeGraph Voice Turn" credential.
 * D3: reply text is parsed here, deterministically. UNPARSED never reaches the tunnel.
 * D4: no-answer is forwarded as decision NO_ANSWER; the server stores it as its own source.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const mod = readFileSync(new URL('./reply-parser.mjs', import.meta.url), 'utf8')
const region = mod.match(/\/\/ #region parser\n([\s\S]*?)\/\/ #endregion parser/)
if (!region) { console.error('parser markers not found'); process.exit(1) }
const parser = region[1].trimEnd()

const GHL_ACTION_CRED = { id: 'r3SFGMCVCgINZFL7', name: 'FridgeGraph GHL Action' }
const VOICE_TURN_CRED = { id: 'MPoum0tgq94XPGvy', name: 'FridgeGraph Voice Turn' }
const TUNNEL = 'https://fridgegraph.loomz.stream/voice-turn'

const code = (name, id, jsCode, position, notes) => ({
  parameters: { jsCode }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
  ...(notes ? { notes } : {}),
})

// One "Decide" node per branch. It owns three outcomes: invalid, unparsed, forward.
const decideBody = (kind) => `
const j = $json ?? {};
const attemptId = typeof j.attemptId === 'string' && j.attemptId.trim() ? j.attemptId.trim() : null;

if (!attemptId) {
  return [{ json: { ok: false, httpCode: 400, status: 'BAD_REQUEST', note: 'attemptId required' } }];
}

const parsed = ${kind === 'reply'
  ? "parseReply(j.message ?? j.body ?? '');"
  : "{ decision: 'NO_ANSWER', declineReason: null };  // system-observed call outcome (D4)"}

if (parsed.decision === 'UNPARSED') {
  return [{ json: { ok: false, httpCode: 200, status: 'UNPARSED', note: 'no_state_change' } }];
}

const body = { attemptId, decision: parsed.decision };
if (parsed.declineReason) body.declineReason = parsed.declineReason;
// D2 correlation: only forwarded when the GHL payload actually carries one. Never invented.
const correlation = typeof j.eventId === 'string' ? j.eventId
  : (typeof j.messageId === 'string' ? j.messageId : null);
if (correlation) body.eventId = correlation;

return [{ json: {
  ok: true,
  httpCode: 200,
  status: parsed.decision,
  note: 'forwarded',
  matched: parsed.matched ?? null,
  timestamp: String(Math.floor(Date.now() / 1000)),
  body,
} }];
`.trim()

const nodes = [
  {
    parameters: {
      httpMethod: 'POST', path: 'ghl-reply', responseMode: 'responseNode',
      options: {}, authentication: 'headerAuth',
    },
    id: 'rt-hook-reply', name: 'GHL Reply', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [-460, 160], webhookId: 'ghl-reply',
    credentials: { httpHeaderAuth: GHL_ACTION_CRED },
    notes: 'D1: GHL Workflow "FG-SMS-Reply" posts {attemptId, message}. Header auth, no HMAC.',
  },
  {
    parameters: {
      httpMethod: 'POST', path: 'ghl-no-answer', responseMode: 'responseNode',
      options: {}, authentication: 'headerAuth',
    },
    id: 'rt-hook-noanswer', name: 'GHL No Answer', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [-460, 460], webhookId: 'ghl-no-answer',
    credentials: { httpHeaderAuth: GHL_ACTION_CRED },
    notes: 'D1: GHL Workflow "FG - No Answer" posts {attemptId}. Header auth, no HMAC.',
  },
  code('Decide Reply', 'rt-decide-reply', `${parser}\n${decideBody('reply')}`, [-160, 160],
    'D3: deterministic parser (single source: ops/reply-parser.mjs). No model runs here.'),
  code('Decide No Answer', 'rt-decide-noanswer', `${parser}\n${decideBody('no_answer')}`, [-160, 460],
    'D4: a no-answer is a system-observed outcome, not a decline. It is forwarded as NO_ANSWER.'),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'cond-forward-reply', leftValue: '={{ $json.ok }}', rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'rt-if-reply', name: 'Forward?', type: 'n8n-nodes-base.if', typeVersion: 2,
    position: [140, 160],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'cond-forward-na', leftValue: '={{ $json.ok }}', rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'rt-if-noanswer', name: 'Forward No Answer?', type: 'n8n-nodes-base.if', typeVersion: 2,
    position: [140, 460],
  },
  {
    parameters: {
      method: 'POST', url: TUNNEL, sendHeaders: true, specifiedHeaders: 'json',
      headerParameters: { parameters: [{ name: 'X-FridgeGraph-Timestamp', value: '={{ $json.timestamp }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: {
        timeout: 3000,
        response: { response: { neverError: true, fullResponse: true } },
      },
    },
    id: 'rt-http-reply', name: 'Call Voice Turn', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [420, 60], onError: 'continueRegularOutput',
    retryOnFail: false, credentials: { httpHeaderAuth: VOICE_TURN_CRED },
    notes: 'D1: the proven voice-turn chain. The credential supplies X-FridgeGraph-Webhook-Secret.',
  },
  {
    parameters: {
      method: 'POST', url: TUNNEL, sendHeaders: true, specifiedHeaders: 'json',
      headerParameters: { parameters: [{ name: 'X-FridgeGraph-Timestamp', value: '={{ $json.timestamp }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      options: {
        timeout: 3000,
        response: { response: { neverError: true, fullResponse: true } },
      },
    },
    id: 'rt-http-noanswer', name: 'Call Voice Turn (no answer)', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [420, 380], onError: 'continueRegularOutput',
    retryOnFail: false, credentials: { httpHeaderAuth: VOICE_TURN_CRED },
    notes: 'D4: same tunnel route; the server maps NO_ANSWER to record_no_answer().',
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: `={{ (() => {
  const b = typeof $json.body === 'string' ? (() => { try { return JSON.parse($json.body || '{}') } catch { return {} } })() : ($json.body || {});
  return { status: b.status || b.error || null, note: b.note || null };
})() }}`,
      options: { responseCode: '={{ $json.statusCode === 404 ? 400 : 200 }}' },
    },
    id: 'rt-respond-reply', name: 'Respond reply', type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1, position: [700, 60],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: `={{ (() => {
  const b = typeof $json.body === 'string' ? (() => { try { return JSON.parse($json.body || '{}') } catch { return {} } })() : ($json.body || {});
  return { status: b.status || b.error || null, note: b.note || null };
})() }}`,
      options: { responseCode: '={{ $json.statusCode === 404 ? 400 : 200 }}' },
    },
    id: 'rt-respond-noanswer', name: 'Respond no-answer', type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1, position: [700, 380],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { status: $json.status, note: $json.note } }}',
      options: { responseCode: '={{ $json.httpCode || 200 }}' },
    },
    id: 'rt-respond-early', name: 'Respond early', type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1, position: [420, 260],
    notes: 'Bad attemptId -> 400. UNPARSED -> 200 with no state change and no tunnel call.',
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { status: $json.status, note: $json.note } }}',
      options: { responseCode: '={{ $json.httpCode || 200 }}' },
    },
    id: 'rt-respond-early-na', name: 'Respond early no-answer', type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1, position: [420, 560],
  },
]

const link = (to) => [{ node: to, type: 'main', index: 0 }]
const connections = {
  'GHL Reply': { main: [link('Decide Reply')] },
  'GHL No Answer': { main: [link('Decide No Answer')] },
  'Decide Reply': { main: [link('Forward?')] },
  'Decide No Answer': { main: [link('Forward No Answer?')] },
  'Forward?': { main: [link('Call Voice Turn'), link('Respond early')] },
  'Forward No Answer?': { main: [link('Call Voice Turn (no answer)'), link('Respond early no-answer')] },
  'Call Voice Turn': { main: [link('Respond reply')] },
  'Call Voice Turn (no answer)': { main: [link('Respond no-answer')] },
}

const wf = {
  name: 'FridgeGraph - Reply and Timeout',
  active: false,
  settings: { executionOrder: 'v1', saveExecutionProgress: true },
  nodes,
  connections,
}

const out = new URL('../docs/n8n/fridgegraph-reply-timeout.workflow.json', import.meta.url)
writeFileSync(out, JSON.stringify(wf, null, 2) + '\n')
console.log(`wrote ${out.pathname}`)
console.log(`nodes: ${nodes.length}`)
console.log(`parser region embedded: ${nodes.find((n) => n.id === 'rt-decide-reply').parameters.jsCode.includes('function parseReply')}`)
