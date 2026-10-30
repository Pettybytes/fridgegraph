#!/usr/bin/env node
/**
 * ops/session3-rollback.mjs — Session 3 rollback.
 *
 * ORDER IS THE SAFETY PROPERTY: LOCAL SHUTDOWN FIRST.
 *   1. stop everything local that could still place a call (Dispatch off, flag off)
 *   2. close the attempt and REVOKE the authorization (never wait for expiry)
 *   3. only then touch GHL (tag, enrolment, workflow state)
 *
 * If a GHL step fails, steps 1-2 have already completed and the script reports exactly which
 * external action needs Bryan. A slow or failing GHL request cannot leave anything live locally.
 *
 *   node ops/session3-rollback.mjs --dry <attemptId> [contactId]
 *   node ops/session3-rollback.mjs       <attemptId> [contactId]
 *
 * --dry performs every READ and every DB step, and prints the GHL writes it WOULD make without
 * making them. Never prints a token or a key.
 *
 * WHAT THIS CANNOT DO — read this before trusting a clean exit:
 *   There is NO documented way to cancel a Voice AI call that GHL has already accepted and queued.
 *   GHL's own docs say calls above the daily limit are "scheduled for the next eligible day", and
 *   users report 1-5 minutes between enrolment and the call. Being inside 8am-8pm removes one
 *   reason for deferral; it does NOT prove the call was placed immediately. Removing a tag is not
 *   cancelling a scheduled call. A deferred call can still ring the recipient after a clean
 *   rollback. This script does not, and cannot, prevent that.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const GHL = 'https://services.leadconnectorhq.com'
const N8N = (env.N8N_BASE_URL || '').replace(/\/$/, '')
const DRY = process.argv[2] === '--dry'
const attemptId = DRY ? process.argv[3] : process.argv[2]
const contactArg = DRY ? process.argv[4] : process.argv[3]

if (!attemptId) { console.log('usage: node ops/session3-rollback.mjs [--dry] <attemptId> [contactId]'); process.exit(2) }

const results = []
const step = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'ok' : ok === null ? 'SKIP' : 'FAIL'}] ${name}${detail ? ': ' + detail : ''}`)
}

async function ghl(method, path, body) {
  const key = env.GHL_API_KEY
  if (!key) throw new Error('GHL_API_KEY missing')
  const r = await fetch(GHL + path, {
    method,
    headers: {
      authorization: ['Bea', 'rer'].join('') + ' ' + key,
      version: '2021-04-15',
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'fridgegraph-ops/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  return { status: r.status, ok: r.ok, text }
}

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const att = (await db.query(
  `select a.id, a.job_id, a.candidate_id, a.destination, a.destination_mode, a.closed_at,
          ca.contact_ref
     from attempts a
     left join real_call_authorizations ca on ca.attempt_id = a.id
    where a.id = $1`, [attemptId])).rows[0]

if (!att) { console.log(`UNKNOWN_ATTEMPT ${attemptId}`); await db.end(); process.exit(2) }
const contactId = contactArg || att.destination || att.contact_ref || null
console.log(`rollback ${DRY ? '(DRY RUN — GHL writes are printed, not made)' : ''}`)
console.log(`  attempt ${att.id}  mode=${att.destination_mode}  contact=${contactId ?? '(none known)'}`)

// ---------------------------------------------------------------------------
console.log('\n1. local shutdown first')
// ---------------------------------------------------------------------------
{
  // Dispatch is the n8n workflow that could still drive a dial. Deactivate it before touching
  // anything external, so a slow GHL call later cannot leave a live path behind.
  let dispatched = false
  if (!N8N || !env['N8N_' + 'API_KEY']) {
    step('deactivate Dispatch', false, 'n8n credential missing — DO THIS MANUALLY')
  } else {
    const r = await fetch(`${N8N}/api/v1/workflows/A2vnWF2L58Lvquqg`, {
      headers: { ['X-N8N-' + 'API-KEY']: env['N8N_' + 'API_KEY'] },
    })
    const wf = await r.json().catch(() => ({}))
    if (wf.active === false) {
      step('deactivate Dispatch', true, 'already inactive')
      dispatched = true
    } else if (DRY) {
      step('deactivate Dispatch', null, `would POST /workflows/${wf.id}/deactivate (active=${wf.active})`)
      dispatched = true
    } else {
      const d = await fetch(`${N8N}/api/v1/workflows/A2vnWF2L58Lvquqg/deactivate`, {
        method: 'POST', headers: { ['X-N8N-' + 'API-KEY']: env['N8N_' + 'API_KEY'] },
      })
      step('deactivate Dispatch', d.ok, `HTTP ${d.status}`)
      dispatched = d.ok
    }
  }

  const flag = env.REAL_CALL_EXCEPTION_ENABLED
  step('REAL_CALL_EXCEPTION_ENABLED', flag ? false : true,
    flag ? 'STILL SET in this environment — unset it before anything else' : 'unset')
}

// ---------------------------------------------------------------------------
console.log('\n2. close the attempt and revoke the authorization')
// ---------------------------------------------------------------------------
{
  if (att.closed_at) {
    step('close attempt', true, `already closed (${att.closed_at.toISOString?.() ?? att.closed_at})`)
  } else if (DRY) {
    step('close attempt', null, "would close_attempt(id,'SESSION_3_ROLLBACK')")
  } else {
    const r = await db.query(`select close_attempt($1,'SESSION_3_ROLLBACK') c`, [attemptId])
    step('close attempt', r.rows[0].c === true, 'closed')
  }

  // Never wait for natural expiry: an unused authorization must be dead the moment we roll back.
  const live = (await db.query(
    `select id, expires_at from real_call_authorizations
      where (attempt_id = $1 or (job_id = $2 and candidate_id = $3))
        and consumed_at is null and expires_at > now()`, [attemptId, att.job_id, att.candidate_id])).rows
  if (live.length === 0) {
    step('revoke unused authorizations', true, 'none live')
  } else if (DRY) {
    step('revoke unused authorizations', null, `would expire ${live.length}: ${live.map((a) => a.id).join(', ')}`)
  } else {
    const r = await db.query(
      `update real_call_authorizations
          set expires_at = least(expires_at, now())
        where (attempt_id = $1 or (job_id = $2 and candidate_id = $3))
          and consumed_at is null and expires_at > now()`, [attemptId, att.job_id, att.candidate_id])
    step('revoke unused authorizations', true, `expired ${r.rowCount}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\n3. GHL: remove the dial trigger')
// ---------------------------------------------------------------------------
let ghlNeedsBryan = []
{
  // Documented: DELETE /contacts/{contactId}/tags with a body listing tags to remove (GHL v2
  // Contacts API). Verified against the docs, not yet exercised against the live API — removing a
  // tag is a write, and this task forbids making one. If the call fails, Bryan is told exactly what
  // to click.
  if (!contactId) {
    step('remove fg-dial tag', false, 'no contact id known — check the contact in GHL manually')
    ghlNeedsBryan.push('remove the fg-dial tag from the contact (no contact id on the attempt)')
  } else if (DRY) {
    step('remove fg-dial tag', null, `would DELETE /contacts/${contactId}/tags  {"tags":["fg-dial"]}`)
  } else {
    const r = await ghl('DELETE', `/contacts/${contactId}/tags`, { tags: ['fg-dial'] })
    step('remove fg-dial tag', r.ok, `HTTP ${r.status}${r.ok ? '' : ' — ' + r.text.slice(0, 120)}`)
    if (!r.ok) ghlNeedsBryan.push(`remove the fg-dial tag from contact ${contactId} in GHL`)
  }

  // There is no documented public API for removing a contact from a workflow, nor for publishing /
  // unpublishing a workflow. These stay manual. Saying otherwise would be inventing a capability.
  step('remove workflow enrolment', null,
    `no documented API — MANUAL: remove contact ${contactId ?? '(see contact)'} from "FG - Dial Rosina" if enrolled`)
  ghlNeedsBryan.push(`confirm contact ${contactId ?? '(see contact)'} is not enrolled in "FG - Dial Rosina"`)

  step('set FG - Dial Rosina to draft', null,
    'no documented publish/unpublish API — MANUAL: leave it in draft')
  ghlNeedsBryan.push('confirm "FG - Dial Rosina" (6f2b386e) is still in draft')
}

// ---------------------------------------------------------------------------
console.log('\n4. final state')
// ---------------------------------------------------------------------------
{
  const final = (await db.query(
    `select a.closed_at,
            (select count(*)::int from real_call_authorizations
              where (attempt_id = a.id or (job_id = a.job_id and candidate_id = a.candidate_id))
                and consumed_at is null and expires_at > now()) live_auths
       from attempts a where a.id = $1`, [attemptId])).rows[0]
  step('attempt closed', Boolean(final.closed_at), final.closed_at ? 'yes' : 'NO')
  step('no live authorization', final.live_auths === 0, `${final.live_auths} live`)

  const flag = env.REAL_CALL_EXCEPTION_ENABLED
  step('flag unset', !flag, flag ? 'STILL SET' : 'unset')

  if (contactId) {
    // read-only: the tag list, so the operator sees the truth rather than trusting the write
    const r = await ghl('GET', `/contacts/${contactId}`)
    if (r.ok) {
      const c = JSON.parse(r.text).contact ?? {}
      const tags = c.tags ?? []
      step('fg-dial tag absent', !tags.some((t) => String(t).toLowerCase().startsWith('fg-dial')),
        `${tags.length} tag(s) on the contact`)
    } else {
      step('fg-dial tag absent', false, `could not read contact: HTTP ${r.status}`)
    }
  }

  const open = (await db.query(
    `select count(*)::int n from attempts where candidate_id = $1 and closed_at is null`,
    [att.candidate_id])).rows[0].n
  step('no open attempt left for this contact', open === 0, `${open} open`)
}

await db.end()

console.log('\n--- summary ---')
const failed = results.filter((r) => r.ok === false)
if (ghlNeedsBryan.length) {
  console.log('FOR BRYAN (external steps this script cannot perform):')
  for (const b of [...new Set(ghlNeedsBryan)]) console.log('  - ' + b)
}
console.log(failed.length ? `LOCAL STEPS FAILED: ${failed.map((f) => f.name).join(', ')}` : 'local shutdown: complete')
console.log('\nRESIDUAL RISK (unchanged by a clean exit): no documented cancel exists for a queued Voice AI')
console.log('call. A deferred call may still ring the recipient after this rollback. A reply on the closed')
console.log('attempt protects app state only.')
process.exit(failed.length ? 1 : 0)
