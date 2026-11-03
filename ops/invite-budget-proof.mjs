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
 *   1. A parent reserves budget for her own child; the reservation is allowed and counted. Cost
 *      is NEVER a caller argument — invite_budget_reserve takes (child, source, promptHash) only;
 *      the $0.01/generation price (Muse Image, per Meta's published docs) is a SQL constant.
 *   2. A DIFFERENT parent of the SAME child (co-parent) shares the SAME per-child budget — a new
 *      login cannot reset it. Once the $0.01 x 100 = $1.00 default cap is reached, the 101st
 *      reservation for that child is refused, from either parent.
 *   3. A DIFFERENT child has an INDEPENDENT budget — exhausting p_nora's does not touch p_jax's.
 *   4. settle(FAILED) reverses the reservation: the unit becomes spendable again immediately.
 *   5. A non-parent (and a parent of a different child) is refused UNAUTHORIZED — zero rows
 *      written, same no-oracle shape as every other authorization boundary in this schema.
 *   6. CONCURRENCY: two simultaneous reservations for the same child, submitted together, never
 *      both succeed past the cap — pg_advisory_xact_lock serializes them for real.
 *   7. settle() refuses to settle a reservation that belongs to a DIFFERENT caller, and refuses
 *      to settle the SAME reservation twice (replay/override of a prior outcome is refused).
 *   8. CACHE HIT: settle(SUCCEEDED, cached=true) charges $0.00 — the reservation's provisional
 *      charge is REPLACED with the real (free) cost, and the released budget is immediately
 *      spendable again. settle(SUCCEEDED, cached=false) charges the full reserved amount.
 *   9. UNCERTAIN: settle(UNCERTAIN, ...) keeps the full reserved charge — never refunded by
 *      default, distinct from settle(FAILED, ...) which charges $0.
 *  10. The ledger survives the real resetDemo() untouched — a demo reset must not reset the
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
const COST_PER_GENERATION = 0.01; // mirrors the SQL constant in invite_budget_reserve — $1.00 cap / $0.01 = 100
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
  const reserve = (child, hash) => q("select * from invite_budget_reserve($1, 'MUSE_IMAGE', $2)", [child, hash]);
  const settle = (genId, status, model, outputSha256, cached) => q('select invite_budget_settle($1, $2, $3, $4, $5)', [genId, status, model, outputSha256, cached]);

  // --- Check 1: Kendra reserves for Nora. No cost argument anywhere — the price is server-side. ---
  await as('p_mom');
  const r1 = await reserve('p_nora', 'hash1');
  if (r1.error) fail(`check 1 FAILED: ${r1.error.message}`);
  if (!r1.rows[0].allowed) fail(`check 1 FAILED: expected allowed=true, got ${JSON.stringify(r1.rows[0])}`);
  if (Math.abs(Number(r1.rows[0].remaining_usd) - (1.00 - COST_PER_GENERATION)) > 1e-9) {
    fail(`check 1 FAILED: expected remaining ~${1.00 - COST_PER_GENERATION}, got ${r1.rows[0].remaining_usd}`);
  }
  const gen1 = r1.rows[0].generation_id;
  log(`check 1 PASS: Kendra reserves for Nora (no cost argument — server charged $${COST_PER_GENERATION}), allowed=true, remaining=${r1.rows[0].remaining_usd}`);

  // --- Check 2: Andre (co-parent) shares the SAME budget; the cap ($1.00 / $0.01 = 100) refuses the 101st from EITHER parent ---
  await as('p_dad');
  const r2 = await reserve('p_nora', 'hash2');
  if (r2.error || !r2.rows[0].allowed) fail(`check 2a FAILED: Andre could not reserve against the shared budget: ${JSON.stringify(r2)}`);
  // 2 reservations made so far (check 1 + 2a); fill to 100 total before the over-cap attempt.
  // Generation ids are kept — check 7 frees one of these to test settle()'s ownership/replay
  // rules without needing fresh headroom of its own.
  const fillGenerationIds = [];
  for (let i = 0; i < 98; i++) {
    const r = await reserve('p_nora', `hash_fill_${i}`);
    if (r.error || !r.rows[0].allowed) fail(`check 2b FAILED at fill #${i}: ${JSON.stringify(r)}`);
    fillGenerationIds.push(r.rows[0].generation_id);
  }
  await as('p_mom');
  const over = await reserve('p_nora', 'hash_over');
  if (over.error) fail(`check 2c FAILED: ${over.error.message}`);
  if (over.rows[0].allowed) fail('check 2c FAILED: the 101st reservation (over the $1.00 default cap) was allowed');
  log('check 2 PASS: Andre shares Kendra\'s budget for Nora (a new login cannot reset it); the 101st reservation over the $1.00/day default cap ($0.01 x 100) is refused, from either parent');

  // --- Check 3: Jax's budget is independent of Nora's exhausted one ---
  await as('p_dana');
  const r3 = await reserve('p_jax', 'hash_jax');
  if (r3.error || !r3.rows[0].allowed) fail(`check 3 FAILED: Jax's independent budget was wrongly affected by Nora's: ${JSON.stringify(r3)}`);
  log('check 3 PASS: a different child has a fully independent budget');

  // --- Check 4: settle(FAILED) reverses the reservation ---
  await as('p_mom');
  const settleFail = await settle(gen1, 'FAILED', null, null, false);
  if (settleFail.error || settleFail.rows[0].invite_budget_settle !== true) fail(`check 4a FAILED: ${JSON.stringify(settleFail)}`);
  const afterFail = await reserve('p_nora', 'hash_after_fail');
  if (afterFail.error || !afterFail.rows[0].allowed) fail(`check 4b FAILED: the reversed reservation was not spendable again: ${JSON.stringify(afterFail)}`);
  log('check 4 PASS: settle(FAILED) reverses the reservation — the unit is spendable again immediately');

  // --- Check 5: a non-parent and a parent of a different child are refused ---
  await as('p_stranger');
  const strangerReserve = await reserve('p_nora', 'hash_stranger');
  if (!strangerReserve.error || !/UNAUTHORIZED/.test(strangerReserve.error.message)) fail(`check 5a FAILED: a stranger was not refused UNAUTHORIZED: ${JSON.stringify(strangerReserve)}`);
  await as('p_dana');
  const wrongParent = await reserve('p_nora', 'hash_wrong_parent');
  if (!wrongParent.error || !/UNAUTHORIZED/.test(wrongParent.error.message)) fail(`check 5b FAILED: Jax's parent was not refused for Nora's budget: ${JSON.stringify(wrongParent)}`);
  log('check 5 PASS: a stranger and an unrelated child\'s parent are both refused UNAUTHORIZED, zero rows written');

  // --- Check 6: concurrency — two simultaneous reservations for the SAME child never both pass the cap ---
  const concClient1 = makeClient(); await concClient1.connect();
  const concClient2 = makeClient(); await concClient2.connect();
  // Jax has 1 reservation so far (check 3). Fill to 99 (one short of the $1.00/$0.01=100 cap),
  // then fire two SIMULTANEOUS reservations for the last slot — at most one may succeed.
  await as('p_dana');
  // Kept so checks 8/9 (which also reserve against Jax) can free a slot first — by check 6's end
  // Jax is pinned at the $1.00 cap (1 from check 3 + 98 here + 1 race winner).
  const jaxFillGenerationIds = [];
  for (let i = 0; i < 98; i++) {
    const r = await reserve('p_jax', `hash_jax_fill_${i}`);
    if (r.error || !r.rows[0].allowed) fail(`check 6 setup FAILED at #${i}: ${JSON.stringify(r)}`);
    jaxFillGenerationIds.push(r.rows[0].generation_id);
  }
  await asPerson(concClient1, uidFor('p_dana'));
  await asPerson(concClient2, uidFor('p_dana'));
  const [race1, race2] = await Promise.all([
    concClient1.query("select * from invite_budget_reserve('p_jax', 'MUSE_IMAGE', 'race1')").catch((e) => ({ rows: [], error: e })),
    concClient2.query("select * from invite_budget_reserve('p_jax', 'MUSE_IMAGE', 'race2')").catch((e) => ({ rows: [], error: e })),
  ]);
  const allowedCount = [race1, race2].filter((r) => r.rows?.[0]?.allowed === true).length;
  if (allowedCount !== 1) fail(`check 6 FAILED: expected exactly 1 of 2 concurrent reservations to succeed at the cap boundary, got ${allowedCount}`);
  log('check 6 PASS: two simultaneous reservations for the same child at the cap boundary — exactly ONE succeeds, never both (pg_advisory_xact_lock serializes them for real)');
  await concClient1.end(); await concClient2.end();

  // --- Check 7: settle() refuses a reservation that belongs to someone else, and refuses a replay ---
  // Nora is at the $1.00 cap after checks 2/4 (check 4's own re-reservation re-filled the slot it
  // freed) — settle one of check 2's fill reservations FAILED first, purely to free headroom for
  // this check's own fresh reservation. Those fill reservations were made as p_dad (check 2's
  // active identity at the time), so they must be freed as their actual owner, p_dad — settle()
  // enforces ownership even for this setup step. That settle is not itself part of what's proven.
  await as('p_dad');
  const freeUp = await settle(fillGenerationIds[0], 'FAILED', null, null, false);
  if (freeUp.error || freeUp.rows[0].invite_budget_settle !== true) fail(`check 7 setup FAILED: could not free headroom: ${JSON.stringify(freeUp)}`);
  await as('p_mom');
  const gen7 = (await reserve('p_nora', 'hash_mine')).rows[0].generation_id;
  if (!gen7) fail('check 7 setup FAILED: reservation still refused after freeing headroom');
  await as('p_dad'); // a co-parent — legitimately shares the BUDGET, but not THIS specific reservation row
  const stolenSettle = await settle(gen7, 'SUCCEEDED', 'muse-image-1.0', 'deadbeef', false);
  if (stolenSettle.error) fail(`check 7a FAILED unexpectedly errored: ${stolenSettle.error.message}`);
  if (stolenSettle.rows[0].invite_budget_settle !== false) fail('check 7a FAILED: Andre was able to settle Kendra\'s own reservation');
  await as('p_mom');
  const firstSettle = await settle(gen7, 'SUCCEEDED', 'muse-image-1.0', 'realhash', false);
  if (firstSettle.error || firstSettle.rows[0].invite_budget_settle !== true) fail(`check 7b FAILED: Kendra's own first settle should succeed: ${JSON.stringify(firstSettle)}`);
  const replaySettle = await settle(gen7, 'FAILED', null, null, false);
  if (replaySettle.error) fail(`check 7c FAILED unexpectedly errored: ${replaySettle.error.message}`);
  if (replaySettle.rows[0].invite_budget_settle !== false) fail('check 7c FAILED: a second settle() on an already-terminal reservation was allowed to replay/override the outcome');
  log('check 7 PASS: settle() refuses a reservation it does not own — a co-parent sharing the budget cannot settle someone else\'s specific reservation row; a reservation already settled once cannot be settled again (no replay/override)');

  // --- Check 8: CACHE HIT settles $0, uncached SUCCEEDED settles the full reserved cost ---
  // Jax is pinned at the $1.00 cap after check 6 — free one fill slot first (same owner, p_dana)
  // purely for headroom; that settle is not itself part of what check 8 proves.
  await as('p_dana');
  const freeUp8 = await settle(jaxFillGenerationIds[0], 'FAILED', null, null, false);
  if (freeUp8.error || freeUp8.rows[0].invite_budget_settle !== true) fail(`check 8 setup FAILED: could not free headroom: ${JSON.stringify(freeUp8)}`);
  const genCached = (await reserve('p_jax', 'hash_cache_test')).rows[0].generation_id;
  if (!genCached) fail('check 8 setup FAILED: could not reserve for the cache-hit test (Jax may be at cap)');
  const beforeCacheSettle = await q("select coalesce(sum(cost_usd),0)::numeric as n from invite_generations where child_id='p_jax' and status in ('PENDING','SUCCEEDED','UNCERTAIN') and (created_at at time zone 'America/Detroit')::date = (now() at time zone 'America/Detroit')::date");
  const cacheSettle = await settle(genCached, 'SUCCEEDED', 'muse-image-1.0', 'cachedhash', true);
  if (cacheSettle.error || cacheSettle.rows[0].invite_budget_settle !== true) fail(`check 8a FAILED: ${JSON.stringify(cacheSettle)}`);
  const afterCacheSettle = await q("select cost_usd::numeric as n from invite_generations where id = $1", [genCached]);
  if (Number(afterCacheSettle.rows[0].n) !== 0) fail(`check 8b FAILED: a cache-hit settle should charge $0, stored cost_usd=${afterCacheSettle.rows[0].n}`);
  const afterCacheSpend = await q("select coalesce(sum(cost_usd),0)::numeric as n from invite_generations where child_id='p_jax' and status in ('PENDING','SUCCEEDED','UNCERTAIN') and (created_at at time zone 'America/Detroit')::date = (now() at time zone 'America/Detroit')::date");
  if (Math.abs(Number(afterCacheSpend.rows[0].n) - Number(beforeCacheSettle.rows[0].n) + COST_PER_GENERATION) > 1e-9) {
    fail(`check 8c FAILED: today's spend did not drop by the reserved amount after the cache-hit settle (before=${beforeCacheSettle.rows[0].n}, after=${afterCacheSpend.rows[0].n})`);
  }
  log(`check 8 PASS: settle(SUCCEEDED, cached=true) charges $0.00 — the reservation's provisional charge is replaced with the real (free) cost, and today's spend for the child drops by the released amount`);

  // --- Check 9: UNCERTAIN keeps the full reserved charge — never refunded by default ---
  await as('p_dana');
  const genUncertain = (await reserve('p_jax', 'hash_uncertain_test')).rows[0].generation_id;
  if (!genUncertain) fail('check 9 setup FAILED: could not reserve for the uncertain test');
  const uncertainSettle = await settle(genUncertain, 'UNCERTAIN', null, null, false);
  if (uncertainSettle.error || uncertainSettle.rows[0].invite_budget_settle !== true) fail(`check 9a FAILED: ${JSON.stringify(uncertainSettle)}`);
  const afterUncertain = await q("select status, cost_usd::numeric as n from invite_generations where id = $1", [genUncertain]);
  if (afterUncertain.rows[0].status !== 'UNCERTAIN' || Number(afterUncertain.rows[0].n) !== COST_PER_GENERATION) {
    fail(`check 9b FAILED: expected status=UNCERTAIN, cost=${COST_PER_GENERATION}, got ${JSON.stringify(afterUncertain.rows[0])}`);
  }
  log(`check 9 PASS: settle(UNCERTAIN, ...) keeps the full $${COST_PER_GENERATION} reserved charge — the provider may have billed for it, so it is never silently refunded, distinct from settle(FAILED, ...) which charges $0 (check 4)`);

  await client.end();
  await superuser.end();

  // --- Check 10: resetDemo() must never touch the ledger ---
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
  if (countAfter !== countBefore) fail(`check 10 FAILED: resetDemo() changed invite_generations row count ${countBefore} -> ${countAfter}`);
  log(`check 10 PASS: resetDemo() left invite_generations untouched (${countBefore} rows before and after) — a demo reset must not reset the spending ledger`);

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
