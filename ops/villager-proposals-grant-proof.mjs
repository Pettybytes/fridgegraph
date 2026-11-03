#!/usr/bin/env node
/**
 * Proof for 0088 — villager_proposals SELECT grant.
 *
 * Runs on a disposable Postgres 16 (127.0.0.1 only), applies the real migration chain, and:
 *   1. REPRODUCES the defect first (no SELECT for authenticated → 42501), before 0088 is applied;
 *   2. proves own-proposal visibility, other-person and other-family isolation;
 *   3. proves anonymous refusal;
 *   4. proves write permissions are unchanged (still refused);
 *   5. proves the RLS policy text is untouched.
 *
 * BLOCKED is a first-class result: a check that cannot run never counts as a pass.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const IMAGE = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
const CONTAINER = 'fg-proposal-grant-proof'
const PORT = 55445

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'PASS' ? 'ok  ' : status === 'BLOCKED' ? 'BLK ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const docker = (args, input) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input })
const psql = sql => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-f', '/dev/stdin'], sql)
const codeOf = e => e?.code ?? String(e)

async function connect(tries = 80) {
  for (let i = 0; i < tries; i++) {
    const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 3000 })
    try { await c.connect(); await c.query('select 1'); return c } catch { await c.end().catch(() => {}); await sleep(500) }
  }
  return null
}

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const B1 = '33333333-3333-4333-8333-333333333333'

async function asRole(client, role, sub, fn) {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    if (sub) await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub])
    return await fn()
  } finally {
    await client.query('rollback')
  }
}

async function main() {
  docker(['rm', '-f', CONTAINER])
  const run = docker(['run', '-d', '--rm', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-p', `127.0.0.1:${PORT}:5432`, IMAGE])
  if (run.status !== 0) { record('disposable database started', 'BLOCKED', run.stderr.slice(0, 160)); return }

  const client = await connect()
  if (!client) { record('disposable database started', 'BLOCKED', 'no connection'); return }
  client.on('error', () => {})

  try {
    record('disposable database started', 'PASS', `127.0.0.1:${PORT}`)

    const prelude = psql(`
      create extension if not exists pgcrypto;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema if not exists auth;
      create schema if not exists storage;
      create schema if not exists extensions;
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    `)
    if (prelude.status !== 0) { record('supabase-shaped prelude', 'FAIL', prelude.stderr.slice(0, 200)); return }
    record('supabase-shaped prelude', 'PASS', 'roles, auth schema, pgcrypto')

    const files = readdirSync(join(REPO, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
    const target = '0088_villager_proposals_read_grant.sql'
    // The proof runs against the DEPLOYED baseline, not "everything in the tree". 0084-0087 are
    // staged/unapplied on the project database; including them would prove a schema nobody is
    // running. 0088 touches only villager_proposals (0074), which the deployed build reads today.
    const UNAPPLIED = new Set([
      '0084_demo_history.sql',
      '0085_invite_budget_ledger.sql',
      '0086_availability_view_hardening.sql',
      '0087_outreach_dispatch.sql',
    ])
    const before = files.filter(f => f < target && !UNAPPLIED.has(f))
    const excluded = files.filter(f => f < target && UNAPPLIED.has(f))
    const failures = []
    for (const file of before) {
      if (file.startsWith('0040')) {
        psql(`
          insert into villages (id, name) values ('v_a','A'),('v_emma','Emma'),('v_taylor','Taylor'),('v_micah','Micah'),('v_malik','Malik')
            on conflict (id) do nothing;
          insert into households (id, village_id, sandbox) values
            ('h_a','v_a',false),('h_emma','v_emma',false),('h_taylor','v_taylor',false),
            ('h_micah','v_micah',false),('h_malik','v_malik',false)
            on conflict (id) do nothing;
        `)
      }
      const out = docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'],
        readFileSync(join(REPO, 'supabase/migrations', file), 'utf8'))
      if (out.status !== 0) failures.push(`${file}: ${(out.stderr || '').split('\n').find(l => /ERROR/i.test(l)) ?? ''}`)
    }
    record('migration chain applies up to 0088', failures.length === 0 ? 'PASS' : 'FAIL',
      failures.length ? failures.join(' | ').slice(0, 220) : `${before.length} migrations; excluded as unapplied: ${excluded.join(', ') || 'none'}`)

    // ── seed three people in two families ──
    const seed = psql(`
      insert into people (id, display_name, birth_date) values
        ('p_a1','A One','1985-01-01'),('p_a2','A Two','1987-02-02'),
        ('p_b1','B One','1990-03-03'),('c_a1','Child A','2018-04-04'),('c_b1','Child B','2019-05-05');
      insert into children (person_id) values ('c_a1'),('c_b1') on conflict do nothing;
      insert into villages (id, name) values ('v_a','Village A'),('v_b','Village B') on conflict do nothing;
      insert into households (id, village_id, sandbox) values ('h_a','v_a',false),('h_b','v_b',false) on conflict do nothing;
      insert into household_members (person_id, household_id, role) values
        ('p_a1','h_a','parent'),('p_a2','h_a','parent'),('c_a1','h_a','child'),
        ('p_b1','h_b','parent'),('c_b1','h_b','child');
      insert into identity_map (user_id, person_id) values
        ('${A1}','p_a1'),('${A2}','p_a2'),('${B1}','p_b1');
      insert into villager_proposals (id, proposer_id, child_id, person_id, relationship_type, scopes, expires_at) values
        ('prop_a1','p_a1','c_a1','p_a2','family_friend','{schedule.read}', now() + interval '1 day'),
        ('prop_a2','p_a2','c_a1','p_a1','family_friend','{schedule.read}', now() + interval '1 day'),
        ('prop_b1','p_b1','c_b1','p_b1','family_friend','{schedule.read}', now() + interval '1 day');
    `)
    record('three proposals seeded across two families', seed.status === 0 ? 'PASS' : 'FAIL',
      seed.status === 0 ? 'prop_a1, prop_a2, prop_b1' : (seed.stderr || '').slice(0, 200))

    // ── 1. REPRODUCE THE DEFECT (before 0088) ──
    const preGrant = (await client.query(`select has_table_privilege('authenticated','public.villager_proposals','SELECT') as p`)).rows[0].p
    let preError = null
    try {
      await asRole(client, 'authenticated', A1, () => client.query('select id from villager_proposals'))
    } catch (error) { preError = codeOf(error) }
    record('DEFECT REPRODUCED before 0088: authenticated has no SELECT and gets 42501',
      preGrant === false && preError === '42501' ? 'PASS' : 'FAIL',
      `hasSelect=${preGrant} error=${preError}`)

    // ── apply 0088 ──
    const applied = docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'],
      readFileSync(join(REPO, 'supabase/migrations', target), 'utf8'))
    record('0088 applies cleanly', applied.status === 0 ? 'PASS' : 'FAIL',
      applied.status === 0 ? 'grant + revokes' : (applied.stderr || '').slice(0, 220))

    // ── 2. visibility and isolation ──
    const own = await asRole(client, 'authenticated', A1, async () =>
      (await client.query('select id from villager_proposals order by id')).rows.map(r => r.id))
    record('a caller sees their OWN proposal only', own.length === 1 && own[0] === 'prop_a1' ? 'PASS' : 'FAIL', JSON.stringify(own))

    const sameFamily = await asRole(client, 'authenticated', A2, async () =>
      (await client.query('select id from villager_proposals order by id')).rows.map(r => r.id))
    record('a same-household caller does NOT see the other person\'s proposal',
      sameFamily.length === 1 && sameFamily[0] === 'prop_a2' ? 'PASS' : 'FAIL', JSON.stringify(sameFamily))

    const otherFamily = await asRole(client, 'authenticated', B1, async () =>
      (await client.query('select id from villager_proposals order by id')).rows.map(r => r.id))
    record('another family sees only its own proposal',
      otherFamily.length === 1 && otherFamily[0] === 'prop_b1' ? 'PASS' : 'FAIL', JSON.stringify(otherFamily))

    // ── 3. anonymous refusal ──
    let anonError = null
    try {
      await asRole(client, 'anon', null, () => client.query('select id from villager_proposals'))
    } catch (error) { anonError = codeOf(error) }
    record('anonymous SELECT is refused', anonError === '42501' ? 'PASS' : 'FAIL', String(anonError))

    // ── 4. write permissions unchanged ──
    const writes = {}
    for (const [name, sql] of [
      ['insert', `insert into villager_proposals (id,proposer_id,child_id,person_id,relationship_type,scopes,expires_at) values ('prop_x','p_a1','c_a1','p_a2','family_friend','{schedule.read}',now()+interval '1 day')`],
      ['update', `update villager_proposals set version = version + 1 where id = 'prop_a1'`],
      ['delete', `delete from villager_proposals where id = 'prop_a1'`],
    ]) {
      try {
        await asRole(client, 'authenticated', A1, () => client.query(sql))
        writes[name] = 'ALLOWED'
      } catch (error) { writes[name] = codeOf(error) }
    }
    record('authenticated cannot INSERT/UPDATE/DELETE',
      writes.insert === '42501' && writes.update === '42501' && writes.delete === '42501' ? 'PASS' : 'FAIL',
      JSON.stringify(writes))

    const priv = (await client.query(`
      select
        has_table_privilege('authenticated','public.villager_proposals','SELECT') as auth_select,
        has_table_privilege('authenticated','public.villager_proposals','INSERT') as auth_insert,
        has_table_privilege('authenticated','public.villager_proposals','UPDATE') as auth_update,
        has_table_privilege('authenticated','public.villager_proposals','DELETE') as auth_delete,
        has_table_privilege('anon','public.villager_proposals','SELECT') as anon_select
    `)).rows[0]
    record('privileges are exactly one SELECT, and nothing to anon',
      priv.auth_select === true && !priv.auth_insert && !priv.auth_update && !priv.auth_delete && !priv.anon_select
        ? 'PASS' : 'FAIL', JSON.stringify(priv))

    // ── 5. policy untouched ──
    const policy = (await client.query(`
      select cmd, qual from pg_policies
       where schemaname='public' and tablename='villager_proposals' and policyname='villager_proposals_read'
    `)).rows[0]
    record('the proposer-only policy is present and unchanged',
      policy && policy.cmd === 'SELECT' && /proposer_id/.test(policy.qual) && /current_person/.test(policy.qual)
        ? 'PASS' : 'FAIL', policy ? `${policy.cmd} · ${policy.qual}` : 'missing')

    const writePolicies = (await client.query(`
      select count(*)::int n from pg_policies
       where schemaname='public' and tablename='villager_proposals' and cmd in ('INSERT','UPDATE','DELETE','ALL')
    `)).rows[0].n
    record('no write policy was added', writePolicies === 0 ? 'PASS' : 'FAIL', `writePolicies=${writePolicies}`)

    writeFileSync(join(REPO, 'docs/evidence/0088-villager-proposals-grant.json'), JSON.stringify({
      at: new Date().toISOString(), image: IMAGE, migration: target, checks: results,
    }, null, 2) + '\n')
  } finally {
    await client.end().catch(() => {})
    docker(['rm', '-f', CONTAINER])
  }
}

try { await main() } catch (error) { record('grant proof harness', 'FAIL', String(error).slice(0, 300)) }
const failed = results.filter(r => r.status === 'FAIL')
const blocked = results.filter(r => r.status === 'BLOCKED')
console.log(`\n${results.length} checks · ${results.filter(r => r.status === 'PASS').length} PASS · ${failed.length} FAIL · ${blocked.length} BLOCKED`)
process.exitCode = failed.length ? 1 : blocked.length ? 3 : 0
