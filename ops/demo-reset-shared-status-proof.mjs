#!/usr/bin/env node
/**
 * Real-Postgres proof that `resetDemo()` (src/demo/reset.ts) — the actual canonical reset
 * transaction, not a hand-written imitation of its delete/reinsert logic — correctly restores
 * Andre's shared status and leaves everyone else's alone.
 *
 * Imports and calls the REAL `resetDemo` function against a disposable `postgres:16-alpine`
 * container (same methodology as `ops/shared-status-proof.mjs` and
 * `ops/confirm-add-villager-return-proof.mjs`), removed unconditionally even on failure.
 *
 * `resetDemo()` also calls five SQL functions and two family-reconciliation helpers this proof
 * does not exercise — they belong to unrelated subsystems (Orbit, decisions, school reports,
 * villager provenance, places, and Supabase Auth account cleanup) with their own migration
 * chains and their own tests elsewhere. Stubbed here as trivial no-ops so the REAL TypeScript
 * control flow of `resetDemo()` can run to completion and exercise the real shared_statuses
 * wiring — this proves that wiring, not those other subsystems. `SUPABASE_URL` /
 * `SUPABASE_SERVICE_ROLE_KEY` are deliberately left unset so the Auth Admin API paths in
 * src/demo/family.ts short-circuit to empty results rather than attempting a real network call.
 *
 * Checks:
 *   1. A stale, live-edited status for Andre (wrong text, already expired) is restored to the
 *      exact canonical seed shape, with a fresh (non-stale) expiry.
 *   2. An unrelated person's live-set status is completely untouched — same row, same values,
 *      same expiry — proving the reset is scoped to Andre's own fixture row, not a blanket wipe.
 *
 * Usage: node --import tsx ops/demo-reset-shared-status-proof.mjs
 * Requires: docker (already on PATH in this checkout's environment).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createCastV2 } from '../src/fixtures-cast-v2.ts';

const CONTAINER = `fg-demo-reset-proof-${randomUUID().slice(0, 8)}`;
const lines = [];
const log = (line) => { process.stdout.write(`${line}\n`); lines.push(line); };
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function stopContainer() {
  spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' });
}
async function waitForReady(makeClient, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const client = makeClient();
    try { await client.connect(); return client; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  fail('postgres container never became reachable');
}

// resetDemo() calls five SQL functions belonging to unrelated subsystems (places, decisions,
// school reports, villager provenance, Orbit) — rather than stub those out, apply the FULL real
// migration set so every one of them is the genuine function, exercising the genuine resetDemo()
// end to end. The one exception: 0040's own embedded seed INSERT references households
// (`h_emma`, `h_taylor`, …) that only exist once the APPLICATION-level Cast v2 seed has run —
// confirmed by applying every migration in order against a bare container: 76 of 77 succeed,
// only 0040 fails, on exactly that INSERT, and nothing later depends on what rolled back with it
// (`can_approve_swap`, 0040's only other statement, is independently defined by 0028 and 0041,
// both of which apply cleanly). This is the same class of gap the standalone proofs
// (`ops/confirm-add-villager-return-proof.mjs`, `ops/shared-status-proof.mjs`) avoid by using a
// curated subset instead — here, skipping one known file is enough to get the complete schema.
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
    try {
      await client.query(sql);
    } catch (e) {
      throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log(`applied ${files.length} of ${files.length + 1} migrations (every file except 0040, which needs the application-level Cast v2 seed to satisfy its own household FKs)`);
}

// src/demo/reset.ts's own client() hardcodes `ssl: { rejectUnauthorized: false }` — it always
// requests TLS, regardless of the connection string, so the disposable container needs a real
// (self-signed is fine) cert or the server rejects the SSL handshake outright. Generated fresh
// per run, in a private per-run temp dir, never committed or reused.
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
  log(`[demo-reset-shared-status-proof] container ${CONTAINER}`);
  const { key, crt } = generateSelfSignedCert();
  sh('docker', [
    'run', '-d', '--name', CONTAINER,
    '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres',
    '-v', `${crt}:/var/lib/postgresql/server.crt:ro`,
    '-v', `${key}:/var/lib/postgresql/server.key:ro`,
    '-P', 'postgres:16-alpine',
    '-c', 'ssl=on', '-c', 'ssl_cert_file=/var/lib/postgresql/server.crt', '-c', 'ssl_key_file=/var/lib/postgresql/server.key',
  ]);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  const port = Number(portLine.split(':').pop());
  log(`postgres (SSL-enabled) listening on 127.0.0.1:${port}`);

  const client = await waitForReady(() => new pg.Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false },
  }));
  log('connected');

  await stubAuth(client);
  await applyMigrations(client);

  // resetDemo() is a RESET, not an initial seed: its own step 3 restores Cast v2 (upsert, after
  // step 2), which means it assumes Cast v2 is ALREADY present from a prior seed — exactly what a
  // repeat call on a live, already-seeded database sees. A truly empty database fails here with a
  // real FK error (`coordination_jobs_child_id_fkey`, confirmed live), because the simulated
  // fixtures resetDemo() restores in step 2 reference Cast v2 children step 3 hasn't inserted
  // yet. Pre-seeding Cast v2 directly (the REAL `createCastV2()` data, not an imitation of it —
  // just inserted via raw SQL here since no PostgREST is running in this disposable container)
  // reproduces that precondition honestly, matching what `resetDemo()` actually requires in
  // production rather than fabricating an unrealistic empty-database scenario.
  const cast = createCastV2();
  const CAST_ORDER = ['villages', 'people', 'children', 'households', 'household_members', 'relationships', 'contact_methods', 'grants', 'routines', 'events', 'care_facts'];
  for (const table of CAST_ORDER) {
    const rows = cast[table] ?? [];
    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const values = cols.map((k) => row[k]);
      await client.query(`insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict do nothing`, values);
    }
  }
  log(`pre-seeded Cast v2 (${CAST_ORDER.map((t) => `${t}=${(cast[t] ?? []).length}`).join(', ')}), simulating an already-seeded database`);

  // Andre (p_dad) is already part of 0002's baseline seed, now applied — no need to insert him.
  // Priya (p_priya) stands in as the "unrelated person" whose status must survive untouched.

  // A stale, live-edited status for Andre: wrong text, already expired — exactly what a browser
  // session could have left behind before a reset.
  await client.query(
    `insert into shared_statuses (person_id, emoji, text, eta_text, set_at, expires_at)
     values ('p_dad', '😴', 'A stale live-edited status', null, now() - interval '2 hours', now() - interval '1 hour')`,
  );

  // An unrelated person's live-set status — resetDemo() must never touch this.
  const unrelatedExpiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  await client.query(
    `insert into shared_statuses (person_id, emoji, text, eta_text, set_at, expires_at)
     values ('p_priya', '☕', 'Getting coffee', null, now(), $1)`,
    [unrelatedExpiresAt],
  );
  await client.end();

  // resetDemo() opens its OWN connection via SUPABASE_DB_URL — point it at this same container.
  process.env.SUPABASE_DB_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { resetDemo } = await import('../src/demo/reset.ts');
  const report = await resetDemo('demo-reset-shared-status-proof');
  log(`resetDemo() completed: restored=${JSON.stringify(report.restored)} cleared=${JSON.stringify(report.cleared)}`);

  const verify = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', ssl: { rejectUnauthorized: false } });
  await verify.connect();

  // --- Check 1: Andre's stale status was restored to the exact canonical shape ---
  const andre = await verify.query("select * from shared_statuses where person_id = 'p_dad'");
  if (andre.rows.length !== 1) fail(`check 1 FAILED: expected exactly one row for p_dad, got ${andre.rows.length}`);
  const row = andre.rows[0];
  if (row.text !== 'Changing a diaper' || row.emoji !== '🍼' || row.eta_text !== 'unknown') {
    fail(`check 1 FAILED: Andre's status was not restored to the canonical shape: ${JSON.stringify(row)}`);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    fail('check 1 FAILED: restored status has a stale (already-expired) expiry');
  }
  log("check 1 PASS: resetDemo() restored Andre's stale, expired, wrong-text status to the exact canonical shape with a fresh expiry");

  // --- Check 2: the unrelated person's status is completely untouched ---
  const other = await verify.query("select * from shared_statuses where person_id = 'p_priya'");
  if (other.rows.length !== 1) fail(`check 2 FAILED: expected exactly one row for p_priya, got ${other.rows.length}`);
  const otherRow = other.rows[0];
  if (otherRow.text !== 'Getting coffee' || otherRow.emoji !== '☕' || otherRow.expires_at.toISOString() !== unrelatedExpiresAt) {
    fail(`check 2 FAILED: an unrelated person's status was altered by resetDemo(): ${JSON.stringify(otherRow)}`);
  }
  log("check 2 PASS: resetDemo() left the unrelated person's live-set status completely untouched");

  await verify.end();
  log('ALL CHECKS PASS');
}

mkdirSync('.runs', { recursive: true });
try {
  await main();
  writeFileSync('.runs/demo-reset-shared-status-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(0);
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  writeFileSync('.runs/demo-reset-shared-status-proof.log', lines.join('\n') + '\n');
  stopContainer();
  process.exit(1);
}
