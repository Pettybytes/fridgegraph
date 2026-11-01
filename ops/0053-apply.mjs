#!/usr/bin/env node
/**
 * ops/0053-apply.mjs — apply 0053 (recorded places). Run ONLY inside a reserved window.
 *
 * Prints the facts a later reader needs: catalog size, seeded places, and the draft signature (a
 * changed argument list is how a caller silently stops passing the new field).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0053_orbit_recorded_places.sql', 'utf8'));
console.log('0053 applied');
console.log('catalog labels:', (await c.query('select count(*)::int n from recorded_place_catalog')).rows[0].n);
console.log('seeded places:', (await c.query('select count(*)::int n from recorded_places')).rows[0].n);
const sig = (await c.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='draft_orbit_share'`)).rows.map((r) => r.a);
console.log('draft_orbit_share signatures:', sig.join(' | '));
await c.end();
