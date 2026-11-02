#!/usr/bin/env node
/**
 * Real-Postgres proof for the `confirm_add_villager` RETURN QUERY defect found live on #78
 * (SQLSTATE 42804 — the fresh-confirm branch returned 9 of the function's 10 declared columns,
 * dropping `granted_by`; the idempotent-replay branch was always correct). The offline `FakeDb`
 * unit tests (`src/subgraphs/add-villager-proposal.test.ts`) never caught this because they
 * simulate the resolver in JS and never enforce a real `RETURNS TABLE` column count the way
 * Postgres does — this script is the thing that would have caught it before it shipped.
 *
 * Disposable only: spins up a throwaway `postgres:16-alpine` container, applies a curated minimal
 * migration set (see MIGRATIONS below) including 0080 (the fix, #115, merged to main — adds the
 * missing `v_grant.granted_by`), runs the four checks below against real SQL execution, then
 * removes the container unconditionally. Never touches the shared project database; needs no
 * credentials.
 *
 * NOT wired into `.github/workflows/ci.yml`: that workflow is shared by every PR in this repo and
 * has no Postgres/docker step today, and adding one is a bigger, shared-blast-radius change than
 * this one bug-fix PR should make unilaterally. GitHub's own `ubuntu-latest` runners do have
 * Docker preinstalled, so wiring this in later is possible — left for whoever owns that workflow
 * file to decide. Until then this is a recorded, real-DB run, same shape as every other
 * `ops/*-proof.mjs` script in this repo that needs more than a served HTTP stack provides.
 *
 * Checks:
 *   1. First confirm returns all 10 declared columns (including `granted_by`) and writes exactly
 *      one relationship activation, one grant row, one approvals row.
 *   2. An identical repeat confirm (same proposalId + version) returns the SAME result and writes
 *      nothing further (true idempotent replay, not a second grant).
 *   3. A stale version (the proposal was re-proposed and bumped since) is refused
 *      (`PROPOSAL_STALE`), with zero writes.
 *   4. A caller who is not the proposal's own proposer is refused (`UNAUTHORIZED`), with zero
 *      writes — the authorization check, not just a database constraint.
 *
 * Usage: node ops/confirm-add-villager-return-proof.mjs
 * Requires: docker (already on PATH in this checkout's environment).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-confirm-villager-proof-${randomUUID().slice(0, 8)}`;

const log = (line) => { process.stdout.write(`${line}\n`); lines.push(line); };
const lines = [];
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
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

// A curated subset, not every migration: running all 79 against a bare container fails on
// seed-data foreign keys that only resolve once `scripts/db.ts`'s application-level fixture
// seeding (the full "Cast v2" roster, well beyond migrations) has also run — out of scope for a
// narrow regression test of one function. These three are exactly the schema `confirm_add_villager`
// and `propose_add_villager` depend on: 0001 (base tables: people, households, household_members,
// relationships, grants, approvals), 0003 (current_person/is_parent_of/has_scope), 0074
// (villager_proposals + the buggy functions themselves). Checked: every later migration that
// ALTERs `relationships`/`grants`/`approvals`/`household_members` only widens constraints or adds
// a column with a default — none narrows anything this test's own INSERTs rely on, so skipping
// them changes nothing this test observes. `is_demo_guide()` (needed by both functions) is defined
// by 0025, but that file's OTHER statements reference `real_call_authorizations` (created by 0013,
// an unrelated feature) — rather than pull that whole chain in, its function body is reproduced
// verbatim below, byte-for-byte, instead of running the full file.
// 0080 (#115) is the fix: confirm_add_villager's fresh-confirm RETURN QUERY gets the missing
// v_grant.granted_by appended back on. It's applied separately below (not in this list) because
// its committed file has its own defect — see the missing-semicolon note in applyMigrations.
const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0074_add_villager_proposal.sql',
];
const FIX_MIGRATION = 'supabase/migrations/0080_confirm_add_villager_return_columns.sql';

// Verbatim from supabase/migrations/0025_demo_sandbox.sql — only the two functions this test's
// dependency chain needs, not that migration's broader demo-sandbox RLS policies.
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

  // 0080 is merged to main (#115), including #116's follow-up fix for the missing semicolon this
  // script originally had to patch around in-memory — applied verbatim now, no workaround needed.
  const fixSql = readFileSync(FIX_MIGRATION, 'utf8');
  if (!fixSql.includes('granted_by')) fail('0080 content does not mention granted_by — wrong file?');
  try {
    await client.query(fixSql);
  } catch (e) {
    throw new Error(`applying ${FIX_MIGRATION} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  log(`applied ${FIX_MIGRATION} (#115, merged to main; semicolon fixed by #116)`);
}

async function stubAuth(client) {
  // Supabase provisions the `authenticated`/`anon`/`service_role` roles and the `auth` schema as
  // part of the platform; a vanilla postgres:16-alpine has neither. Create the minimum this
  // schema's own GRANT/REVOKE statements reference — no login, no privileges beyond what each
  // migration explicitly grants.
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
  // Mirrors the relevant slice of src/fixtures.ts / migration 0002's seed exactly (same ids,
  // same relationship types/statuses) — just the rows propose_add_villager/confirm_add_villager
  // actually touch, not the full demo cast.
  await client.query(`
    insert into villages (id, name) values ('v_nora', 'Nora''s village');
    insert into people (id, display_name, birth_date) values
      ('p_nora', 'Nora Ellison', '2018-03-14'),
      ('p_mom', 'Kendra Ellison', '1988-05-02'),
      ('p_dana', 'Dana Coleman', '1987-04-11'),
      ('p_priya', 'Priya Nair', '2003-09-05');
    insert into children (person_id) values ('p_nora');
    insert into households (id, village_id) values ('h_a', 'v_nora'), ('h_c', 'v_nora');
    insert into household_members (person_id, household_id, role) values
      ('p_mom', 'h_a', 'parent'), ('p_nora', 'h_a', 'child'), ('p_dana', 'h_c', 'parent');
    insert into relationships (id, from_id, to_id, type, status, created_at, history) values
      ('r_dana_friend_parent', 'p_dana', 'p_nora', 'friend_parent', 'DISCOVERED', '2026-10-24',
       '[{"at":"2026-10-24","event":"DISCOVERED (friend_parent)"}]'),
      ('r_priya_sitter', 'p_priya', 'p_nora', 'sitter', 'ACTIVE', '2026-10-01',
       '[{"at":"2026-10-01","event":"ACTIVE (sitter)"}]');
  `);
}

async function asPerson(client, userId) {
  await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
}

async function countsNow(client) {
  const rel = await client.query(
    "select status from relationships where id = 'r_dana_friend_parent'",
  );
  const grants = await client.query("select count(*)::int as n from grants where actor_id = 'p_dana' and child_id = 'p_nora'");
  const approvals = await client.query(
    "select count(*)::int as n from approvals where subject_type = 'Grant' and subject_id in (select id from grants where actor_id = 'p_dana' and child_id = 'p_nora')",
  );
  return { relStatus: rel.rows[0]?.status ?? null, grantCount: grants.rows[0].n, approvalCount: approvals.rows[0].n };
}

async function main() {
  log(`[confirm-add-villager-return-proof] container ${CONTAINER}`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-P', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  const port = portLine.split(':').pop();
  log(`postgres listening on 127.0.0.1:${port}`);

  const client = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port: Number(port), user: 'postgres', password: 'postgres', database: 'postgres',
  }));
  log('connected');

  await stubAuth(client);
  await applyMigrations(client);
  await seedFixtures(client);
  log('seeded minimal fixtures (Kendra/Nora/Dana/Priya, matching src/fixtures.ts ids exactly)');

  // Identities for this run (p_mom/Kendra is a parent of p_nora, p_dana has the DISCOVERED
  // friend_parent relationship, p_priya has only a sitter relationship, never a parent). Auth
  // UUIDs are invented for this disposable container and mapped via identity_map, the same table
  // current_person() reads live.
  const uidKendra = randomUUID();
  const uidPriya = randomUUID();
  await client.query('insert into identity_map (user_id, person_id) values ($1, $2), ($3, $4)', [
    uidKendra, 'p_mom', uidPriya, 'p_priya',
  ]);

  // --- Check 1: first confirm returns all 10 columns, writes exactly one of each row ---
  await asPerson(client, uidKendra);
  const before = await countsNow(client);
  if (before.relStatus !== 'DISCOVERED' || before.grantCount !== 0 || before.approvalCount !== 0) {
    fail(`unexpected baseline from fixture seed: ${JSON.stringify(before)}`);
  }

  const proposed1 = await client.query(
    "select * from propose_add_villager($1, $2, $3, $4, $5, $6, $7)",
    ['p_nora', 'Dana Coleman', ['pickup.request'], 'family_friend', '2026-11-02', '2026-12-31', 900],
  );
  const proposalId = proposed1.rows[0].id;
  if (proposed1.rows[0].version !== 1) fail(`expected fresh proposal at version 1, got ${proposed1.rows[0].version}`);

  const confirmed1 = await client.query('select * from confirm_add_villager($1, $2)', [proposalId, 1]);
  const row1 = confirmed1.rows[0];
  const expectedColumns = [
    'relationship_id', 'relationship_type', 'relationship_status', 'person_id', 'child_id',
    'grant_id', 'scopes', 'valid_from', 'valid_until', 'granted_by',
  ];
  const actualColumns = Object.keys(row1);
  for (const col of expectedColumns) {
    if (!actualColumns.includes(col)) fail(`check 1 FAILED: column "${col}" missing from confirm_add_villager's result — got ${JSON.stringify(actualColumns)}`);
  }
  if (row1.granted_by !== 'p_mom') fail(`check 1 FAILED: granted_by expected p_mom, got ${row1.granted_by}`);
  if (row1.relationship_status !== 'ACTIVE') fail(`check 1 FAILED: relationship_status expected ACTIVE, got ${row1.relationship_status}`);

  const after1 = await countsNow(client);
  if (after1.relStatus !== 'ACTIVE') fail(`check 1 FAILED: relationship not activated, got ${after1.relStatus}`);
  if (after1.grantCount !== 1) fail(`check 1 FAILED: expected exactly 1 grant, got ${after1.grantCount}`);
  if (after1.approvalCount !== 1) fail(`check 1 FAILED: expected exactly 1 approvals row, got ${after1.approvalCount}`);
  log('check 1 PASS: first confirm returned all 10 columns; exactly one relationship activation, one grant, one approvals row written');

  // --- Check 2: repeat confirm (same proposalId + version) is a true idempotent replay ---
  const confirmed2 = await client.query('select * from confirm_add_villager($1, $2)', [proposalId, 1]);
  const row2 = confirmed2.rows[0];
  if (row2.grant_id !== row1.grant_id || row2.relationship_id !== row1.relationship_id) {
    fail(`check 2 FAILED: repeat confirm returned different ids: ${JSON.stringify(row2)} vs ${JSON.stringify(row1)}`);
  }
  const after2 = await countsNow(client);
  if (after2.grantCount !== 1 || after2.approvalCount !== 1) {
    fail(`check 2 FAILED: repeat confirm created new rows — grants=${after2.grantCount} approvals=${after2.approvalCount}`);
  }
  log('check 2 PASS: repeat confirm returned the identical result and wrote nothing new');

  // --- Check 3: a stale version is refused, no writes ---
  // Kendra proposes adding Priya (a second, distinct person — p_priya already has a `sitter`
  // relationship to Nora, so she resolves) at version 1, then re-proposes to bump it to version 2
  // (re-proposing for the same proposer/child/person replaces + bumps the unconfirmed draft).
  // Confirming the now-stale version 1 must be refused.
  const proposed3 = await client.query(
    "select * from propose_add_villager($1, $2, $3, $4, $5, $6, $7)",
    ['p_nora', 'Priya Nair', ['pickup.request'], 'family_friend', null, null, 900],
  );
  const staleDraftId = proposed3.rows[0].id;
  // Bump it: a second propose for the same (proposer, child, person) replaces + bumps version.
  const proposed3b = await client.query(
    "select * from propose_add_villager($1, $2, $3, $4, $5, $6, $7)",
    ['p_nora', 'Priya Nair', ['pickup.request', 'schedule.read'], 'family_friend', null, null, 900],
  );
  if (proposed3b.rows[0].id !== staleDraftId || proposed3b.rows[0].version !== 2) {
    fail(`stale-version setup failed: expected same id bumped to version 2, got ${JSON.stringify(proposed3b.rows[0])}`);
  }
  const beforeStale = await client.query("select count(*)::int as n from grants where actor_id = 'p_priya' and child_id = 'p_nora'");
  let staleRefused = false;
  try {
    await client.query('select * from confirm_add_villager($1, $2)', [staleDraftId, 1]);
  } catch (e) {
    staleRefused = /PROPOSAL_STALE/.test(e.message);
  }
  if (!staleRefused) fail('check 3 FAILED: confirming a stale version did not raise PROPOSAL_STALE');
  const afterStale = await client.query("select count(*)::int as n from grants where actor_id = 'p_priya' and child_id = 'p_nora'");
  if (afterStale.rows[0].n !== beforeStale.rows[0].n) fail('check 3 FAILED: a refused stale confirm still wrote a grant');
  log('check 3 PASS: confirming a stale version was refused (PROPOSAL_STALE) with zero writes');

  // --- Check 4: a caller who is not the proposal's own proposer is refused ---
  await asPerson(client, uidPriya);
  const beforeAuth = await client.query("select count(*)::int as n from grants where actor_id = 'p_priya' and child_id = 'p_nora'");
  let unauthorizedRefused = false;
  try {
    await client.query('select * from confirm_add_villager($1, $2)', [staleDraftId, 2]);
  } catch (e) {
    unauthorizedRefused = /UNAUTHORIZED/.test(e.message);
  }
  if (!unauthorizedRefused) fail("check 4 FAILED: a non-proposer's confirm attempt did not raise UNAUTHORIZED");
  const afterAuth = await client.query("select count(*)::int as n from grants where actor_id = 'p_priya' and child_id = 'p_nora'");
  if (afterAuth.rows[0].n !== beforeAuth.rows[0].n) fail('check 4 FAILED: a refused unauthorized confirm still wrote a grant');
  log("check 4 PASS: a caller who never proposed it was refused (UNAUTHORIZED) with zero writes");

  await client.end();
  log('ALL CHECKS PASS');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/confirm-add-villager-return-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/confirm-add-villager-return-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
