#!/usr/bin/env node
// Apply 0059 + 0060. Window-only. See 0059-dry-run.mjs for what is and is not proven.
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const url = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')).slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const f of ['supabase/migrations/0059_road_distance_ride_cost.sql', 'supabase/migrations/0060_rank_uses_road_distance.sql']) {
  await c.query(readFileSync(f, 'utf8'));
  console.log(f.split('/').pop(), 'applied');
}
const t = await c.query(`select to_regclass('public.place_route_results') is not null as t`);
console.log('store present:', t.rows[0].t);
await c.end();
