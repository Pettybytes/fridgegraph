/**
 * Minimal MCP client probe for the Milestone 1 spike.
 *
 * Speaks Streamable HTTP JSON-RPC by hand so the evidence shows the raw protocol:
 * initialize -> notifications/initialized -> tools/list -> tools/call.
 */

const URL_ = process.env.MCP_URL ?? 'http://127.0.0.1:5050/mcp';
const TOOL = process.env.MCP_TOOL ?? 'PickupCandidates';
const ARGS = JSON.parse(process.env.MCP_ARGS ?? '{"childId":"p_nora","asOf":"2026-10-26"}');

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
    // Take the last data: line of the SSE frame.
    const dataLines = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    body = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1]) : { raw: text };
  } else {
    body = text ? JSON.parse(text) : {};
  }
  return { status: res.status, body, contentType };
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'fridgegraph-probe', version: '0.1.0' },
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

// Negative control: with introspection disabled there is no discovery tool.
const probe = await rpc('tools/call', {
  name: 'introspect',
  arguments: { operation: '{ __schema { types { name } } }' },
});
console.log('\n== tools/call introspect (negative control) ==');
console.log(JSON.stringify(probe.body, null, 2));
