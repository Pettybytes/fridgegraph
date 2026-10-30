#!/usr/bin/env node
/**
 * Dry run for 0021_one_open_attempt.sql.
 *
 * Applies the migration inside one transaction, checks the invariant mechanics, then rolls back.
 * Hashes the touched function definitions before, after-apply and after-rollback; the final hash
 * must equal the original.
 *
 * What this proves: the partial unique index exists and is partial, open_attempt refuses a second
 * open attempt for one contact, close_attempt lets the next one open, a reply naming a closed
 * attempt is rejected with a zero webhook_events delta, and a no-answer is stored as its own source
 * without touching candidate_evaluations.
 *
 * What this does NOT prove: the two-connection concurrency race. A dry run rolls back, so there is
 * no committed index entry for a second live connection to collide with. That race is proven in
 * the applied proof (ops/0021-apply-proof.mjs), and the evidence says so.
 *
 * Applies nothing. Never prints the connection string.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='))
if (!row) { console.log('no SUPABASE_DB_URL'); process.exit(2) }
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '')

const body = readFileSync('supabase/migrations/0021_one_open_attempt.sql', 'utf8')
  .split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n')

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const FUNCS = ['open_attempt', 'close_attempt', '_close_attempt_on_outcome',
  'record_no_answer', 'accept_pickup_webhook', '_evaluate_candidates']

const hash = async () => (await c.query(`
  select md5(string_agg(d, '|' order by d)) h from (
    select pg_get_functiondef(p.oid) d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = any($1::text[])) s`, [FUNCS])).rows[0].h

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}

const before = await hash()
console.log('hash before      :', before)

await c.query('begin')
try {
  await c.query(body)
  const after = await hash()
  console.log('hash after apply :', after, after !== before ? '(changed)' : '(UNCHANGED — problem)')
  if (after === before) failed++

  // --- structure -----------------------------------------------------------
  const idx = await c.query(`
    select indexdef from pg_indexes
     where schemaname='public' and indexname='attempts_one_open_per_contact'`)
  check('partial unique index exists', idx.rows.length, 1)
  check('index is partial on closed_at is null',
    /where \(closed_at is null\)/i.test(idx.rows[0]?.indexdef || ''), true)
  check('index is unique', /unique index/i.test(idx.rows[0]?.indexdef || ''), true)

  const cols = await c.query(`
    select column_name from information_schema.columns
     where table_schema='public' and table_name in ('attempts','webhook_events')`)
  const names = cols.rows.map((r) => r.column_name)
  check('attempts.closed_at exists', names.includes('closed_at'), true)
  check('webhook_events.source exists', names.includes('source'), true)

  // --- scenarios (all inside the transaction, rolled back) -----------------
  // Clear every open attempt so the scratch job owns the contact.
  await c.query(`update attempts set closed_at = now(), closed_reason='DRYRUN_RESET'
                  where closed_at is null`)

  const child = (await c.query(`select person_id from children limit 1`)).rows[0].person_id
  const j = 'job_' + 'dryrun'.padEnd(26, '0')
  await c.query(`insert into coordination_jobs
      (id, idempotency_key, type, child_id, status, version, request_version, as_of)
      values ($1,$2,'PICKUP',$3,'discovering',1,1,current_date)`,
    [j, 'dryrun:' + j, child])

  const r1 = (await c.query(`select open_attempt($1,'p_bryan','SMS') r`, [j])).rows[0].r
  check('first attempt opens', r1.startsWith('opened:'), true)
  const att1 = r1.split(':')[1]

  const r2 = (await c.query(`select open_attempt($1,'p_bryan','SMS') r`, [j])).rows[0].r
  check('second attempt for same contact refused', r2.startsWith('refused:'), true)
  check('refusal names the open attempt', r2.endsWith(att1), true)
  check('still exactly one open for p_bryan',
    (await c.query(`select count(*)::int n from attempts
                     where candidate_id='p_bryan' and closed_at is null`)).rows[0].n, 1)

  check('close_attempt closes it',
    (await c.query(`select close_attempt($1,'DRYRUN') r`, [att1])).rows[0].r, true)
  check('close_attempt is idempotent',
    (await c.query(`select close_attempt($1,'DRYRUN') r`, [att1])).rows[0].r, false)

  // 0013 keeps one attempt per (job, candidate) forever, so the next legitimate attempt is a new
  // job's attempt -- not a second row on the same job.
  const j2 = 'job_' + 'dryrun2'.padEnd(25, '0')
  await c.query(`insert into coordination_jobs
      (id, idempotency_key, type, child_id, status, version, request_version, as_of)
      values ($1,$2,'PICKUP',$3,'discovering',1,1,current_date)`,
    [j2, 'dryrun:' + j2, child])
  const r3 = (await c.query(`select open_attempt($1,'p_bryan','SMS') r`, [j2])).rows[0].r
  check('next attempt opens after close', r3.startsWith('opened:'), true)
  const att2 = r3.split(':')[1]

  // closed-attempt reply: no row, no change
  await c.query(`select close_attempt($1,'DRYRUN')`, [att2])
  const evBefore = (await c.query(`select count(*)::int n from webhook_events`)).rows[0].n
  const rej = (await c.query(
    `select accept_pickup_webhook($1,true,null,1,'evt_dryrun_closed','sha_dryrun') r`,
    [att2])).rows[0].r
  check('reply to closed attempt rejected', rej, 'rejected_closed')
  const evAfter = (await c.query(`select count(*)::int n from webhook_events`)).rows[0].n
  check('webhook_events delta 0 on rejection', evAfter - evBefore, 0)
  check('attempt still closed, no late reopen',
    (await c.query(`select closed_at is not null a from attempts where id=$1`, [att2])).rows[0].a,
    true)

  // no-answer: own source, no evaluation write
  const j3 = 'job_' + 'dryrun3'.padEnd(25, '0')
  await c.query(`insert into coordination_jobs
      (id, idempotency_key, type, child_id, status, version, request_version, as_of)
      values ($1,$2,'PICKUP',$3,'discovering',1,1,current_date)`,
    [j3, 'dryrun:' + j3, child])
  const r4 = (await c.query(`select open_attempt($1,'p_bryan','CALL') r`, [j3])).rows[0].r
  const att3 = r4.split(':')[1]
  const ceBefore = (await c.query(
    `select count(*)::int n from candidate_evaluations where job_id=$1`, [j3])).rows[0].n
  const na = (await c.query(
    `select record_no_answer($1,'evt_dryrun_na','sha_na') r`, [att3])).rows[0].r
  check('no-answer recorded', na, 'recorded')
  const src = (await c.query(
    `select source, outcome from webhook_events where id='evt_dryrun_na'`)).rows[0]
  check('no-answer source', src?.source, 'no_answer')
  check('no-answer outcome', src?.outcome, 'NO_ANSWER')
  const ceAfter = (await c.query(
    `select count(*)::int n from candidate_evaluations where job_id=$1`, [j3])).rows[0].n
  check('no-answer writes nothing to candidate_evaluations', ceAfter - ceBefore, 0)
  check('no-answer closes the attempt',
    (await c.query(`select closed_reason from attempts where id=$1`, [att3])).rows[0].closed_reason,
    'NO_ANSWER')
} catch (e) {
  failed++
  console.log('APPLY FAILED:', e.message)
  await c.query('rollback')
  await c.end()
  process.exit(1)
}

await c.query('rollback')
const after = await hash()
console.log('hash after rollback:', after, after === before ? '(restored ✓)' : '(NOT RESTORED — problem)')
if (after !== before) failed++
await c.end()

if (failed) { console.log(`DRY RUN FAILED (${failed} failing checks)`); process.exit(1) }
console.log('DRY RUN OK — nothing persisted')
