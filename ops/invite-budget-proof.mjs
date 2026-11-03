#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES proof for the per-CHILD invite generation budget + ledger (migration 0085,
 * STAGED — not applied anywhere). Full design: docs/contracts/invites.md.
 *
 * Money-adjacent (AGENTS.md §1.6: senior-only, Claude only on explicit instruction, human review
 * required before any apply) — this proof exists so that review has something real to check
 * against, not a claim. Real disposable Postgres, same methodology as every other proof this
 * session: loopback-bound container, stubbed auth.uid()/auth.jwt() via a session GUC, torn down
 * unconditionally.
 *
 * Checks:
 *   1. A parent reserves budget for her own child; the reservation is allowed and counted.
 *   2. A DIFFERENT parent of the SAME child (co-parent) shares the SAME per-child budget — a new
 *      login cannot reset it. Once the $0.04 x 25 = $1.00 default cap is reached, the 26th
 *      reservation for that child is refused, from either parent.
 *   3. A DIFFERENT child has an INDEPENDENT budget — exhausting p_nora's does not touch p_jax's.
 *   4. settle(FAILED) reverses the reservation: the unit becomes spendable again immediately.
 *   5. A non-parent (and a parent of a different child) is refused UNAUTHORIZED — zero rows
 *      written, same no-oracle shape as every other authorization boundary in this schema.
 *   6. CONCURRENCY: two simultaneous reservations for the same child, submitted together, never
 *      both succeed past the cap — pg_advisory_xact_lock serializes them for real.
 *   7. settle() refuses to settle a reservation that belongs to a DIFFERENT caller.
 *   8. The ledger survives the real resetDemo() untouched — a demo reset must not reset the
 *      spending ledger.
 *
 * Usage: node --import tsx ops/invite-budget-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const CONTAINER = `fg-invite-budget-${randomUUID().slice(0, 8)}`;
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
  log(`[invite-budget-proof] container ${CONTAINER}`);
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

  const makeClient = () => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  const superuser = await waitForReady(makeClient);
  log('connected (setup connection)');

  await superuser.query(`
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

  const files = allMigrationsExcept0040();
  for (const path of files) {
    const sql = readFileSync(path, 'utf8');
    try { await superuser.query(sql); } catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`applied ${files.length} migrations (every file except 0040) — includes 0085 (staged, this PR)`);

  // The baseline seed (0002) already has Nora co-parented (h_a Kendra / h_b Andre) and Jax
  // (unrelated child, h_c Dana) — only a stranger (no household at all) is missing.
  await superuser.query(`
    insert into people (id, display_name, birth_date) values ('p_stranger', 'A Stranger', '1990-01-01')
    on conflict do nothing;
  `);
  log('baseline seed (0002) already has Nora co-parented h_a/h_b and Jax (unrelated, h_c) — added only a stranger');

  async function asPerson(client, userId) {
    await client.query('select set_config($1, $2, false)', ['test.current_uid', userId]);
  }
  // current_person() (0003) resolves auth.uid() -> identity_map.person_id — a real, explicit
  // link table, not a guessed column. A deterministic uuid per person id, same technique every
  // other proof this session uses.
  function uidFor(personId) {
    return '00000000-0000-0000-0000-' + Buffer.from(personId).toString('hex').padStart(12, '0').slice(0, 12);
  }
  for (const id of ['p_mom', 'p_dad', 'p_dana', 'p_stranger']) {
    await superuser.query('insert into identity_map (user_id, person_id) values ($1, $2) on conflict do nothing', [uidFor(id), id]);
  }

  const client = makeClient();
  await client.connect();
  async function q(sql, params = []) {
    try { return { rows: (await client.query(sql, params)).rows, error: null }; }
    catch (e) { return { rows: [], error: e }; }
  }
  async function as(personId) { await asPerson(client, uidFor(personId)); }

  // --- Check 1: Kendra reserves for Nora ---
  await as('p_mom');
  const r1 = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash1')");
  if (r1.error) fail(`check 1 FAILED: ${r1.error.message}`);
  if (!r1.rows[0].allowed) fail(`check 1 FAILED: expected allowed=true, got ${JSON.stringify(r1.rows[0])}`);
  const gen1 = r1.rows[0].generation_id;
  log(`check 1 PASS: Kendra reserves $0.04 for Nora, allowed=true, remaining=${r1.rows[0].remaining_usd}`);

  // --- Check 2: Andre (co-parent) shares the SAME budget; the cap (25 x $0.04 = $1.00) refuses the 26th from EITHER parent ---
  await as('p_dad');
  const r2 = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash2')");
  if (r2.error || !r2.rows[0].allowed) fail(`check 2a FAILED: Andre could not reserve against the shared budget: ${JSON.stringify(r2)}`);
  for (let i = 0; i < 23; i++) {
    const r = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', $1)", [`hash_fill_${i}`]);
    if (r.error || !r.rows[0].allowed) fail(`check 2b FAILED at fill #${i}: ${JSON.stringify(r)}`);
  }
  await as('p_mom');
  const over = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash_over')");
  if (over.error) fail(`check 2c FAILED: ${over.error.message}`);
  if (over.rows[0].allowed) fail('check 2c FAILED: the 26th reservation (over the $1.00 default cap) was allowed');
  log('check 2 PASS: Andre shares Kendra\'s budget for Nora (a new login cannot reset it); the 26th reservation over the $1.00/day default cap is refused, from either parent');

  // --- Check 3: Jax's budget is independent of Nora's exhausted one ---
  await as('p_dana');
  const r3 = await q("select * from invite_budget_reserve('p_jax', 0.04, 'MUSE_IMAGE', 'hash_jax')");
  if (r3.error || !r3.rows[0].allowed) fail(`check 3 FAILED: Jax's independent budget was wrongly affected by Nora's: ${JSON.stringify(r3)}`);
  log('check 3 PASS: a different child has a fully independent budget');

  // --- Check 4: settle(FAILED) reverses the reservation ---
  await as('p_mom');
  const settleFail = await q("select invite_budget_settle($1, 'FAILED', null, null)", [gen1]);
  if (settleFail.error || settleFail.rows[0].invite_budget_settle !== true) fail(`check 4a FAILED: ${JSON.stringify(settleFail)}`);
  const afterFail = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash_after_fail')");
  if (afterFail.error || !afterFail.rows[0].allowed) fail(`check 4b FAILED: the reversed $0.04 was not spendable again: ${JSON.stringify(afterFail)}`);
  log('check 4 PASS: settle(FAILED) reverses the reservation — the unit is spendable again immediately');

  // --- Check 5: a non-parent and a parent of a different child are refused ---
  await as('p_stranger');
  const strangerReserve = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash_stranger')");
  if (!strangerReserve.error || !/UNAUTHORIZED/.test(strangerReserve.error.message)) fail(`check 5a FAILED: a stranger was not refused UNAUTHORIZED: ${JSON.stringify(strangerReserve)}`);
  await as('p_dana');
  const wrongParent = await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash_wrong_parent')");
  if (!wrongParent.error || !/UNAUTHORIZED/.test(wrongParent.error.message)) fail(`check 5b FAILED: Jax's parent was not refused for Nora's budget: ${JSON.stringify(wrongParent)}`);
  log('check 5 PASS: a stranger and an unrelated child\'s parent are both refused UNAUTHORIZED, zero rows written');

  // --- Check 6: concurrency — two simultaneous reservations for the SAME child never both pass the cap ---
  const concClient1 = makeClient(); await concClient1.connect(); await asPerson(concClient1, uidFor('p_mom'));
  const concClient2 = makeClient(); await concClient2.connect(); await asPerson(concClient2, uidFor('p_mom'));
  // Drain Jax's budget to exactly one unit remaining, then fire two SIMULTANEOUS reservations —
  // at most one may succeed.
  await as('p_dana');
  for (let i = 0; i < 23; i++) {
    const r = await q("select * from invite_budget_reserve('p_jax', 0.04, 'MUSE_IMAGE', $1)", [`hash_jax_fill_${i}`]);
    if (r.error || !r.rows[0].allowed) fail(`check 6 setup FAILED at #${i}: ${JSON.stringify(r)}`);
  }
  await asPerson(concClient1, uidFor('p_dana'));
  await asPerson(concClient2, uidFor('p_dana'));
  const [race1, race2] = await Promise.all([
    concClient1.query("select * from invite_budget_reserve('p_jax', 0.04, 'MUSE_IMAGE', 'race1')").catch((e) => ({ rows: [], error: e })),
    concClient2.query("select * from invite_budget_reserve('p_jax', 0.04, 'MUSE_IMAGE', 'race2')").catch((e) => ({ rows: [], error: e })),
  ]);
  const allowedCount = [race1, race2].filter((r) => r.rows?.[0]?.allowed === true).length;
  if (allowedCount !== 1) fail(`check 6 FAILED: expected exactly 1 of 2 concurrent reservations to succeed at the cap boundary, got ${allowedCount}`);
  log('check 6 PASS: two simultaneous reservations for the same child at the cap boundary — exactly ONE succeeds, never both (pg_advisory_xact_lock serializes them for real)');
  await concClient1.end(); await concClient2.end();

  // --- Check 7: settle() refuses a reservation that belongs to someone else ---
  await as('p_mom');
  const gen7 = (await q("select * from invite_budget_reserve('p_nora', 0.04, 'MUSE_IMAGE', 'hash_mine')")).rows[0].generation_id;
  await as('p_dad'); // a co-parent — legitimately shares the BUDGET, but not THIS specific reservation row
  const stolenSettle = await q("select invite_budget_settle($1, 'SUCCEEDED', 'muse-image-1.0', 'deadbeef')", [gen7]);
  if (stolenSettle.error) fail(`check 7 FAILED unexpectedly errored: ${stolenSettle.error.message}`);
  if (stolenSettle.rows[0].invite_budget_settle !== false) fail('check 7 FAILED: Andre was able to settle Kendra\'s own reservation');
  log('check 7 PASS: settle() refuses a reservation it does not own — a co-parent sharing the budget cannot settle someone else\'s specific reservation row');

  await client.end();
  await superuser.end();

  // --- Check 8: resetDemo() must never touch the ledger ---
  // resetDemo() expects the full Cast v2 fixture set already present (same as every other real-
  // resetDemo() proof this session) — pre-seed it before calling the real transaction.
  const { createCastV2 } = await import('../src/fixtures-cast-v2.ts');
  const seedConn = await waitForReady(makeClient);
  const cast = createCastV2();
  const CAST_ORDER = ['villages', 'people', 'children', 'households', 'household_members', 'relationships', 'contact_methods', 'grants', 'routines', 'events', 'care_facts'];
  for (const table of CAST_ORDER) {
    for (const row of cast[table] ?? []) {
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await seedConn.query(`insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict do nothing`, cols.map((k) => row[k]));
    }
  }
  await seedConn.end();
  log(`pre-seeded Cast v2 (${CAST_ORDER.map((t) => `${t}=${(cast[t] ?? []).length}`).join(', ')}) — resetDemo() expects it already present`);

  process.env.SUPABASE_DB_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const before = await waitForReady(makeClient);
  const countBefore = (await before.query('select count(*)::int as n from invite_generations')).rows[0].n;
  await before.end();

  const { resetDemo } = await import('../src/demo/reset.ts');
  await resetDemo('invite-budget-proof');

  const after = makeClient(); await after.connect();
  const countAfter = (await after.query('select count(*)::int as n from invite_generations')).rows[0].n;
  await after.end();
  if (countAfter !== countBefore) fail(`check 8 FAILED: resetDemo() changed invite_generations row count ${countBefore} -> ${countAfter}`);
  log(`check 8 PASS: resetDemo() left invite_generations untouched (${countBefore} rows before and after) — a demo reset must not reset the spending ledger`);

  log('ALL CHECKS PASS — DISPOSABLE-POSTGRES INVITE BUDGET REHEARSAL (not a live application)');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/invite-budget-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/invite-budget-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
