// Disposable PostgreSQL only. No machine environment or shared database connection is read.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { createCastV2 } from '../src/fixtures-cast-v2.ts';
export async function insertRows(client, table, rows) {
 for (const row of rows) {
  const columns=Object.keys(row).map(c=>'"'+c+'"').join(',');
  await client.query(`insert into ${table} (${columns}) select ${columns} from json_populate_record(null::${table},$1::json) on conflict do nothing`,[JSON.stringify(row)]);
 }
}
export async function guideDatabase({before=false,beforeShowcase=false}={}) {
  const name = `fg-guide-${randomUUID().slice(0, 8)}`;
  const command = args => {
    const result = spawnSync('docker', args, { encoding: 'utf8' });
    if (result.status) throw Error(result.stderr);
    return result.stdout.trim();
  };
  command(['run', '-d', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const port = Number(command(['port', name, '5432/tcp']).split(':').at(-1));
  const options = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres' };
  const admin = new pg.Client(options);
  const close = async () => { await admin.end().catch(() => {}); command(['rm', '-f', name]); };
  try {
    for (let i = 0; ; i++) {
      const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
      if (ready.status === 0) break;
      if (i > 30) throw Error('Disposable database did not start');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await admin.connect();
    await admin.query(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create extension if not exists pgcrypto;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(auth.jwt()->>'sub','')::uuid
      $$;
      grant usage on schema auth to authenticated, anon;
    `);
    const files = readdirSync('supabase/migrations').filter(f => /^\d+.*\.sql$/.test(f)).sort();
    for (const file of files) {
      if(before&&file.startsWith('0098'))continue;
      if(beforeShowcase&&/^(0100|0101)/.test(file))continue;
      if (file.startsWith('0040')) {
        for(const [table,rows] of Object.entries(createCastV2())) await insertRows(admin,table,rows);
      }
      try { await admin.query(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
      catch (error) { throw Error(`${file}: ${error.message}`); }
    }
    return { admin, options, close };
  } catch (error) { await close(); throw error; }
}
if (process.argv[1]?.endsWith('/guide-database.mjs')) {
  const db = await guideDatabase();
  console.log('All migrations applied to disposable PostgreSQL');
  await db.close();
}
