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
 * It ALSO refuses to pass when the MCP config the running server was started from is missing or
 * stale. `--up` generates that file; a hand-rebased copy drifts the moment `.apollo/mcp.local.yaml`
 * changes, and a drifted config silently drops or re-points tools while every port still answers.
 * "Stale" here means: the derived file is older than its source, its endpoint does not point at the
 * alt router we are probing, its transport port is not the MCP port we are probing, or an operation
 * file it names no longer exists.
 *
 * Prints no token, no password, no key.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MCP = process.env.ALT_MCP_URL || 'http://127.0.0.1:5051/mcp'
const EXPECTED = Number(process.env.ALT_EXPECTED_CANDIDATES || 4)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_CONFIG = join(ROOT, '.apollo', 'mcp.local.yaml')
const MCP_CONFIG = process.env.ALT_MCP_CONFIG || `${process.env.TMPDIR || '/tmp'}/fridgegraph-alt-mcp.yaml`
const ROUTER_PORT = String(process.env.ALT_ROUTER_PORT || 4012)

const failConfig = (message) => {
  console.error(`  mcp config        FAIL — ${message}`)
  process.exit(1)
}

const mcpPort = new URL(MCP).port

if (!existsSync(MCP_CONFIG)) {
  failConfig(`missing at ${MCP_CONFIG} — run ops/alt-stack.sh --up to generate it`)
}
const configText = readFileSync(MCP_CONFIG, 'utf8')

const transportPort = configText.match(/^\s*port:\s*(\d+)\s*$/m)?.[1]
const endpoint = configText.match(/^\s*endpoint:\s*(\S+)\s*$/m)?.[1]
if (!transportPort || !endpoint) {
  failConfig(`${MCP_CONFIG} has no readable transport port / endpoint`)
}
if (transportPort !== mcpPort) {
  failConfig(`${MCP_CONFIG} listens on ${transportPort}, but the probe targets ${mcpPort}`)
}
if (!endpoint.includes(`:${ROUTER_PORT}/`)) {
  failConfig(`${MCP_CONFIG} endpoint ${endpoint} does not target the alt router on ${ROUTER_PORT}`)
}
if (existsSync(SOURCE_CONFIG) && statSync(MCP_CONFIG).mtimeMs < statSync(SOURCE_CONFIG).mtimeMs) {
  failConfig(`${MCP_CONFIG} is older than .apollo/mcp.local.yaml — regenerate with ops/alt-stack.sh --up`)
}
const referenced = [
  ...configText.matchAll(/^\s*path:\s*(\S+)\s*$/gm),
  ...configText.matchAll(/^\s*-\s*(\S+\.graphql)\s*$/gm),
].map((m) => m[1])
const missing = referenced.filter((p) => !existsSync(isAbsolute(p) ? p : join(ROOT, p)))
if (missing.length) {
  failConfig(`${MCP_CONFIG} names ${missing.length} file(s) that do not exist: ${missing.join(', ')}`)
}
console.log(`  mcp config        ${referenced.length} path(s) present, port ${transportPort} → router ${ROUTER_PORT}`)

// The auth module reads .demo-credentials at import time, so it is imported only AFTER the config
// checks: a missing or stale config must report itself, not surface as a credentials error.
const { tokenForPersonId } = await import('./auth.mjs')

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
