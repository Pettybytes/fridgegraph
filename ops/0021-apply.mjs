#!/usr/bin/env node
/**
 * Apply 0021_one_open_attempt.sql and prove its acceptance cases against the live (dev) database.
 *
 * Prints: backfill counts, then the three acceptance cases with before/after evidence.
 * Case 1 is a REAL two-connection race: two clients call open_attempt for the SAME contact at the
 * same time, each on its own discovering job. Exactly one may become open.
 *
 * Never prints the connection string.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')

const sql = readFileSync('supabase/migrations/0021_one_open_attempt.sql', 'utf8')
const client = () => new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const c = await client()
await c.connect()

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}

console.log('=== apply ===')
await c.query(sql)
console.log('applied (or already applied — create/replace is idempotent)')

const back = await c.query(`
  select closed_reason, count(*)::int n from attempts
   where closed_reason like 'BACKFILL%' group by 1 order by 1`)
console.log('backfill closure counts:', JSON.stringify(back.rows))
console.log('open attempts now      :', (await c.query(
  `select count(*)::int n from attempts where closed_at is null`)).rows[0].n)
const dupes = await c.query(`
  select candidate_id, count(*)::int n from attempts
   where closed_at is null group by 1 having count(*) > 1`)
check('no contact has two open attempts', dupes.rows.length, 0)

// --- proof fixture ---------------------------------------------------------
const P = 'p_lbproof'
await c.query(`insert into people (id, display_name, birth_date)
               values ($1,'Level B Proof Contact','1990-01-01') on conflict (id) do nothing`, [P])
await c.query(`update attempts set closed_at=now(), closed_reason='PROOF_RESET'
                where candidate_id=$1 and closed_at is null`, [P])

const child = (await c.query(`select person_id from children limit 1`)).rows[0].person_id
const mkJob = async (tag) => {
  const id = 'job_' + Buffer.from('lb-proof-' + tag + '-' + Date.now()).toString('hex').slice(0, 26)
  await c.query(`insert into coordination_jobs
      (id, idempotency_key, type, child_id, status, version, request_version, as_of)
      values ($1,$2,'PICKUP',$3,'discovering',1,1,current_date)`, [id, 'proof:' + id, child])
  return id
}

// --- case 1: concurrent creation, same contact -----------------------------
console.log('\n=== case 1: two concurrent attempt creations, one contact ===')
const jA = await mkJob('a')
const jB = await mkJob('b')
const c1 = client(), c2 = client()
await c1.connect(); await c2.connect()
const [rA, rB] = await Promise.all([
  c1.query(`select open_attempt($1,$2,'SMS') r`, [jA, P]).then((q) => q.rows[0].r),
  c2.query(`select open_attempt($1,$2,'SMS') r`, [jB, P]).then((q) => q.rows[0].r),
])
await c1.end(); await c2.end()
console.log('  connection A ->', rA)
console.log('  connection B ->', rB)
const opened = [rA, rB].filter((r) => r.startsWith('opened:')).length
check('exactly one concurrent creation opened', opened, 1)
check('the other was refused', [rA, rB].filter((r) => r.startsWith('refused:')).length, 1)
check('exactly one open row for the contact', (await c.query(
  `select count(*)::int n from attempts where candidate_id=$1 and closed_at is null`, [P])).rows[0].n, 1)

const winnerAtt = (rA.startsWith('opened:') ? rA : rB).split(':')[1]
const winnerJob = rA.startsWith('opened:') ? jA : jB
const loserJob = rA.startsWith('opened:') ? jB : jA

// --- case 2: closing lets the next legitimate attempt open -----------------
console.log('\n=== case 2: close, then a legitimate next attempt ===')
const beforeRow = (await c.query(
  `select closed_at, closed_reason from attempts where id=$1`, [winnerAtt])).rows[0]
console.log('  before close:', JSON.stringify(beforeRow))
check('closing the open attempt succeeds',
  (await c.query(`select close_attempt($1,'PROOF_CLOSED') r`, [winnerAtt])).rows[0].r, true)
const r2 = (await c.query(`select open_attempt($1,$2,'SMS') r`, [loserJob, P])).rows[0].r
console.log('  next creation ->', r2)
check('next legitimate attempt opens', r2.startsWith('opened:'), true)

// --- case 3: an event naming a closed attempt changes nothing --------------
console.log('\n=== case 3: event naming a closed attempt ===')
const closedAtt = winnerAtt
const attBefore = (await c.query(
  `select id, job_id, candidate_id, closed_at, closed_reason from attempts where id=$1`,
  [closedAtt])).rows[0]
const evBefore = (await c.query(`select count(*)::int n from webhook_events`)).rows[0].n
const ceBefore = (await c.query(
  `select count(*)::int n from candidate_evaluations where job_id=$1`, [winnerJob])).rows[0].n
const rej = (await c.query(
  `select accept_pickup_webhook($1,true,null,1,'evt_lbproof_closed','sha_lbproof') r`,
  [closedAtt])).rows[0].r
const attAfter = (await c.query(
  `select id, job_id, candidate_id, closed_at, closed_reason from attempts where id=$1`,
  [closedAtt])).rows[0]
const evAfter = (await c.query(`select count(*)::int n from webhook_events`)).rows[0].n
const ceAfter = (await c.query(
  `select count(*)::int n from candidate_evaluations where job_id=$1`, [winnerJob])).rows[0].n
console.log('  result      :', rej)
console.log('  attempt row :', JSON.stringify(attAfter))
check('closed-attempt event rejected', rej, 'rejected_closed')
check('attempt row unchanged', JSON.stringify(attAfter), JSON.stringify(attBefore))
check('webhook_events delta', evAfter - evBefore, 0)
check('candidate_evaluations delta', ceAfter - ceBefore, 0)

console.log('\n=== index definition ===')
console.log((await c.query(
  `select indexdef from pg_indexes where indexname='attempts_one_open_per_contact'`)).rows[0].indexdef)

await c.end()
if (failed) { console.log(`\nAPPLIED PROOF FAILED (${failed})`); process.exit(1) }
console.log('\nAPPLIED PROOF OK')
