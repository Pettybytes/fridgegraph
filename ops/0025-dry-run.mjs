#!/usr/bin/env node
/**
 * ops/0025-dry-run.mjs — dry run for 0025_demo_sandbox.sql (E2b + E2c).
 *
 * One transaction: the migration SQL is applied inside it, every probe runs against that state,
 * then everything is rolled back. Nothing is left behind.
 *
 * Probes:
 *   A. markers read ONLY from app_metadata (user_metadata cannot forge them)
 *   B. a job created by a demo session is recorded demo_caller; its attempts inherit it
 *   C. a demo attempt cannot be inserted as REAL_CONSENTED
 *   D. a RealCallAuthorization cannot be minted for a demo attempt
 *   E. promote and consume refuse a demo attempt
 *   F. assert_outreach_allowed refuses a demo attempt and passes a non-demo one
 *   G. rolled back: counts unchanged
 *
 * SCOPE NOTE: this script connects as the migration role, which BYPASSes Row Level Security. It can
 * therefore prove triggers and SECURITY DEFINER functions, and can prove NOTHING about policies.
 * Guide read scope and guide write refusal are proven over PostgREST with real tokens in
 * ops/e2c-proof.mjs. Do not add RLS assertions here — they would pass without policies existing.
 *
 * Usage: node ops/0025-dry-run.mjs
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const MAP = JSON.parse(readFileSync('data/identity-map.json', 'utf8'))
const userFor = (personId) => Object.entries(MAP).find(([, p]) => p === personId)?.[0]

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}
const counts = async () => ({
  people: (await db.query('select count(*)::int n from people')).rows[0].n,
  jobs: (await db.query('select count(*)::int n from coordination_jobs')).rows[0].n,
  attempts: (await db.query('select count(*)::int n from attempts')).rows[0].n,
  authz: (await db.query('select count(*)::int n from real_call_authorizations')).rows[0].n,
})
const before = await counts()

/** Act as a user id with the given app_metadata. Transaction-local. */
const actAs = async (sub, metadata = {}) => {
  await db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub, role: 'authenticated', app_metadata: metadata })])
}

/** Assert that a statement raises with a code. */
const expectRaise = async (label, sql, params, pattern) => {
  await db.query('savepoint e')
  try {
    await db.query(sql, params)
    check(label, false, 'no error raised')
  } catch (e) {
    check(label, pattern.test(String(e.message)), String(e.message).replace(/\n/g, ' ').slice(0, 90))
  }
  await db.query('rollback to savepoint e')
}

const GUIDED = userFor('p_demo_guide')
const KENDRA = userFor('p_mom')
if (!GUIDED || !KENDRA) throw new Error('identity map missing the guide or Kendra — run the seed')

const raw = readFileSync('supabase/migrations/0025_demo_sandbox.sql', 'utf8')
const body = raw.slice(raw.search(/^begin;/im) + 'begin;'.length, raw.lastIndexOf('commit;'))

console.log('=== 0025 dry run (migration applied inside one transaction, then rolled back) ===')
await db.query('begin')
try {
  await db.query(body)
  console.log('  migration SQL applied inside the transaction')

  // --- A. markers come from app_metadata only -----------------------------
  await actAs(KENDRA, { demo: true })
  check('A1 demo claim in app_metadata -> is_demo_caller()', (await db.query('select is_demo_caller() r')).rows[0].r === true)
  check('A2 demo claim does not imply guide', (await db.query('select is_demo_guide() r')).rows[0].r === false)

  await actAs(KENDRA, {})
  check('A3 no claim -> not demo', (await db.query('select is_demo_caller() r')).rows[0].r === false)

  await db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: KENDRA, role: 'authenticated', user_metadata: { demo: true, demo_guide: true } })])
  check('A4 user_metadata.demo cannot forge the marker',
    (await db.query('select is_demo_caller() r, is_demo_guide() r2')).rows[0].r === false)
  check('A5 user_metadata.demo_guide cannot forge the marker',
    (await db.query('select is_demo_guide() r')).rows[0].r === false)

  await db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: KENDRA, role: 'authenticated', app_metadata: { demo: 'false' } })])
  check('A6 app_metadata.demo = "false" is not true', (await db.query('select is_demo_caller() r')).rows[0].r === false)

  // --- B. a demo session's job is recorded --------------------------------
  const child = (await db.query(
    `select child_id from coordination_jobs where status = 'discovering' limit 1`)).rows[0]?.child_id
    ?? (await db.query(`select person_id from children limit 1`)).rows[0].person_id

  await actAs(KENDRA, { demo: true })
  const newJob = (await db.query(
    `insert into coordination_jobs (id, idempotency_key, type, child_id, status)
     values ('job_dry_demo', 'dry-demo-' || gen_random_uuid()::text, 'PICKUP', $1, 'pending')
     returning demo_caller, sandbox`, [child])).rows[0]
  check('B1 demo session creates a demo_caller job', newJob.demo_caller === true)
  check('B2 job is sandbox (fictional record)', newJob.sandbox === true)

  await actAs(KENDRA, {})
  const realJob = (await db.query(
    `insert into coordination_jobs (id, idempotency_key, type, child_id, status)
     values ('job_dry_real', 'dry-real-' || gen_random_uuid()::text, 'PICKUP', $1, 'pending')
     returning demo_caller, sandbox`, [child])).rows[0]
  check('B3 a non-demo session is not marked demo_caller', realJob.demo_caller === false)

  const demoAttempt = (await db.query(
    `insert into attempts (id, job_id, channel, at, candidate_id, destination_mode)
     values ('att_dry_demo', 'job_dry_demo', 'SMS', now(), 'p_gma', 'TEST_RESPONDER')
     returning demo_caller, sandbox`)).rows[0]
  check('B4 attempt inherits demo_caller from its job', demoAttempt.demo_caller === true)
  check('B5 attempt inherits sandbox from its job', demoAttempt.sandbox === true)

  await expectRaise('B6 a demo attempt cannot be created REAL_CONSENTED',
    `insert into attempts (id, job_id, channel, at, candidate_id, destination_mode)
     values ('att_dry_demo_real', 'job_dry_demo', 'CALL', now(), 'p_holt', 'REAL_CONSENTED')`,
    [], /DEMO_OUTREACH_REFUSED/)

  const realAttempt = (await db.query(
    `insert into attempts (id, job_id, channel, at, candidate_id, destination_mode)
     values ('att_dry_real', 'job_dry_real', 'CALL', now(), 'p_holt', 'TEST_RESPONDER')
     returning demo_caller`)).rows[0]
  check('B7 a non-demo attempt stays non-demo', realAttempt.demo_caller === false)

  // --- C/D. authorization mint -------------------------------------------
  await expectRaise('D1 no authorization can be minted for a demo attempt',
    `insert into real_call_authorizations (id, attempt_id, recipient_ref, expires_at)
     values ('auth_dry_demo', 'att_dry_demo', 'dry-contact-ref', now() + interval '10 minutes')`,
    [], /DEMO_OUTREACH_REFUSED/)

  const minted = await db.query(
    `insert into real_call_authorizations (id, attempt_id, recipient_ref, expires_at, job_id, candidate_id)
     values ('auth_dry_real', 'att_dry_real', 'dry-contact-ref', now() + interval '10 minutes',
             'job_dry_real', 'p_holt') returning id`)
  check('D2 the same insert is allowed for a non-demo attempt', minted.rowCount === 1)

  // --- E. promote / consume -----------------------------------------------
  await expectRaise('E1 promote refuses a demo attempt',
    `select promote_attempt_to_real_consented('att_dry_demo', 'dry-contact-ref')`, [],
    /DEMO_OUTREACH_REFUSED/)
  await expectRaise('E2 consume refuses a demo attempt (service role path)',
    `select consume_real_call_authorization('att_dry_demo', 'dry-contact-ref')`, [],
    /DEMO_OUTREACH_REFUSED/)

  // Even with the attempt relabelled by hand, the caller marker still refuses.
  await db.query(`alter table attempts disable trigger attempts_refuse_demo_promotion`)
  await db.query(`update attempts set destination_mode='REAL_CONSENTED' where id='att_dry_demo'`)
  await actAs(KENDRA, { demo: true })
  await expectRaise('E3 a demo CALLER is refused even on a relabelled attempt',
    `select consume_real_call_authorization('att_dry_demo', 'dry-contact-ref')`, [],
    /DEMO_OUTREACH_REFUSED/)
  await actAs(KENDRA, {})
  await db.query(`alter table attempts enable trigger attempts_refuse_demo_promotion`)

  // --- F. dispatcher pre-flight -------------------------------------------
  await expectRaise('F1 assert_outreach_allowed refuses a demo attempt',
    `select assert_outreach_allowed('att_dry_demo')`, [], /DEMO_OUTREACH_REFUSED/)
  await expectRaise('F2 assert_outreach_allowed refuses unknown attempts',
    `select assert_outreach_allowed('att_does_not_exist')`, [], /ATTEMPT_NOT_FOUND/)

  // --- G. marker helpers on real seed data --------------------------------
  // Existence helpers only: a boolean, never rows. Policy behaviour is proven over PostgREST.
  const kids = (await db.query(`select person_id from children order by person_id limit 2`)).rows
  check('G1 is_sandbox_child recognises a seeded child',
    (await db.query('select is_sandbox_child($1) r', [kids[0].person_id])).rows[0].r === true,
    kids[0].person_id)
  check('G2 is_sandbox_person recognises a seeded person',
    (await db.query('select is_sandbox_person($1) r', [kids[0].person_id])).rows[0].r === true)
  check('G3 an unknown person is not sandbox',
    (await db.query(`select is_sandbox_person('p_not_a_person') r`)).rows[0].r === false)
  check('G4 the guide person row exists and belongs to no household',
    (await db.query(`select count(*)::int n from people p where p.id = 'p_demo_guide'`)).rows[0].n === 1
    && (await db.query(`select count(*)::int n from household_members where person_id = 'p_demo_guide'`)).rows[0].n === 0)
} finally {
  await db.query('rollback')
}

const after = await counts()
for (const key of Object.keys(before)) {
  check(`H rolled back: ${key} unchanged`, before[key] === after[key], `${before[key]} -> ${after[key]}`)
}

await db.end()
console.log(failed ? `\nDRY RUN FAILED: ${failed}` : '\nDRY RUN PASSED')
process.exit(failed ? 1 : 0)
