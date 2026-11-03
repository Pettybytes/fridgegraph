#!/usr/bin/env node
/**
 * Negative tests for 0088's catalog guards.
 *
 * The guards exist so the migration cannot grant SELECT onto a table whose catalog is not the one it
 * was reviewed against. A guard that has never been observed to raise is not a guard, so this script
 * builds a disposable Postgres 16 (127.0.0.1 only), applies the real chain up to 0088, clones that
 * baseline, mutates ONE catalog fact per case, and requires 0088 to ABORT with '0088: …'.
 *
 * A positive control (unmutated clone → applies) is included so a permanently-failing migration
 * could not pass this suite.
 *
 * BLOCKED is first-class: no Docker means BLOCKED, never PASS.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const IMAGE = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
const CONTAINER = 'fg-proposal-guard-tests'
const PORT = 55446
const TARGET = '0088_villager_proposals_read_grant.sql'

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'PASS' ? 'ok  ' : status === 'BLOCKED' ? 'BLK ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const docker = (args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const psqlDb = (db, sql) => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'], sql)
// spawnSync cannot take SQL stdin, so write through a temp file inside the container's stdin channel.
const run = (db, sql) => spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'], { encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024 })

async function healthy() {
  for (let i = 0; i < 80; i++) {
    const r = run('postgres', 'select 1;')
    if (r.status === 0) return true
    await sleep(500)
  }
  return false
}

const ROLES = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
`

const PRELUDE = `
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists extensions;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
`

function migrationChainBeforeTarget() {
  return readdirSync(join(REPO, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort().filter(f => f < TARGET)
}

function applyBaseline(db) {
  for (const file of migrationChainBeforeTarget()) {
    if (file.startsWith('0040')) {
      run(db, `
        insert into villages (id, name) values ('v_a','A'),('v_emma','Emma'),('v_taylor','Taylor'),('v_micah','Micah'),('v_malik','Malik')
          on conflict (id) do nothing;
        insert into households (id, village_id, sandbox) values
          ('h_a','v_a',false),('h_emma','v_emma',false),('h_taylor','v_taylor',false),
          ('h_micah','v_micah',false),('h_malik','v_malik',false)
          on conflict (id) do nothing;
      `)
    }
    const r = run(db, readFileSync(join(REPO, 'supabase/migrations', file), 'utf8'))
    if (r.status !== 0) return `${file}: ${(r.stderr || '').split('\n').find(l => /ERROR/i.test(l)) ?? ''}`
  }
  return null
}

const CASES = [
  ['rls disabled', `alter table public.villager_proposals disable row level security;`, /row level security is not enabled/],
  ['rls not forced', `alter table public.villager_proposals no force row level security;`, /not FORCED/],
  ['expected SELECT policy removed', `drop policy villager_proposals_read on public.villager_proposals;`, /expected exactly one SELECT policy|expected the proposer-only/],
  ['predicate broadened to true', `drop policy villager_proposals_read on public.villager_proposals;
     create policy villager_proposals_read on public.villager_proposals for select to authenticated using (true);`, /expected exactly one SELECT policy|predicate changed/],
  ['policy widened to public role', `drop policy villager_proposals_read on public.villager_proposals;
     create policy villager_proposals_read on public.villager_proposals for select to public using (proposer_id = current_person());`, /expected exactly one SELECT policy|applies to/],
  ['extra permissive SELECT policy', `create policy villager_proposals_read_extra on public.villager_proposals for select to authenticated using (true);`, /expected exactly one SELECT policy/],
  ['write policy added', `create policy villager_proposals_write on public.villager_proposals for update to authenticated using (true) with check (true);`, /unexpected write policy/],
  ['table missing', `drop table public.villager_proposals cascade;`, /is missing/],
]

async function main() {
  docker(['rm', '-f', CONTAINER])
  const started = docker(['run', '-d', '--rm', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-p', `127.0.0.1:${PORT}:5432`, IMAGE])
  if (started.status !== 0) return record('disposable database started', 'BLOCKED', (started.stderr || '').slice(0, 160))
  if (!(await healthy())) return record('disposable database started', 'BLOCKED', 'no connection')

  try {
    record('disposable database started', 'PASS', `127.0.0.1:${PORT}`)
    const pre = run('postgres', `${ROLES}\n${PRELUDE}`)
    if (pre.status !== 0) return record('supabase-shaped prelude', 'FAIL', (pre.stderr || '').slice(0, 200))
    record('supabase-shaped prelude', 'PASS', 'roles, auth schema, pgcrypto')

    const created = run('postgres', 'create database neg_base;')
    if (created.status !== 0) return record('baseline database created', 'FAIL', (created.stderr || '').slice(0, 200))
    // The prelude is per-database: roles are cluster-wide but the auth schema and auth.uid() are not.
    const basePrelude = run('neg_base', PRELUDE)
    if (basePrelude.status !== 0) return record('baseline prelude', 'FAIL', (basePrelude.stderr || '').slice(0, 200))
    const chainError = applyBaseline('neg_base')
    if (chainError) return record('baseline chain applies up to 0088', 'FAIL', chainError.slice(0, 220))
    record('baseline chain applies up to 0088', 'PASS', `${migrationChainBeforeTarget().length} migrations`)

    const sql0088 = readFileSync(join(REPO, 'supabase/migrations', TARGET), 'utf8')

    // Positive control: an unmutated clone must apply. Without this a permanently-failing guard
    // would look like a passing suite.
    {
      run('postgres', 'drop database if exists neg_control;')
      const c = run('postgres', 'create database neg_control template neg_base;')
      if (c.status !== 0) record('positive control clone', 'FAIL', (c.stderr || '').slice(0, 160))
      else {
        const applied = run('neg_control', sql0088)
        record('POSITIVE CONTROL: unmutated catalog applies 0088',
          applied.status === 0 ? 'PASS' : 'FAIL', applied.status === 0 ? 'grant applied' : (applied.stderr || '').slice(0, 200))
      }
    }

    let index = 0
    for (const [name, mutation, pattern] of CASES) {
      index += 1
      const db = `neg_case_${index}`
      run('postgres', `drop database if exists ${db};`)
      const clone = run('postgres', `create database ${db} template neg_base;`)
      if (clone.status !== 0) { record(`ABORT on ${name}`, 'FAIL', `clone: ${(clone.stderr || '').slice(0, 120)}`); continue }
      const mutated = run(db, mutation)
      if (mutated.status !== 0) { record(`ABORT on ${name}`, 'FAIL', `mutation: ${(mutated.stderr || '').slice(0, 160)}`); continue }
      const applied = run(db, sql0088)
      const message = `${applied.stderr || ''}\n${applied.stdout || ''}`
      const raised = applied.status !== 0 && /0088:/.test(message) && pattern.test(message)
      record(`ABORT on ${name}`, raised ? 'PASS' : 'FAIL',
        raised ? (message.match(/0088:[^\n]*/) || [''])[0].slice(0, 160) : `exit=${applied.status} ${message.slice(0, 180)}`)
    }

    writeFileSync(join(REPO, 'docs/evidence/0088-catalog-guards.json'), JSON.stringify({
      at: new Date().toISOString(), image: IMAGE, migration: TARGET, checks: results,
    }, null, 2) + '\n')
  } finally {
    docker(['rm', '-f', CONTAINER])
  }
}

try { await main() } catch (error) { record('catalog guard harness', 'FAIL', String(error).slice(0, 300)) }
const failed = results.filter(r => r.status === 'FAIL')
const blocked = results.filter(r => r.status === 'BLOCKED')
console.log(`\n${results.length} checks · ${results.filter(r => r.status === 'PASS').length} PASS · ${failed.length} FAIL · ${blocked.length} BLOCKED`)
process.exitCode = failed.length ? 1 : blocked.length ? 3 : 0
