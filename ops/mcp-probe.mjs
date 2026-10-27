/**
 * Minimal MCP client probe.
 *
 * Streamable HTTP JSON-RPC by hand: initialize -> notifications/initialized -> tools/list ->
 * tools/call. Identity is the caller's own bearer token, forwarded by the MCP server
 * (`forward_headers: [authorization]`) — nothing is pinned in the config any more.
 *
 * Env: MCP_PERSON (default p_mom), MCP_NO_TOKEN=1 to send no identity at all (negative control).
 */
import { redactBearer, tokenForPersonId } from './auth.mjs';

const URL_ = process.env.MCP_URL ?? 'http://127.0.0.1:5050/mcp';
const TOOL = process.env.MCP_TOOL ?? 'PickupCandidates';
const ARGS = JSON.parse(process.env.MCP_ARGS ?? '{"childId":"p_nora","asOf":"2026-10-26"}');
const PERSON = process.env.MCP_PERSON ?? 'p_mom';
const NO_TOKEN = process.env.MCP_NO_TOKEN === '1';

const bearer = NO_TOKEN ? undefined : await tokenForPersonId(PERSON);
console.log(`identity: ${NO_TOKEN ? '(none sent)' : `${PERSON} ${redactBearer(bearer)}`}\n`);

let sessionId;
let id = 0;

async function rpc(method, params, { notify = false } = {}) {
  const payload = notify
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: ++id, method, params };

  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });

  const returnedSession = res.headers.get('mcp-session-id');
  if (returnedSession) sessionId = returnedSession;

  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  let body;
  if (contentType.includes('text/event-stream')) {
    const dataLines = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    body = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1]) : { raw: text };
  } else {
    body = text ? JSON.parse(text) : {};
  }
  return { status: res.status, body };
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'fridgegraph-probe', version: '0.2.0' },
});
console.log('== initialize ==');
console.log(JSON.stringify(init.body, null, 2));

await rpc('notifications/initialized', {}, { notify: true });

const tools = await rpc('tools/list', {});
console.log('\n== tools/list ==');
console.log(JSON.stringify(tools.body, null, 2));

const call = await rpc('tools/call', { name: TOOL, arguments: ARGS });
console.log(`\n== tools/call ${TOOL} ==`);
console.log(JSON.stringify(call.body, null, 2));

const probe = await rpc('tools/call', {
  name: 'introspect',
  arguments: { operation: '{ __schema { types { name } } }' },
});
console.log('\n== tools/call introspect (negative control) ==');
console.log(JSON.stringify(probe.body, null, 2));
