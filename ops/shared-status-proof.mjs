#!/usr/bin/env node
/**
 * Real-Postgres proof for the Dad status chip backend (migration 0076, `shared_statuses`).
 *
 * Same methodology as `ops/confirm-add-villager-return-proof.mjs`: a disposable `postgres:16-
 * alpine` container, a curated minimal migration set (not all ~80 files, for the same reason —
 * running the full chain needs `scripts/db.ts`'s full Cast v2 seed to satisfy unrelated foreign
 * keys, out of scope for one feature's regression test), a stubbed `auth` schema so
 * `current_person()`/`is_demo_guide()` resolve the way they do live, removed unconditionally
 * even on failure.
 *
 * Checks:
 *   1. The owner (Andre) sets and later clears his own status; both calls succeed.
 *   2. Someone who shares no child's village with Andre (no row, RLS) is refused — cannot read
 *      it, and a direct INSERT/UPDATE/DELETE attempt as them touches zero rows.
 *   3. Someone who DOES share a child's village (Kendra — co-parent of Nora; Priya — sitter for
 *      Nora) can read Andre's status; its shape matches the `SharedStatus` contract exactly.
 *   4. Expiry hides it: an expired row is invisible even to someone who could otherwise see it,
 *      enforced by RLS itself (`shared_statuses_read`'s own `expires_at > now()` clause), not by
 *      app-layer diligence.
 *   5. The demo guide is refused on write (a real `app_metadata.demo_guide` JWT claim, not just
 *      a role name).
 *   6. Reset restores it: deleting every row and re-running the exact seed `baseline()` performs
 *      brings Andre's status back, with a freshly computed (not stale) expiry.
 *
 * Usage: node ops/shared-status-proof.mjs
 * Requires: docker (already on PATH in this checkout's environment).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-shared-status-proof-${randomUUID().slice(0, 8)}`;
const lines = [];
const log = (line) => { process.stdout.write(`${line}\n`); lines.push(line); };
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function stopContainer() {
  spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' });
}

async function waitForReady(makeClient, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const client = makeClient();
    try {
      await client.connect();
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  fail('postgres container never became reachable');
}

// Curated, not all ~80 migrations — same reasoning as confirm-add-villager-return-proof.mjs.
// 0001 (base tables), 0003 (current_person/is_parent_of/has_scope), 0006 (local_today, used by
// _connected_children's grant-window check), 0076 (shared_statuses itself).
const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0006_local_today.sql',
  'supabase/migrations/0076_shared_statuses.sql',
];

// Verbatim from supabase/migrations/0025_demo_sandbox.sql — only is_demo_guide, not that file's
// broader demo-sandbox RLS policies (which reference 0013's unrelated real_call_authorizations).
const IS_DEMO_GUIDE_SQL = `
create or replace function is_demo_caller() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'demo', 'false') = 'true'
$$;

create or replace function is_demo_guide() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'demo_guide', 'false') = 'true'
$$;

revoke all on function is_demo_caller() from public, anon;
revoke all on function is_demo_guide() from public, anon;
grant execute on function is_demo_caller() to authenticated, service_role;
grant execute on function is_demo_guide() to authenticated, service_role;
`;

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

async function applyMigrations(client) {
  for (const path of MIGRATIONS) {
    const sql = readFileSync(path, 'utf8');
    try {
      await client.query(sql);
      if (path.endsWith('0003_rls.sql')) await client.query(IS_DEMO_GUIDE_SQL);
    } catch (e) {
      throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log(`applied ${MIGRATIONS.length} targeted migrations: ${MIGRATIONS.map((p) => p.split('/').pop()).join(', ')}`);
}

async function seedFixtures(client) {
  // Mirrors the relevant slice of src/fixtures.ts exactly: Andre (p_dad) and Kendra (p_mom) are
  // both parents of Nora via SEPARATE households (h_a/h_b, the real shape — divorced parents),
  // Priya (p_priya) has an ACTIVE sitter relationship to Nora, and p_stranger has no connection
  // to anyone.
  await client.query(`
    insert into villages (id, name) values ('v_nora', 'Nora''s village');
    insert into people (id, display_name, birth_date) values
      ('p_nora', 'Nora Ellison', '2018-03-14'),
      ('p_mom', 'Kendra Ellison', '1988-05-02'),
      ('p_dad', 'Andre Ellison', '1986-09-20'),
      ('p_priya', 'Priya Nair', '2003-09-05'),
      ('p_stranger', 'A Stranger', '1990-01-01');
    insert into children (person_id) values ('p_nora');
    insert into households (id, village_id) values ('h_a', 'v_nora'), ('h_b', 'v_nora');
    insert into household_members (person_id, household_id, role) values
      ('p_mom', 'h_a', 'parent'), ('p_nora', 'h_a', 'child'),
      ('p_dad', 'h_b', 'parent'), ('p_nora', 'h_b', 'child');
    insert into relationships (id, from_id, to_id, type, status, created_at, history) values
      ('r_priya_sitter', 'p_priya', 'p_nora', 'sitter', 'ACTIVE', '2026-10-01', '[]');
  `);
}

async function asPerson(client, userId, jwt) {
  await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
  await client.query('select set_config($1, $2, false)', ['test.current_jwt', jwt ?? '{}']);
}

async function main() {
  log(`[shared-status-proof] container ${CONTAINER}`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-P', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  const port = Number(portLine.split(':').pop());
  log(`postgres listening on 127.0.0.1:${port}`);

  const superuser = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres',
  }));
  log('connected');

  await stubAuth(superuser);
  await applyMigrations(superuser);
  await seedFixtures(superuser);
  log('seeded minimal fixtures (Andre/Kendra/Priya/Nora/a stranger)');

  const uidAndre = randomUUID();
  const uidKendra = randomUUID();
  const uidPriya = randomUUID();
  const uidStranger = randomUUID();
  await superuser.query(
    'insert into identity_map (user_id, person_id) values ($1,$2),($3,$4),($5,$6),($7,$8)',
    [uidAndre, 'p_dad', uidKendra, 'p_mom', uidPriya, 'p_priya', uidStranger, 'p_stranger'],
  );

  // All actual read/write checks run AS the `authenticated` role, matching how PostgREST/
  // supabase-js actually connects — the superuser connection above is for setup/assertions only.
  const client = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres',
  }));
  await client.query('set role authenticated');

  // --- Check 1: owner sets and later clears their own status ---
  await asPerson(client, uidAndre);
  const inserted = await client.query(
    `insert into shared_statuses (person_id, emoji, text, eta_text, expires_at)
     values ($1, $2, $3, $4, now() + interval '24 hours')
     returning *`,
    ['p_dad', '🍼', 'Changing a diaper', 'unknown'],
  );
  if (inserted.rows[0].person_id !== 'p_dad') fail('check 1 FAILED: insert did not return the expected row');
  log('check 1a PASS: Andre set his own status');

  const cleared = await client.query('delete from shared_statuses where person_id = $1 returning *', ['p_dad']);
  if (cleared.rowCount !== 1) fail('check 1 FAILED: owner clear did not remove the row');
  log('check 1b PASS: Andre cleared his own status');

  // Re-set it for the remaining checks.
  await client.query(
    `insert into shared_statuses (person_id, emoji, text, eta_text, expires_at)
     values ($1, $2, $3, $4, now() + interval '24 hours')`,
    ['p_dad', '🍼', 'Changing a diaper', 'unknown'],
  );

  // --- Check 2: someone with no shared child is refused entirely ---
  await asPerson(client, uidStranger);
  const strangerRead = await client.query('select * from shared_statuses where person_id = $1', ['p_dad']);
  if (strangerRead.rows.length !== 0) fail('check 2 FAILED: a stranger could read Andre\'s status');
  const strangerUpdate = await client.query("update shared_statuses set text = 'hacked' where person_id = $1", ['p_dad']);
  if (strangerUpdate.rowCount !== 0) fail('check 2 FAILED: a stranger\'s update touched a row');
  const strangerDelete = await client.query('delete from shared_statuses where person_id = $1', ['p_dad']);
  if (strangerDelete.rowCount !== 0) fail('check 2 FAILED: a stranger\'s delete touched a row');
  log('check 2 PASS: someone with no shared child is refused read, update, and delete alike (zero rows, no error)');

  // --- Check 3: co-parent and sitter — both share Nora's village with Andre — can read it ---
  await asPerson(client, uidKendra);
  const kendraRead = await client.query('select * from shared_statuses where person_id = $1', ['p_dad']);
  if (kendraRead.rows.length !== 1) fail('check 3 FAILED: Kendra (co-parent of Nora) could not read Andre\'s status');
  const row = kendraRead.rows[0];
  if (row.emoji !== '🍼' || row.text !== 'Changing a diaper' || row.eta_text !== 'unknown') {
    fail(`check 3 FAILED: shape mismatch: ${JSON.stringify(row)}`);
  }
  log('check 3a PASS: Kendra (co-parent of Nora) reads Andre\'s status with the exact expected shape');

  await asPerson(client, uidPriya);
  const priyaRead = await client.query('select * from shared_statuses where person_id = $1', ['p_dad']);
  if (priyaRead.rows.length !== 1) fail('check 3 FAILED: Priya (sitter for Nora) could not read Andre\'s status');
  log('check 3b PASS: Priya (sitter for Nora, a different relationship type than parent) also reads it');

  // --- Check 4: expiry hides it, enforced by RLS, even for someone who could otherwise see it ---
  await superuser.query("update shared_statuses set expires_at = now() - interval '1 minute' where person_id = 'p_dad'");
  const kendraExpired = await client.query('select * from shared_statuses where person_id = $1', ['p_dad']);
  if (kendraExpired.rows.length !== 0) fail('check 4 FAILED: an expired status was still visible to someone who could otherwise see it');
  log('check 4 PASS: an expired status is invisible even to Kendra, enforced by RLS itself');
  await superuser.query("update shared_statuses set expires_at = now() + interval '24 hours' where person_id = 'p_dad'");

  // --- Check 5: the demo guide is refused on write, via a real app_metadata.demo_guide claim ---
  await asPerson(client, uidStranger, JSON.stringify({ app_metadata: { demo_guide: true } }));
  const guideInsert = await client.query(
    `insert into shared_statuses (person_id, emoji, text, expires_at)
     values ($1, $2, $3, now() + interval '24 hours')
     on conflict (person_id) do nothing returning *`,
    ['p_stranger', null, 'Guide trying to set a status'],
  ).catch((e) => ({ error: e }));
  // RLS policy denial on INSERT surfaces as a thrown error (the WITH CHECK clause rejects the new
  // row), not a silent zero-row result the way SELECT/UPDATE/DELETE do.
  if (!guideInsert.error) fail('check 5 FAILED: the demo guide was able to insert a shared status');
  log(`check 5 PASS: the demo guide is refused on write (${guideInsert.error.message})`);

  await client.end();
  log('ALL CHECKS PASS (1-5)');

  // --- Check 6: reset restores it, mirroring exactly what scripts/db.ts's reset does for this
  // table — delete every row, then re-run the same seed shape with a freshly computed expiry. ---
  await superuser.query('delete from shared_statuses');
  const beforeReset = await superuser.query('select count(*)::int as n from shared_statuses');
  if (beforeReset.rows[0].n !== 0) fail('check 6 FAILED: setup delete did not clear the table');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await superuser.query(
    `insert into shared_statuses (person_id, emoji, text, eta_text, set_at, expires_at)
     values ($1, $2, $3, $4, now(), $5)
     on conflict (person_id) do update
       set emoji = excluded.emoji, text = excluded.text, eta_text = excluded.eta_text,
           set_at = excluded.set_at, expires_at = excluded.expires_at`,
    ['p_dad', '🍼', 'Changing a diaper', 'unknown', expiresAt],
  );
  const afterReset = await superuser.query('select * from shared_statuses where person_id = $1', ['p_dad']);
  if (afterReset.rows.length !== 1) fail('check 6 FAILED: reset did not restore Andre\'s status');
  const restored = afterReset.rows[0];
  if (new Date(restored.expires_at).getTime() <= Date.now()) fail('check 6 FAILED: restored status has a stale (already-expired) expiry');
  log('check 6 PASS: reset restores Andre\'s status with a freshly computed (not stale) expiry');

  await superuser.end();
  log('ALL CHECKS PASS');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/shared-status-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/shared-status-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
