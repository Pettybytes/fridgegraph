#!/usr/bin/env node
/**
 * Migration batch dry run — 0058 → 0059 → 0060 → 0061, in dependency order, one connection,
 * one explicit transaction, forced ROLLBACK on success or failure.
 *
 * TWO MODES, and the isolated one stays the default.
 *
 *   isolated (default)
 *     DRY_RUN_DB_URL=postgres://… node ops/migration-batch-dry-run.mjs
 *     Refuses if the URL is absent, or if it equals the project database. Nothing about this
 *     changes the earlier failure: a rehearsal against live data is not a dry run.
 *
 *   shared (authorized, window-only)
 *     node ops/migration-batch-dry-run.mjs --shared-db --window=<WINDOW_ID>
 *     Bryan authorized this on 2026-11-01, but ONLY inside a reserved shared-stack window, and the
 *     window id is mandatory. `--shared-db` without `--window` refuses; `--window` without
 *     `--shared-db` refuses. The mode is never selected by accident and the isolation guard is never
 *     removed — it is the fallback whenever a window is not asserted.
 *
 * WHAT IS RECORDED: the target database identity (host and database name only, never user or
 * password) and the ACTUAL test context, so nobody can later mistake a shared rehearsal for an
 * isolated one. This matters because the earlier 0059/0060 dry run used the project database with no
 * window — that admission stays in HANDOFF, and it is why this mode exists.
 *
 * The apply is not part of this script. A failed dry run stops the apply because the operator runs
 * this first and reads the exit code; `--apply` is deliberately absent.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const ORDER = [
  'supabase/migrations/0058_place_route_geometry.sql',
  'supabase/migrations/0059_road_distance_ride_cost.sql',
  'supabase/migrations/0060_rank_uses_road_distance.sql',
  'supabase/migrations/0061_event_place_linkage.sql',
];

const args = process.argv.slice(2);
const shared = args.includes('--shared-db');
const windowId = (args.find((a) => a.startsWith('--window=')) ?? '').split('=')[1] ?? '';

const envUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();

/** Host + database only. Never the user, never the password, never the full URL. */
function identity(url) {
  try {
    const u = new URL(url);
    const db = (u.pathname || '/').replace(/^\//, '') || '(default)';
    return `${u.host}/${db}`;
  } catch { return '(unparseable — not printed)'; }
}

let target;
let context;
if (shared) {
  if (!windowId) {
    console.error('REFUSED: --shared-db requires --window=<WINDOW_ID>. A shared-database rehearsal without a reserved window is exactly what this guard exists to prevent.');
    process.exit(2);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,60}$/.test(windowId)) {
    console.error(`REFUSED: --window=${windowId} is not a plausible window id.`);
    process.exit(2);
  }
  if (!envUrl) {
    console.error('REFUSED: --shared-db needs a project database URL in .env; none found.');
    process.exit(2);
  }
  target = envUrl;
  context = `shared-window:${windowId}`;
} else {
  if (windowId) {
    console.error('REFUSED: --window requires --shared-db. Use the isolated mode, or assert both.');
    process.exit(2);
  }
  target = process.env.DRY_RUN_DB_URL;
  if (!target) {
    console.error('REFUSED: DRY_RUN_DB_URL is not set. This dry run requires an isolated disposable database.');
    process.exit(2);
  }
  if (envUrl && target.replace(/\s/g, '') === envUrl) {
    console.error('REFUSED: DRY_RUN_DB_URL points at the project database. Use --shared-db --window=<id> inside a reserved window instead.');
    process.exit(2);
  }
  context = 'isolated';
}

console.log(`mode: ${context}`);
console.log(`target database: ${identity(target)} (credentials never printed)`);

const strip = (file) =>
  readFileSync(file, 'utf8').replace(/^\s*begin\s*;/i, '').replace(/commit\s*;\s*$/i, '');

const c = new pg.Client({
  connectionString: target,
  ssl: /localhost|127\.0\.0\.1/.test(target) ? undefined : { rejectUnauthorized: false },
});

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

await c.connect();
await c.query('begin');
let threw = null;
try {
  for (const file of ORDER) {
    await c.query(strip(file));
    console.log(`  applied in-transaction: ${file.split('/').pop()}`);
  }
  const objs = await c.query(`
    select to_regclass('public.place_route_results') is not null as store,
           (select count(*) from pg_proc where proname in
             ('place_route_geometry_for','route_distance_miles','ride_miles_for','store_route_result',
              'event_day_places','_event_place_in_family'))::int as fns,
           (select count(*) from information_schema.columns
             where table_name='events' and column_name='place_id')::int as ev_place`);
  check('the batch produced its objects', objs.rows[0].store && objs.rows[0].fns >= 5 && objs.rows[0].ev_place === 1,
    JSON.stringify(objs.rows[0]));
} catch (e) {
  threw = e;
  check('the batch applied without error', false, e.message);
} finally {
  await c.query('rollback');
}

// The rollback must be verified, not assumed — and this is the check that gates the apply.
const after = await c.query(`
  select to_regclass('public.place_route_results') is not null as store,
         (select count(*) from pg_proc where proname in
           ('route_distance_miles','ride_miles_for','store_route_result','event_day_places'))::int as fns,
         (select count(*) from information_schema.columns
           where table_name='events' and column_name='place_id')::int as ev_place`);
check('ROLLBACK verified: nothing from the batch persisted',
  !after.rows[0].store && after.rows[0].fns === 0 && after.rows[0].ev_place === 0,
  JSON.stringify(after.rows[0]));

await c.end();
console.log(`\n${failed === 0 && !threw ? 'PASS' : 'FAIL'} — mode ${context}, ${failed} failing check(s)`);
process.exit(failed === 0 && !threw ? 0 : 1);
