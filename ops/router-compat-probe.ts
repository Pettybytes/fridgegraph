#!/usr/bin/env node
/**
 * router-compat-probe — prove the fridge compatibility probe is PLANNABLE on the real router.
 *
 * WHY
 * A selection whose fields are ALL `@skip(if:true)` has an empty query plan. Apollo Router
 * v2.18.0 answers that with HTTP 500 `empty query plan` before any subgraph or auth check.
 * A mocked Apollo client cannot see it, so the unit suite was green while CP6 failed in a
 * real browser. This runs the actual router against a real supergraph to keep that trap shut.
 *
 * SELF-CONTAINED BY DESIGN
 * - The supergraph is composed OFFLINE from committed SDL (`ops/compose-offline.mjs`), so it
 *   carries the routing URLs THIS process intends. No deploy worktree, no neighbouring stack.
 * - Every one of the seven subgraphs is a local stub, so the router resolves against stubs
 *   rather than a shared checkout. Nothing here reads or writes the running stack.
 * - The operation under test is the EXPORTED `FRIDGE_COMPATIBILITY` document, serialised with
 *   `graphql`'s print(). It is never re-typed in this file, so the test cannot drift from the
 *   shipped adapter.
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 * - Proves: the router can plan and execute the shipped operation (no empty-plan 500), and
 *   that the all-skipped shape still reproduces that 500.
 * - Does NOT prove: authenticated resolution, RLS, or that editing works end-to-end. Stubs
 *   carry no authorization. Those remain the CP6 window's job.
 *
 * Exit codes: 0 pass · 1 fail · 3 BLOCKED (could not run — never reported as a pass).
 *
 * Run: npx tsx ops/router-compat-probe.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { print } from 'graphql'
import { FRIDGE_COMPATIBILITY } from '../web/src/features/fridge/phase2Adapter'

const BLOCKED = 3
const blocked = (reason: string): never => { console.error(`BLOCKED: ${reason}`); process.exit(BLOCKED) }

// The operation under test comes from the export, not from a literal in this file.
const SHIPPED = print(FRIDGE_COMPATIBILITY)
if (/@skip\s*\(\s*if:\s*true\s*\)/.test(SHIPPED)) {
  console.error('FAIL: the exported probe still contains an all-skipped selection')
  process.exit(1)
}
// Control: the same operation with both selections skipped — the shape that produced the 500.
// print() reformats ("childId: $childId) {"), so match on structure rather than a literal.
const skipify = (query: string, field: string) =>
  query.replace(new RegExp(`(${field}\\([^)]*\\))\\s*\\{`), '$1 @skip(if:true) {')
const CONTROL = skipify(skipify(SHIPPED, 'goals'), 'fridgeNotes')
if (CONTROL === SHIPPED || !CONTROL.includes('@skip(if:true)')) {
  console.error('FAIL: could not construct the all-skipped control query')
  process.exit(1)
}

const ROUTER_BIN = process.env.ROUTER_BIN ?? join(process.env.HOME ?? '', '.rover', 'bin', 'router-v2.18.0')
if (!existsSync(ROUTER_BIN)) blocked(`router binary not found at ${ROUTER_BIN} (set ROUTER_BIN)`)

const SUBGRAPH_COUNT = 7
const portFree = (port: number) => new Promise<boolean>(resolve => {
  const probe = createNetServer()
  probe.once('error', () => resolve(false))
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
})

// compose-offline routes subgraph i to base+i, so the block must be contiguous and free.
async function freeBlock(): Promise<number> {
  for (let base = 45_000; base < 46_000; base += 10) {
    const results = await Promise.all(Array.from({length: SUBGRAPH_COUNT}, (_, i) => portFree(base + i)))
    if (results.every(Boolean)) return base
  }
  return blocked('no free contiguous 7-port block found for subgraph stubs')
}

const basePort = await freeBlock()

// Every stub answers any POST. Content is deliberately minimal: this test measures the
// router's ability to PLAN the operation, not what a subgraph returns.
const stubBody = JSON.stringify({data: {goals: [], fridgeNotes: []}})
const stubs = await Promise.all(Array.from({length: SUBGRAPH_COUNT}, (_, i) => new Promise<{close: () => void}>(resolve => {
  const server = createServer((req, res) => {
    res.writeHead(200, {'content-type': 'application/json'})
    res.end(stubBody)
  })
  server.listen(basePort + i, '127.0.0.1', () => resolve({close: () => server.close()}))
})))

const dir = mkdtempSync(join(tmpdir(), 'fg-router-compat-'))
const supergraph = join(dir, 'supergraph.graphql')

try {
  execFileSync(process.execPath, ['ops/compose-offline.mjs', '--out', supergraph, '--base-port', String(basePort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  for (const stub of stubs) stub.close()
  blocked(`offline composition failed — ${String((e as {stderr?: Buffer}).stderr ?? (e as Error).message).slice(0, 600)}`)
}

// The artifact must route to THIS process's stubs, never to a neighbouring stack.
const composed = readFileSync(supergraph, 'utf8')
for (let i = 0; i < SUBGRAPH_COUNT; i++) {
  if (!composed.includes(`http://127.0.0.1:${basePort + i}/`)) {
    for (const stub of stubs) stub.close()
    blocked(`composed supergraph does not route subgraph ${i} to local stub ${basePort + i}`)
  }
}

const routerPort = basePort + SUBGRAPH_COUNT
if (!await portFree(routerPort)) blocked(`router port ${routerPort} is not free`)
const config = join(dir, 'router.yaml')
writeFileSync(config, `supergraph:\n  listen: 127.0.0.1:${routerPort}\nsandbox:\n  enabled: false\n`)

const { spawn } = await import('node:child_process')
const router = spawn(ROUTER_BIN, ['--supergraph', supergraph, '--config', config, '--log', 'error'], {stdio: ['ignore', 'ignore', 'pipe']})
let stderr = ''
router.stderr.on('data', chunk => { stderr += chunk.toString() })

async function post(query: string) {
  const response = await fetch(`http://127.0.0.1:${routerPort}/`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query, variables: {childId: 'c_probe'}}),
  })
  return {status: response.status, body: await response.text()}
}

async function waitReady(deadlineMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    try {
      const response = await post('{__typename}')
      if (response.status === 200) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

const emptyPlan = (r: {status: number; body: string}) => r.status === 500 && /empty query plan/i.test(r.body)
let failed = false
const fail = (message: string) => { failed = true; console.error(`FAIL: ${message}`) }

try {
  if (!await waitReady()) {
    for (const stub of stubs) stub.close()
    blocked(`router did not become ready — ${stderr.split('\n').slice(-3).join(' ')}`)
  }

  console.log(`router:      ${ROUTER_BIN}`)
  console.log(`supergraph:  composed offline from schema/*.graphql (stubs ${basePort}–${basePort + SUBGRAPH_COUNT - 1})`)
  console.log(`operation:   exported FRIDGE_COMPATIBILITY via print()`)

  const control = await post(CONTROL)
  const shipped = await post(SHIPPED)

  console.log(`  CONTROL all-skipped → ${control.status} ${emptyPlan(control) ? '(empty query plan — bug reproduces)' : control.body.slice(0, 140)}`)
  console.log(`  SHIPPED probe       → ${shipped.status} ${shipped.body.slice(0, 140)}`)

  // If the control stops reproducing, this test is no longer measuring the defect.
  if (!emptyPlan(control)) fail('the all-skipped control no longer reproduces the empty-plan 500')
  if (emptyPlan(shipped)) fail('the shipped probe still produces an empty query plan')
  if (shipped.status !== 200) fail(`expected HTTP 200 for a plannable operation, got ${shipped.status}`)
} finally {
  router.kill('SIGTERM')
  for (const stub of stubs) stub.close()
}

if (failed) process.exit(1)
console.log('RESULT: PASS — exported probe is plannable on router-v2.18.0; all-skipped control still fails')
