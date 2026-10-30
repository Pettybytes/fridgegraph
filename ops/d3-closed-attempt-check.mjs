#!/usr/bin/env node
/**
 * D3 acceptance #4 — a voice-turn reply on a CLOSED attempt returns END_CALL and mutates nothing.
 *
 * Uses an EXISTING closed attempt (no fixture is created, so nothing is left behind) and compares
 * the full coordination state before and after the HTTP call. Also re-proves the SQL layer refuses
 * the same event inside a rolled-back transaction.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}

const closed = (await db.query(
  `select id, job_id, candidate_id, closed_at from attempts
    where closed_at is not null order by closed_at desc limit 1`)).rows[0]
console.log(`closed attempt under test: ${closed.id}`)

const snap = async () => ({
  attempt: (await db.query(`select id, job_id, candidate_id, closed_at, closed_reason,
                                   destination_mode, real_consent_consumed_at
                              from attempts where id=$1`, [closed.id])).rows[0],
  evals: (await db.query(
    `select count(*)::int n, coalesce(sum(case when available then 1 else 0 end),0)::int yes
       from candidate_evaluations where job_id=$1`, [closed.job_id])).rows[0],
  events: (await db.query(`select count(*)::int n from webhook_events`)).rows[0].n,
  job: (await db.query(`select status, version from coordination_jobs where id=$1`, [closed.job_id])).rows[0],
  confirms: (await db.query(`select count(*)::int n from confirmations where job_id=$1`, [closed.job_id])).rows[0].n,
})

const before = await snap()
const r = await fetch('http://127.0.0.1:4118/voice-turn', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-fridgegraph-webhook-secret': env.N8N_WEBHOOK_SECRET,
    'x-fridgegraph-timestamp': String(Math.floor(Date.now() / 1000)),
  },
  body: JSON.stringify({ attemptId: closed.id, decision: 'ACCEPTED' }),
})
const json = await r.json().catch(() => ({}))
console.log(`  response ${r.status} ${JSON.stringify(json).slice(0, 140)}`)
const after = await snap()

check('HTTP status', r.status, 200)
check('status is END_CALL', json.status, 'END_CALL')
check('note is attempt_closed', json.note, 'attempt_closed')
check('attempt row unchanged', JSON.stringify(after.attempt), JSON.stringify(before.attempt))
check('candidate_evaluations unchanged', JSON.stringify(after.evals), JSON.stringify(before.evals))
check('webhook_events delta', after.events - before.events, 0)
check('job unchanged', JSON.stringify(after.job), JSON.stringify(before.job))
check('confirmations unchanged', after.confirms - before.confirms, 0)

// The SQL layer must also refuse, inside a transaction that is rolled back.
await db.query('begin')
const ev0 = (await db.query(`select count(*)::int n from webhook_events`)).rows[0].n
const sqlRes = (await db.query(
  `select accept_pickup_webhook($1,true,null,1,'evt_d3_closed_accept','sha_d3') r`, [closed.id])).rows[0].r
const ev1 = (await db.query(`select count(*)::int n from webhook_events`)).rows[0].n
await db.query('rollback')
check('SQL rejects the closed attempt', sqlRes, 'rejected_closed')
check('SQL event delta', ev1 - ev0, 0)

await db.end()
if (failed) { console.log(`\nD3 ACCEPTANCE FAILED (${failed})`); process.exit(1) }
console.log('\nD3 ACCEPTANCE OK — END_CALL, zero coordination mutation')
