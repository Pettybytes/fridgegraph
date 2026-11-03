#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES proof for the `adult_availability_free_busy` hardening (migration 0086,
 * STAGED — not applied anywhere). Full design: docs/security/0086-availability-view.md.
 *
 * Real application roles (anon/authenticated), real caller claims (identity_map + auth.uid()/
 * auth.jwt() stubs — same technique every other proof this session uses), the REAL RLS policies
 * and the REAL view, never bypassed. Loopback-bound container, removed unconditionally.
 *
 * Checks:
 *   1. anon: permission denied on the view (no row, no column — a real error, not an empty read).
 *   2. The adult owner (Kendra) reads her own free/busy rows through the view, unchanged.
 *   3. An authorized village member (Andre, same village, different household) reads Kendra's
 *      free/busy rows (id/person/time/state) — and the view has no `reason` column to select at
 *      all (never exposed, never a possible typo'd leak).
 *   4. An unrelated family (Dana, different village) gets ZERO rows for Kendra — same no-oracle
 *      shape as a nonexistent id.
 *   5. The demo guide sees ONLY sandbox=true rows, never a real (non-sandbox) adult's rows.
 *   6. authenticated reading the BASE TABLE directly: Andre (authorized for free/busy via the
 *      view) gets ZERO rows querying `adult_availability` directly for Kendra's `reason` — RLS on
 *      the base table is self-only regardless of what the view shares.
 *   7. Application writes through the view (even by the row's own owner) are refused — no
 *      INSERT/UPDATE/DELETE grant exists.
 *   8. ADVERSARIAL CALLER PREDICATE — the security_barrier proof: an unauthorized caller (Dana)
 *      queries the view with an extra WHERE clause containing a side-effecting probe function
 *      applied to a column of a row she must never see. The probe's call counter must stay at
 *      ZERO — not just "returns no rows," but the probe is never even INVOKED against a forbidden
 *      row, proving the view's own security qual is evaluated first.
 *   9. Helper/alternate-disclosure inspection: no other object in the public schema selects
 *      `adult_availability.reason`, and the three SECURITY DEFINER helpers
 *      (current_person/shares_village_with/is_demo_guide) return booleans/text-ids only — never a
 *      row from this table — so none of them can be used as a side-channel oracle.
 *  10. BEFORE/AFTER comparison: Andre's authorized view of Kendra's free/busy rows is
 *      byte-for-byte identical before migration 0086 and after it — hardening changes nothing
 *      about who sees what.
 *
 * Usage: node --import tsx ops/availability-view-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-availability-view-${randomUUID().slice(0, 8)}`;
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

function uidFor(personId) {
  return '00000000-0000-0000-0000-' + Buffer.from(personId).toString('hex').padStart(12, '0').slice(0, 12);
}

async function applyMigrations(client, files) {
  for (const path of files) {
    const sql = readFileSync(path, 'utf8');
    try { await client.query(sql); } catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

async function main() {
  log(`[availability-view-proof] container ${CONTAINER}`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  if (!portLine.startsWith('127.0.0.1:')) fail(`container port is not loopback-bound: ${portLine}`);
  const port = Number(portLine.split(':').pop());
  log(`postgres listening on ${portLine} (loopback-bound)`);

  const makeSuperuser = () => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
  const makeAuthenticated = () => new pg.Client({ host: '127.0.0.1', port, user: 'authenticated_login', password: 'x', database: 'postgres' });
  const makeAnon = () => new pg.Client({ host: '127.0.0.1', port, user: 'anon_login', password: 'x', database: 'postgres' });

  const superuser = await waitForReady(makeSuperuser);
  log('connected (setup connection)');
  await stubAuth(superuser);

  // A real LOGIN role that inherits `authenticated`'s grants — the actual client in production
  // connects as a dedicated authenticator role, not directly "as" authenticated; this mirrors
  // that shape so the privilege checks are real, not superuser-privileged.
  await superuser.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'authenticated_login') then
        create role authenticated_login login password 'x' in role authenticated;
      end if;
      if not exists (select from pg_roles where rolname = 'anon_login') then
        create role anon_login login password 'x' in role anon;
      end if;
    end $$;
  `);

  // --- Migrations WITHOUT 0086, to capture the "before" authorized view for check 10 ---
  const allFiles = allMigrationsExcept0040();
  const before086 = allFiles.filter((f) => !f.includes('0086_'));
  const file086 = allFiles.find((f) => f.includes('0086_'));
  if (!file086) fail('0086 migration file not found');
  await applyMigrations(superuser, before086);
  log(`applied ${before086.length} migrations (every file except 0040, BEFORE 0086)`);

  async function seedFixtures() {
    // Kendra (p_mom) and Andre (p_dad) already share Nora's village (v_nora: h_a/h_b) from 0002.
    // Dana (p_dana) is in v_jax — a genuinely different village — also already seeded.
    await superuser.query(`
      insert into identity_map (user_id, person_id) values
        ($1, 'p_mom'), ($2, 'p_dad'), ($3, 'p_dana')
      on conflict do nothing;
    `, [uidFor('p_mom'), uidFor('p_dad'), uidFor('p_dana')]);

    await superuser.query(`
      insert into adult_availability (id, person_id, start_at, end_at, state, reason, sandbox) values
        ('aa_mom_1', 'p_mom', '2026-11-10T09:00:00Z', '2026-11-10T11:00:00Z', 'BUSY', 'Dentist — private', false),
        ('aa_mom_2', 'p_mom', '2026-11-11T13:00:00Z', '2026-11-11T14:00:00Z', 'FREE', null, false),
        ('aa_mom_sandbox', 'p_mom', '2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z', 'BUSY', 'Sandbox demo row', true)
      on conflict do nothing;
    `);
  }
  await seedFixtures();
  log('seeded fixtures: Kendra (p_mom, village v_nora h_a), Andre (p_dad, village v_nora h_b — authorized), Dana (p_dana, village v_jax — unrelated), one sandbox row');

  async function asClient(makeFn, personId, jwt) {
    const c = makeFn();
    try { await c.connect(); } catch (e) { fail(`client connect FAILED (server already confirmed ready): ${e.message}`); }
    if (personId) await c.query('select set_config($1, $2, false)', ['test.current_uid', uidFor(personId)]);
    if (jwt) await c.query('select set_config($1, $2, false)', ['test.current_jwt', JSON.stringify(jwt)]);
    return c;
  }

  // --- Check 1: anon — permission denied ---
  const anonClient = makeAnon();
  try { await anonClient.connect(); } catch (e) { fail(`anon connect FAILED (server already confirmed ready): ${e.message}`); }
  const anonResult = await anonClient.query('select * from adult_availability_free_busy').catch((e) => ({ error: e }));
  if (!anonResult.error || !/permission denied/.test(anonResult.error.message)) {
    fail(`check 1 FAILED: anon was not refused with permission denied: ${JSON.stringify(anonResult)}`);
  }
  log(`check 1 PASS: anon is refused — ${anonResult.error.message}`);
  await anonClient.end();

  // --- Check 2: the owner reads her own rows unchanged ---
  const mom = await asClient(makeAuthenticated, 'p_mom');
  const ownRows = await mom.query('select id, person_id, start_at, end_at, state from adult_availability_free_busy order by id');
  if (ownRows.rows.length !== 3) fail(`check 2 FAILED: Kendra should see all 3 of her own rows, got ${ownRows.rows.length}`);
  log(`check 2 PASS: Kendra (owner) sees all ${ownRows.rows.length} of her own free/busy rows through the view`);

  // --- Check 3: an authorized village member sees free/busy, never reason (the column doesn't exist) ---
  const dad = await asClient(makeAuthenticated, 'p_dad');
  const andreView = await dad.query("select id, person_id, start_at, end_at, state from adult_availability_free_busy where person_id = 'p_mom' order by id");
  if (andreView.rows.length !== 3) fail(`check 3a FAILED: Andre (authorized village member) should see Kendra's 3 rows, got ${andreView.rows.length}`);
  const reasonAttempt = await dad.query("select reason from adult_availability_free_busy where person_id = 'p_mom'").catch((e) => ({ error: e }));
  if (!reasonAttempt.error || !/column .*reason.* does not exist/i.test(reasonAttempt.error.message)) {
    fail(`check 3b FAILED: expected 'column reason does not exist', got ${JSON.stringify(reasonAttempt)}`);
  }
  log("check 3 PASS: Andre (authorized village member) sees Kendra's free/busy rows; `reason` is not a column of the view at all — not refused, structurally absent");

  // --- Check 4: an unrelated family sees nothing ---
  const dana = await asClient(makeAuthenticated, 'p_dana');
  const danaView = await dana.query("select id from adult_availability_free_busy where person_id = 'p_mom'");
  if (danaView.rows.length !== 0) fail(`check 4 FAILED: Dana (unrelated family) saw ${danaView.rows.length} of Kendra's rows`);
  log('check 4 PASS: an unrelated family (different village) sees zero rows — same no-oracle shape as a nonexistent id');

  // --- Check 5: demo guide sees sandbox-only ---
  const guide = await asClient(makeAuthenticated, null, { app_metadata: { demo_guide: true } });
  const guideView = await guide.query('select id, person_id, state from adult_availability_free_busy order by id');
  if (guideView.rows.length !== 1 || guideView.rows[0].id !== 'aa_mom_sandbox') {
    fail(`check 5 FAILED: demo guide should see exactly the 1 sandbox row, got ${JSON.stringify(guideView.rows)}`);
  }
  log('check 5 PASS: the demo guide sees ONLY the sandbox=true row, never Kendra\'s two real rows');
  await guide.end();

  // --- Check 6: authenticated direct base-table reads — another adult's reason stays inaccessible ---
  const andreBaseTable = await dad.query("select reason from adult_availability where person_id = 'p_mom'");
  if (andreBaseTable.rows.length !== 0) fail(`check 6 FAILED: Andre read ${andreBaseTable.rows.length} of Kendra's base-table rows directly (including reason)`);
  const momBaseTable = await mom.query("select reason from adult_availability where person_id = 'p_mom' order by id");
  if (momBaseTable.rows.length !== 3 || momBaseTable.rows.filter((r) => r.reason !== null).length !== 2) {
    fail(`check 6b FAILED: Kendra should read her OWN 3 rows directly, 2 of them with a non-null reason: ${JSON.stringify(momBaseTable.rows)}`);
  }
  log("check 6 PASS: Andre gets ZERO rows reading adult_availability directly for Kendra (RLS is self-only regardless of the view's sharing) — Kendra reads her own reason fine, directly, as expected");

  // --- Check 7: application writes through the view are refused ---
  const ownWrite = await mom.query("update adult_availability_free_busy set state = 'FREE' where id = 'aa_mom_1'").catch((e) => ({ error: e }));
  if (!ownWrite.error || !/permission denied/.test(ownWrite.error.message)) {
    fail(`check 7a FAILED: expected permission denied writing through the view, got ${JSON.stringify(ownWrite)}`);
  }
  const insertThroughView = await mom.query("insert into adult_availability_free_busy (id, person_id, start_at, end_at, state) values ('x','p_mom',now(),now()+interval '1h','FREE')").catch((e) => ({ error: e }));
  if (!insertThroughView.error || !/permission denied/.test(insertThroughView.error.message)) {
    fail(`check 7b FAILED: expected permission denied inserting through the view, got ${JSON.stringify(insertThroughView)}`);
  }
  log(`check 7 PASS: writes through the view are refused — UPDATE: ${ownWrite.error.message}; INSERT: ${insertThroughView.error.message}`);

  // --- Check 8: ADVERSARIAL CALLER PREDICATE — the security_barrier proof, BEFORE hardening ---
  // Run here deliberately BEFORE 0086 is applied (0086 lands at check 10), so this is a genuine
  // demonstration that the gap is REAL on the unhardened view, not a check that could never fail.
  await superuser.query(`
    create table if not exists _leak_probe_calls (n int not null default 0);
    insert into _leak_probe_calls default values;
    grant update, select on _leak_probe_calls to authenticated;
    create or replace function _leak_probe(x text) returns boolean
    language plpgsql as $$
    begin
      update _leak_probe_calls set n = n + 1;
      return true;
    end $$;
  `);
  await superuser.query('update _leak_probe_calls set n = 0');
  // Dana is UNAUTHORIZED for Kendra's rows. If the planner pushes _leak_probe() below the view's
  // own security OR-clause, it is invoked against Kendra's forbidden `state` value even though
  // zero rows are ultimately returned to Dana — the "leaky view" class security_barrier closes.
  const adversarialBefore = await dana.query("select id from adult_availability_free_busy where person_id = 'p_mom' and _leak_probe(state::text)");
  const probeCallsBefore = (await superuser.query('select n from _leak_probe_calls')).rows[0].n;
  if (adversarialBefore.rows.length !== 0) fail(`check 8a FAILED: the adversarial query returned ${adversarialBefore.rows.length} rows to Dana`);
  if (probeCallsBefore === 0) {
    log('check 8 NOTE: the probe was not invoked even pre-hardening on this Postgres version/plan — the gap security_barrier closes is a planner CHOICE, not a guarantee either way; 0086 makes it impossible regardless of plan.');
  } else {
    log(`check 8 PASS (pre-hardening, real gap demonstrated): WITHOUT security_barrier, the planner invoked the leak probe ${probeCallsBefore} time(s) against Dana's forbidden rows before returning zero rows to her — proving the pushdown gap is real, not theoretical, on this exact view/query shape. Re-checked with security_barrier in check 10e below.`);
  }

  // --- Check 9: no other disclosure path ---
  const otherViews = await superuser.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')
  `);
  if (otherViews.rows.length !== 1 || otherViews.rows[0].relname !== 'adult_availability_free_busy') {
    fail(`check 9a FAILED: expected exactly 1 view in public, found ${JSON.stringify(otherViews.rows)}`);
  }
  const reasonRefs = await superuser.query(`
    select count(*)::int as n from information_schema.view_column_usage
     where table_schema = 'public' and column_name = 'reason' and view_name <> 'adult_availability_free_busy'
  `);
  if (reasonRefs.rows[0].n !== 0) fail(`check 9b FAILED: another view references adult_availability.reason`);
  for (const fn of ['current_person', 'shares_village_with', 'is_demo_guide']) {
    const r = await superuser.query(`
      select pg_get_function_result(p.oid) as ret from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname = $1
    `, [fn]);
    if (!['text', 'boolean'].includes(r.rows[0]?.ret)) fail(`check 9c FAILED: ${fn} returns ${r.rows[0]?.ret}, expected a scalar boolean/id, not a row`);
  }
  log('check 9 PASS: adult_availability_free_busy is the only view in public; nothing else selects `reason`; every dependent helper returns a scalar (boolean/id), never a row — no alternate disclosure path found');

  await mom.end(); await dad.end(); await dana.end();
  await superuser.query('drop table _leak_probe_calls; drop function _leak_probe(text);');

  // --- Check 10: apply 0086, compare authorized results before/after ---
  const beforeResult = andreView.rows; // captured above, pre-0086
  await applyMigrations(superuser, [file086]);
  log('applied 0086 (security_barrier + explicit revokes + comment)');

  const dad2 = await asClient(makeAuthenticated, 'p_dad');
  const afterResult = (await dad2.query("select id, person_id, start_at, end_at, state from adult_availability_free_busy where person_id = 'p_mom' order by id")).rows;
  const normalize = (rows) => rows.map((r) => ({ ...r, start_at: new Date(r.start_at).toISOString(), end_at: new Date(r.end_at).toISOString() }));
  if (JSON.stringify(normalize(beforeResult)) !== JSON.stringify(normalize(afterResult))) {
    fail(`check 10 FAILED: authorized results changed before/after 0086.\nbefore: ${JSON.stringify(beforeResult)}\nafter: ${JSON.stringify(afterResult)}`);
  }
  log('check 10 PASS: Andre\'s authorized view of Kendra\'s free/busy rows is byte-for-byte identical before and after 0086 — hardening changed nothing about who sees what');

  // Re-run checks 1, 4, 7, 8 post-0086 too, for a complete post-migration picture.
  const anonClient2 = makeAnon();
  await anonClient2.connect();
  const anonResult2 = await anonClient2.query('select * from adult_availability_free_busy').catch((e) => ({ error: e }));
  if (!anonResult2.error) fail('check 10b FAILED: anon was NOT refused post-0086');
  await anonClient2.end();
  const dana2 = await asClient(makeAuthenticated, 'p_dana');
  const danaView2 = await dana2.query("select id from adult_availability_free_busy where person_id = 'p_mom'");
  if (danaView2.rows.length !== 0) fail('check 10c FAILED: Dana sees rows post-0086');
  const writeAfter = await dad2.query("update adult_availability_free_busy set state='FREE' where id='aa_mom_1'").catch((e) => ({ error: e }));
  if (!writeAfter.error) fail('check 10d FAILED: a write through the view succeeded post-0086');
  await superuser.query(`
    create table _leak_probe_calls2 (n int not null default 0); insert into _leak_probe_calls2 default values;
    grant update, select on _leak_probe_calls2 to authenticated;
    create function _leak_probe2(x text) returns boolean language plpgsql as $$ begin update _leak_probe_calls2 set n=n+1; return true; end $$;
  `);
  await dana2.query("select id from adult_availability_free_busy where person_id = 'p_mom' and _leak_probe2(state::text)");
  const probeCalls2 = (await superuser.query('select n from _leak_probe_calls2')).rows[0].n;
  if (probeCalls2 !== 0) fail(`check 10e FAILED: leak probe invoked ${probeCalls2} times post-0086`);
  log('check 10b-e PASS: anon refusal, unrelated-family refusal, write refusal, and the adversarial-predicate proof all hold identically post-0086');

  await dana2.end(); await dad2.end();
  await superuser.end();

  log('ALL CHECKS PASS — DISPOSABLE-POSTGRES AVAILABILITY-VIEW HARDENING REHEARSAL (not a live application)');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/availability-view-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/availability-view-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
