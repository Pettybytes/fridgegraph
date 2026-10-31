#!/usr/bin/env node
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0033_orbit_hash_photo_helpers.sql', 'utf8'));
console.log('0033 applied');
console.log('orbit_photos rls:', (await c.query(`select relrowsecurity v from pg_class where relname='orbit_photos'`)).rows[0].v);
console.log('_orbit_is_active gone:', (await c.query(`select count(*)::int v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_orbit_is_active'`)).rows[0].v === 0);
const h = (await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_orbit_message_hash'`)).rows[0].d;
console.log('hash uses sha256:', h.includes("'sha256'"));
console.log('hash binds resolved audience:', h.includes('orbit_audience_for'));
await c.end();
