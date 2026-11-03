#!/usr/bin/env node
/**
 * Real-Postgres proof that migration 0083 (STAGED, still unapplied anywhere) and `resetDemo()`
 * (src/demo/reset.ts, the ACTUAL canonical reset transaction, not a hand-written imitation)
 * correctly handle `goals` provenance.
 *
 * SECOND correction (review on #157's merge, before any live apply): the first cut of 0083 added
 * `goals.sandbox` as `not null default TRUE`. Goals is an EXISTING, already-populated table — that
 * default silently backfills every row that already exists at apply time, which would mark a
 * genuinely non-demo goal already in a real database as demo-clearable. This proof now applies
 * migrations in TWO PHASES specifically to catch that class of bug: every migration except 0083
 * (and 0040) first, an "unrelated, pre-existing" goal inserted into the pre-0083 table shape,
 * THEN 0083 itself — proving the migration's own default leaves that row `sandbox = false`
 * (never inferred, never assumed; checked directly against the real ALTER TABLE statement), while
 * the two verified canonical demo goals are explicitly marked `true` by 0083's own targeted
 * UPDATE. Only after that direct migration-level check does the proof move on to resetDemo()
 * itself.
 *
 * Same methodology as `ops/demo-reset-shared-status-proof.mjs`: SSL-enabled disposable
 * `postgres:16-alpine`, Cast v2 pre-seeded via the REAL `createCastV2()` data to honestly simulate
 * `resetDemo()`'s actual precondition (an already-seeded database), then the real `resetDemo()`
 * imported and called directly.
 *
 * Checks:
 *   1. Immediately after 0083 applies (before any further writes): the pre-existing, unrelated
 *      goal (inserted BEFORE 0083, simulating real data already in a live database) is
 *      `sandbox = false` — the column's own default, not a value this proof set.
 *   2. The two canonical demo goals are `sandbox = true` immediately after 0083 applies — 0083's
 *      own targeted UPDATE, not the column default.
 *   3. A live-edited goal (title changed, marked complete, period changed) restores to its exact
 *      canonical seed shape after resetDemo() — including period/completed_at back to null.
 *   4. The second seeded goal (`goal_passing`, PROPOSED, proposed by a non-parent coach) restores
 *      too — proving the restore isn't accidentally scoped to only one row.
 *   5. A DEMO-CREATED goal (sandbox=true, exactly what createGoal's resolver asserts explicitly on
 *      every insert) is REMOVED by resetDemo() — scoped demo content cleared.
 *   6. The SAME pre-existing, unrelated goal from check 1 — now carried through an entire
 *      resetDemo() call, not just the migration — still survives completely untouched. This is
 *      the actual "preserve pre-existing unrelated goals" proof the review asked for: one row,
 *      tracked from before migration, through migration, through a real reset, never touched.
 *   7. A sandbox-marked fridge note is removed by reset (scoped demo content, unchanged, reconfirmed).
 *   8. A non-sandbox fridge note is left completely untouched (unchanged, reconfirmed).
 *
 * Usage: node --import tsx ops/fridge-phase2-reset-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createCastV2 } from '../src/fixtures-cast-v2.ts';

const CONTAINER = `fg-fridge-reset-proof-${randomUUID().slice(0, 8)}`;
const lines = [];
const log = (line) => { process.stdout.write(`${line}\n`); lines.push(line); };
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
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

const MIGRATION_0083 = 'supabase/migrations/0083_fridge_phase2.sql';

/** Every real migration except 0040 (needs the application-level Cast v2 seed to satisfy its own
 * household FKs — confirmed independently, nothing downstream depends on it) AND 0083 — applied
 * separately, deliberately, as its own phase (see the file header for why). */
function migrationsBefore0083() {
  return readdirSync('supabase/migrations')
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith('0040_') && !f.startsWith('0083_'))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => `supabase/migrations/${f}`);
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

async function applyFiles(client, files, label) {
  for (const path of files) {
    const sql = readFileSync(path, 'utf8');
    try { await client.query(sql); } catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`applied ${files.length} migrations (${label})`);
}

function generateSelfSignedCert() {
  const dir = join(tmpdir(), `fg-pg-ssl-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = join(dir, 'server.key');
  const crt = join(dir, 'server.crt');
  sh('openssl', ['req', '-new', '-x509', '-days', '1', '-nodes', '-subj', '/CN=localhost', '-keyout', key, '-out', crt]);
  chmodSync(key, 0o600);
  chmodSync(crt, 0o600);
  return { key, crt };
}

async function main() {
  log(`[fridge-phase2-reset-proof] container ${CONTAINER}`);
  const { key, crt } = generateSelfSignedCert();
  sh('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres',
    '-v', `${crt}:/var/lib/postgresql/server.crt:ro`,
    '-v', `${key}:/var/lib/postgresql/server.key:ro`,
    '-p', '127.0.0.1::5432', 'postgres:16-alpine',
    '-c', 'ssl=on', '-c', 'ssl_cert_file=/var/lib/postgresql/server.crt', '-c', 'ssl_key_file=/var/lib/postgresql/server.key',
  ]);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  if (!portLine.startsWith('127.0.0.1:')) fail(`container port is not loopback-bound: ${portLine}`);
  const port = Number(portLine.split(':').pop());
  log(`postgres (SSL-enabled) listening on ${portLine} (loopback-bound)`);

  const client = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false },
  }));
  log('connected');

  await stubAuth(client);
  await applyFiles(client, migrationsBefore0083(), 'every file except 0040 and 0083');

  const cast = createCastV2();
  const CAST_ORDER = ['villages', 'people', 'children', 'households', 'household_members', 'relationships', 'contact_methods', 'grants', 'routines', 'events', 'care_facts'];
  for (const table of CAST_ORDER) {
    for (const row of cast[table] ?? []) {
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await client.query(`insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict do nothing`, cols.map((k) => row[k]));
    }
  }
  log(`pre-seeded Cast v2 (${CAST_ORDER.map((t) => `${t}=${(cast[t] ?? []).length}`).join(', ')}), simulating an already-seeded database`);

  // A genuinely pre-existing, unrelated goal — inserted BEFORE 0083 runs, in the table's PRE-0083
  // shape (no period/completed_at/sandbox columns exist yet). This simulates real data already
  // sitting in a live database at the moment 0083 is applied — exactly the scenario the review
  // flagged: a `default true` would have silently swept this row up as "demo content."
  await client.query(`
    insert into goals (id, child_id, title, proposed_by_id, status)
    values ('goal_unrelated_preexisting', 'p_nora', 'A real, non-demo goal already in the database', 'p_mom', 'APPROVED')
  `);
  log("inserted 'goal_unrelated_preexisting' BEFORE 0083 — simulating a real pre-existing row");

  await applyFiles(client, [MIGRATION_0083], '0083 itself, applied as its own phase');

  // --- Check 1 & 2: directly against the migration's own behavior, before any other write ---
  const preexistingAfterMigration = (await client.query("select sandbox from goals where id = 'goal_unrelated_preexisting'")).rows[0];
  if (!preexistingAfterMigration || preexistingAfterMigration.sandbox !== false) {
    fail(`check 1 FAILED: the pre-existing unrelated goal must be sandbox=false immediately after 0083 applies, got: ${JSON.stringify(preexistingAfterMigration)}`);
  }
  log('check 1 PASS: a goal that existed BEFORE 0083 ran is sandbox=false immediately after — the column default, not a blanket backfill');

  const canonicalAfterMigration = await client.query("select id, sandbox from goals where id in ('goal_reading','goal_passing') order by id");
  if (canonicalAfterMigration.rows.length !== 2 || canonicalAfterMigration.rows.some((r) => r.sandbox !== true)) {
    fail(`check 2 FAILED: both canonical demo goals must be sandbox=true immediately after 0083 applies, got: ${JSON.stringify(canonicalAfterMigration.rows)}`);
  }
  log("check 2 PASS: both canonical demo goals are sandbox=true immediately after 0083's own targeted UPDATE");

  // goal_reading/goal_passing already exist — 0002_seed.sql inserts them directly. Corrupt them
  // as a live browser session would: goal_reading's title edited, marked complete, period
  // changed; goal_passing's title AND status changed (PROPOSED promoted to APPROVED live) —
  // proving restore reverts both fields, not just one.
  await client.query(`
    update goals set title = 'Reading level 3 by June — EDITED', period = 'MONTH', completed_at = now()
     where id = 'goal_reading';
    update goals set title = 'Left-foot passing — EDITED', status = 'APPROVED'
     where id = 'goal_passing';
  `);
  // A DEMO-CREATED goal — sandbox=true explicitly, exactly what createGoal's resolver now asserts
  // on every insert (never the column default, which is false). Same child as the canonical
  // seeds, on purpose — this is exactly the case a naive "delete every goal belonging to p_nora
  // except the two known ids" or an id-prefix heuristic would get right BY ACCIDENT; contrasted
  // against the pre-existing unrelated goal (same child, sandbox=false) below.
  await client.query(`
    insert into goals (id, child_id, title, proposed_by_id, status, period, completed_at, sandbox)
    values ('goal_live_created', 'p_nora', 'A goal created live during the demo', 'p_mom', 'APPROVED', null, null, true)
  `);

  // A sandbox-marked fridge note (what the real postFridgeNote mutation always creates — sandbox
  // defaults true) — reset must clear it. A non-sandbox note — reset must leave it alone.
  await client.query(`
    insert into fridge_notes (id, child_id, author_id, text, sandbox) values
      ('fnote_live', 'p_nora', 'p_mom', 'A note posted during the demo', true),
      ('fnote_permanent', 'p_nora', 'p_mom', 'Not demo-sandboxed — must survive reset', false)
  `);
  await client.end();

  process.env.SUPABASE_DB_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { resetDemo } = await import('../src/demo/reset.ts');
  const report = await resetDemo('fridge-phase2-reset-proof');
  log(`resetDemo() completed: restored=${JSON.stringify(report.restored)} cleared=${JSON.stringify(report.cleared)}`);

  const verify = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  await verify.connect();

  // --- Check 3: goal_reading restored to its exact canonical seed shape ---
  const reading = (await verify.query("select * from goals where id = 'goal_reading'")).rows[0];
  if (!reading) fail('check 3 FAILED: goal_reading is missing after reset');
  if (reading.title !== 'Reading level 3 by June' || reading.status !== 'APPROVED' || reading.period !== null || reading.completed_at !== null || reading.owner_id !== 'p_mom' || reading.sandbox !== true) {
    fail(`check 3 FAILED: goal_reading not restored to the canonical shape: ${JSON.stringify(reading)}`);
  }
  log('check 3 PASS: a live-edited goal (title, completed_at, period all changed) restores to its exact canonical seed shape, sandbox=true reasserted');

  // --- Check 4: goal_passing restored too (not just the first row) ---
  const passing = (await verify.query("select * from goals where id = 'goal_passing'")).rows[0];
  if (!passing) fail('check 4 FAILED: goal_passing is missing after reset');
  if (passing.title !== 'Left-foot passing this season' || passing.status !== 'PROPOSED' || passing.proposed_by_id !== 'p_marcus' || passing.owner_id !== null || passing.sandbox !== true) {
    fail(`check 4 FAILED: goal_passing not restored to the canonical shape: ${JSON.stringify(passing)}`);
  }
  log('check 4 PASS: the second seeded goal (PROPOSED, proposed by a non-parent) restores too');

  // --- Check 5: the demo-created goal (sandbox=true) is REMOVED ---
  const demoCreated = await verify.query("select * from goals where id = 'goal_live_created'");
  if (demoCreated.rows.length !== 0) {
    fail(`check 5 FAILED: a demo-created goal (sandbox=true) survived reset — it must be cleared for the next judge: ${JSON.stringify(demoCreated.rows)}`);
  }
  log('check 5 PASS: a demo-created goal (explicit sandbox=true, as createGoal always asserts) is removed by reset — scoped demo content cleared, same as fridge notes');

  // --- Check 6: the SAME pre-existing, unrelated goal (checks 1/2) survives an ENTIRE resetDemo()
  // call untouched — tracked from before migration, through migration, through a real reset. ---
  const unrelated = (await verify.query("select * from goals where id = 'goal_unrelated_preexisting'")).rows[0];
  if (!unrelated) fail('check 6 FAILED: the pre-existing unrelated goal was deleted by resetDemo()');
  if (unrelated.title !== 'A real, non-demo goal already in the database' || unrelated.sandbox !== false) {
    fail(`check 6 FAILED: the pre-existing unrelated goal was altered by resetDemo(): ${JSON.stringify(unrelated)}`);
  }
  log('check 6 PASS: the goal inserted BEFORE migration 0083 survives an entire real resetDemo() call completely untouched — "preserve pre-existing unrelated goals," proven end to end, not just at the migration step');

  // --- Check 7: the sandbox-marked fridge note is cleared ---
  const clearedNote = await verify.query("select * from fridge_notes where id = 'fnote_live'");
  if (clearedNote.rows.length !== 0) fail(`check 7 FAILED: the sandbox fridge note survived reset: ${JSON.stringify(clearedNote.rows)}`);
  log('check 7 PASS: a sandbox-marked fridge note is removed by reset — scoped demo content cleared');

  // --- Check 8: the non-sandbox fridge note survives untouched ---
  const survivingNote = (await verify.query("select * from fridge_notes where id = 'fnote_permanent'")).rows[0];
  if (!survivingNote) fail('check 8 FAILED: a non-sandbox fridge note was deleted by reset');
  if (survivingNote.text !== 'Not demo-sandboxed — must survive reset') fail(`check 8 FAILED: the non-sandbox note was altered: ${JSON.stringify(survivingNote)}`);
  log('check 8 PASS: a non-sandbox fridge note is left completely untouched — the blanket delete is scoped to sandbox=true only');

  await verify.end();
  log('ALL CHECKS PASS');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/fridge-phase2-reset-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/fridge-phase2-reset-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
