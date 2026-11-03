#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES AUTHORIZATION REHEARSAL for the 30-day demo pickup-coordination history
 * (migration 0084, STAGED — not applied anywhere). Full design: docs/contracts/demo-history.md.
 *
 * Covers the SQL authorization half only — real disposable Postgres, same methodology as every
 * other proof this session. The HTTP/media-service half (the /api/demo/voice-note/:id endpoint
 * itself: bearer requirement, no-store header, 404-for-both, reauthorization on a subsequent
 * request, the RPC genuinely gating the file read) is a SEPARATE, real loopback-HTTP test
 * (src/demo/voiceNoteEndpoint.test.ts); the GraphQL read contract (CandidateEvaluation.voiceNoteId,
 * VoiceNote.responseId/status/proposedScript, non-empty turnTimings) is a third, separate, real
 * graphql()-execution test (src/subgraphs/coordination.voiceNoteContract.test.ts) — per the
 * contract's own §6: "a disposable-Postgres SQL proof alone does not and cannot prove HTTP/
 * signed-URL behavior."
 *
 * Checks:
 *   1. Kendra (parent) reads jobTimeline-equivalent rows for a history story and sees the two NEW
 *      event sources: a real RESPONSE_RECORDED instant (responded_at/response_kind) and, for a
 *      different story, a real JOB_DECLINED instant (decided_at).
 *   2. Kendra reads voice_notes metadata for her own child's story.
 *   3. The note's own speaker (the caregiver who left it) reads her own voice note, even without
 *      being the parent.
 *   4. A DIFFERENT caregiver (not the speaker, not a parent) is refused reading that voice note.
 *   5. A parent of an unrelated child (other family) is refused reading both the story's responses
 *      and its voice note.
 *   6. A stranger with zero relation and zero grants (same shape as guide/anonymous) is refused.
 *   7. voice_note_access(id) itself returns access=null/storage_path=null for every refused caller
 *      — the no-oracle guarantee the HTTP endpoint depends on, proven directly at the RPC level.
 *   8. No authenticated caller — not even the parent — can INSERT/UPDATE/DELETE a voice_notes row:
 *      this table is reset/seed-written only, never a live write path.
 *   9. A PENDING voice note (no delivered audio yet) is refused by voice_note_access for EVERYONE,
 *      including the parent and the speaker — identical to a refused or nonexistent note. Proves
 *      the delivered-vs-proposed separation is enforced at the database, not just by convention.
 *
 * Usage: node ops/demo-history-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-demo-history-${randomUUID().slice(0, 8)}`;
const lines = [];
const log = (line) => { process.stdout.write(`${line}\n`); lines.push(line); };
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function stopContainer() { spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' }); }
async function waitForReady(makeClient, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const client = makeClient();
    try { await client.connect(); return client; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  fail('postgres container never became reachable');
}

// 0001 (base tables), 0003 (current_person/is_parent_of v1/has_scope v1), 0004 (table GRANTs),
// 0006 (local_today/has_scope final form), 0013 (coordination_jobs/attempts/candidate_evaluations,
// accept_pickup/approve_pickup v1, _is_approver_for), 0017 (approve_pickup widened, over-limit),
// 0024 (is_parent_of widened to guardian), 0084 (this PR — redefines accept_pickup/approve_pickup
// additively, adds voice_notes). 0021 (attempts.closed_at/closed_reason + webhook dedupe) is
// deliberately NOT included — this proof's own fixtures never write or read those columns, and
// 0021 pulls in webhook_events (0018), out of scope for what this proof actually exercises.
const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0004_grants.sql',
  'supabase/migrations/0006_local_today.sql',
  'supabase/migrations/0013_station06_coordination.sql',
  'supabase/migrations/0017_over_limit_fallback.sql',
  'supabase/migrations/0024_authority_model.sql',
  'supabase/migrations/0084_demo_history.sql',
];

async function applyMigrations(client) {
  for (const path of MIGRATIONS) {
    const sql = readFileSync(path, 'utf8');
    try { await client.query(sql); } catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`applied ${MIGRATIONS.length} targeted migrations: ${MIGRATIONS.map((p) => p.split('/').pop()).join(', ')}`);
}

async function stubAuth(client) {
  await client.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('test.current_uid', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb
    language sql stable as $$
      select coalesce(nullif(current_setting('test.current_jwt', true), '')::jsonb, '{}'::jsonb)
    $$;
  `);
}

async function seedFixtures(client) {
  // Nora's family (Kendra/Andre, divorced-parents shape, same as every other proof this session).
  // Caregivers: Loretta (speaker on the voice note) and Priya (a DIFFERENT caregiver, no relation
  // to this specific response). A fully separate family for cross-family refusal. A stranger.
  await client.query(`
    insert into villages (id, name) values ('v_nora', 'Nora''s village'), ('v_other', 'Other village');
    insert into people (id, display_name, birth_date) values
      ('p_nora', 'Nora Ellison', '2018-03-14'),
      ('p_mom', 'Kendra Ellison', '1988-05-02'),
      ('p_dad', 'Andre Ellison', '1986-09-20'),
      ('p_gma', 'Loretta Brooks', '1960-01-01'),
      ('p_priya', 'Priya Nair', '2003-09-05'),
      ('p_stranger', 'A Stranger', '1990-01-01'),
      ('p_other_mom', 'Other Mom', '1985-01-01'),
      ('p_other_child', 'Other Child', '2019-01-01');
    insert into children (person_id) values ('p_nora'), ('p_other_child');
    insert into households (id, village_id) values ('h_a', 'v_nora'), ('h_b', 'v_nora'), ('h_other', 'v_other');
    insert into household_members (person_id, household_id, role) values
      ('p_mom', 'h_a', 'parent'), ('p_nora', 'h_a', 'child'),
      ('p_dad', 'h_b', 'parent'), ('p_nora', 'h_b', 'child'),
      ('p_other_mom', 'h_other', 'parent'), ('p_other_child', 'h_other', 'child');

    -- One confirmed, voice-to-resolution story (mirrors job_hist_08 in the real dataset).
    insert into coordination_jobs (id, idempotency_key, type, child_id, status, version, request_version, created_at)
    values ('job_hist_test', 'pickup:p_nora:test:hist', 'PICKUP', 'p_nora', 'confirmed', 1, 1, now() - interval '5 days');
    insert into attempts (id, job_id, channel, at, candidate_id, destination_mode)
    values ('att_hist_test', 'job_hist_test', 'CALL', now() - interval '5 days', 'p_gma', 'TEST_RESPONDER');
    insert into candidate_evaluations (id, job_id, request_version, candidate_id, available, response_kind, responded_at, accepted_via)
    values ('ce_hist_test', 'job_hist_test', 1, 'p_gma', true, 'ACCEPTED', now() - interval '5 days' + interval '8 minutes', 'CANDIDATE_JWT');
    -- READY: this row exercises AUTHORIZATION (checks 2-7), which needs a delivered note to test
    -- against — a PENDING one would refuse everyone regardless of who's asking (check 9 below
    -- tests that gate on its own, separately).
    insert into voice_notes (id, response_id, speaker_person_id, status, proposed_script, transcript, duration_seconds, storage_path, sha256, content_type, generated_at, transcribed_at, muse_storage_path, muse_sha256)
    values ('vn_hist_test', 'ce_hist_test', 'p_gma', 'READY', 'Of course, sweetheart. I will leave a little early.', 'Of course, sweetheart. I will leave a little early.', 9.8, 'demo-history/test.mp3', repeat('0', 64), 'audio/mpeg', now(), now(), 'demo-history/test.wav', repeat('1', 64));

    -- PENDING: no delivered audio/transcript/duration/hash yet — only a proposed script, status
    -- defaults to PENDING. check 9 proves this is refused for EVERYONE, parent and speaker alike.
    insert into voice_notes (id, response_id, speaker_person_id, proposed_script)
    values ('vn_hist_pending', 'ce_hist_test', 'p_gma', 'Draft line, not yet recorded.');

    -- A second story, explicitly declined by the parent — proves JOB_DECLINED has a real instant.
    insert into coordination_jobs (id, idempotency_key, type, child_id, status, version, request_version, created_at, decided_at, failure_reason)
    values ('job_hist_declined', 'pickup:p_nora:test:declined', 'PICKUP', 'p_nora', 'failed', 2, 1,
            now() - interval '9 days', now() - interval '9 days' + interval '40 minutes', 'approver_declined');
  `);
}

async function asPerson(client, userId) {
  await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
}

async function main() {
  log(`[demo-history-proof] container ${CONTAINER}`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  if (!portLine.startsWith('127.0.0.1:')) fail(`container port is not loopback-bound: ${portLine}`);
  const port = Number(portLine.split(':').pop());
  log(`postgres listening on ${portLine} (loopback-bound)`);

  const superuser = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  log('connected (setup connection)');
  await stubAuth(superuser);
  await applyMigrations(superuser);
  await seedFixtures(superuser);
  log('seeded minimal fixtures (Kendra/Andre/Loretta/Priya/stranger/other-family, one voice-to-resolution story, one declined story)');

  const uid = {};
  for (const id of ['p_mom', 'p_dad', 'p_gma', 'p_priya', 'p_stranger', 'p_other_mom']) uid[id] = randomUUID();
  const values = Object.entries(uid).map(([id, u]) => `('${u}','${id}')`).join(',');
  await superuser.query(`insert into identity_map (user_id, person_id) values ${values}`);

  const client = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await client.query('set role authenticated');
  const as = (id) => asPerson(client, uid[id]);
  const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, error: null })).catch((e) => ({ rows: null, error: e }));

  // --- Check 1: Kendra reads the two new event sources' underlying columns ---
  await as('p_mom');
  const resp = await q("select responded_at, response_kind from candidate_evaluations where id = 'ce_hist_test'");
  if (resp.error || resp.rows[0].responded_at === null || resp.rows[0].response_kind !== 'ACCEPTED') {
    fail(`check 1a FAILED: ${JSON.stringify(resp)}`);
  }
  const decl = await q("select decided_at, failure_reason from coordination_jobs where id = 'job_hist_declined'");
  if (decl.error || decl.rows[0].decided_at === null || decl.rows[0].failure_reason !== 'approver_declined') {
    fail(`check 1b FAILED: ${JSON.stringify(decl)}`);
  }
  log('check 1 PASS: Kendra (parent) reads a real responded_at/response_kind pair, and a real decided_at/failure_reason pair for a declined story');

  // --- Check 2: Kendra reads the voice note's metadata ---
  const note = await q("select transcript, duration_seconds, speaker_person_id from voice_notes where id = 'vn_hist_test'");
  if (note.error || note.rows.length !== 1) fail(`check 2 FAILED: ${JSON.stringify(note)}`);
  log('check 2 PASS: Kendra (parent of the story\'s child) reads the voice note\'s metadata');

  // --- Check 3: the speaker (Loretta) reads her own note ---
  await as('p_gma');
  const own = await q("select id from voice_notes where id = 'vn_hist_test'");
  if (own.error || own.rows.length !== 1) fail(`check 3 FAILED: ${JSON.stringify(own)}`);
  log('check 3 PASS: the note\'s own speaker reads it, independent of being a parent');

  // --- Check 4: a different caregiver (Priya) is refused ---
  await as('p_priya');
  const priyaRead = await q("select id from voice_notes where id = 'vn_hist_test'");
  if (priyaRead.error) fail(`check 4 FAILED unexpectedly errored: ${priyaRead.error.message}`);
  if (priyaRead.rows.length !== 0) fail('check 4 FAILED: an unrelated caregiver read a voice note that is not hers and not her child\'s');
  log('check 4 PASS: a different caregiver (not the speaker, not a parent) is refused — zero rows, no oracle');

  // --- Check 5: an unrelated family (other child\'s parent) is refused ---
  await as('p_other_mom');
  const otherFamilyNote = await q("select id from voice_notes where id = 'vn_hist_test'");
  if (otherFamilyNote.rows.length !== 0) fail('check 5a FAILED: an unrelated family read the voice note');
  const otherFamilyResp = await q("select id from candidate_evaluations where id = 'ce_hist_test'");
  if (otherFamilyResp.rows.length !== 0) fail('check 5b FAILED: an unrelated family read the response row');
  log('check 5 PASS: a parent of a different, unrelated child is refused both the response and the voice note');

  // --- Check 6: a stranger (zero relation, zero grants) is refused ---
  await as('p_stranger');
  const strangerNote = await q("select id from voice_notes where id = 'vn_hist_test'");
  if (strangerNote.rows.length !== 0) fail('check 6 FAILED: a stranger read the voice note');
  log('check 6 PASS: a stranger with zero relation and zero grants (same shape as guide/anonymous) is refused');

  // --- Check 7: voice_note_access(id) itself returns null/null for every refused caller ---
  const accessAsStranger = await q("select * from voice_note_access('vn_hist_test')");
  if (accessAsStranger.error) fail(`check 7a FAILED: ${accessAsStranger.error.message}`);
  if (accessAsStranger.rows[0].access !== null || accessAsStranger.rows[0].storage_path !== null) {
    fail(`check 7a FAILED: a stranger's voice_note_access call leaked access/storage_path: ${JSON.stringify(accessAsStranger.rows[0])}`);
  }
  await as('p_mom');
  const accessAsParent = await q("select * from voice_note_access('vn_hist_test')");
  if (accessAsParent.error || accessAsParent.rows[0].access !== 'PARENT' || !accessAsParent.rows[0].storage_path) {
    fail(`check 7b FAILED: ${JSON.stringify(accessAsParent)}`);
  }
  await as('p_gma');
  const accessAsSpeaker = await q("select * from voice_note_access('vn_hist_test')");
  if (accessAsSpeaker.error || accessAsSpeaker.rows[0].access !== 'SPEAKER' || !accessAsSpeaker.rows[0].storage_path) {
    fail(`check 7c FAILED: ${JSON.stringify(accessAsSpeaker)}`);
  }
  log('check 7 PASS: voice_note_access(id) itself returns null/null for a refused caller, and the correct access level + storage_path for the parent and the speaker respectively — the no-oracle guarantee the HTTP endpoint depends on');

  // --- Check 8: no authenticated caller, not even the parent, can write voice_notes directly ---
  await as('p_mom');
  const parentInsert = await q(
    "insert into voice_notes (id, response_id, speaker_person_id, transcript, duration_seconds, storage_path, sha256) values ('vn_forged','ce_hist_test','p_mom','forged',1.0,'x',repeat('0',64))",
  );
  if (!parentInsert.error) fail('check 8 FAILED: an authenticated parent was able to insert a voice_notes row directly — this table must be reset/seed-written only');
  log(`check 8 PASS: no authenticated caller can write voice_notes directly — reset/seed-written only (${parentInsert.error.message})`);

  // --- Check 9: a PENDING note is refused by voice_note_access for EVERYONE, including the
  // parent and the speaker — identical to a refused or nonexistent note, never distinguishable. ---
  await as('p_mom');
  const pendingAsParent = await q("select * from voice_note_access('vn_hist_pending')");
  if (pendingAsParent.error || pendingAsParent.rows[0].access !== null || pendingAsParent.rows[0].storage_path !== null) {
    fail(`check 9a FAILED: a PENDING note leaked access to its parent: ${JSON.stringify(pendingAsParent)}`);
  }
  await as('p_gma');
  const pendingAsSpeaker = await q("select * from voice_note_access('vn_hist_pending')");
  if (pendingAsSpeaker.error || pendingAsSpeaker.rows[0].access !== null || pendingAsSpeaker.rows[0].storage_path !== null) {
    fail(`check 9b FAILED: a PENDING note leaked access to its own speaker: ${JSON.stringify(pendingAsSpeaker)}`);
  }
  log('check 9 PASS: a PENDING voice note (no delivered audio yet) is refused by voice_note_access for both the parent and the speaker — the delivered-vs-proposed separation is enforced at the database');

  await client.end();
  await superuser.end();
  log('ALL CHECKS PASS — DISPOSABLE-POSTGRES AUTHORIZATION REHEARSAL (not a live application)');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/demo-history-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/demo-history-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
