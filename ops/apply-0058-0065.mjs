#!/usr/bin/env node
/**
 * Apply 0058 → 0065 to the project database. One transaction per file, in dependency order.
 *
 * Deliberately narrow: it applies exactly the village slice and refuses to guess about everything
 * else. Teacher migrations 0070–0072 are NOT here — they are already applied and are probed, not
 * replayed. Each file is read from disk, so this must run from the checkout whose SHA is being
 * deployed; the caller records that SHA in the receipt.
 *
 * Usage: SUPABASE_DB_URL from .env, or APPLY_DB_URL.
 * Exit: 0 all applied/probed · 1 any failure (stops at the first one).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const PLAN = [
  '0058_place_route_geometry.sql',
  '0059_road_distance_ride_cost.sql',
  '0060_rank_uses_road_distance.sql',
  '0061_event_place_linkage.sql',
  '0062_place_coordinates_and_event_links.sql',
  '0063_authorized_road_result_store.sql',
  '0064_ride_miles_double_precision.sql',
  '0065_price_leg_in_pickup_direction.sql',
];

const envUrl = (() => {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
    return line ? line.slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '') : null;
  } catch { return null; }
})();
const url = process.env.APPLY_DB_URL ?? envUrl;
if (!url) { console.error('REFUSED: no database URL'); process.exit(2); }

const client = new pg.Client({ connectionString: url, application_name: 'fg-apply-village-slice' });
await client.connect();

let failed = 0;
for (const file of PLAN) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(`  APPLIED  ${file}`);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    failed += 1;
    console.log(`  FAILED   ${file} — ${e.code ?? ''} ${e.message}`);
    break;
  }
}

// Applied state, measured — not inferred from the fact that the file said APPLIED.
const probe = await client.query(
  `select
     exists(select 1 from pg_proc where proname='place_route_geometry_for') as geometry,
     exists(select 1 from pg_proc where proname='ride_miles_for') as ride_miles,
     exists(select 1 from pg_proc where proname='store_route_result_authorized') as store_auth,
     exists(select 1 from pg_proc where proname='reset_demo_places') as reset_places,
     exists(select 1 from pg_proc where proname='_rank_and_advance') as rank_advance`);
console.log('  PROBE', JSON.stringify(probe.rows[0]));
await client.end();
process.exit(failed ? 1 : 0);
