import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const url = (env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')) ?? '').split('=').slice(1).join('=').replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const sub = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const own = (await c.query(`select id, label from recorded_places where household_id='h_a' limit 1`)).rows[0];
const other = (await c.query(`select id, label from recorded_places where household_id='h_malik' limit 1`)).rows[0];
await c.query(`update recorded_places set latitude=42.331400, longitude=-83.045800 where id=$1`, [own.id]);
console.log('coordinates set on:', own.label, '| cross-family control:', other.label);
let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
await c.query('begin');
for (const [pid, label] of [['p_mom', 'Kendra'], ['p_dad', 'Andre'], ['p_priya', 'Priya'], ['p_gma', 'Loretta'], ['p_dana', 'Dana']]) {
  await c.query('reset role'); await c.query('set local role authenticated');
  await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: sub(pid), role: 'authenticated', app_metadata: { demo: 'true' } })]);
  const a = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [own.id])).rows[0] ?? null;
  const b = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [other.id])).rows;
  const locates = a?.latitude != null;
  const expectLocate = pid === 'p_mom' || pid === 'p_dad';
  check(`${label}: own-family row ${a ? 'visible' : 'none'}, coordinates ${locates ? 'SHOWN' : 'withheld'}`,
    (expectLocate ? locates : true) && b.length === 0,
    `lat=${a?.latitude ?? 'null'}; cross-family rows=${b.length}`);
}
await c.query('rollback');
await c.query('reset role');
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} failing`);
await c.end();
