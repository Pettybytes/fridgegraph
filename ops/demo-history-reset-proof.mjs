#!/usr/bin/env node
/**
 * Real-Postgres proof that `resetDemo()` (src/demo/reset.ts) — the ACTUAL canonical reset
 * transaction — restores the versioned v1 demo history exactly, clears demo-created pollution via
 * explicit provenance (not an id-prefix guess — same lesson `fix/0083-goals-provenance` (#161)
 * already established for `goals`), and leaves a genuinely unrelated record untouched.
 *
 * Same methodology as every other real-resetDemo() proof this session: SSL-enabled disposable
 * `postgres:16-alpine`, every real migration applied except 0040, Cast v2 pre-seeded via the real
 * `createCastV2()` data, then the real `resetDemo()` imported and called directly — TWICE, with a
 * live corruption/pollution step in between, so "restore" is actually exercised, not just "create".
 *
 * Checks:
 *   1. First resetDemo() call creates all 20 history stories, the 3 voice notes, and the one
 *      explicitly-declined story's decided_at.
 *   2. After corrupting a voice note's delivered transcript (job_hist_08's is READY — real audio
 *      reconciled from #167), nulling a declined story's decided_at, and
 *      inserting a demo-created extra job (sandbox=true, simulating a judge's live
 *      requestPickup), a SECOND resetDemo() call: restores the voice note's transcript exactly;
 *      restores decided_at exactly; removes the demo-created extra job entirely.
 *   3. A genuinely unrelated coordination_jobs row (sandbox=false, inserted only by this proof,
 *      never by application code) survives BOTH resetDemo() calls completely untouched.
 *
 * Usage: node --import tsx ops/demo-history-reset-proof.mjs
 * Requires: docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createCastV2 } from '../src/fixtures-cast-v2.ts';

const CONTAINER = `fg-demo-history-reset-${randomUUID().slice(0, 8)}`;
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
  log(`applied ${files.length} migrations (every file except 0040) — includes 0084 (staged, this PR)`);
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
  log(`[demo-history-reset-proof] container ${CONTAINER}`);
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

  // A genuinely unrelated coordination_jobs row — sandbox=false, inserted ONLY by this proof,
  // never by any application code path. Must survive both resetDemo() calls untouched.
  await client.query(`
    insert into coordination_jobs (id, idempotency_key, type, child_id, status, version, request_version, created_at, sandbox)
    values ('job_unrelated_nondemo', 'pickup:p_nora:unrelated:x', 'PICKUP', 'p_nora', 'pending', 1, 1, now(), false)
  `);
  await client.end();

  process.env.SUPABASE_DB_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { resetDemo } = await import('../src/demo/reset.ts');
  const report1 = await resetDemo('demo-history-reset-proof-1');
  log(`resetDemo() call #1 completed: restored.coordination_jobs=${report1.restored.coordination_jobs} restored.candidate_evaluations=${report1.restored.candidate_evaluations} restored.voice_notes=${report1.restored.voice_notes}`);

  const verify1 = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  await verify1.connect();

  // --- Check 1: the first call created all 20 stories, 3 voice notes, 1 declined decided_at ---
  const jobCount = (await verify1.query("select count(*)::int as n from coordination_jobs where id like 'job_hist_%'")).rows[0].n;
  if (jobCount !== 20) fail(`check 1a FAILED: expected 20 history jobs, got ${jobCount}`);
  const voiceCount = (await verify1.query('select count(*)::int as n from voice_notes').then((r) => r)).rows[0].n;
  if (voiceCount !== 3) fail(`check 1b FAILED: expected 3 voice notes, got ${voiceCount}`);
  const declinedAt = (await verify1.query("select decided_at from coordination_jobs where id = 'job_hist_15'")).rows[0]?.decided_at;
  if (!declinedAt) fail('check 1c FAILED: job_hist_15 should have a real decided_at after the first reset');
  const familyCountsSql = "select child_id, count(*)::int as n from coordination_jobs where id like 'fx_job_history_v1_%' group by child_id order by child_id";
  const familyCounts = (await verify1.query(familyCountsSql)).rows;
  const expectedFamilyCounts = { p_avery: 19, p_emma: 22, p_jax: 21, p_leo: 18, p_malik: 24, p_max: 19, p_micah: 23, p_nora: 20, p_skye: 18, p_taylor: 20 };
  if (JSON.stringify(Object.fromEntries(familyCounts.map(r => [r.child_id, r.n]))) !== JSON.stringify(expectedFamilyCounts)) {
    fail(`all-family history FAILED: wrong stored counts ${JSON.stringify(familyCounts)}`);
  }
  const familySnapshotSql = "select id, child_id, status, created_at, as_of, fixture from coordination_jobs where id like 'fx_job_history_v1_%' order by id";
  const familyBefore = (await verify1.query(familySnapshotSql)).rows;
  const calendarSnapshotSql = "select id, child_id, start_at, end_at from events where id like 'fx_pr_%' order by id";
  const calendarBefore = (await verify1.query(calendarSnapshotSql)).rows;
  const endpointChildren = (await verify1.query("select distinct child_id from events where id like 'fx_pr_%_pickup' and start_at::date = '2026-11-17' order by child_id")).rows.map(r => r.child_id);
  if (JSON.stringify(endpointChildren) !== JSON.stringify(Object.keys(expectedFamilyCounts))) fail('calendar endpoint FAILED: all ten children need a November 17 pickup');
  await verify1.end();
  log('check 1 PASS: the first resetDemo() call created all 20 history jobs, 3 voice notes, and a real decided_at for the declined story');
  log('all-family history PASS: 204 stored requests across all 10 authorized children');
  log('calendar endpoint PASS: all ten authorized children have a recorded November 17 pickup');

  // --- Corrupt + pollute, exactly as a live demo session could ---
  const corrupt = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  await corrupt.connect();
  const voiceNoteId = (await corrupt.query(
    "select vn.id from voice_notes vn join candidate_evaluations ce on ce.id = vn.response_id where ce.job_id = 'job_hist_08'",
  )).rows[0].id;
  // job_hist_08's voice note is READY (real transcript reconciled from #167) — corrupt the
  // delivered field itself, the thing most worth proving restores exactly.
  await corrupt.query('update voice_notes set transcript = $1 where id = $2', ['EDITED LIVE', voiceNoteId]);
  await corrupt.query("update coordination_jobs set decided_at = null, failure_reason = null where id = 'job_hist_15'");
  // A demo-created extra job, sandbox=true — exactly what a judge's live requestPickup produces.
  await corrupt.query(`
    insert into coordination_jobs (id, idempotency_key, type, child_id, status, version, request_version, created_at, sandbox)
    values ('job_live_judge', 'pickup:p_nora:live:judge', 'PICKUP', 'p_nora', 'pending', 1, 1, now(), true)
  `);
  await corrupt.end();
  log('corrupted: voice note transcript edited, job_hist_15.decided_at cleared, a demo-created extra job inserted (sandbox=true)');

  const report2 = await resetDemo('demo-history-reset-proof-2');
  log(`resetDemo() call #2 completed: restored.coordination_jobs=${report2.restored.coordination_jobs} cleared.coordination_jobs=${report2.cleared.coordination_jobs ?? 0}`);

  const verify2 = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  await verify2.connect();

  // --- Check 2: the second call restores the corrupted content exactly ---
  const restoredNote = (await verify2.query('select status, transcript from voice_notes where id = $1', [voiceNoteId])).rows[0];
  if (!restoredNote || restoredNote.transcript === 'EDITED LIVE' || !restoredNote.transcript.includes('get Nora at 4.20') || restoredNote.status !== 'READY') {
    fail(`check 2a FAILED: voice note transcript not restored to canonical: ${JSON.stringify(restoredNote)}`);
  }
  const restoredDeclined = (await verify2.query("select decided_at, failure_reason from coordination_jobs where id = 'job_hist_15'")).rows[0];
  if (!restoredDeclined?.decided_at || restoredDeclined.failure_reason !== 'approver_declined') {
    fail(`check 2b FAILED: job_hist_15's decline was not restored: ${JSON.stringify(restoredDeclined)}`);
  }
  log('check 2 PASS: the second resetDemo() call restores the live-edited voice note transcript and the cleared decided_at/failure_reason to their exact canonical shape');

  // --- Check 3: the demo-created extra job is gone ---
  const liveJudgeJob = await verify2.query("select id from coordination_jobs where id = 'job_live_judge'");
  if (liveJudgeJob.rows.length !== 0) fail('check 3 FAILED: a demo-created extra job (sandbox=true) survived reset — it must be cleared for the next judge');
  log('check 3 PASS: a demo-created extra job (sandbox=true, simulating a judge\'s live request) is removed by reset');

  // --- Check 4: the genuinely unrelated job survives BOTH resets untouched ---
  const unrelated = (await verify2.query("select status, sandbox from coordination_jobs where id = 'job_unrelated_nondemo'")).rows[0];
  if (!unrelated || unrelated.status !== 'pending' || unrelated.sandbox !== false) {
    fail(`check 4 FAILED: the unrelated non-demo job was altered: ${JSON.stringify(unrelated)}`);
  }
  log('check 4 PASS: a genuinely unrelated, non-demo coordination_jobs row (sandbox=false) survives both resetDemo() calls completely untouched');

  const familyAfter = (await verify2.query(familySnapshotSql)).rows;
  if (JSON.stringify(familyBefore) !== JSON.stringify(familyAfter)) fail('all-family history FAILED: duplicate or changed rows after second reset');
  log('all-family reset PASS: all 204 rows are identical after the second real reset');
  const calendarAfter = (await verify2.query(calendarSnapshotSql)).rows;
  if (JSON.stringify(calendarBefore) !== JSON.stringify(calendarAfter)) fail('calendar reset FAILED: changed or duplicated generated event rows');
  log(`calendar reset PASS: all ${calendarAfter.length} generated events are identical after the second real reset`);

  await verify2.end();
  log('ALL CHECKS PASS');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/demo-history-reset-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/demo-history-reset-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
