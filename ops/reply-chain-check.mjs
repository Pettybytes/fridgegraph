#!/usr/bin/env node
/**
 * ops/reply-chain-check.mjs — B3 wire check: does the n8n side accept exactly the payloads Bryan's
 * two published GHL workflows send?
 *
 *   FG-SMS-Reply  -> POST /webhook/ghl-reply      { attemptId, message }
 *   FG - No Answer-> POST /webhook/ghl-no-answer  { attemptId }
 *
 * Deliberately uses a CLOSED attempt, so every accepted payload dies at the D2 gate inside
 * record_no_answer/accept_pickup_webhook and nothing mutates. State changes are B4's job, with
 * fresh attempts.
 *
 * Also proves the two failure modes with no mutation: missing token -> 403, bad id -> 400.
 *
 * Never prints the token or the action-token header value.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const BASE = (env.N8N_BASE_URL || 'https://fns2.app.n8n.cloud').replace(/\/$/, '')
const TOKEN = env.FG_GHL_ACTION_TOKEN
if (!TOKEN) { console.log('FG_GHL_ACTION_TOKEN missing'); process.exit(2) }

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}

// A closed attempt from the migration backfill: real, recognisable, and safely inert.
const closed = (await db.query(
  `select id, job_id, closed_reason from attempts
    where closed_at is not null order by closed_at desc limit 1`)).rows[0]
if (!closed) { console.log('no closed attempt to test against'); process.exit(2) }
console.log(`closed attempt under test: ${closed.id} (${closed.closed_reason})`)

const post = async (path, body, opts = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (opts.token !== false) headers['X-FG-Action-Token'] = TOKEN
  const r = await fetch(`${BASE}/webhook/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* leave null */ }
  return { status: r.status, json, text }
}

const snapshot = async () => ({
  events: (await db.query(`select count(*)::int n from webhook_events`)).rows[0].n,
  attempt: (await db.query(
    `select closed_at, closed_reason from attempts where id=$1`, [closed.id])).rows[0],
  ce: (await db.query(
    `select count(*)::int n from candidate_evaluations where job_id=$1`, [closed.job_id])).rows[0].n,
})
const before = await snapshot()

console.log('\n--- FG-SMS-Reply payload { attemptId, message } ---')
const reply = await post('ghl-reply', { attemptId: closed.id, message: 'Yes, I can!' })
console.log(`  ${reply.status} ${reply.text.slice(0, 160)}`)
check('reply payload accepted by n8n', reply.status, 200)
check('reply reached the tunnel and was refused at the D2 gate',
  reply.json?.note, 'rejected_closed')

console.log('\n--- FG - No Answer payload { attemptId } ---')
const na = await post('ghl-no-answer', { attemptId: closed.id })
console.log(`  ${na.status} ${na.text.slice(0, 160)}`)
check('no-answer payload accepted by n8n', na.status, 200)
check('no-answer reached the tunnel and was refused at the D2 gate', na.json?.note, 'rejected_closed')

console.log('\n--- D2 correlation field, optional and passthrough ---')
const withId = await post('ghl-reply', { attemptId: closed.id, message: 'yes', eventId: 'corr-probe-1' })
console.log(`  ${withId.status} ${withId.text.slice(0, 160)}`)
check('payload with an extra correlation field is still accepted', withId.status, 200)

console.log('\n--- failure modes ---')
const noTok = await post('ghl-reply', { attemptId: closed.id, message: 'yes' }, { token: false })
check('missing action token', noTok.status, 403)
const badId = await post('ghl-reply', { attemptId: 'att_doesnotexist', message: 'yes' })
console.log(`  ${badId.status} ${badId.text.slice(0, 160)}`)
check('unknown attempt id', badId.status, 400)

const after = await snapshot()
check('webhook_events delta', after.events - before.events, 0)
check('attempt row unchanged', JSON.stringify(after.attempt), JSON.stringify(before.attempt))
check('candidate_evaluations delta', after.ce - before.ce, 0)

await db.end()
if (failed) { console.log(`\nCHAIN CHECK FAILED (${failed})`); process.exit(1) }
console.log('\nCHAIN CHECK OK — payload contract accepted, nothing mutated')
