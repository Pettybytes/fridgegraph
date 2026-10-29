#!/usr/bin/env node
/**
 * ops/webhook-reply-server.mjs — the signed HTTP boundary for coordination replies.
 *
 * Boundary order (webhook.md §4). Nothing privileged runs until every check below has passed:
 *   1. HMAC-SHA256 over `${timestamp}.${rawBody}` with N8N_WEBHOOK_SECRET
 *   2. timestamp tolerance ±300 s against this server's clock
 *   3. constant-time signature comparison
 *   4. JSON parse + shape validation
 *   5. the Attempt exists, and its destination, channel and request_version match the payload
 *   6. durable event-id dedupe (webhook_events) — a duplicate changes nothing
 *   7. service-role RPC accept_pickup_webhook
 *
 * Candidate identity is NEVER read from the payload: the RPC derives it from the Attempt row.
 * The service-role key never leaves this process. Logs carry the path, status and event id only —
 * never the signature, the secret or a token.
 *
 * Usage: PORT=4110 node ops/webhook-reply-server.mjs
 */
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'

const PORT = Number(process.env.PORT || 4110)
const TOLERANCE_S = 300
const SECRET = process.env.N8N_WEBHOOK_SECRET
const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB = process.env.SUPABASE_DB_URL

if (!SECRET || !BASE || !SVC || !DB) {
  console.error('webhook-reply-server: missing N8N_WEBHOOK_SECRET / SUPABASE_URL / service key / DB url')
  process.exit(2)
}

const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })

const log = (status, eventId, note) => console.log(`[reply] ${status}${eventId ? ' event=' + String(eventId).slice(0, 12) + '…' : ''}${note ? ' ' + note : ''}`)

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 262144) { reject(new Error('payload too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleReply(req, res) {
  const ts = req.headers['x-fridgegraph-timestamp']
  const sig = req.headers['x-fridgegraph-signature']
  let eventId = null

  // 1–3: authentication, before anything is parsed or looked up.
  if (typeof ts !== 'string' || typeof sig !== 'string') { log(401, null, 'missing headers'); return send(res, 401, { error: 'UNAUTHORIZED' }) }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts))
  if (!Number.isFinite(skew) || skew > TOLERANCE_S) { log(401, null, 'timestamp out of tolerance'); return send(res, 401, { error: 'UNAUTHORIZED' }) }

  const raw = await readBody(req)
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')
  if (!safeEqual(expected, sig)) { log(401, null, 'bad signature'); return send(res, 401, { error: 'UNAUTHORIZED' }) }

  // 4: shape.
  let body
  try { body = JSON.parse(raw) } catch { log(400, null, 'malformed json'); return send(res, 400, { error: 'MALFORMED' }) }
  const { eventId: eid, attemptId, requestVersion, available, declineReason = null, recipient, channel } = body ?? {}
  eventId = typeof eid === 'string' ? eid : null
  if (!eventId || typeof attemptId !== 'string' || typeof requestVersion !== 'number'
      || typeof available !== 'boolean' || typeof recipient !== 'string')
    { log(400, eventId, 'bad shape'); return send(res, 400, { error: 'MALFORMED' }) }

  // 5: binding — the Attempt must exist and agree on destination, channel and request version.
  const a = await db.query(
    `select a.id, a.destination, a.channel, a.job_id, j.request_version, j.status
       from attempts a join coordination_jobs j on j.id = a.job_id
      where a.id = $1`, [attemptId])
  if (!a.rowCount) { log(404, eventId, 'unknown attempt'); return send(res, 404, { error: 'UNKNOWN_ATTEMPT' }) }
  const row = a.rows[0]
  if (row.destination !== recipient || row.channel !== channel || row.request_version !== requestVersion) {
    log(400, eventId, 'binding mismatch'); return send(res, 400, { error: 'BINDING_MISMATCH' })
  }

  // 6+7: dedupe and the state change commit together inside the function, one transaction.
  // If processing raises, the event row rolls back with it, so a retry is not wrongly rejected.
  const digest = crypto.createHash('sha256').update(raw).digest('hex')
  const r = await fetch(`${BASE}/rest/v1/rpc/accept_pickup_webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SVC },
    body: JSON.stringify({
      p_attempt: attemptId, p_available: available, p_decline: declineReason,
      p_request_version: requestVersion, p_event_id: eventId, p_payload_sha256: digest,
    }),
  })
  const text = await r.text()
  if (!r.ok) {
    const msg = (() => { try { return JSON.parse(text || '{}').message } catch { return null } })()
    log(r.status, eventId, 'rejected: ' + (msg || 'unknown'))
    if (msg === 'EVENT_ID_CONFLICT') return send(res, 409, { error: 'EVENT_ID_CONFLICT' })
    return send(res, r.status, { error: 'REJECTED', detail: msg })
  }

  let status = 'recorded'
  try { status = JSON.parse(text) } catch { /* plain text */ }
  if (status === 'duplicate') { log(200, eventId, 'duplicate'); return send(res, 200, { status: 'duplicate' }) }
  if (status === 'rejected_state') { log(409, eventId, 'rejected_state'); return send(res, 409, { status: 'rejected_state' }) }

  log(200, eventId, 'recorded')
  return send(res, 200, { status })
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/webhooks/coordination/reply')) {
    return send(res, 404, { error: 'NOT_FOUND' })
  }
  try { await handleReply(req, res) }
  catch (e) { log(500, null, e.message); if (!res.headersSent) send(res, 500, { error: 'INTERNAL' }) }
})

await db.connect()
server.listen(PORT, '127.0.0.1', () => console.log(`webhook-reply-server on 127.0.0.1:${PORT}`))

for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, async () => { server.close(); await db.end().catch(() => {}); process.exit(0) })
}
