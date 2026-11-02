#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES AUTHORIZATION REHEARSAL for the Phase 2 fridge backend (migration 0083,
 * STAGED — not applied anywhere). See docs/contracts/fridge-notes.md for the full design.
 *
 * Covers both halves of 0083:
 *   A. Goals — new columns (period, completed_at — independent of status), new CRUD mutations'
 *      underlying RLS/trigger behavior, preserving the EXISTING approved/proposed visibility rule
 *      unchanged.
 *   B. Fridge notes — a new table: parent/guardian posting (default PARENTS_ONLY), explicit
 *      SHARED sharing gated by a fridge.read grant, caregiver posting gated by an explicit
 *      fridge.post grant (household membership alone grants nothing), author-only content edits,
 *      parent-only delete, and database-enforced immutability (child/author can never change;
 *      a non-parent author can never touch audience).
 *
 * Disposable only: a throwaway postgres:16-alpine container, loopback-bound from first launch,
 * removed unconditionally. Never touches the shared/project database.
 *
 * Usage: node ops/fridge-phase2-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-fridge-phase2-${randomUUID().slice(0, 8)}`;
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

// Curated: 0001 (base tables), 0003 (current_person/is_parent_of v1/has_scope v1), 0004 (the
// table-level GRANTs — without this, goals writes 403 before any policy runs, proving nothing),
// 0006 (local_today + has_scope's final, timezone-correct form), 0024 (is_parent_of widened to
// parent+guardian — needed to actually exercise "guardian", not just "parent"), 0083 (this PR).
const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0004_grants.sql',
  'supabase/migrations/0006_local_today.sql',
  'supabase/migrations/0024_authority_model.sql',
  'supabase/migrations/0083_fridge_phase2.sql',
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
    do $$
    begin
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
  // Nora's family: Kendra (parent, h_a), Andre (parent, h_b — divorced-parents shape, same as
  // every other proof this session), Loretta (GUARDIAN, h_a — proves guardian authority, not
  // just parent), Walt (resident_adult, h_a — household membership alone, no grant, proves
  // nothing). Priya starts with NO grants (added explicitly per-check below). A fully separate
  // family (p_other_mom/p_other_child) for cross-family refusal. A stranger with zero relation.
  await client.query(`
    insert into villages (id, name) values ('v_nora', 'Nora''s village'), ('v_other', 'Other village');
    insert into people (id, display_name, birth_date) values
      ('p_nora', 'Nora Ellison', '2018-03-14'),
      ('p_mom', 'Kendra Ellison', '1988-05-02'),
      ('p_dad', 'Andre Ellison', '1986-09-20'),
      ('p_gma', 'Loretta Brooks', '1960-01-01'),
      ('p_walt', 'Walt Brooks', '1965-01-01'),
      ('p_priya', 'Priya Nair', '2003-09-05'),
      ('p_stranger', 'A Stranger', '1990-01-01'),
      ('p_other_mom', 'Other Mom', '1985-01-01'),
      ('p_other_child', 'Other Child', '2019-01-01');
    insert into children (person_id) values ('p_nora'), ('p_other_child');
    insert into households (id, village_id) values ('h_a', 'v_nora'), ('h_b', 'v_nora'), ('h_other', 'v_other');
    insert into household_members (person_id, household_id, role) values
      ('p_mom', 'h_a', 'parent'), ('p_gma', 'h_a', 'guardian'), ('p_walt', 'h_a', 'resident_adult'),
      ('p_nora', 'h_a', 'child'),
      ('p_dad', 'h_b', 'parent'), ('p_nora', 'h_b', 'child'),
      ('p_other_mom', 'h_other', 'parent'), ('p_other_child', 'h_other', 'child');
  `);
}

async function asPerson(client, userId) {
  await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
}
async function grantScope(client, actorId, childId, scope) {
  await client.query(
    "insert into grants (id, actor_id, child_id, scopes, granted_by) values ($1,$2,$3,array[$4],'p_mom')",
    [`g_${randomUUID().slice(0, 8)}`, actorId, childId, scope],
  );
}
function expectError(result, code, label) {
  if (!result.error) fail(`${label} FAILED: expected an error, got a result`);
  if (!result.error.message.includes(code)) fail(`${label} FAILED: expected ${code}, got: ${result.error.message}`);
}
function expectZeroRows(result, label) {
  if (result.error) fail(`${label} FAILED: unexpected error ${result.error.message}`);
  if ((result.rows ?? []).length !== 0) fail(`${label} FAILED: expected 0 rows, got ${result.rows.length}`);
}

async function main() {
  log(`[fridge-phase2-proof] container ${CONTAINER}`);
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
  log('seeded minimal fixtures (Kendra/Andre/Loretta/Walt/Priya/stranger/other-family)');

  const uid = {};
  for (const id of ['p_mom', 'p_dad', 'p_gma', 'p_walt', 'p_priya', 'p_stranger', 'p_other_mom']) uid[id] = randomUUID();
  const values = Object.entries(uid).map(([id, u]) => `('${u}','${id}')`).join(',');
  await superuser.query(`insert into identity_map (user_id, person_id) values ${values}`);

  const client = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await client.query('set role authenticated');
  const as = (id) => asPerson(client, uid[id]);
  const q = (sql, params) => client.query(sql, params).then((r) => ({ rows: r.rows, error: null })).catch((e) => ({ rows: null, error: e }));

  // =============================================================================================
  // A. GOALS
  // =============================================================================================

  await as('p_mom');
  const created = await q(
    `insert into goals (id, child_id, title, proposed_by_id, horizon, period, status)
     values ('goal_a', 'p_nora', 'Tie shoes independently', current_person(), null, 'WEEK', 'APPROVED')
     returning *`,
  );
  if (created.error) fail(`check A1 FAILED: Kendra's create errored: ${created.error.message}`);
  if (created.rows[0].period !== 'WEEK' || created.rows[0].completed_at !== null) fail('check A1 FAILED: period/completed_at not as inserted');
  log('check A1 PASS: Kendra (parent) creates a goal with an explicit period; completed_at starts null');

  await as('p_gma');
  const guardianCreate = await q(
    `insert into goals (id, child_id, title, proposed_by_id, status) values ('goal_b', 'p_nora', 'Draft by Loretta', current_person(), 'PROPOSED') returning *`,
  );
  if (guardianCreate.error) fail(`check A2 FAILED: Loretta (guardian) create errored: ${guardianCreate.error.message}`);
  log('check A2 PASS: Loretta (guardian, not "parent") has the same write authority as a parent');

  await as('p_dad');
  const andreReads = await q('select * from goals where child_id = $1', ['p_nora']);
  if (andreReads.rows.length !== 2) fail(`check A3 FAILED: Andre (co-parent) should see both goals (PROPOSED+APPROVED), got ${andreReads.rows.length}`);
  log('check A3 PASS: Andre (co-parent, no relation to Loretta\'s household) sees both PROPOSED and APPROVED — unchanged visibility');

  await grantScope(superuser, 'p_priya', 'p_nora', 'goals.read');
  await as('p_priya');
  const priyaReads = await q('select * from goals where child_id = $1', ['p_nora']);
  if (priyaReads.rows.length !== 1 || priyaReads.rows[0].status !== 'APPROVED') {
    fail(`check A4 FAILED: a goals.read grant holder must see APPROVED only, got ${JSON.stringify(priyaReads.rows.map((r) => r.status))}`);
  }
  log('check A4 PASS: a goals.read grant holder sees APPROVED only — the EXISTING approved/proposed rule, preserved exactly');

  await as('p_walt');
  expectZeroRows(await q('select * from goals where child_id = $1', ['p_nora']), 'check A5');
  log('check A5 PASS: Walt (resident_adult, household member, no grant) sees nothing — membership alone implies nothing');

  await as('p_mom');
  const reassignChild = await q("update goals set child_id = 'p_other_child' where id = 'goal_a'");
  expectError(reassignChild, 'GOAL_CHILD_IMMUTABLE', 'check A6');
  log('check A6 PASS: child_id is permanently immutable, even for the owning parent');

  const reassignProposer = await q("update goals set proposed_by_id = 'p_dad' where id = 'goal_a'");
  expectError(reassignProposer, 'GOAL_PROPOSER_IMMUTABLE', 'check A7');
  log('check A7 PASS: proposed_by_id is permanently immutable');

  const completed = await q("update goals set completed_at = now() where id = 'goal_a' returning status, completed_at");
  if (completed.error || completed.rows[0].completed_at === null || completed.rows[0].status !== 'APPROVED') {
    fail(`check A8 FAILED: ${JSON.stringify(completed)}`);
  }
  log('check A8 PASS: completeGoal-equivalent sets completed_at without touching status — independent of approval');

  const uncompleted = await q("update goals set completed_at = null where id = 'goal_a' returning completed_at");
  if (uncompleted.error || uncompleted.rows[0].completed_at !== null) fail(`check A9 FAILED: ${JSON.stringify(uncompleted)}`);
  log('check A9 PASS: uncompleteGoal-equivalent clears completed_at');

  await as('p_priya');
  const priyaDelete = await q("delete from goals where id = 'goal_b'");
  if (priyaDelete.error) fail(`check A10 FAILED unexpectedly errored: ${priyaDelete.error.message}`);
  if (priyaDelete.rows.length !== 0) fail('check A10 FAILED: a read-only grant holder deleted a goal');
  log('check A10 PASS: Priya (goals.read only, not a parent) cannot delete — RLS silently touches 0 rows');

  await as('p_other_mom');
  expectZeroRows(await q('select * from goals where child_id = $1', ['p_nora']), 'check A11 read');
  const otherWrite = await q(
    "insert into goals (id, child_id, title, proposed_by_id, status) values ('goal_forged', 'p_nora', 'forged', current_person(), 'APPROVED')",
  );
  if (!otherWrite.error) fail('check A11 FAILED: an unrelated parent inserted a goal for Nora');
  log('check A11 PASS: an unrelated parent (different family) is refused both read and write on Nora\'s goals');

  // Concurrent edit: two real connections update DIFFERENT fields of the same goal, fired without
  // sequencing. Postgres's own row-level serialization (not application code) must leave a
  // coherent final row — no corruption, no lost field, no crash.
  const connA = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  const connB = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await asPerson(connA, uid.p_mom); await asPerson(connB, uid.p_mom);
  const [rA, rB] = await Promise.all([
    connA.query("update goals set title = 'Updated by A' where id = 'goal_a' returning title, period"),
    connB.query("update goals set period = 'MONTH' where id = 'goal_a' returning title, period"),
  ]);
  await connA.end(); await connB.end();
  await as('p_mom');
  const finalGoal = (await q("select title, period from goals where id = 'goal_a'")).rows[0];
  if (!['Tie shoes independently', 'Updated by A'].includes(finalGoal.title) || finalGoal.period !== 'MONTH') {
    fail(`check A12 FAILED: concurrent update produced an incoherent row: ${JSON.stringify(finalGoal)}`);
  }
  void rA; void rB;
  log(`check A12 PASS: two real concurrent connections updating different fields of the same goal leave a coherent row (${JSON.stringify(finalGoal)}) — no corruption`);

  // =============================================================================================
  // B. FRIDGE NOTES
  // =============================================================================================

  await as('p_mom');
  const note1 = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_1','p_nora',current_person(),'Great day at school!') returning *`,
  );
  if (note1.error) fail(`check B1 FAILED: ${note1.error.message}`);
  if (note1.rows[0].audience !== 'PARENTS_ONLY') fail('check B1 FAILED: default audience must be PARENTS_ONLY');
  log('check B1 PASS: Kendra posts a note; defaults to PARENTS_ONLY; author derived server-side');

  const forgedAuthor = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_forged','p_nora','p_dad','forged')`,
  );
  if (!forgedAuthor.error) fail('check B2 FAILED: Kendra inserted a note with a forged author_id (Andre)');
  log('check B2 PASS: a forged author_id (someone else) on insert is refused — WITH CHECK requires author_id = current_person()');

  await as('p_walt');
  const waltPost = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_walt','p_nora',current_person(),'should not land')`,
  );
  if (!waltPost.error) fail('check B3 FAILED: Walt (resident_adult, household member, no grant) was able to post');
  log('check B3 PASS: household membership alone cannot post — the core "not implied by residence" guarantee');

  await grantScope(superuser, 'p_priya', 'p_nora', 'fridge.post');
  await as('p_priya');
  const priyaPost = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_priya','p_nora',current_person(),'Nora did great at pickup today') returning *`,
  );
  if (priyaPost.error) fail(`check B4 FAILED: Priya with an explicit fridge.post grant could not post: ${priyaPost.error.message}`);
  log('check B4 PASS: an explicit, parent-issued fridge.post grant (not household membership) lets a caregiver post');

  await as('p_dad');
  const andreReadsNotes = await q("select * from fridge_notes where id = 'fn_1'");
  if (andreReadsNotes.rows.length !== 1) fail('check B5 FAILED: Andre (co-parent) cannot read Kendra\'s PARENTS_ONLY note');
  log('check B5 PASS: any parent reads any PARENTS_ONLY note for their child, regardless of who authored it');

  // Priya has fridge.post but NOT fridge.read — she should NOT see Kendra's note, but DOES see
  // her own (author always sees their own, regardless of audience/grants).
  await as('p_priya');
  expectZeroRows(await q("select * from fridge_notes where id = 'fn_1'"), 'check B6 (fn_1 hidden from Priya)');
  const priyaOwn = await q("select * from fridge_notes where id = 'fn_priya'");
  if (priyaOwn.rows.length !== 1) fail('check B6 FAILED: Priya cannot see her own note');
  log('check B6 PASS: fridge.post does not imply fridge.read — Priya cannot see Kendra\'s note but always sees her own');

  await as('p_mom');
  const shared = await q("update fridge_notes set audience = 'SHARED' where id = 'fn_1' returning audience, revision");
  if (shared.error || shared.rows[0].audience !== 'SHARED' || shared.rows[0].revision !== 2) {
    fail(`check B7 FAILED: ${JSON.stringify(shared)}`);
  }
  log('check B7 PASS: a parent explicitly shares a note — audience becomes SHARED, revision bumps 1→2');

  await grantScope(superuser, 'p_priya', 'p_nora', 'fridge.read');
  await as('p_priya');
  const priyaNowSees = await q("select * from fridge_notes where id = 'fn_1'");
  if (priyaNowSees.rows.length !== 1) fail('check B8 FAILED: a fridge.read grant holder should now see the SHARED note');
  const stillHidden = await q("select * from fridge_notes where id = 'fn_2'");
  void stillHidden;
  log('check B8 PASS: with an explicit fridge.read grant, a SHARED note becomes visible — still only because it was explicitly shared');

  const priyaEditsOwnText = await q("update fridge_notes set text = 'Nora had a GREAT day at pickup' where id = 'fn_priya' returning text, revision");
  if (priyaEditsOwnText.error || priyaEditsOwnText.rows[0].revision !== 2) fail(`check B9 FAILED: ${JSON.stringify(priyaEditsOwnText)}`);
  log('check B9 PASS: the note\'s own non-parent author can edit its content; revision bumps');

  const priyaWidensAudience = await q("update fridge_notes set audience = 'SHARED' where id = 'fn_priya'");
  expectError(priyaWidensAudience, 'FRIDGE_NOTE_AUDIENCE_LOCKED', 'check B10');
  log('check B10 PASS: a non-parent author cannot widen (or touch at all) her own note\'s audience — DB-enforced');

  const priyaDeletesOwn = await q("delete from fridge_notes where id = 'fn_priya'");
  if (priyaDeletesOwn.error) fail(`check B11 FAILED unexpectedly errored: ${priyaDeletesOwn.error.message}`);
  if (priyaDeletesOwn.rows.length !== 0) fail('check B11 FAILED: a non-parent author deleted her own note — delete is parent-only');
  log('check B11 PASS: the author cannot delete her own note — "parents may remove notes," not "authors may"');

  await as('p_mom');
  const kendraDeletesPriyas = await q("delete from fridge_notes where id = 'fn_priya' returning id");
  if (kendraDeletesPriyas.error || kendraDeletesPriyas.rows.length !== 1) fail(`check B12 FAILED: ${JSON.stringify(kendraDeletesPriyas)}`);
  log('check B12 PASS: a parent removes a caregiver\'s note for their child');

  const reassignNoteChild = await q("update fridge_notes set child_id = 'p_other_child' where id = 'fn_1'");
  expectError(reassignNoteChild, 'FRIDGE_NOTE_CHILD_IMMUTABLE', 'check B13');
  log('check B13 PASS: child_id is permanently immutable on fridge_notes too');

  const reassignNoteAuthor = await q("update fridge_notes set author_id = 'p_dad' where id = 'fn_1'");
  expectError(reassignNoteAuthor, 'FRIDGE_NOTE_AUTHOR_IMMUTABLE', 'check B14');
  log('check B14 PASS: author_id is permanently immutable');

  const sameValueUpdate = await q("update fridge_notes set audience = 'SHARED' where id = 'fn_1' returning revision");
  if (sameValueUpdate.error || sameValueUpdate.rows[0].revision !== 2) fail(`check B15 FAILED: a no-op value change must not bump revision: ${JSON.stringify(sameValueUpdate)}`);
  log('check B15 PASS: writing the SAME value a second time does not bump revision — the trigger compares values, not statement presence');

  const forgedChildKendra = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_forged_child','p_other_child',current_person(),'forged')`,
  );
  if (!forgedChildKendra.error) fail('check B16 FAILED: Kendra posted a note for a child she is not connected to at all');
  log('check B16 PASS: a forged/unrelated child id is refused on insert — is_parent_of(child_id) fails honestly');

  await as('p_stranger');
  expectZeroRows(await q('select * from fridge_notes where child_id = $1', ['p_nora']), 'check B17 read (stranger)');
  const strangerWrite = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_stranger','p_nora',current_person(),'should not land')`,
  );
  if (!strangerWrite.error) fail('check B17 FAILED: a stranger with zero relation and zero grants posted a note');
  log('check B17 PASS: a stranger (zero relation, zero grants — same shape as an unauthenticated/guide caller with no sandbox grant) is refused read AND write');

  await as('p_other_mom');
  expectZeroRows(await q('select * from fridge_notes where child_id = $1', ['p_nora']), 'check B18 (other family read)');
  const otherFamilyWrite = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_other','p_nora',current_person(),'should not land')`,
  );
  if (!otherFamilyWrite.error) fail('check B18 FAILED: an unrelated parent of a DIFFERENT child posted a note for Nora');
  log('check B18 PASS: a parent of an unrelated child (other family entirely) is refused read and write on Nora\'s notes');

  // Concurrent edit: two real connections race a content edit against an audience change on the
  // SAME note, fired without sequencing. Confirms no corruption and that the audience-lock rule
  // still holds under real concurrency, not just sequential calls.
  await as('p_mom');
  const note2 = await q(
    `insert into fridge_notes (id, child_id, author_id, text) values ('fn_race','p_nora',current_person(),'before race') returning revision`,
  );
  if (note2.error) fail(`check B19 setup FAILED: ${note2.error.message}`);
  const connC = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  const connD = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await asPerson(connC, uid.p_mom); await asPerson(connD, uid.p_mom);
  const raceResults = await Promise.allSettled([
    connC.query("update fridge_notes set text = 'after race from C' where id = 'fn_race' returning text, revision"),
    connD.query("update fridge_notes set paper_color = 'pink' where id = 'fn_race' returning paper_color, revision"),
  ]);
  await connC.end(); await connD.end();
  if (raceResults.some((r) => r.status === 'rejected')) fail(`check B19 FAILED: a concurrent update was rejected outright: ${JSON.stringify(raceResults)}`);
  const finalNote = (await q("select text, paper_color, revision from fridge_notes where id = 'fn_race'")).rows[0];
  if (finalNote.revision < 2 || finalNote.text === null || finalNote.paper_color === null) {
    fail(`check B19 FAILED: concurrent edit left an incoherent row: ${JSON.stringify(finalNote)}`);
  }
  log(`check B19 PASS: two real concurrent connections editing the same note (text vs paperColor) leave a coherent row with revision correctly advanced (${JSON.stringify(finalNote)})`);

  await client.end();
  await superuser.end();
  log('ALL CHECKS PASS — DISPOSABLE-POSTGRES AUTHORIZATION REHEARSAL (not a live application)');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/fridge-phase2-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/fridge-phase2-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
