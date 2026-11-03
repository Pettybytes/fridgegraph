#!/usr/bin/env node
// Disposable local-router regression for the fridge compatibility probe.
//
// Why this exists: a selection whose fields are ALL `@skip(if:true)` is an EMPTY QUERY
// PLAN. Apollo Router v2.18.0 answers it with HTTP 500 `empty query plan` — before any
// subgraph or auth check. A mocked Apollo client cannot see that, so the unit suite was
// green while CP6 failed in the browser. This runs the real router binary against a real
// composed supergraph and proves BOTH halves:
//   - the old all-skipped shape still fails (the bug is reproducible), and
//   - the shipped probe is plannable (the regression cannot return).
//
// Exit codes: 0 pass · 1 fail · 3 BLOCKED (could not run — never reported as a pass).
import {spawn} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'

const BLOCKED = 3
const blocked = reason => { console.error(`BLOCKED: ${reason}`); process.exit(BLOCKED) }

const CANDIDATE_SUPERGRAPHS = [
  process.env.ROUTER_SUPERGRAPH,
  '/Users/user/Desktop/bentley/fridgegraph-deploy-bbe11a4/.runs/supergraph-bbe11a4.graphql',
  '.runs/supergraph.graphql',
].filter(Boolean)
const supergraph = CANDIDATE_SUPERGRAPHS.find(p => existsSync(p))
if (!supergraph) blocked(`no composed supergraph found (tried: ${CANDIDATE_SUPERGRAPHS.join(', ')})`)

const ROUTER_CANDIDATES = [
  process.env.ROUTER_BIN,
  '/Users/user/.rover/bin/router-v2.18.0',
].filter(Boolean)
const routerBin = ROUTER_CANDIDATES.find(p => existsSync(p))
if (!routerBin) blocked(`no router binary found (tried: ${ROUTER_CANDIDATES.join(', ')})`)

// The shipped probe, read from source so the test cannot drift from the adapter.
const adapterSource = readFileSync(new URL('../web/src/features/fridge/phase2Adapter.ts', import.meta.url), 'utf8')
if (/@skip\s*\(\s*if:\s*true\s*\)/.test(adapterSource)) {
  console.error('FAIL: phase2Adapter.ts still contains an all-skipped selection')
  process.exit(1)
}

const SHIPPED = `query FridgePhase2Compatibility($childId:ID!){ __typename goals(childId:$childId){id period completedAt} fridgeNotes(childId:$childId){id text paperColor audience revision createdAt updatedAt author{id displayName}} }`
const OLD_SKIPPED = `query FridgePhase2Compatibility($childId:ID!){ __typename goals(childId:$childId) @skip(if:true){period completedAt} fridgeNotes(childId:$childId) @skip(if:true){id text paperColor audience revision createdAt updatedAt author{id displayName}} }`

const freePort = () => new Promise((resolve, reject) => {
  const srv = createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => { const {port} = srv.address(); srv.close(() => resolve(port)) })
})

async function post(port, query) {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query, variables: {childId: 'c_probe'}}),
  })
  return {status: response.status, body: await response.text()}
}

const emptyPlan = r => r.status === 500 && /empty query plan/i.test(r.body)

async function waitReady(port, deadlineMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({query: '{__typename}'})})
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

const port = await freePort()
const dir = mkdtempSync(join(tmpdir(), 'fg-router-compat-'))
const config = join(dir, 'router.yaml')
writeFileSync(config, `supergraph:\n  listen: 127.0.0.1:${port}\nsandbox:\n  enabled: false\n`)

const child = spawn(routerBin, ['--supergraph', supergraph, '--config', config, '--log', 'error'], {stdio: ['ignore', 'ignore', 'pipe']})
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk.toString() })

let failed = false
const fail = message => { failed = true; console.error(`FAIL: ${message}`) }

try {
  if (!await waitReady(port)) blocked(`router did not become ready — ${stderr.split('\n').slice(-3).join(' ')}`)

  const old = await post(port, OLD_SKIPPED)
  const shipped = await post(port, SHIPPED)

  console.log(`router: ${routerBin}`)
  console.log(`supergraph: ${supergraph}`)
  console.log(`  OLD all-skipped   → ${old.status} ${emptyPlan(old) ? '(empty query plan — reproduces the bug)' : old.body.slice(0, 120)}`)
  console.log(`  SHIPPED probe     → ${shipped.status} ${shipped.body.slice(0, 120)}`)

  // The bug must still be reproducible, or this regression is not testing the cause.
  if (!emptyPlan(old)) fail('the all-skipped shape no longer reproduces the empty-plan 500, so this test is not measuring the defect')
  // The shipped probe must be plannable. Auth refusal (200 + field errors) is a PASS here:
  // this asserts the router can PLAN it, not that a caller is authorized.
  if (emptyPlan(shipped)) fail('the shipped probe still produces an empty query plan')
  if (shipped.status >= 500) fail(`the shipped probe returned ${shipped.status}`)
  if (shipped.status !== 200) fail(`expected HTTP 200 for a plannable read, got ${shipped.status}`)
} finally {
  child.kill('SIGTERM')
}

if (failed) process.exit(1)
console.log('RESULT: PASS — shipped probe is plannable; all-skipped probe still fails')
