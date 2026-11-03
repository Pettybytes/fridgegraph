#!/usr/bin/env node
/**
 * Disposable rehearsal for 0087 (pickup outreach storage + claim/reserve).
 *
 * Runs against a stock Postgres container bound to 127.0.0.1 ONLY. A stock Postgres proves SQL
 * semantics — function resolution, locking, the fence, the guard triggers, the cap arithmetic.
 * It does NOT prove Supabase's anon/authenticated/service_role semantics, auth.uid(), JWTs or
 * PostgREST coercion; those need the reserved window on the project database.
 *
 * Every check reports PASS, FAIL or BLOCKED. BLOCKED is a first-class result: a check that could
 * not run must never read as a pass.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const IMAGE = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
const CONTAINER = 'fg-outreach-rehearsal'
const PORT = 55440
const MIGRATION = join(REPO, 'supabase/migrations/0087_outreach_dispatch.sql')

const results = []
let liveClient = null
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  const mark = status === 'PASS' ? 'ok  ' : status === 'BLOCKED' ? 'BLK ' : 'FAIL'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opts })
}

function startContainer() {
  docker(['rm', '-f', CONTAINER])
  const run = docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'POSTGRES_PASSWORD=',
    '-p', `127.0.0.1:${PORT}:5432`,
    IMAGE,
  ])
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr || run.stdout}`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Poll with a FRESH client each attempt: a client whose connect rejected is not reusable. */
async function connectReady(tries = 80) {
  for (let i = 0; i < tries; i++) {
    const client = new pg.Client({
      host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres',
      connectionTimeoutMillis: 3000,
    })
    try {
      await client.connect()
      await client.query('select 1')
      return client
    } catch {
      await client.end().catch(() => {})
      await sleep(500)
    }
  }
  return null
}

/** Run fn inside a transaction as `role`, always rolling back. */
async function asRole(client, role, fn) {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    return await fn()
  } finally {
    await client.query('rollback')
  }
}

const codeOf = e => e?.code ?? e?.message ?? String(e)

async function main() {
  // ── static: the reset path must not name an outreach table ──
  const resetSrc = readFileSync(join(REPO, 'src/demo/reset.ts'), 'utf8')
  const tableBlock = (resetSrc.match(/const SANDBOX_TABLES = \[([\s\S]*?)\] as const/) ?? [, ''])[1] +
                     (resetSrc.match(/const ID_TABLES = \[([\s\S]*?)\] as const/) ?? [, ''])[1]
  const outreachNames = [...tableBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(n => n.startsWith('outreach_'))
  record('resetDemo table lists do not include outreach safety records', outreachNames.length === 0 ? 'PASS' : 'FAIL',
    outreachNames.join(', ') || 'none listed')

  startContainer()
  const client = await connectReady()
  if (!client) {
    record('postgres reached', 'BLOCKED', 'container did not accept connections')
    return
  }
  try {
    liveClient = client
    client.on('error', () => {})
    record('postgres reached', 'PASS', IMAGE.split('@')[1].slice(0, 12))

    for (const role of ['anon', 'authenticated', 'service_role']) {
      await client.query(`do $$ begin if not exists (select 1 from pg_roles where rolname='${role}') then create role ${role} nologin; end if; end $$;`)
    }
    await client.query(readFileSync(MIGRATION, 'utf8'))
    record('0087 applied to a disposable database', 'PASS', 'single transaction, no error')
  } catch (error) {
    record('0087 applied to a disposable database', 'FAIL', codeOf(error).slice(0, 300))
    await client.end().catch(() => {})
    return
  }

  const q = async (sql, params = []) => (await client.query(sql, params)).rows

  // ── helper: create a dispatch identity ──
  let seq = 0
  const makeDispatch = async ({ run = 'run_A', recipient = 'a'.repeat(64), version = 1, kind = 'REQUEST' } = {}) => {
    seq += 1
    const attempt = `att_${seq}`
    const candidate = `p_cand${seq}`
    const [{ id }] = await q('select outreach_dispatch_id($1,$2,$3,$4) as id', [attempt, candidate, version, kind])
    await q(
      `insert into outreach_dispatch (dispatch_id, run_id, attempt_id, candidate_id, job_version, message_kind)
       values ($1,$2,$3,$4,$5,$6)`,
      [id, run, attempt, candidate, version, kind],
    )
    return id
  }

  // ── 1. safety-record guard (owner-level, not RLS) ──
  for (const [name, sql] of [
    ['delete from outreach_suppression', 'delete from outreach_suppression'],
    ['truncate outreach_allowance', 'truncate outreach_allowance'],
    ['delete from outreach_dispatch', 'delete from outreach_dispatch'],
    ['delete from outreach_reservation', 'delete from outreach_reservation'],
  ]) {
    try {
      await q(sql)
      record(`guard refuses ${name}`, 'FAIL', 'statement succeeded')
    } catch (error) {
      record(`guard refuses ${name}`, codeOf(error) === '42501' ? 'PASS' : 'FAIL', codeOf(error))
    }
  }

  const d0 = await makeDispatch()

  // ── 2. demo-caller boundary ──
  const boundary = [
    ['select outreach_dispatch', 'select 1 from outreach_dispatch'],
    ['insert outreach_suppression', `insert into outreach_suppression (key,reason,source) values ('k','STOP','test')`],
    ['update outreach_allowance', `update outreach_allowance set used_segments = 0`],
  ]
  for (const [name, sql] of boundary) {
    try {
      await asRole(client, 'authenticated', () => client.query(sql))
      record(`authenticated cannot ${name}`, 'FAIL', 'succeeded')
    } catch (error) {
      record(`authenticated cannot ${name}`, codeOf(error) === '42501' ? 'PASS' : 'FAIL', codeOf(error))
    }
  }
  for (const [name, sql, args] of [
    ['outreach_claim', `select outreach_claim($1,$2,60)`, [d0, 'demo']],
    ['outreach_reserve', `select outreach_reserve($1,$2,$3,null)`, [d0, 'b'.repeat(64), 1]],
  ]) {
    try {
      await asRole(client, 'authenticated', () => client.query(sql, args))
      record(`authenticated cannot execute ${name}`, 'FAIL', 'succeeded')
    } catch (error) {
      record(`authenticated cannot execute ${name}`, codeOf(error) === '42501' ? 'PASS' : 'FAIL', codeOf(error))
    }
  }

  // ── 3. identity ──
  const a = (await q(`select outreach_dispatch_id('att_x','p_y',3,'REQUEST') as id`))[0]
  const b = (await q(`select outreach_dispatch_id('att_x','p_y',3,'REQUEST') as id`))[0]
  const c = (await q(`select outreach_dispatch_id('att_x','p_y',3,'NUDGE') as id`))[0]
  record('dispatch identity is deterministic', a.id === b.id ? 'PASS' : 'FAIL', a.id.slice(0, 12))
  record('a different message kind is a different identity', a.id !== c.id ? 'PASS' : 'FAIL')

  // ── 4. claim / fence / handoff / accept ──
  const d1 = await makeDispatch({ run: 'run_B', recipient: 'c'.repeat(64) })
  const claim1 = (await q(`select outreach_claim($1,'w1',60) as r`, [d1]))[0].r
  record('first claim on PENDING succeeds', claim1.ok === true && !!claim1.token ? 'PASS' : 'FAIL', JSON.stringify(claim1).slice(0, 120))

  const claim2 = (await q(`select outreach_claim($1,'w2',60) as r`, [d1]))[0].r
  record('a live claim cannot be stolen', claim2.ok === false && claim2.reason === 'NOT_CLAIMABLE' ? 'PASS' : 'FAIL', claim2.reason)

  const wrong = (await q(`select outreach_mark_handoff($1,$2) as ok`, [d1, 'not-the-token']))[0].ok
  record('mark_handoff is fenced (wrong token refused)', wrong === false ? 'PASS' : 'FAIL')

  const handoff = (await q(`select outreach_mark_handoff($1,$2) as ok`, [d1, claim1.token]))[0].ok
  record('mark_handoff records the handoff before the request', handoff === true ? 'PASS' : 'FAIL')

  // Force the lease into the past: expiry must not resurrect a handed-off dispatch.
  await q(`update outreach_dispatch set claim_expires_at = now() - interval '10 minutes' where dispatch_id = $1`, [d1])
  const afterExpiry = (await q(`select outreach_claim($1,'w3',60) as r`, [d1]))[0].r
  record('lease expiry does NOT make a handed-off dispatch claimable',
    afterExpiry.ok === false && afterExpiry.reason === 'HANDOFF_STARTED' ? 'PASS' : 'FAIL', afterExpiry.reason)

  const accepted = (await q(`select outreach_mark_accepted($1,$2,'SM-1') as ok`, [d1, claim1.token]))[0].ok
  record('fenced accept records the provider id', accepted === true ? 'PASS' : 'FAIL')

  const afterAccept = (await q(`select outreach_claim($1,'w4',60) as r`, [d1]))[0].r
  // Both refusals are true once accepted; the handoff marker is checked first because it is the
  // earlier fact, so HANDOFF_STARTED is the expected reason. What matters is that it never sends.
  record('an accepted dispatch is never claimable',
    afterAccept.ok === false && ['PROVIDER_ID', 'HANDOFF_STARTED'].includes(afterAccept.reason) ? 'PASS' : 'FAIL',
    afterAccept.reason)

  // ── 5. THE CRASH PROOF ──
  // provider accepts → the worker dies before persisting the response/id → restart.
  const dCrash = await makeDispatch({ run: 'run_C', recipient: 'd'.repeat(64) })
  const c1 = (await q(`select outreach_claim($1,'workerA',60) as r`, [dCrash]))[0].r
  await q(`select outreach_reserve($1,$2,2,null)`, [dCrash, 'd'.repeat(64)])
  const h1 = (await q(`select outreach_mark_handoff($1,$2) as ok`, [dCrash, c1.token]))[0].ok
  // crash: no mark_accepted, no provider id written
  await q(`update outreach_dispatch set claim_expires_at = now() - interval '1 hour' where dispatch_id = $1`, [dCrash])
  const restarted = (await q(`select outreach_claim($1,'workerB',60) as r`, [dCrash]))[0].r
  const handoffAttempts = await q(
    `select count(*)::int as n from outreach_dispatch
      where dispatch_id = $1 and handoff_started_at is not null`, [dCrash])
  const reservationSurvived = await q(`select segments from outreach_reservation where dispatch_id = $1`, [dCrash])
  record('crash after handoff: restart cannot claim the dispatch again',
    h1 === true && restarted.ok === false && restarted.reason === 'HANDOFF_STARTED' ? 'PASS' : 'FAIL',
    `${restarted.reason}`)
  record('crash after handoff: exactly one handoff marker, zero additional sends',
    handoffAttempts[0].n === 1 ? 'PASS' : 'FAIL', `markers=${handoffAttempts[0].n}`)
  record('crash after handoff: the reservation is retained',
    reservationSurvived.length === 1 && reservationSurvived[0].segments === 2 ? 'PASS' : 'FAIL')

  // ── 6. reservation idempotency (reclaim must not double-charge) ──
  const d2 = await makeDispatch({ run: 'run_D', recipient: 'e'.repeat(64) })
  const r1 = (await q(`select outreach_reserve($1,$2,4,null) as r`, [d2, 'e'.repeat(64)]))[0].r
  const usedAfter1 = (await q(
    `select used_segments from outreach_allowance where scope_kind='RUN' and scope_key='run_D'`))[0].used_segments
  const r2 = (await q(`select outreach_reserve($1,$2,4,null) as r`, [d2, 'e'.repeat(64)]))[0].r
  const usedAfter2 = (await q(
    `select used_segments from outreach_allowance where scope_kind='RUN' and scope_key='run_D'`))[0].used_segments
  record('reserve is idempotent per dispatch identity',
    r1.reserved === true && r2.reused === true && usedAfter1 === 4 && usedAfter2 === 4 ? 'PASS' : 'FAIL',
    `used ${usedAfter1} → ${usedAfter2}`)

  // ── 7. caps ──
  const dRec = await makeDispatch({ run: 'run_E', recipient: 'f'.repeat(64) })
  const rec1 = (await q(`select outreach_reserve($1,$2,15,$3) as r`, [dRec, 'f'.repeat(64), '2030-01-01']))[0].r
  const dRec2 = await makeDispatch({ run: 'run_E', recipient: 'f'.repeat(64), version: 2 })
  const rec2 = (await q(`select outreach_reserve($1,$2,1,$3) as r`, [dRec2, 'f'.repeat(64), '2030-01-01']))[0].r
  record('recipient cap 15 binds at the 16th segment',
    rec1.ok === true && rec2.ok === false && rec2.reason === 'LIMIT_RECIPIENT' ? 'PASS' : 'FAIL', rec2.reason)

  const runCap = []
  for (let i = 0; i < 4; i++) {
    const d = await makeDispatch({ run: 'run_F', recipient: String(i).repeat(64) })
    runCap.push((await q(`select outreach_reserve($1,$2,15,$3) as r`, [d, String(i).repeat(64), '2030-01-02']))[0].r)
  }
  record('run cap 50 binds on the fourth 15-segment reservation',
    runCap[0].ok && runCap[1].ok && runCap[2].ok && runCap[3].ok === false && runCap[3].reason === 'LIMIT_RUN' ? 'PASS' : 'FAIL',
    `45 used, fourth refused: ${runCap[3].reason}`)

  // Ten 15-segment reservations from ten different recipients in ten different runs fill the day
  // (150) without tripping the run or recipient caps; the eleventh must be refused by the DAY cap.
  const dayReasons = []
  for (let i = 0; i < 11; i++) {
    const rcpt = String(i % 10).repeat(63) + String.fromCharCode(97 + i)
    const d = await makeDispatch({ run: `run_G${i}`, recipient: rcpt })
    dayReasons.push((await q(`select outreach_reserve($1,$2,15,$3) as r`, [d, rcpt, '2030-01-03']))[0].r)
  }
  record('day cap 150 binds at the 151st segment across runs',
    dayReasons.slice(0, 10).every(r => r.ok === true) && dayReasons[10].ok === false && dayReasons[10].reason === 'LIMIT_DAY'
      ? 'PASS' : 'FAIL', `first ten ${dayReasons.slice(0, 10).filter(r => r.ok).length}/10 ok; eleventh: ${dayReasons[10].reason}`)

  // Tighten one run's dollar ceiling, then prove the backstop is an independent gate.
  await q(`insert into outreach_allowance (scope_kind,scope_key,window_start,limit_segments,limit_micros)
           values ('RUN','run_H', current_date, 50, 100000)
           on conflict (scope_kind,scope_key,window_start) do update set limit_micros = 100000`)
  const dH = await makeDispatch({ run: 'run_H', recipient: 'h'.repeat(64) })
  const costGate = (await q(`select outreach_reserve($1,$2,13,$3) as r`, [dH, 'h'.repeat(64), '2030-01-04']))[0].r
  record('$1 run backstop refuses when segments would exceed the ceiling',
    costGate.ok === false && costGate.reason === 'LIMIT_COST_RUN' ? 'PASS' : 'FAIL', costGate.reason)

  // ── 8. app-update latency (≤ 5 s, measured not assumed) ──
  const samples = []
  for (let i = 0; i < 12; i++) {
    const d = await makeDispatch({ run: `run_L${i}`, recipient: 'i'.repeat(64) })
    const t0 = process.hrtime.bigint()
    const cl = (await q(`select outreach_claim($1,'lat',60) as r`, [d]))[0].r
    await q(`select outreach_reserve($1,$2,1,null)`, [d, 'i'.repeat(64)])
    await q(`select outreach_mark_handoff($1,$2) as ok`, [d, cl.token])
    await q(`select outreach_mark_accepted($1,$2,$3) as ok`, [d, cl.token, `SM-L${i}`])
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  samples.sort((x, y) => x - y)
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]
  record('app update round trip (claim→reserve→handoff→accept) p95 ≤ 5 s', p95 <= 5000 ? 'PASS' : 'FAIL',
    `p95 ${p95.toFixed(1)} ms over ${samples.length}`)

  await client.end().catch(() => {})
}

function writeReport() {
  try {
    const out = {
      at: new Date().toISOString(),
      image: IMAGE,
      migration: 'supabase/migrations/0087_outreach_dispatch.sql',
      checks: results,
    }
    writeFileSync(join(REPO, 'docs/evidence/outreach-rehearsal.json'), JSON.stringify(out, null, 2) + '\n')
  } catch {
    /* evidence is best-effort; the console result is authoritative */
  }
}

try {
  await main()
} catch (error) {
  record('rehearsal harness', 'FAIL', String(error).slice(0, 300))
} finally {
  if (liveClient) { await liveClient.end().catch(() => {}); liveClient = null }
  docker(['rm', '-f', CONTAINER])
  const failed = results.filter(r => r.status === 'FAIL')
  const blocked = results.filter(r => r.status === 'BLOCKED')
  console.log(`\n${results.length} checks · ${results.filter(r => r.status === 'PASS').length} PASS · ${failed.length} FAIL · ${blocked.length} BLOCKED`)
  writeReport()
  process.exitCode = failed.length ? 1 : blocked.length ? 3 : 0
}
