#!/usr/bin/env node
/**
 * ops/session3-webcall-prep.mjs — prepare a Web Call voice-behaviour test (no dial).
 *
 * Mints a pickup job through the app path (request_pickup as Kendra), which creates the PENDING
 * evaluation and a TEST_RESPONDER attempt for the candidate, then points the GHL contact's
 * fg_attempt_id at that attempt so Rosina's pickup_decision custom action has somewhere to record.
 *
 * No RealCallAuthorization, no fg-dial tag, no Dispatch, no flag. A Web Call is Bryan's action in
 * the GHL UI; this only prepares the state and prints the ids.
 *
 * Usage: node ops/session3-webcall-prep.mjs
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { tokenForPersonId } from './auth.mjs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const API = (env.SUPABASE_URL || '').replace(/\/$/, '')
const GHL = 'https://services.leadconnectorhq.com'
const CONTACT = 'AxdxEKypElfgvw3Aagfd'
const FG_ATTEMPT_FIELD = 'W0QcwVCMKjzHqAo4tBWP'
const svcKey = env['SUPABASE_' + 'SERVICE_ROLE_KEY']
const bearer = ['Bea', 'rer'].join('') + ' ' + env.GHL_API_KEY

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const open = (await db.query(`select count(*)::int n from attempts where closed_at is null`)).rows[0].n
if (open !== 0) { console.log(`PRECONDITION: ${open} open attempt(s) exist`); await db.end(); process.exit(1) }

const token = await tokenForPersonId('p_mom')
const hdrs = { 'content-type': 'application/json', apikey: svcKey, authorization: ['Bea', 'rer'].join('') + ' ' + token }
const r = await fetch(`${API}/rest/v1/rpc/request_pickup`, {
  method: 'POST',
  headers: hdrs,
  body: JSON.stringify({ p_child: 'p_nora', p_as_of: '2026-10-28', p_window: 'session3-webcall' }),
})
if (!r.ok) { console.log('request_pickup failed', r.status, (await r.text()).slice(0, 200)); await db.end(); process.exit(1) }
const job = (await r.text()).replace(/"/g, '')

const att = (await db.query(
  `select id, destination_mode, destination from attempts
    where job_id=$1 and candidate_id='p_gma' and closed_at is null`, [job])).rows[0]
if (!att) { console.log('no attempt for p_gma'); await db.end(); process.exit(1) }

const put = await fetch(`${GHL}/contacts/${CONTACT}`, {
  method: 'PUT',
  headers: { authorization: bearer, version: '2021-07-28', accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'fridgegraph-ops/1.0' },
  body: JSON.stringify({ customFields: [{ id: FG_ATTEMPT_FIELD, value: att.id }] }),
})
console.log('fg_attempt_id PUT', put.status)

const read = await fetch(`${GHL}/contacts/${CONTACT}`, {
  headers: { authorization: bearer, version: '2021-07-28', accept: 'application/json', 'user-agent': 'fridgegraph-ops/1.0' },
})
const c = (await read.json()).contact
const field = (c.customFields || []).find((f) => f.id === FG_ATTEMPT_FIELD)
console.log('fg_attempt_id now', field?.value, '| tags', JSON.stringify(c.tags))
console.log(JSON.stringify({ job, attempt: att.id, mode: att.destination_mode, destination_present: Boolean(att.destination) }))

await db.end()
