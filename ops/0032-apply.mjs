#!/usr/bin/env node
/** Applies 0032 (Orbit minimal slice). Forward-only. */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0032_orbit_minimal.sql', 'utf8'));
console.log('0032 applied');
for (const t of ['orbit_alerts', 'orbit_audience_members', 'orbit_responses']) {
  const rls = (await c.query(`select relrowsecurity from pg_class where relname=$1`, [t])).rows[0];
  const n = (await c.query(`select count(*)::int v from pg_policies where tablename=$1`, [t])).rows[0].v;
  console.log(`${t}: rls=${rls?.relrowsecurity} policies=${n}`);
}
for (const fn of ['draft_orbit_share', 'preview_orbit_share', 'activate_orbit_alert', 'respond_to_orbit_alert', 'close_orbit_alert']) {
  const v = (await c.query(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rows[0]?.v;
  console.log(`${fn}: authenticated EXECUTE=${v}`);
}
const cols = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name like 'orbit_%'`)).rows.map((r) => r.column_name);
console.log('location-shaped columns:', cols.filter((c2) => /location|lat|lng|coord|address|geo/i.test(c2)).join(',') || 'none');
await c.end();
