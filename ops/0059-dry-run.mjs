#!/usr/bin/env node
/**
 * 0059 + 0060 dry run — applies both bodies inside ONE transaction and rolls back.
 *
 * Scope stated honestly: this proves the new store, the freshness/ snapshot rules, the basis strings
 * and that `_rank_and_advance` was replaced with a body that calls `ride_miles_for`. It does NOT
 * re-prove the whole ranking pipeline (jobs, discovery, approvals) — that needs the live scenario.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const url = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')).slice('SUPABASE_DB_URL='.length).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

/** Strip the file's own begin/commit so it can run inside this transaction. */
const body = (file) =>
  readFileSync(file, 'utf8')
    .replace(/^\s*begin\s*;/i, '')
    .replace(/commit\s*;\s*$/i, '');

await c.query('begin');
try {
  await c.query(body('supabase/migrations/0059_road_distance_ride_cost.sql'));
  await c.query(body('supabase/migrations/0060_rank_uses_road_distance.sql'));

  const t = await c.query(`select to_regclass('public.place_route_results') is not null as t`);
  check('the road-result store exists', t.rows[0].t);
  const f = await c.query(`select count(*)::int n from pg_proc where proname in ('route_distance_miles','ride_miles_for','road_result_max_age')`);
  check('both helpers exist', f.rows[0].n === 3, `found=${f.rows[0].n}`);

  // A PUBLIC grant is an ACL entry whose grantee is EMPTY (``=X/owner``). ``authenticated=X/owner``
  // is a grant to authenticated, not to PUBLIC — matching ``=X`` anywhere false-positives on it.
  const aclRows = (await c.query(`select proname, proacl::text a from pg_proc
    where proname in ('route_distance_miles','ride_miles_for')`)).rows;
  const publicEntries = aclRows.flatMap((r) =>
    (r.a ?? '').replace(/^\{|\}$/g, '').split(',').filter((e) => e.startsWith('=')));
  check('helpers grant no PUBLIC execute', publicEntries.length === 0,
    publicEntries.length ? publicEntries.join(' ') : aclRows.map((r) => `${r.proname}:${r.a}`).join(' | '));

  // A fresh result, keyed by the exact snapshot.
  await c.query(`insert into public.place_route_results
    (id, profile, from_place_id, to_place_id, from_lat, from_lng, to_lat, to_lng, distance_meters, duration_seconds)
    values ('pr_test', 'driving-car', 'pl_school', 'pl_home', 42.360000, -71.060000, 42.370000, -71.070000, 8000, 600)`);

  const road = await c.query(`select public.route_distance_miles(42.36, -71.06, 42.37, -71.07, 'driving-car') as m`);
  check('a fresh stored result is returned', Math.abs(Number(road.rows[0].m) - 8000 / 1609.344) < 1e-6, String(road.rows[0].m));

  const other = await c.query(`select public.route_distance_miles(42.36, -71.06, 42.37, -71.07, 'foot-walking') as m`);
  check('a different profile misses the store', other.rows[0].m === null, String(other.rows[0].m));

  const moved = await c.query(`select public.route_distance_miles(42.36, -71.06, 42.371, -71.07, 'driving-car') as m`);
  check('a changed coordinate snapshot misses the store', moved.rows[0].m === null, String(moved.rows[0].m));

  const basisRoad = await c.query(`select miles, basis from public.ride_miles_for(42.36, -71.06, 42.37, -71.07)`);
  check('the basis says ROAD when a stored result is used',
    basisRoad.rows[0].basis.includes('stored road distance') && Math.abs(Number(basisRoad.rows[0].miles) - 8000 / 1609.344) < 1e-6,
    basisRoad.rows[0].basis);

  // Age it past the declared rule and re-ask.
  await c.query(`update public.place_route_results set computed_at = now() - interval '31 days' where id='pr_test'`);
  const stale = await c.query(`select public.route_distance_miles(42.36, -71.06, 42.37, -71.07, 'driving-car') as m`);
  check('a result older than the declared 30-day rule is not used', stale.rows[0].m === null, String(stale.rows[0].m));

  const basisHav = await c.query(`select miles, basis from public.ride_miles_for(42.36, -71.06, 42.37, -71.07)`);
  check('with no usable result the basis SAYS haversine, not road',
    basisHav.rows[0].basis.includes('haversine') && basisHav.rows[0].miles !== null, basisHav.rows[0].basis);

  // The WRITER must actually replace, or freshness is fiction.
  await c.query(`select public.store_route_result('driving-car','pl_school','pl_home',
      42.36, -71.06, 42.37, -71.07, 9000, 700)`);
  const rewritten = await c.query(`select distance_meters, computed_at > now() - interval '1 minute' as fresh
    from public.place_route_results where profile='driving-car' and round(from_lat,6)=42.360000`);
  check('the writer upserts: one row, new distance, fresh timestamp',
    rewritten.rowCount === 1 && Number(rewritten.rows[0].distance_meters) === 9000 && rewritten.rows[0].fresh,
    JSON.stringify(rewritten.rows[0]));
  const after = await c.query(`select public.route_distance_miles(42.36, -71.06, 42.37, -71.07, 'driving-car') as m`);
  check('a re-measured result is readable again (freshness restored)', Math.abs(Number(after.rows[0].m) - 9000/1609.344) < 1e-6, String(after.rows[0].m));

  const def = (await c.query(`select pg_get_functiondef(oid) d from pg_proc where proname='_rank_and_advance'`)).rows[0].d;
  check('_rank_and_advance now prices from ride_miles_for', def.includes('ride_miles_for'));
  check('_rank_and_advance stores the computed basis rather than a literal',
    def.includes('cost_basis = v_alt_basis'));
  check('driver ranking still uses haversine (unchanged on purpose)',
    /haversine_miles/.test(def));
} catch (e) {
  failed += 1;
  console.log('  FAIL  dry run threw —', e.message);
} finally {
  await c.query('rollback');
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${failed} failing check(s); everything rolled back`);
  await c.end();
}
process.exit(failed === 0 ? 0 : 1);
