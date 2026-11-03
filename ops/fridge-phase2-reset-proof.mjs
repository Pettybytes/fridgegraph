#!/usr/bin/env node
/**
 * Real-Postgres proof that `resetDemo()` (src/demo/reset.ts) — the ACTUAL canonical reset
 * transaction, not a hand-written imitation — correctly wires Phase 2 (migration 0083, STAGED):
 * fridge notes are cleared as scoped demo content, the two canonical seeded goals restore to
 * their exact shape, a DEMO-CREATED goal (explicit sandbox=true, not an id-prefix guess) is
 * removed, and a genuinely unrelated non-demo goal (explicit sandbox=false) for the SAME child
 * survives untouched — proving ownership is the column, not the child or the id.
 *
 * Same methodology as `ops/demo-reset-shared-status-proof.mjs`: SSL-enabled disposable
 * `postgres:16-alpine`, every real migration applied except 0040 (needs the application-level
 * Cast v2 seed to satisfy its own household FKs — confirmed independently, nothing downstream
 * depends on it), Cast v2 pre-seeded via the REAL `createCastV2()` data to honestly simulate
 * `resetDemo()`'s actual precondition (an already-seeded database), then the real `resetDemo()`
 * imported and called directly.
 *
 * Checks:
 *   1. A live-edited goal (title changed, marked complete, period changed) restores to its exact
 *      canonical seed shape — including period/completed_at back to their seeded (null) values.
 *   2. The second seeded goal (`goal_passing`, PROPOSED, proposed by a non-parent coach) restores
 *      too — proving the restore isn't accidentally scoped to only one row.
 *   3. A DEMO-CREATED goal (sandbox=true, the default createGoal always writes, a non-fixture id
 *      for the SAME child as the canonical seeds) is REMOVED by reset — ownership is the explicit
 *      `sandbox` column, not an id prefix and not "every goal belonging to this child" (the next
 *      check proves that distinction is real, not assumed).
 *   4. An UNRELATED, genuinely non-demo goal (sandbox=false, set explicitly — never by this code —
 *      for the SAME child as the canonical seeds) survives reset completely untouched, proving
 *      check 3 removed it because of its sandbox flag, not because of its child or its id.
 *   5. A sandbox-marked fridge note is removed by reset (scoped demo content) — the existing,
 *      unchanged behavior, reconfirmed alongside the corrected goals behavior above.
 *   6. A non-sandbox fridge note is left completely untouched — the blanket delete is scoped to
 *      `sandbox = true` only, never every row in the table.
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

function allMigrationsExcept0040() {
  return readdirSync('supabase/migrations')
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith('0040_'))
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

async function applyMigrations(client) {
  const files = allMigrationsExcept0040();
  for (const path of files) {
    const sql = readFileSync(path, 'utf8');
    try { await client.query(sql); } catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`applied ${files.length} migrations (every file except 0040) — includes 0083 (staged, this PR)`);
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
  await applyMigrations(client);

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

  // goal_reading/goal_passing already exist — 0002_seed.sql (now included in the full migration
  // set) inserts them directly. Corrupt them as a live browser session would: goal_reading's
  // title edited, marked complete, period changed; goal_passing's title AND status changed
  // (PROPOSED promoted to APPROVED live) — proving restore reverts both fields, not just one.
  await client.query(`
    update goals set title = 'Reading level 3 by June — EDITED', period = 'MONTH', completed_at = now()
     where id = 'goal_reading';
    update goals set title = 'Left-foot passing — EDITED', status = 'APPROVED'
     where id = 'goal_passing';
  `);
  // A DEMO-CREATED goal — sandbox=true explicitly, exactly what createGoal's resolver always
  // writes (the column's own default, restated here so the proof does not depend on the DEFAULT
  // clause continuing to exist). Same child as the canonical seeds, on purpose — this is exactly
  // the case a naive "delete every goal belonging to p_nora except the two known ids" or an
  // id-prefix heuristic would get right BY ACCIDENT; the next insert proves it is the sandbox
  // column doing the work, not the child or the id shape.
  await client.query(`
    insert into goals (id, child_id, title, proposed_by_id, status, sandbox)
    values ('goal_live_created', 'p_nora', 'A goal created live during the demo', 'p_mom', 'APPROVED', true)
  `);
  // An UNRELATED, genuinely non-demo goal — sandbox=false, set explicitly (never by application
  // code; nothing in this PR ever writes false here). Same child, same proximity to the canonical
  // seeds as the row above — the only difference is the sandbox flag. Must survive untouched.
  await client.query(`
    insert into goals (id, child_id, title, proposed_by_id, status, sandbox)
    values ('goal_unrelated_nondemo', 'p_nora', 'A real, non-demo goal — never touched by reset', 'p_mom', 'APPROVED', false)
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

  // --- Check 1: goal_reading restored to its exact canonical seed shape ---
  const reading = (await verify.query("select * from goals where id = 'goal_reading'")).rows[0];
  if (!reading) fail('check 1 FAILED: goal_reading is missing after reset');
  if (reading.title !== 'Reading level 3 by June' || reading.status !== 'APPROVED' || reading.period !== null || reading.completed_at !== null || reading.owner_id !== 'p_mom') {
    fail(`check 1 FAILED: goal_reading not restored to the canonical shape: ${JSON.stringify(reading)}`);
  }
  log('check 1 PASS: a live-edited goal (title, completed_at, period all changed) restores to its exact canonical seed shape');

  // --- Check 2: goal_passing restored too (not just the first row) ---
  const passing = (await verify.query("select * from goals where id = 'goal_passing'")).rows[0];
  if (!passing) fail('check 2 FAILED: goal_passing is missing after reset');
  if (passing.title !== 'Left-foot passing this season' || passing.status !== 'PROPOSED' || passing.proposed_by_id !== 'p_marcus' || passing.owner_id !== null) {
    fail(`check 2 FAILED: goal_passing not restored to the canonical shape: ${JSON.stringify(passing)}`);
  }
  log('check 2 PASS: the second seeded goal (PROPOSED, proposed by a non-parent) restores too');

  // --- Check 3: the demo-created goal (sandbox=true) is REMOVED ---
  const demoCreated = await verify.query("select * from goals where id = 'goal_live_created'");
  if (demoCreated.rows.length !== 0) {
    fail(`check 3 FAILED: a demo-created goal (sandbox=true) survived reset — it must be cleared for the next judge: ${JSON.stringify(demoCreated.rows)}`);
  }
  log('check 3 PASS: a demo-created goal (explicit sandbox=true) is removed by reset — scoped demo content cleared, same as fridge notes');

  // --- Check 4: the unrelated non-demo goal (sandbox=false), same child, survives untouched ---
  const unrelated = (await verify.query("select * from goals where id = 'goal_unrelated_nondemo'")).rows[0];
  if (!unrelated) fail('check 4 FAILED: an unrelated non-demo goal (sandbox=false) was deleted by reset');
  if (unrelated.title !== 'A real, non-demo goal — never touched by reset' || unrelated.sandbox !== false) {
    fail(`check 4 FAILED: the unrelated goal was altered: ${JSON.stringify(unrelated)}`);
  }
  log('check 4 PASS: an unrelated non-demo goal (explicit sandbox=false) for the SAME child survives reset completely untouched — ownership is the column, not the child or the id (proven by contrast with check 3)');

  // --- Check 5: the sandbox-marked fridge note is cleared ---
  const clearedNote = await verify.query("select * from fridge_notes where id = 'fnote_live'");
  if (clearedNote.rows.length !== 0) fail(`check 5 FAILED: the sandbox fridge note survived reset: ${JSON.stringify(clearedNote.rows)}`);
  log('check 5 PASS: a sandbox-marked fridge note is removed by reset — scoped demo content cleared');

  // --- Check 6: the non-sandbox fridge note survives untouched ---
  const survivingNote = (await verify.query("select * from fridge_notes where id = 'fnote_permanent'")).rows[0];
  if (!survivingNote) fail('check 6 FAILED: a non-sandbox fridge note was deleted by reset');
  if (survivingNote.text !== 'Not demo-sandboxed — must survive reset') fail(`check 6 FAILED: the non-sandbox note was altered: ${JSON.stringify(survivingNote)}`);
  log('check 6 PASS: a non-sandbox fridge note is left completely untouched — the blanket delete is scoped to sandbox=true only');

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
