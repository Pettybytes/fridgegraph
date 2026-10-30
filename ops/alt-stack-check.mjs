#!/usr/bin/env node
/**
 * ops/alt-stack-check.mjs — read-only probe used by `ops/alt-stack.sh --check`.
 *
 * Signs in as Kendra (p_mom) and calls PickupCandidates through the MCP server, printing the
 * candidate count. Fails if the tool errors or returns anything other than 4.
 *
 * This is deliberately the SAME path that failed silently when data/identity-map.json was missing:
 * a missing map makes every caller "unmapped", so the MCP tool returns UNAUTHENTICATED while the
 * ports all look healthy. Checking tool output, not just ports, is the point.
 *
 * Prints no token, no password, no key.
 */
import { tokenForPersonId } from './auth.mjs'

const MCP = process.env.ALT_MCP_URL || 'http://127.0.0.1:5051/mcp'
const EXPECTED = Number(process.env.ALT_EXPECTED_CANDIDATES || 4)

const token = await tokenForPersonId('p_mom')
const common = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: 'Bearer ' + token,
}

const init = await fetch(MCP, {
  method: 'POST',
  headers: common,
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'alt-stack-check', version: '1.0.0' },
    },
  }),
})
if (!init.ok) {
  console.error(`  mcp initialize     HTTP ${init.status}`)
  process.exit(1)
}
const sid = init.headers.get('mcp-session-id')

await fetch(MCP, {
  method: 'POST',
  headers: sid ? { ...common, 'mcp-session-id': sid } : common,
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
})

const call = await fetch(MCP, {
  method: 'POST',
  headers: sid ? { ...common, 'mcp-session-id': sid } : common,
  body: JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'PickupCandidates', arguments: { childId: 'p_nora', asOf: '2026-10-26' } },
  }),
})
const text = await call.text()

// The MCP server may answer as SSE or plain JSON; both wrap the same result.
const payloadText = text.includes('data: ')
  ? text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
  : text

let candidates = null
let error = null
try {
  const outer = JSON.parse(payloadText)
  const inner = outer?.result?.content?.[0]?.text
  const body = inner ? JSON.parse(inner) : outer
  if (body?.errors?.length) error = body.errors.map((e) => e.message).join(' | ')
  const c = body?.data?.pickupCandidates
  candidates = Array.isArray(c) ? c.length : null
} catch (e) {
  error = 'unparsable response: ' + e.message
}

if (candidates === EXPECTED) {
  console.log(`  mcp candidates     ${candidates}/${EXPECTED} as Kendra`)
  process.exit(0)
}
console.error(`  mcp candidates     ${candidates ?? 'none'}/${EXPECTED}${error ? ` (${error})` : ''}`)
process.exit(1)
