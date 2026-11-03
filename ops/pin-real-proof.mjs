#!/usr/bin/env node
/**
 * DISPOSABLE-POSTGRES AUTHORIZATION PROOF for "Pin it to the fridge" made real (migration 0090,
 * STAGED — not applied anywhere). Mirrors ops/fridge-phase2-proof.mjs.
 *
 * Proves the real private-media + persistence authority the TS handlers rely on:
 *   1. register_pin_media: parent/guardian only; a caregiver, a resident adult, an unrelated parent,
 *      and anon are all refused.
 *   2. pin_media_access: a parent gets PARENT + path; a stranger / anon get the SAME empty answer as a
 *      missing id (no oracle).
 *   3. Persistence into fridge_notes via attachment_ref, then caller-scoped media retrieval:
 *      a fridge.read grant holder sees the media ONLY when the note is SHARED (PARENTS_ONLY stays
 *      hidden; a grant without SHARED, or SHARED without the grant, both stay hidden); another family,
 *      a caregiver without the grant, and anon are refused.
 *   4. Idempotency the confirm replay relies on: the same note id upserts once (on conflict do nothing).
 *   5. cleanup_expired_pin_media sweeps an unreferenced expired upload but never a pinned one.
 *
 * Disposable only: a throwaway postgres:16-alpine container, loopback-bound, removed unconditionally.
 * Never touches the shared/project database. Usage: node ops/pin-real-proof.mjs  (requires docker)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONTAINER = `fg-pin-real-${randomUUID().slice(0, 8)}`;
const log = (line) => process.stdout.write(`${line}\n`);
const fail = (msg) => { throw new Error(msg); };

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function stopContainer() { spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' }); }
async function waitForReady(makeClient, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const client = makeClient();
    try { await client.connect(); return client; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  fail('postgres container never became reachable');
}

const MIGRATIONS = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0003_rls.sql',
  'supabase/migrations/0004_grants.sql',
  'supabase/migrations/0006_local_today.sql',
  'supabase/migrations/0024_authority_model.sql',
  'supabase/migrations/0083_fridge_phase2.sql',
  'supabase/migrations/0090_pin_media.sql',
];

async function applyMigrations(client) {
  for (const path of MIGRATIONS) {
    try { await client.query(readFileSync(path, 'utf8')); }
    catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log(`applied ${MIGRATIONS.length} migrations: ${MIGRATIONS.map((p) => p.split('/').pop()).join(', ')}`);
}

async function stubAuth(client) {
  await client.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.current_uid', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.current_jwt', true),'')::jsonb,'{}'::jsonb) $$;
  `);
}

async function seedFixtures(client) {
  await client.query(`
    insert into villages (id, name) values ('v_nora','Nora''s village'), ('v_other','Other village');
    insert into people (id, display_name, birth_date) values
      ('p_nora','Nora Ellison','2018-03-14'),
      ('p_mom','Kendra Ellison','1988-05-02'),
      ('p_gma','Loretta Brooks','1960-01-01'),
      ('p_walt','Walt Brooks','1965-01-01'),
      ('p_priya','Priya Nair','2003-09-05'),
      ('p_stranger','A Stranger','1990-01-01'),
      ('p_other_mom','Other Mom','1985-01-01'),
      ('p_other_child','Other Child','2019-01-01');
    insert into children (person_id) values ('p_nora'), ('p_other_child');
    insert into households (id, village_id) values ('h_a','v_nora'), ('h_other','v_other');
    insert into household_members (person_id, household_id, role) values
      ('p_mom','h_a','parent'), ('p_gma','h_a','guardian'), ('p_walt','h_a','resident_adult'), ('p_nora','h_a','child'),
      ('p_other_mom','h_other','parent'), ('p_other_child','h_other','child');
  `);
}

const SHA = 'a'.repeat(64);

async function main() {
  log(`[pin-real-proof] container ${CONTAINER}`);
  sh('docker', ['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=postgres', '-p', '127.0.0.1::5432', 'postgres:16-alpine']);
  const portLine = sh('docker', ['port', CONTAINER, '5432/tcp']);
  if (!portLine.startsWith('127.0.0.1:')) fail(`container port is not loopback-bound: ${portLine}`);
  const port = Number(portLine.split(':').pop());
  log(`postgres listening on ${portLine} (loopback-bound)`);

  const su = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await stubAuth(su);
  await applyMigrations(su);
  await seedFixtures(su);

  const uid = {};
  for (const id of ['p_mom', 'p_gma', 'p_walt', 'p_priya', 'p_stranger', 'p_other_mom']) uid[id] = randomUUID();
  await su.query(`insert into identity_map (user_id, person_id) values ${Object.entries(uid).map(([id, u]) => `('${u}','${id}')`).join(',')}`);

  const client = await waitForReady(() => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' }));
  await client.query('set role authenticated');
  const as = async (id) => client.query('select set_config($1,$2,false)', ['test.current_uid', uid[id]]);
  const asAnon = async () => { await client.query('select set_config($1,$2,false)', ['test.current_uid', '']); await client.query('reset role'); await client.query('set role anon'); };
  const backToAuth = async () => { await client.query('reset role'); await client.query('set role authenticated'); };
  const q = (sql, p) => client.query(sql, p).then((r) => ({ rows: r.rows, error: null })).catch((e) => ({ rows: null, error: e }));
  const grant = async (actor, scope) => su.query("insert into grants (id, actor_id, child_id, scopes, granted_by) values ($1,$2,'p_nora',array[$3],'p_mom')", [`g_${randomUUID().slice(0, 8)}`, actor, scope]);

  const pass = (l) => log(`check PASS: ${l}`);

  // 1. register_pin_media — parent/guardian only.
  await as('p_mom');
  const reg = await q(`select register_pin_media('p_nora',$1,'image/png','pin-mom.png',100) id`, [SHA]);
  if (reg.error || !reg.rows[0].id) fail(`1a: parent register failed: ${reg.error?.message}`);
  const mediaId = reg.rows[0].id;
  pass('Kendra (parent) registers pin media');

  await as('p_gma');
  const regG = await q(`select register_pin_media('p_nora',$1,'image/png','pin-gma.png',100) id`, [SHA]);
  if (regG.error) fail(`1b: guardian register failed: ${regG.error.message}`);
  pass('Loretta (guardian) registers pin media');

  for (const [who, person] of [['caregiver Priya', 'p_priya'], ['resident Walt', 'p_walt'], ['unrelated parent', 'p_other_mom']]) {
    await as(person);
    const r = await q(`select register_pin_media('p_nora',$1,'image/png','x.png',100) id`, [SHA]);
    if (!r.error || !r.error.message.includes('UNAUTHORIZED')) fail(`1c: ${who} register should be UNAUTHORIZED, got ${r.error?.message ?? 'a row'}`);
  }
  pass('caregiver, resident adult and an unrelated parent are all refused register (UNAUTHORIZED)');

  await asAnon();
  const regAnon = await q(`select register_pin_media('p_nora',$1,'image/png','x.png',100) id`, [SHA]);
  if (!regAnon.error) fail('1d: anon register should fail');
  pass('anon register is refused');
  await backToAuth();

  // 2. pin_media_access — parent vs no-oracle.
  await as('p_mom');
  const accP = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accP.error || accP.rows[0].access !== 'PARENT' || !accP.rows[0].storage_path) fail(`2a: parent access wrong: ${JSON.stringify(accP)}`);
  pass('parent gets PARENT access + storage path');

  await as('p_stranger');
  const accS = await q(`select * from pin_media_access($1)`, [mediaId]);
  const missing = await q(`select * from pin_media_access('pm_does_not_exist')`);
  const emptyish = (r) => r.rows[0].access === null && r.rows[0].storage_path === null;
  if (accS.error || !emptyish(accS)) fail(`2b: stranger should get an empty answer: ${JSON.stringify(accS.rows)}`);
  if (!emptyish(missing)) fail('2c: a missing id should look identical to a refusal');
  pass('a stranger and a missing id both get the SAME empty answer (no oracle)');

  // 3. persist a pin (fridge_notes.attachment_ref) then caller-scoped retrieval.
  await as('p_mom');
  const note = await q(`insert into fridge_notes (id, child_id, author_id, text, audience, attachment_ref)
                        values ('fn_pin_1','p_nora',current_person(),'Nora drew our dog!','SHARED',$1) returning id`, [mediaId]);
  if (note.error) fail(`3a: parent pin insert failed: ${note.error.message}`);
  pass('Kendra pins: a SHARED fridge_note with attachment_ref → the media');

  // a fridge.read grant holder sees a SHARED note's media
  await grant('p_priya', 'fridge.read');
  await as('p_priya');
  const accShared = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accShared.error || accShared.rows[0].access !== 'SHARED') fail(`3b: fridge.read holder should get SHARED on a SHARED note: ${JSON.stringify(accShared.rows)}`);
  pass('a fridge.read grant holder retrieves the media of a SHARED note (SHARED)');

  // flip the note to PARENTS_ONLY → the same grant holder is now refused
  await as('p_mom');
  await q(`update fridge_notes set audience='PARENTS_ONLY' where id='fn_pin_1'`);
  await as('p_priya');
  const accPO = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accPO.error || accPO.rows[0].access !== null) fail(`3c: PARENTS_ONLY must hide the media from a grant holder: ${JSON.stringify(accPO.rows)}`);
  pass('flipping the note to PARENTS_ONLY immediately hides the media from the grant holder');

  // a caregiver WITHOUT the grant never sees it (re-share, revoke grant)
  await as('p_mom');
  await q(`update fridge_notes set audience='SHARED' where id='fn_pin_1'`);
  await su.query(`delete from grants where actor_id='p_priya'`);
  await as('p_priya');
  const accNoGrant = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accNoGrant.error || accNoGrant.rows[0].access !== null) fail(`3d: SHARED without a fridge.read grant must stay hidden: ${JSON.stringify(accNoGrant.rows)}`);
  pass('SHARED without a fridge.read grant stays hidden (both are required)');

  // another family and anon: refused
  await as('p_other_mom');
  const accOther = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accOther.rows[0].access !== null) fail('3e: another family must be refused');
  await asAnon();
  const accAnon = await q(`select * from pin_media_access($1)`, [mediaId]);
  if (accAnon.rows[0].access !== null) fail('3f: anon must be refused');
  pass('another family and anon are refused the media');
  await backToAuth();

  // 4. idempotency the confirm replay relies on.
  await as('p_mom');
  const dupe = await q(`insert into fridge_notes (id, child_id, author_id, text, audience, attachment_ref)
                        values ('fn_pin_1','p_nora',current_person(),'a different caption','PARENTS_ONLY',$1)
                        on conflict (id) do nothing returning id`, [mediaId]);
  if (dupe.error) fail(`4a: upsert errored: ${dupe.error.message}`);
  if (dupe.rows.length !== 0) fail('4b: a replayed id must not create a second row');
  const stillShared = await q(`select audience, text from fridge_notes where id='fn_pin_1'`);
  if (stillShared.rows[0].audience !== 'SHARED' || !stillShared.rows[0].text.includes('dog')) fail('4c: the replay must not overwrite the original content/audience');
  pass('a replayed confirm (same id, on conflict do nothing) never creates a second note or overwrites content');

  // 5. cleanup sweeps an unreferenced expired upload, keeps a pinned one. (Insert the orphan directly
  // as the service connection — the parent-gated register fn needs a caller jwt we don't set here.)
  await su.query(`insert into pin_media (id, child_id, owner_person_id, content_sha256, storage_path, mime_type, byte_size, expires_at)
                  values ('pm_orphan','p_nora','p_mom',$1,'orphan.png','image/png',10, now() - interval '1 hour')`, [SHA]);
  await su.query(`update pin_media set expires_at = now() - interval '1 hour' where id=$1`, [mediaId]); // pinned but "expired"
  const swept = await su.query(`select * from cleanup_expired_pin_media()`);
  const sweptPaths = swept.rows.map((r) => r.cleanup_expired_pin_media ?? Object.values(r)[0]);
  if (!sweptPaths.includes('orphan.png')) fail(`5a: the unreferenced expired upload should be swept: ${JSON.stringify(sweptPaths)}`);
  const pinnedStill = await su.query(`select 1 from pin_media where id=$1`, [mediaId]);
  if (pinnedStill.rows.length !== 1) fail('5b: a pinned (referenced) media must NEVER be swept, even past its TTL');
  pass('cleanup sweeps an unreferenced expired upload and never a pinned one');

  log('\nALL PIN-REAL PROOF CHECKS PASSED');
}

main().then(() => { stopContainer(); process.exit(0); }).catch((e) => {
  stopContainer();
  console.error(`\n[pin-real-proof] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
