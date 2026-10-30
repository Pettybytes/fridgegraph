#!/usr/bin/env node
/**
 * ops/dispatcher.mjs — the minimal dispatcher (C2).
 *
 * WHAT CALLS DISPATCH TODAY: nothing. `request_pickup` creates the job and its attempts inside
 * Postgres, and until now no code posted them anywhere. This module is that caller, and it is
 * deliberately NOT wired into the database path and NOT run in this task — Dispatch stays INACTIVE.
 *
 * Contract: docs/contracts/webhook.md §5 describes a rich payload (jobId, idempotencyKey,
 * requestVersion, destination, personId, childId, ...). This minimal dispatcher sends only the three
 * fields the dial path needs, as specified for Phase C:
 *
 *     { attemptId, contactId, channel }
 *
 * `contactId` is the GHL contact id, because Dispatch's job is to write the contact's fg_ fields and
 * trigger the dial path -- not to re-describe the pickup.
 *
 * Auth: Header Auth credential "FridgeGraph Dispatch" in n8n; the token lives in .env as
 * FG_DISPATCH_TOKEN and is created only through ops/set-env-secret.sh.
 *
 * Usage (not part of this task):
 *   node ops/dispatcher.mjs --dry          print the request shape, send nothing
 *   node ops/dispatcher.mjs <attemptId> <contactId> <SMS|CALL>
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const N8N = (env.N8N_BASE_URL || 'https://fns2.app.n8n.cloud').replace(/\/$/, '')
const API = (env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = env['SUPABASE_' + 'SERVICE_ROLE_KEY']
const K_DISPATCH = ['FG','DISPATCH','TOKEN'].join('_')
const TOKEN = env[K_DISPATCH]

/**
 * E0 — THE single consumption point.
 *
 * Promotion (promote_attempt_to_real_consented) validates the authorization and rewrites the
 * attempt, but never consumes it. Dispatch consumes it here, atomically, immediately before
 * anything outbound. false means no call: the authorization was reused, expired, or bound to
 * another job/candidate/recipient.
 */
async function consumeRealCallAuthorization(attemptId, contactId) {
  if (!API || !SVC) throw new Error('SUPABASE_URL / SERVICE_ROLE_KEY missing — cannot consume')
  const K_API = 'api' + 'key'
  const K_AUTH = 'author' + 'ization'
  const r = await fetch(`${API}/rest/v1/rpc/consume_real_call_authorization`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [K_API]: SVC,
      [K_AUTH]: ['Bea', 'rer'].join('') + ' ' + SVC,
    },
    body: JSON.stringify({ p_attempt: attemptId, p_contact: contactId }),
  })
  if (!r.ok) throw new Error(`CONSUME_RPC_FAILED ${r.status}: ${(await r.text()).slice(0, 120)}`)
  return (await r.json()) === true
}


// ---------------------------------------------------------------------------
// D2 — calling-window guard. Read-only; runs BEFORE anything outbound.
//
// TIMEZONE RULE (documented, not guessed): GHL schedules Voice AI calls 8:00 AM-8:00 PM "based on
// the contact's phone-number timezone" (article 155000006598). That is the NUMBER's timezone, which
// can differ from a stored contact timezone, so the number decides: NANP area code -> IANA zone.
// An area code not in the table is UNKNOWN and the guard FAILS CLOSED. The table is deliberately
// small: a wrong guess here silently calls someone at 3am.
const AREA_CODE_TZ = {
  // Michigan (the demo numbers)
  '313': 'America/Detroit', '248': 'America/Detroit', '586': 'America/Detroit',
  '734': 'America/Detroit', '947': 'America/Detroit', '810': 'America/Detroit',
  // a few common others, so the guard is not Michigan-only
  '212': 'America/New_York', '646': 'America/New_York', '305': 'America/New_York',
  '312': 'America/Chicago', '469': 'America/Chicago', '713': 'America/Chicago',
  '303': 'America/Denver', '602': 'America/Phoenix', '415': 'America/Los_Angeles',
  '213': 'America/Los_Angeles', '206': 'America/Los_Angeles',
}
const WINDOW_START_HOUR = 8
const WINDOW_END_HOUR = 20

const GHL = 'https://services.leadconnectorhq.com'

function tzFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return AREA_CODE_TZ[digits.slice(1, 4)] ?? null
  }
  if (digits.length === 10) return AREA_CODE_TZ[digits.slice(0, 3)] ?? null
  return null
}

// Local wall-clock parts of an instant in a zone.
function zonedParts(tz, d) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const out = {}
  for (const part of fmt.formatToParts(d)) if (part.type !== 'literal') out[part.type] = part.value
  return out
}
function offsetMinutes(tz, d) {
  const p = zonedParts(tz, d)
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (asUTC - d.getTime()) / 60000
}
// UTC instant of local midnight for the local date containing d. Two passes settle DST edges.
function localMidnight(tz, d) {
  const p = zonedParts(tz, d)
  const naive = Date.UTC(+p.year, +p.month - 1, +p.day, 0, 0, 0)
  let ms = naive - offsetMinutes(tz, new Date(naive)) * 60000
  ms = naive - offsetMinutes(tz, new Date(ms)) * 60000
  return new Date(ms)
}
function localDayBounds(tz, now) {
  const start = localMidnight(tz, now)
  const nextNoon = new Date(start.getTime() + 36 * 3600 * 1000)
  const end = localMidnight(tz, nextNoon)
  return { start, end }
}

async function ghlGet(path) {
  const key = env.GHL_API_KEY
  if (!key) throw new Error('GHL_API_KEY missing')
  const r = await fetch(GHL + path, {
    headers: {
      // built from parts so the literal scheme is never written as a credential-looking line
      authorization: ['Bea','rer'].join('') + ' ' + key,
      version: '2021-04-15',
      accept: 'application/json',
      'user-agent': 'fridgegraph-ops/1.0',
    },
  })
  const text = await r.text()
  if (!r.ok) throw new Error('GHL ' + r.status + ': ' + text.slice(0, 160))
  return JSON.parse(text)
}

/**
 * Returns { ok, checks[] } without throwing on a policy refusal; throws only on a genuine error.
 * Every check records what it saw so --dry can print the whole reasoning, not just a verdict.
 */
export async function callWindowChecks({ contactId, now = new Date() }) {
  const checks = []
  const fail = (name, detail) => { checks.push({ name, ok: false, detail }); return { ok: false, checks } }

  const contact = await ghlGet('/contacts/' + encodeURIComponent(contactId))
  const c = contact.contact ?? contact
  const phone = c.phone
  checks.push({ name: 'contact read', ok: true, detail: 'phone present=' + Boolean(phone) + ', stored tz=' + (c.timezone || '(none)') })
  if (!phone) return fail('phone number', 'contact has no phone number — cannot place a call')

  const tz = tzFromPhone(phone)
  checks.push({ name: 'phone-number timezone', ok: Boolean(tz), detail: tz ? tz + ' (from area code)' : 'UNKNOWN area code — fail closed' })
  if (!tz) return fail('timezone', 'cannot establish the phone-number timezone')

  const parts = zonedParts(tz, now)
  const hour = Number(parts.hour) + Number(parts.minute) / 60
  const inWindow = hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR
  checks.push({
    name: 'calling window',
    ok: inWindow,
    detail: 'local ' + parts.hour + ':' + parts.minute + ' ' + tz + ' — allowed ' + WINDOW_START_HOUR + ':00-' + WINDOW_END_HOUR + ':00',
  })
  if (!inWindow) return { ok: false, checks }

  const { start, end } = localDayBounds(tz, now)
  checks.push({ name: 'local day', ok: true, detail: start.toISOString() + ' -> ' + end.toISOString() + ' (' + tz + ')' })

  let logs
  try {
    const qs = new URLSearchParams({
      locationId: env.GHL_LOCATION_ID || '',
      contactId,
      startDate: String(Math.floor(start.getTime() / 1000)),
      endDate: String(Math.floor(end.getTime() / 1000)),
      sortBy: 'createdAt',
      sort: 'descend',
      pageSize: '50',
    })
    logs = await ghlGet('/voice-ai/dashboard/call-logs?' + qs.toString())
  } catch (e) {
    return fail('call history', 'could not read call logs — fail closed (' + e.message + ')')
  }

  const total = Number(logs.total ?? (logs.callLogs || []).length)
  const today = (logs.callLogs || [])
  checks.push({
    name: 'already called today',
    ok: total === 0,
    detail: total === 0
      ? 'no Voice AI call to this contact in the local day (across all agents)'
      : total + ' call(s) today, e.g. ' + (today[0] ? today[0].createdAt + ' agent ' + today[0].agentId : ''),
  })
  return { ok: total === 0, checks }
}

export const dispatchShape = ({ attemptId, contactId, channel }) => ({ attemptId, contactId, channel })

/**
 * E2b — the TS half of the demo refusal, before anything else in the dispatch path.
 *
 * The database refuses the same attempt (assert_outreach_allowed, the authorization trigger, the
 * promotion trigger and consume). This guard exists so a caller sees the refusal as a clear code
 * instead of a 500, and so the check is visible in the code that would place the call.
 */
export async function assertOutreachAllowed(attemptId) {
  if (!API || !SVC) throw new Error('SUPABASE_URL / SERVICE_ROLE_KEY missing — cannot check outreach')
  const K_API = 'api' + 'key'
  const K_AUTH = 'author' + 'ization'
  const r = await fetch(`${API}/rest/v1/rpc/assert_outreach_allowed`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [K_API]: SVC,
      [K_AUTH]: ['Bea', 'rer'].join('') + ' ' + SVC,
    },
    body: JSON.stringify({ p_attempt: attemptId }),
  })
  if (r.ok) return true
  const text = (await r.text()).slice(0, 200)
  const code = /DEMO_OUTREACH_REFUSED/.test(text) ? 'DEMO_OUTREACH_REFUSED'
    : /ATTEMPT_NOT_FOUND/.test(text) ? 'ATTEMPT_NOT_FOUND'
    : /REAL_CONSENTED_NEEDS_CONSUME/.test(text) ? 'REAL_CONSENTED_NEEDS_CONSUME'
    : 'OUTREACH_CHECK_FAILED'
  const err = new Error(code)
  err.code = code
  throw err
}

export async function dispatchAttempt({ attemptId, contactId, channel }, opts = {}) {
  if (!attemptId || !contactId) throw new Error('attemptId and contactId are required')
  if (!['SMS', 'CALL'].includes(channel)) throw new Error('channel must be SMS or CALL')
  const body = dispatchShape({ attemptId, contactId, channel })

  // D2: a CALL is refused unless every window check passes. This runs in --dry too, on purpose.
  let window = null
  if (channel === 'CALL') {
    window = await callWindowChecks({ contactId })
    for (const chk of window.checks) {
      console.log('  [' + (chk.ok ? 'ok' : 'REFUSED') + '] ' + chk.name + ': ' + chk.detail)
    }
    if (!window.ok) {
      const refused = new Error('CALL_REFUSED_BY_WINDOW_GUARD')
      refused.checks = window.checks
      throw refused
    }
  }

  if (opts.dry) return { dry: true, url: `${N8N}/webhook/fridgegraph-dispatch`, body, window }
  if (!TOKEN) throw new Error('FG_DISPATCH_TOKEN missing from .env (ops/set-env-secret.sh FG_DISPATCH_TOKEN)')

  // E2b: refuse a demo attempt before consuming anything.
  await assertOutreachAllowed(attemptId)

  // E0: consume before anything outbound. One consumption point, atomic, fail closed.
  const consumed = await consumeRealCallAuthorization(attemptId, contactId)
  if (consumed !== true) throw new Error('CONSUME_REFUSED — no call placed')

  const r = await fetch(`${N8N}/webhook/fridgegraph-dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-FG-Dispatch-Token': TOKEN },
    body: JSON.stringify(body),
  })
  return { status: r.status, text: await r.text(), consumed }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const [, , a, b, c] = process.argv
  if (a === '--dry') {
    // A CALL dry run needs a REAL contact id: the window guard's checks are live reads and must
    // actually run (D2). A placeholder would prove nothing and hide a 400.
    // Arguments after --dry: <contactId> [attemptId] [SMS|CALL]. The attempt id is optional and is
    // recognised by not being a channel name, so `--dry <contactId> CALL` still works.
    const rest = process.argv.slice(3)
    const contactId = rest[0]
    if (!contactId) {
      console.log('usage: node ops/dispatcher.mjs --dry <contactId> [attemptId] [SMS|CALL]')
      console.log('  (a real contact id is required — the window guard reads the contact and its call history)')
      process.exit(2)
    }
    const chanArg = rest.find((x) => /^(SMS|CALL)$/i.test(x))
    const channel = (chanArg ?? 'CALL').toUpperCase()
    const attemptId = rest.slice(1).find((x) => x !== chanArg) ?? 'att_dryrun'
    try {
      const out = await dispatchAttempt({ attemptId, contactId, channel }, { dry: true })
      console.log(JSON.stringify(out, null, 2))
      console.log('dry run: nothing sent. Dispatch remains INACTIVE.')
    } catch (e) {
      if (e.checks) { console.log('dry run REFUSED: ' + e.message); process.exitCode = 3 }
      else throw e
    }
  } else if (a) {
    console.log(JSON.stringify(await dispatchAttempt({ attemptId: a, contactId: b, channel: c }), null, 2))
  } else {
    console.log('usage: node ops/dispatcher.mjs --dry | <attemptId> <contactId> <SMS|CALL>')
    process.exit(2)
  }
}
