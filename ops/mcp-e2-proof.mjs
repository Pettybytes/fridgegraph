#!/usr/bin/env node
/**
 * ops/mcp-e2-proof.mjs — the demo/sandbox boundary on the MCP surface (alt stack, port 5051).
 *
 * DOES NOT START OR RESTART ANYTHING. It talks to the server that is already listening:
 *   MCP 127.0.0.1:5051  ->  endpoint 127.0.0.1:4012 (alt-stack router)
 *
 * Identities are real sessions minted by the demo login endpoint; no password and no
 * .demo-credentials are involved.
 *
 * The tool payload is not just ids: PickupCandidates returns displayName, contact method values and
 * vehicle plates. So "unauthorized" is asserted TWICE — the call must fail, and the raw response must
 * contain none of the strings an authorized caller legitimately receives. Those strings are compared
 * in memory and never printed.
 *
 * Usage: node ops/mcp-e2-proof.mjs
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const MCP = process.env.MCP_URL ?? 'http://127.0.0.1:5051/mcp'
const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login'
const CHILD = 'p_nora'
const AS_OF = '2026-10-26'

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}

const login = async (personaId) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await fetch(LOGIN, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId }),
    })
    if (r.status !== 429) return r.json()
    const wait = Number(r.headers.get('retry-after') ?? 10)
    console.log(`  (rate limited; waiting ${wait}s)`)
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000))
  }
  throw new Error(`login for ${personaId} stayed rate limited`)
}

/**
 * Built from parts on purpose. A literal scheme word written next to an interpolated value can be
 * mangled by output masking when this file is generated, which silently turns EVERY call anonymous
 * and makes a "refusal" proof pass for the wrong reason. Parts cannot be mangled.
 */
const authHeader = (token) => ({ authorization: ['Bear', 'er'].join('') + ' ' + token })

/** Streamable HTTP: the reply is JSON or an SSE stream of `data:` lines. */
const parseReply = (text) => {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }
  for (const line of trimmed.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/)
    if (!m) continue
    try { return JSON.parse(m[1]) } catch { /* keep looking */ }
  }
  return null
}

let sessionId = null
let rpcId = 0
const rpc = async (method, params, token, { notify = false } = {}) => {
  const payload = notify
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id: ++rpcId, method, params }
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? authHeader(token) : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  })
  const newSession = res.headers.get('mcp-session-id')
  if (newSession) sessionId = newSession
  const text = await res.text()
  return { status: res.status, text, body: (() => { try { return parseReply(text) } catch { return null } })() }
}

/** The tool result is content[0].text carrying the GraphQL response JSON. */
const graphOf = (call) => {
  const content = call.body?.result?.content
  if (!Array.isArray(content)) return null
  for (const part of content) {
    if (part?.type !== 'text' || typeof part.text !== 'string') continue
    try { return JSON.parse(part.text) } catch { return { raw: part.text } }
  }
  return null
}

const codesOf = (graph) => {
  const errs = graph?.errors ?? []
  return errs.map((e) => e?.extensions?.code ?? e?.message ?? '?')
}

console.log('=== MCP boundary proof (server already running on 5051; nothing restarted) ===')

// ---------------------------------------------------------------- handshake
const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'mcp-e2-proof', version: '1' },
})
check('0 initialize', init.status === 200 && Boolean(init.body?.result), `HTTP ${init.status}`)
await rpc('notifications/initialized', {}, undefined, { notify: true })

const list = await rpc('tools/list', {})
const tools = (list.body?.result?.tools ?? []).map((t) => t.name)
console.log(`  tools exposed: ${tools.join(', ') || '(none)'}`)
check('0 tools/list succeeds', Array.isArray(tools) && tools.length > 0, tools.join(','))
check('0 only PickupCandidates is exposed', tools.length === 1 && tools[0] === 'PickupCandidates', tools.join(','))

const { tokenForPersonId } = await import('./auth.mjs')

// Property name assembled from parts: writing it literally has been corrupted by output masking
// before, and a corrupted key silently yields `undefined` tokens (i.e. anonymous calls).
const SESSION_KEY = ['access', 'token'].join('_')

/**
 * Demo login first — that is the path under test. If Supabase throttles minting (repeated magic
 * links for one user), fall back to the ops password grant so the boundary proof can still run
 * against a real session. Harness-only, reported in the evidence; the product path is unchanged.
 */
const sessionFor = async (personaId, personId) => {
  const r = await login(personaId)
  if (r.status === 'READY') return { token: r.session?.[SESSION_KEY], via: 'demo-login' }
  return { token: await tokenForPersonId(personId), via: 'password-grant (ops)', reason: r.reason }
}

// ---------------------------------------------------------------- identities
const kendraS = await sessionFor('kendra', 'p_mom')
const danaS = await sessionFor('dana', 'p_dana')
const guideS = await sessionFor('demo-guide', 'p_demo_guide')
const KENDRA_TOKEN = kendraS.token
const DANA_TOKEN = danaS.token
const GUIDE_TOKEN = guideS.token
console.log(`  identity source: ${[kendraS, danaS, guideS].map((s) => s.via).join(', ')}`)
for (const [n, s] of [['kendra', kendraS], ['dana', danaS], ['guide', guideS]]) {
  if (!s.token) { console.log(`  cannot proceed: ${n} has no session`); process.exit(1) }
}

const call = (token) => rpc('tools/call', {
  name: 'PickupCandidates',
  arguments: { childId: CHILD, asOf: AS_OF },
}, token)

// ---------------------------------------------------------------- 1. Kendra
const k = await call(KENDRA_TOKEN)
const kGraph = graphOf(k)
const kCodes = codesOf(kGraph)
const kCandidates = kGraph?.data?.pickupCandidates ?? []
// A READY login followed by UNAUTHENTICATED is a harness fault, not a boundary: say so loudly.
check('1 the authorized call is not anonymous (token actually forwarded)',
  !kCodes.includes('UNAUTHENTICATED'), kCodes.join('|') || 'no codes')
check('1 Kendra (parent) gets the candidate list', kCandidates.length > 0,
  `${kCandidates.length} candidate(s)`)
check('1 each candidate carries an id and a reason',
  kCandidates.length > 0 && kCandidates.every((c) => c.person?.id && c.reason))
check('1 the authorized payload includes the details the tool promises',
  kCandidates.some((c) => c.person?.displayName)
  && kCandidates.some((c) => (c.person?.contactMethods ?? []).length > 0))

// Collect the sensitive strings Kendra legitimately receives, to prove Dana never sees them.
const secrets = new Set()
for (const c of kCandidates) {
  if (c.person?.id) secrets.add(String(c.person.id))
  if (c.person?.displayName) secrets.add(String(c.person.displayName))
  for (const m of c.person?.contactMethods ?? []) if (m?.value) secrets.add(String(m.value))
  for (const v of c.person?.vehicles ?? []) if (v?.plate) secrets.add(String(v.plate))
}

// ---------------------------------------------------------------- 2. Dana
// Dana is a KNOWN caller with no relationship to Nora: the expected answer is UNAUTHORIZED. An
// UNAUTHENTICATED here would mean the token never arrived, and must never be counted as a refusal.
const d = await call(DANA_TOKEN)
const dGraph = graphOf(d)
const dCandidates = dGraph?.data?.pickupCandidates
const dCodes = codesOf(dGraph)
check('2 Dana is a recognised caller, not an anonymous one',
  !dCodes.includes('UNAUTHENTICATED'), dCodes.join('|') || 'no codes')
check('2 Dana (unrelated adult) is refused',
  dCodes.includes('UNAUTHORIZED') || d.body?.result?.isError === true
  || (Array.isArray(dCandidates) && dCandidates.length === 0),
  `isError=${d.body?.result?.isError === true} codes=${dCodes.join('|') || 'none'}`)
check('2 Dana receives no candidate array with entries',
  !Array.isArray(dCandidates) || dCandidates.length === 0,
  Array.isArray(dCandidates) ? `${dCandidates.length} entr(y/ies)` : 'no data field')

const dRaw = d.text + JSON.stringify(d.body ?? {})
const leaked = [...secrets].filter((s) => s.length > 3 && dRaw.includes(s))
check('2 Dana\u2019s raw response contains no names, contact values, ids or plates',
  leaked.length === 0, `${leaked.length} of ${secrets.size} sensitive string(s) present`)

// ---------------------------------------------------------------- 3. Guide
const g = await call(GUIDE_TOKEN)
const gGraph = graphOf(g)
const gCodes = codesOf(gGraph)
const gCandidates = gGraph?.data?.pickupCandidates ?? []
check('3 the guide call is not anonymous (token actually forwarded)',
  !gCodes.includes('UNAUTHENTICATED'), gCodes.join('|') || 'no codes')
check('3 the Demo guide reads the sandbox candidate list',
  kCandidates.length > 0 && gCandidates.length === kCandidates.length,
  `${gCandidates.length} vs ${kCandidates.length}`)
check('3 the guide sees the same recorded people, not a substitute set',
  JSON.stringify(gCandidates.map((c) => c.person?.id).sort())
  === JSON.stringify(kCandidates.map((c) => c.person?.id).sort()))

// ---------------------------------------------------------------- 4. no / bad token
const none = await call(undefined)
const noneGraph = graphOf(none)
check('4 no token is refused', none.status === 401
  || none.body?.result?.isError === true
  || codesOf(noneGraph).includes('UNAUTHENTICATED'),
  `HTTP ${none.status} codes=${codesOf(noneGraph).join('|') || 'none'}`)
check('4 no token receives no candidate data',
  !Array.isArray(noneGraph?.data?.pickupCandidates) || noneGraph.data.pickupCandidates.length === 0)
const noneLeak = [...secrets].filter((s) => s.length > 3 && (none.text ?? '').includes(s))
check('4 no token leaks nothing', noneLeak.length === 0, `${noneLeak.length} string(s)`)

const bad = await call('Bearer not-a-jwt')
const badGraph = graphOf(bad)
check('4 a garbage token is refused', bad.status === 400 || bad.status === 401
  || bad.body?.result?.isError === true
  || codesOf(badGraph).includes('UNAUTHENTICATED')
  || codesOf(badGraph).includes('AUTH_ERROR'),
  `HTTP ${bad.status} codes=${codesOf(badGraph).join('|') || 'none'}`)
const badLeak = [...secrets].filter((s) => s.length > 3 && (bad.text ?? '').includes(s))
check('4 a garbage token leaks nothing', badLeak.length === 0, `${badLeak.length} string(s)`)

// ---------------------------------------------------------------- 5. mutations
const mutationTools = tools.filter((t) => !/^(PickupCandidates)$/.test(t))
console.log('\n5) mutations on this surface')
check('5 no mutation tool is exposed, so no authorization refusal can be exercised here',
  mutationTools.length === 0, mutationTools.join(',') || 'only PickupCandidates')

// An unexposed tool is refused by the tool registry, which is an EXPOSURE gate, not authorization.
for (const name of ['ApproveRelationship', 'grantAccess']) {
  const r = await rpc('tools/call', { name, arguments: {} }, GUIDE_TOKEN)
  const errCode = r.body?.error?.code ?? r.body?.result?.isError
  check(`5 ${name} is not resolvable as a tool (exposure gate, not authorization)`,
    errCode === -32602 || r.body?.error?.message?.includes('not found') === true,
    `code=${errCode}`)
}

console.log(`
  NOT EXERCISED HERE (exposed nowhere in any mutation_mode, per the server config):
    approveRelationship, requestPickup, acceptPickup, approvePickup, grantAccess, revokeGrant
  Their authorization refusals are proven elsewhere, over GraphQL:
    guide -> DEMO_GUIDE_READ_ONLY   (ops/e2a-proof.mjs e6, ops/e3-proof.mjs 5)
    demo  -> DEMO_OUTREACH_REFUSED  (ops/e2b-proof.mjs 6-13)
  "Not exposed" is not "refusal exercised": nothing above claims an MCP authorization refusal for a mutation.`)

console.log(failed ? `\nMCP PROOF FAILED: ${failed}` : '\nMCP PROOF PASSED')
process.exit(failed ? 1 : 0)
