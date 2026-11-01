import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const url = (env.split('\n').find((l) => l.startsWith('SUPABASE_DB_URL=')) ?? '').split('=').slice(1).join('=').replace(/["'\s\r]/g, '');
const map = JSON.parse(readFileSync('data/identity-map.json', 'utf8'));
const sub = (pid) => Object.entries(map).find(([, p]) => p === pid)?.[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
let fail = 0;
const check = (l, ok, d = '') => { if (!ok) fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); };
const nora = (await c.query(`select id, label from recorded_places where household_id='h_a' limit 1`)).rows[0];
const malik = (await c.query(`select id, label from recorded_places where household_id='h_malik' limit 1`)).rows[0];
await c.query('begin');
try {
  const strip = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(begin|commit);\s*$/.test(l)).join('\n');
  await c.query(strip('supabase/migrations/0056_village_places_coordinates.sql'));
  await c.query(`update recorded_places set latitude=42.331400, longitude=-83.045800 where latitude is null`);
  const as = async (pid) => {
    await c.query('reset role'); await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: sub(pid), role: 'authenticated', app_metadata: { demo: 'true' } })]);
  };
  await as('p_mom');
  const momOwn = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [nora.id])).rows[0];
  const momOther = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [malik.id])).rows;
  check('Kendra (p_mom, parent) gets her own family place WITH coordinates', momOwn?.latitude != null, `lat=${momOwn?.latitude ?? 'null'} label=${momOwn?.label ?? 'none'}`);
  check('Kendra gets NO row for another family\'s place', momOther.length === 0, `rows=${momOther.length}`);
  await as('p_priya');
  const priOwn = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [nora.id])).rows[0];
  const priOther = (await c.query(`select * from place_geometry_for('p_nora',$1)`, [malik.id])).rows;
  check('Priya gets the place but NO coordinates (no address.read)', Boolean(priOwn) && priOwn.latitude == null, `label=${priOwn?.label ?? 'none'} lat=${priOwn?.latitude ?? 'null'}`);
  check('Priya gets NO row for another family\'s place', priOther.length === 0, `rows=${priOther.length}`);
  await as('p_dana');
  check('an unrelated caller gets nothing', (await c.query(`select * from place_geometry_for('p_nora',$1)`, [nora.id])).rows.length === 0);
  await c.query('rollback');
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${fail} failing`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { await c.query('rollback').catch(() => {}); console.error('DRY ERROR:', e.message); process.exit(1); } finally { await c.end(); }
