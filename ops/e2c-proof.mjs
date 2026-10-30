#!/usr/bin/env node
/**
 * ops/e2c-proof.mjs — the Demo guide scope, proven with real tokens over PostgREST.
 *
 * The point is the DISCRIMINATOR: a table whose base policy is parent/scope-only must return rows to
 * the guide and zero rows to a signed-in adult who has no relationship to that child. Reading
 * `households` would prove nothing, because that base policy already allows any signed-in user.
 *
 * Writes are attempted directly (insert/patch/delete/RPC) and must be refused by policy, not by a UI.
 *
 * Usage: node ops/e2c-proof.mjs
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const BASE = env.SUPABASE_URL.replace(/\/$/, '')
const ANON = env.SUPABASE_PUBLISHABLE_KEY
const LOGIN = process.env.DEMO_LOGIN_URL ?? 'http://127.0.0.1:4008/api/demo/login'

let failed = 0
const check = (label, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ': ' + detail : ''}`)
}

const login = async (personaId) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await fetch(LOGIN, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId }),
    })
    if (r.status !== 429) return r.json()
    const wait = Number(r.headers.get('retry-after') ?? 10)
    console.log(`  (rate limited; waiting ${wait}s)`)
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000))
  }
  throw new Error(`login for ${personaId} stayed rate limited`)
}

const get = async (token, table, query = 'select=*') => {
  const r = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, authorization: `Bearer ${token}`, prefer: 'count=exact' },
  })
  const body = await r.json().catch(() => null)
  return { status: r.status, rows: Array.isArray(body) ? body : [], body }
}

const write = async (token, table, { method, query = '', body }) => {
  const r = await fetch(`${BASE}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json',
      prefer: 'return=representation' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await r.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: r.status, body: parsed }
}

const rpc = async (token, fn, args) => {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  return { status: r.status, text }
}

console.log('=== E2c proof: Demo guide reads sandbox records, writes nothing ===')

const guide = await login('demo-guide')
const kendra = await login('kendra')
const dana = await login('dana')
for (const [name, s] of [['guide', guide], ['kendra', kendra], ['dana', dana]]) {
  if (s.status !== 'READY') { console.log(`  cannot proceed: ${name} is ${s.status}`); process.exit(1) }
}
const G = guide.session.access_token
const K = kendra.session.access_token
const D = dana.session.access_token

// ---------------------------------------------------------------- 1. discriminator
// p_jax belongs to a household Kendra has no relationship with. Base policies deny her; the guide
// policy (is_demo_guide() AND sandbox) allows the guide.
console.log('\n1) discriminator: records the base policy hides from an unrelated adult')
// events: the seed holds one event, for Nora. Dana is Jax's mom and unrelated to Nora.
// care_plans / parenting_schedules / grants: rows exist for Jax, whom Kendra is unrelated to.
const cases = [
  { table: 'events', query: 'select=id&child_id=eq.p_nora', other: D, otherName: 'dana' },
  { table: 'care_plans', query: 'select=*&child_id=eq.p_jax', other: K, otherName: 'kendra' },
  { table: 'parenting_schedules', query: 'select=*&child_id=eq.p_jax', other: K, otherName: 'kendra' },
  { table: 'grants', query: 'select=id&child_id=eq.p_jax', other: K, otherName: 'kendra' },
]
for (const c of cases) {
  const asGuide = await get(G, c.table, c.query)
  const asOther = await get(c.other, c.table, c.query)
  check(`1 ${c.table}: guide reads sandbox rows`, asGuide.status === 200 && asGuide.rows.length > 0,
    `${asGuide.rows.length} row(s)`)
  check(`1 ${c.table}: ${c.otherName} (unrelated) reads none`,
    asOther.status === 200 && asOther.rows.length === 0, `${asOther.rows.length} row(s)`)
}

const asDanaJax = await get(D, 'children', 'select=person_id')
check('1 dana (Jax\u2019s mom) resolves normally', asDanaJax.status === 200, String(asDanaJax.status))

// ---------------------------------------------------------------- 2. breadth
console.log('\n2) the guide reads across the networks the seed holds')
const breadth = [
  'households', 'household_members', 'children', 'events', 'grants', 'household_policies',
  'care_plans', 'goals', 'parenting_schedules', 'relationships', 'contact_methods', 'locations',
  'village_event', 'permission_slips', 'school_reports', 'bus_rosters', 'vehicles', 'practices',
  'coordination_jobs', 'attempts',
]
for (const table of breadth) {
  const r = await get(G, table, 'select=*')
  check(`2 guide SELECT ${table} allowed`, r.status === 200, `${r.rows.length} row(s)`)
}
const jobs = await get(G, 'coordination_jobs', 'select=*')
check('2 the guide reads sandbox jobs only (none left behind by the proofs)', jobs.rows.length === 0,
  `${jobs.rows.length} row(s)`)

// A non-guide token must not gain the guide policies: Kendra still gets 0 on p_jax (proved above),
// and the guide-only tables stay governed by their own base policies for her.
const kendraHouseholds = await get(K, 'households', 'select=*')
const guideHouseholds = await get(G, 'households', 'select=*')
check('2 households is a base-policy read for both (not a guide grant)',
  kendraHouseholds.rows.length === guideHouseholds.rows.length,
  `kendra ${kendraHouseholds.rows.length} / guide ${guideHouseholds.rows.length}`)

// ---------------------------------------------------------------- 3. writes
console.log('\n3) the guide cannot write, by direct call')
const beforeEvents = (await get(G, 'events', 'select=id')).rows.length

const ins = await write(G, 'approvals', { method: 'POST', body: {
  id: 'ap_proof_guide', approver_id: 'p_demo_guide', subject_type: 'Grant',
  subject_id: 'g_proof', decision: 'APPROVED', at: '2026-10-30' } })
check('3 INSERT refused', ins.status >= 400 && /row-level security|violates/i.test(JSON.stringify(ins.body)),
  `HTTP ${ins.status}`)

const patched = await write(G, 'goals', { method: 'PATCH', query: 'id=not.is.null', body: { status: 'APPROVED' } })
check('3 UPDATE refused (0 rows affected)', Array.isArray(patched.body) && patched.body.length === 0,
  `HTTP ${patched.status}, ${Array.isArray(patched.body) ? patched.body.length : '?'} row(s)`)

const deleted = await write(G, 'events', { method: 'DELETE', query: 'id=not.is.null' })
const afterEvents = (await get(G, 'events', 'select=id')).rows.length
check('3 DELETE refused (nothing removed)',
  (Array.isArray(deleted.body) ? deleted.body.length === 0 : deleted.status >= 400) && afterEvents === beforeEvents,
  `${beforeEvents} -> ${afterEvents}`)

const pickup = await rpc(G, 'request_pickup', { p_child: 'p_nora', p_as_of: '2026-10-26', p_window: 'afternoon' })
check('3 RPC request_pickup refused (not a parent)', pickup.status >= 400 && /UNAUTHORIZED/.test(pickup.text),
  `HTTP ${pickup.status}`)

const relabel = await write(G, 'goals', { method: 'POST', body: {
  id: 'g_proof', child_id: 'p_nora', title: 'proof', status: 'PROPOSED' } })
check('3 INSERT into goals refused', relabel.status >= 400, `HTTP ${relabel.status}`)

// The guide reads the same tables it failed to write.
const finalRead = await get(G, 'events', 'select=id')
check('3 the guide still reads after every refused write',
  finalRead.status === 200 && finalRead.rows.length === afterEvents, `${finalRead.rows.length} row(s)`)

console.log(failed ? `\nE2c PROOF FAILED: ${failed}` : '\nE2c PROOF PASSED')
process.exit(failed ? 1 : 0)
