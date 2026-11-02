#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES CONCURRENCY PROOF for `confirm_add_villager` (migration 0074, fixed by
 * 0080) — NOT a live concurrent confirmation. Everything here runs inside a throwaway
 * `postgres:16-alpine` Docker container, bound to loopback only, removed unconditionally at the
 * end. No shared/project database is touched, no credentials are needed, nothing is merged or
 * applied anywhere else.
 *
 * Why this exists: evidence 72's superseding correction (HANDOFF, 2026-11-02T04:07:54Z) found
 * that the earlier "concurrent retry" claim for Add a Villager was actually two SEQUENTIAL,
 * awaited calls — not real concurrency — and that the only other concurrent-run evidence
 * (`src/subgraphs/add-villager-proposal.test.ts`'s `Promise.all` test) is JS-level interleaving
 * against an in-memory `FakeDb`, never two real simultaneous Postgres connections. This script is
 * the thing that closes that specific, named gap: two independent `pg.Client` connections, with
 * DEMONSTRABLE overlapping execution (captured via `pg_stat_activity`, not inferred from timing)
 * against the SAME proposal/version.
 *
 * Method: connection A opens an EXPLICIT transaction and calls the real, unmodified
 * `confirm_add_villager(proposalId, 1)` — the function's own `select ... for update` on the
 * proposal row executes and all of its writes land, but nothing is visible to another
 * transaction until A commits. Connection B, on its own independent connection, calls the SAME
 * `confirm_add_villager(proposalId, 1)` while A's transaction is still open (not committed) — B's
 * own `for update` blocks on the row lock A already holds. A third, read-only observer
 * connection polls `pg_stat_activity` and captures B's backend in `wait_event_type = 'Lock'`
 * *while A's transaction is still open* — the actual overlap, not assumed. Only then does A
 * commit, releasing B to finish via the function's idempotent-replay branch.
 *
 * Checks:
 *   1. Baseline: Kendra proposes adding Dana; the proposal starts unconfirmed.
 *   2. Connection A confirms inside an explicit, uncommitted transaction — the real function,
 *      real writes, held open.
 *   3. While A is open, connection B's confirm call (same proposalId, same version) is observed
 *      BLOCKED on a real Postgres lock (captured from `pg_stat_activity`), not merely "slower."
 *   4. A commits; B then resolves via the idempotent-replay branch, returning the IDENTICAL
 *      relationship_id/grant_id/granted_by A got — not a second write.
 *   5. Exactly one relationship activation (ACTIVE), one grant row, one approvals row exist after
 *      both A and B have completed — never two.
 *   6. A third, ordinary sequential retry (same proposalId/version, after the race) remains
 *      idempotent too: identical ids, same row counts, no further writes.
 *
 * No migration is created or changed by this script. No shared/alt-stack port or live service is
 * contacted — container is loopback-bound (`-p 127.0.0.1::5432`) from the moment it starts.
 *
 * Usage: node ops/confirm-add-villager-concurrency-proof.mjs
 * Requires: docker (already on PATH in this checkout's environment).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-villager-concurrency-${randomUUID().slice(0, 8)}`;
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

// Same curated set as ops/confirm-add-villager-return-proof.mjs, for the same reason: 0001 (base
// tables), 0003 (current_person/is_parent_of/has_scope), 0074 (villager_proposals + the functions
// themselves), then 0080 (#115, merged to main — the missing granted_by column fix) applied
// verbatim on top.
const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0074_add_villager_proposal.sql',
];
const FIX_MIGRATION = 'supabase/migrations/0080_confirm_add_villager_return_columns.sql';

// Verbatim from supabase/migrations/0025_demo_sandbox.sql — only the two functions this chain
// needs, not that file's broader demo-sandbox policies.
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

  const fixSql = readFileSync(FIX_MIGRATION, 'utf8');
  if (!fixSql.includes('granted_by')) fail('0080 content does not mention granted_by — wrong file?');
  await client.query(fixSql);
  log(`applied ${FIX_MIGRATION} (#115/#116, merged to main — real, unmodified confirm_add_villager)`);
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
  // Same ids as src/fixtures.ts / confirm-add-villager-return-proof.mjs: Kendra is a parent of
  // Nora, Dana already has a DISCOVERED friend_parent relationship to Nora (the row
  // confirm_add_villager activates), matching the real propose_add_villager resolution path.
  await client.query(`
    insert into villages (id, name) values ('v_nora', 'Nora''s village');
    insert into people (id, display_name, birth_date) values
      ('p_nora', 'Nora Ellison', '2018-03-14'),
      ('p_mom', 'Kendra Ellison', '1988-05-02'),
      ('p_dana', 'Dana Coleman', '1987-04-11');
    insert into children (person_id) values ('p_nora');
    insert into households (id, village_id) values ('h_a', 'v_nora'), ('h_c', 'v_nora');
    insert into household_members (person_id, household_id, role) values
      ('p_mom', 'h_a', 'parent'), ('p_nora', 'h_a', 'child'), ('p_dana', 'h_c', 'parent');
    insert into relationships (id, from_id, to_id, type, status, created_at, history) values
      ('r_dana_friend_parent', 'p_dana', 'p_nora', 'friend_parent', 'DISCOVERED', '2026-10-24',
       '[{"at":"2026-10-24","event":"DISCOVERED (friend_parent)"}]');
  `);
}

async function asPerson(client, userId) {
  await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
}

async function countsNow(client) {
  const rel = await client.query("select status from relationships where id = 'r_dana_friend_parent'");
  const grants = await client.query("select count(*)::int as n from grants where actor_id = 'p_dana' and child_id = 'p_nora'");
  const approvals = await client.query(
    "select count(*)::int as n from approvals where subject_type = 'Grant' and subject_id in (select id from grants where actor_id = 'p_dana' and child_id = 'p_nora')",
  );
  return { relStatus: rel.rows[0]?.status ?? null, grantCount: grants.rows[0].n, approvalCount: approvals.rows[0].n };
}

async function waitUntilBlocked(observer, pid, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await observer.query(
      `select wait_event_type, wait_event, state, query
         from pg_stat_activity where pid = $1`,
      [pid],
    );
    const row = r.rows[0];
    if (row && row.wait_event_type === 'Lock') return row;
    await new Promise((res) => setTimeout(res, 20));
  }
  return null;
}

async function main() {
  log(`[confirm-add-villager-concurrency-proof] container ${CONTAINER} (DISPOSABLE-POSTGRES CONCURRENCY PROOF)`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  if (!portLine.startsWith('127.0.0.1:')) fail(`container port is not loopback-bound: ${portLine}`);
  const port = Number(portLine.split(':').pop());
  log(`postgres listening on ${portLine} (loopback-bound)`);

  const setup = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres',
  }));
  log('connected (setup connection)');

  await stubAuth(setup);
  await applyMigrations(setup);
  await seedFixtures(setup);
  log('seeded minimal fixtures (Kendra/Nora/Dana, matching src/fixtures.ts ids exactly)');

  const uidKendra = randomUUID();
  await setup.query('insert into identity_map (user_id, person_id) values ($1, $2)', [uidKendra, 'p_mom']);

  // --- Check 1: baseline — Kendra proposes adding Dana; unconfirmed ---
  await asPerson(setup, uidKendra);
  const before = await countsNow(setup);
  if (before.relStatus !== 'DISCOVERED' || before.grantCount !== 0 || before.approvalCount !== 0) {
    fail(`unexpected baseline from fixture seed: ${JSON.stringify(before)}`);
  }
  const proposed = await setup.query(
    'select * from propose_add_villager($1, $2, $3, $4, $5, $6, $7)',
    ['p_nora', 'Dana Coleman', ['pickup.request'], 'family_friend', '2026-11-02', '2026-12-31', 900],
  );
  const proposalId = proposed.rows[0].id;
  if (proposed.rows[0].version !== 1) fail(`expected fresh proposal at version 1, got ${proposed.rows[0].version}`);
  log(`check 1 PASS: Kendra proposed adding Dana — proposal ${proposalId} at version 1, unconfirmed`);

  // --- Checks 2–4: real overlapping execution on two independent connections ---
  const connA = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  const connB = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  const observer = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await asPerson(connA, uidKendra);
  await asPerson(connB, uidKendra);

  const pidBRes = await connB.query('select pg_backend_pid() as pid');
  const pidB = pidBRes.rows[0].pid;

  // Connection A: explicit transaction, the REAL unmodified confirm_add_villager, held open —
  // its own `for update` on the proposal row has already executed and all of its writes have
  // landed in A's uncommitted transaction, but nothing is visible outside it yet.
  await connA.query('begin');
  const confirmA = await connA.query('select * from confirm_add_villager($1, $2)', [proposalId, 1]);
  const rowA = confirmA.rows[0];
  if (!rowA.grant_id || rowA.relationship_status !== 'ACTIVE') {
    fail(`check 2 FAILED: connection A's confirm did not activate/grant as expected: ${JSON.stringify(rowA)}`);
  }
  log(`check 2 PASS: connection A confirmed inside an open, uncommitted transaction (grant ${rowA.grant_id}, relationship ACTIVE)`);

  // Connection B: the SAME call, same proposalId + version, fired on its own independent
  // connection WITHOUT waiting for A to commit. Its own `for update` must block on A's lock.
  const confirmBPromise = connB.query('select * from confirm_add_villager($1, $2)', [proposalId, 1]);

  const blocked = await waitUntilBlocked(observer, pidB);
  if (!blocked) fail('check 3 FAILED: connection B never observed blocked on a lock while A was open — no real overlap captured');
  if (!/confirm_add_villager/i.test(blocked.query)) {
    fail(`check 3 FAILED: the blocked backend was not running confirm_add_villager: ${JSON.stringify(blocked)}`);
  }
  log(`check 3 PASS: connection B observed BLOCKED (wait_event_type=Lock) on the proposal row while A's transaction was still open — real Postgres lock contention, not inferred timing (${JSON.stringify(blocked)})`);

  // Release A — this is the moment B's block resolves.
  await connA.query('commit');
  const rowB = (await confirmBPromise).rows[0];
  if (rowB.grant_id !== rowA.grant_id || rowB.relationship_id !== rowA.relationship_id || rowB.granted_by !== rowA.granted_by) {
    fail(`check 4 FAILED: B's confirm (after A committed) did not match A's exactly: A=${JSON.stringify(rowA)} B=${JSON.stringify(rowB)}`);
  }
  log(`check 4 PASS: after A committed, B resolved via the idempotent-replay branch with the IDENTICAL relationship/grant (${rowB.grant_id}) — no second write`);

  await connA.end();
  await connB.end();

  // --- Check 5: exactly one of each row exists after the race ---
  const afterRace = await countsNow(setup);
  if (afterRace.relStatus !== 'ACTIVE') fail(`check 5 FAILED: relationship not ACTIVE after the race, got ${afterRace.relStatus}`);
  if (afterRace.grantCount !== 1) fail(`check 5 FAILED: expected exactly 1 grant after the race, got ${afterRace.grantCount}`);
  if (afterRace.approvalCount !== 1) fail(`check 5 FAILED: expected exactly 1 approvals row after the race, got ${afterRace.approvalCount}`);
  log('check 5 PASS: exactly one relationship activation, one grant, one approvals row exist after two genuinely concurrent confirms');

  // --- Check 6: a further, ordinary sequential retry remains idempotent too ---
  const confirmC = await setup.query('select * from confirm_add_villager($1, $2)', [proposalId, 1]);
  const rowC = confirmC.rows[0];
  if (rowC.grant_id !== rowA.grant_id || rowC.relationship_id !== rowA.relationship_id) {
    fail(`check 6 FAILED: a subsequent retry after the race returned a different result: ${JSON.stringify(rowC)}`);
  }
  const afterRetry = await countsNow(setup);
  if (afterRetry.grantCount !== 1 || afterRetry.approvalCount !== 1) {
    fail(`check 6 FAILED: a subsequent retry wrote new rows — grants=${afterRetry.grantCount} approvals=${afterRetry.approvalCount}`);
  }
  log('check 6 PASS: a further sequential retry after the race remains idempotent — identical result, zero new writes');

  await observer.end();
  await setup.end();
  log('ALL CHECKS PASS — DISPOSABLE-POSTGRES CONCURRENCY PROOF (not a live concurrent confirmation)');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/confirm-add-villager-concurrency-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/confirm-add-villager-concurrency-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
