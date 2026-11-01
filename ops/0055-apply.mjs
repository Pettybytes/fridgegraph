#!/usr/bin/env node
// Apply 0055 (post-close redaction). Window-only: see ops/0055-revert.mjs for why.
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const row = env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL='));
const url = row.slice(row.indexOf('=') + 1).replace(/["'\s\r]/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(readFileSync('supabase/migrations/0055_orbit_post_close_redaction.sql', 'utf8'));
console.log('0055 applied');
const t = await c.query(`select count(*)::int n from information_schema.role_table_grants
  where table_name='orbit_alerts' and grantee='authenticated' and privilege_type='SELECT'`);
console.log('table-level SELECT for authenticated (expect 0):', t.rows[0].n);
const cols = await c.query(`select column_name from information_schema.column_privileges
  where table_name='orbit_alerts' and grantee='authenticated' and privilege_type='SELECT'
    and column_name in ('wear_color','minimal_message','photo_id','last_seen_at')`);
console.log('sensitive column grants left (expect 0):', cols.rows.length);
await c.end();
