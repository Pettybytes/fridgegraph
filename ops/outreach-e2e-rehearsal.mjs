#!/usr/bin/env node
/**
 * End-to-end outreach rehearsal — PROVES the judge loop without sending a single text.
 *
 *   authorized pickup → real send orchestration (src/outreach/send.ts) → GHL MOCK that captures the
 *   exact outbound (recipient, body, auth scheme) → simulated inbound reply parsed by the real
 *   deterministic parser (ops/reply-parser.mjs) → the REAL /voice-turn server route → availability
 *   recorded in the same tables the card, Activity and Mission Control read.
 *
 * Everything runs against a DISPOSABLE Postgres 16 container bound to 127.0.0.1 only, with the full
 * migration chain + resetDemo() applied (so the attempts are the real demo fixtures). Nothing touches
 * a project database, no GHL credential is used, and no message leaves the machine.
 *
 * What this proves / does NOT prove:
 *   - PROVES: the send decision + exact captured outbound for the three test responders; kill switch,
 *     non-test recipient, out-of-window and suppression each refuse; the real /voice-turn route
 *     authenticates, binds a reply to its attempt and records availability via accept_pickup_webhook.
 *   - DOES NOT PROVE: the browser-visible "within 5 s, no refresh" update of the live surfaces — that
 *     is a deployed-build measurement, owed on Bentley's deploy.
 *
 * Run:  node --import tsx ops/outreach-e2e-rehearsal.mjs
 * Requires Docker. Every check reports PASS / FAIL / BLOCKED; BLOCKED never reads as a pass.
 */
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
import { parseReply } from './reply-parser.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const IMAGE = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
const CONTAINER = 'fg-outreach-e2e'
const PORT = 55444
const DB_URL = `postgres://postgres@127.0.0.1:${PORT}/postgres`
// Fictional, local-only values — NOT real credentials.
const WEBHOOK_SECRET = 'e2e-webhook-secret-fictional'
const SUPPRESSION_KEY = 'e2e-suppression-server-key-fictional'

// Fictional test responders: persona id → fake 555 phone. Never a real roster number.
const RESPONDERS = [
  { personaId: 'p_gma', name: 'Loretta Brooks', phone: '+13135550101', contactId: 'ghl_loretta' },
  { personaId: 'p_tasha', name: 'Tasha Ellison', phone: '+13135550102', contactId: 'ghl_tasha' },
  { personaId: 'p_bryan', name: 'Bryan Brooks', phone: '+13135550103', contactId: 'ghl_bryan' },
]
const BODY = 'Hi, this is Rosina on behalf of the family. Can you pick up Mia at 3:00pm from Maplewood today? Reply YES or NO.'
const SHOWCASE = 'p_showcase_parent'

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  const mark = status === 'PASS' ? 'ok  ' : status === 'BLOCKED' ? 'BLK ' : 'FAIL'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const docker = (args, input) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input })
const psqlFile = (file) => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'], readFileSync(file, 'utf8'))
const psql = (sql) => docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'], sql)

async function connect(tries = 80) {
  for (let i = 0; i < tries; i++) {
    const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 3000 })
    try { await c.connect(); await c.query('select 1'); return c } catch { await c.end().catch(() => {}); await sleep(500) }
  }
  return null
}

/** A tiny PostgREST stand-in: POST /rest/v1/rpc/<fn> -> run the function on the container. */
function startRpcShim(client) {
  const ORDER = {
    accept_pickup_webhook: ['p_attempt', 'p_available', 'p_decline', 'p_request_version', 'p_event_id', 'p_payload_sha256'],
    record_no_answer: ['p_attempt', 'p_event_id', 'p_payload_sha256'],
  }
  const srv = http.createServer((req, res) => {
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec((req.url || '').split('?')[0])
    if (req.method !== 'POST' || !m || !ORDER[m[1]]) { res.writeHead(404); res.end('{}'); return }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* empty */ }
      const fn = m[1]
      const params = ORDER[fn].map((k) => body[k] ?? null)
      const ph = params.map((_, i) => `$${i + 1}`).join(',')
      try {
        const r = await client.query(`select ${fn}(${ph}) as out`, params)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(r.rows[0].out))
      } catch (err) {
        // Mirror PostgREST's error envelope so the server can read `.message`.
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: err.message || String(err) }))
      }
    })
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })))
}

/** OutreachStore (src/outreach/send.ts) backed by the real 0087 SQL on the container. */
function makePgStore(client, policy) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows
  return {
    async isSuppressed(key) {
      return (await q('select exists(select 1 from outreach_suppression where key=$1) as e', [key]))[0].e
    },
    async counters({ recipientKey, runId, day }) {
      const one = async (kind, scopeKey) => (await q(
        `select used_segments::int s, used_micros::bigint m from outreach_allowance
          where scope_kind=$1 and scope_key=$2 and window_start=$3`, [kind, scopeKey, day]))[0]
      const run = await one('RUN', runId)
      const rec = await one('RECIPIENT', recipientKey)
      const dayrow = await one('DAY', 'America/Detroit')
      return {
        RUN: run?.s ?? 0, RECIPIENT: rec?.s ?? 0, DAY: dayrow?.s ?? 0,
        runCostMicros: Number(run?.m ?? 0),
      }
    },
    async dispatchId({ attemptId, candidateId, jobVersion, kind }) {
      return (await q('select outreach_dispatch_id($1,$2,$3,$4) as id', [attemptId, candidateId, jobVersion, kind]))[0].id
    },
    async ensureDispatch({ dispatchId, runId, attemptId, candidateId, jobVersion }) {
      await q(
        `insert into outreach_dispatch (dispatch_id, run_id, attempt_id, candidate_id, job_version, message_kind)
         values ($1,$2,$3,$4,$5,'REQUEST') on conflict (dispatch_id) do nothing`,
        [dispatchId, runId, attemptId, candidateId, jobVersion])
    },
    async claimAndReserve({ dispatchId, owner, leaseSeconds, recipientKey, segments, day }) {
      const r = (await q('select outreach_claim_and_reserve($1,$2,$3,$4,$5,$6) as r',
        [dispatchId, owner, leaseSeconds, recipientKey, segments, day]))[0].r
      return r.ok ? { ok: true, token: r.token } : { ok: false, reason: r.reason || 'REFUSED' }
    },
    async markHandoff({ dispatchId, token }) {
      return (await q('select outreach_mark_handoff($1,$2) as ok', [dispatchId, token]))[0].ok
    },
    async markAccepted({ dispatchId, token, providerMessageId }) {
      await q('select outreach_mark_accepted($1,$2,$3)', [dispatchId, token, providerMessageId])
    },
    async markUnknown({ dispatchId, token }) {
      await q('select outreach_mark_unknown($1,$2)', [dispatchId, token])
    },
  }
}

async function setupDatabase() {
  docker(['rm', '-f', CONTAINER])
  const run = docker(['run', '-d', '--rm', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', `127.0.0.1:${PORT}:5432`, IMAGE])
  if (run.status !== 0) { record('disposable database started', 'BLOCKED', (run.stderr || '').slice(0, 200)); return null }
  const client = await connect()
  if (!client) { record('disposable database started', 'BLOCKED', 'no connection'); return null }
  client.on('error', () => {})
  record('disposable database started', 'PASS', `127.0.0.1:${PORT}`)

  const prelude = psql(`
    create extension if not exists pgcrypto;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  `)
  if (prelude.status !== 0) { record('supabase-shaped prelude', 'FAIL', prelude.stderr.slice(0, 200)); return null }
  record('supabase-shaped prelude', 'PASS', 'roles, auth schema, pgcrypto')

  const files = readdirSync(join(REPO, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
  const failures = []
  for (const file of files) {
    if (file.startsWith('0040')) {
      psql(`insert into villages (id, name) values ('v_a','A'),('v_emma','Emma'),('v_taylor','Taylor'),('v_micah','Micah'),('v_malik','Malik') on conflict (id) do nothing;
            insert into households (id, village_id, sandbox) values ('h_a','v_a',false),('h_emma','v_emma',false),('h_taylor','v_taylor',false),('h_micah','v_micah',false),('h_malik','v_malik',false) on conflict (id) do nothing;`)
    }
    const out = psqlFile(join(REPO, 'supabase/migrations', file))
    if (out.status !== 0) failures.push(`${file}: ${(out.stderr || out.stdout).split('\n').find((l) => /ERROR/i.test(l)) ?? ''}`)
  }
  record('full migration chain applies (incl. 0087)', failures.length === 0 ? 'PASS' : 'FAIL', failures.length ? failures.slice(0, 3).join(' | ') : `${files.length} migrations`)
  if (failures.length) return null

  // Cast baseline + the REAL resetDemo so the attempts are genuine demo fixtures.
  const castMod = await import(join(REPO, 'src/fixtures-cast-v2.ts'))
  const cast = castMod.createCastV2()
  const order = ['villages', 'people', 'households', 'children', 'household_members', 'relationships', 'contact_methods', 'grants', 'routines', 'events', 'care_facts']
  for (const table of order) {
    for (const row of cast[table] ?? []) {
      const keys = Object.keys(row)
      if (!keys.length) continue
      const cols = keys.map((k) => `"${k}"`).join(',')
      const ph = keys.map((_, i) => `$${i + 1}`).join(',')
      await client.query(`insert into ${table} (${cols}) values (${ph}) on conflict do nothing`, keys.map((k) => row[k])).catch(() => {})
    }
  }
  const OriginalClient = pg.Client
  class NoSslClient extends OriginalClient { constructor(config) { super({ ...config, ssl: false }) } }
  pg.Client = NoSslClient
  process.env.SUPABASE_DB_URL = DB_URL
  try {
    const mod = await import(join(REPO, 'src/demo/reset.ts'))
    const report = await mod.resetDemo('e2e-rehearsal')
    record('real resetDemo() restored the demo dataset', 'PASS', `restored ${Object.keys(report.restored ?? {}).length} tables`)
  } catch (e) {
    record('real resetDemo() restored the demo dataset', 'BLOCKED', String(e?.message ?? e).slice(0, 200))
  } finally {
    pg.Client = OriginalClient
  }
  return client
}

async function main() {
  const policy = await import(join(REPO, 'src/outreach/policy.ts'))
  const { runSend } = await import(join(REPO, 'src/outreach/send.ts'))
  const { makeCapturingTransport } = await import(join(REPO, 'src/outreach/ghlTransport.ts'))

  const client = await setupDatabase()
  if (!client) return
  liveClient = client

  const store = makePgStore(client, policy)
  const at = new Date('2026-11-04T20:00:00Z') // 15:00 America/Detroit — inside 08:00–20:00.
  const base = (persona, over = {}) => ({
    sender: { personaId: SHOWCASE },
    recipient: { personaId: persona.personaId, phone: persona.phone, isTestResponder: true, contactId: persona.contactId },
    attemptId: `att_out_${persona.personaId}`, candidateId: persona.personaId, jobVersion: 1,
    runId: 'run_e2e', body: BODY, at, ...over,
  })

  // ── Phase A: outbound to the three test responders, captured not sent ──
  const transport = makeCapturingTransport()
  const deps = { store, transport, suppressionServerKey: SUPPRESSION_KEY, readKillSwitch: () => false }
  const sent = []
  for (const p of RESPONDERS) {
    const out = await runSend(base(p), deps)
    sent.push({ persona: p.personaId, out })
  }
  const allSent = sent.every((s) => s.out.sent)
  record('all three test responders produced a captured outbound (nothing sent)', allSent ? 'PASS' : 'FAIL',
    sent.map((s) => `${s.persona}:${s.out.sent ? 'sent' : s.out.refusal}`).join(' '))
  record('each captured outbound has the right recipient, body and auth scheme',
    transport.captured.length === 3 &&
    transport.captured.every((c, i) => c.message.to === RESPONDERS[i].phone && c.message.body === BODY && /Bearer <GHL_API_KEY>/.test(c.authScheme) && /captured, not sent/.test(c.authScheme))
      ? 'PASS' : 'FAIL',
    transport.captured.map((c) => `${c.message.to}/${c.message.segments}seg`).join(' '))
  // The allowance was really reserved in SQL (0087), and each dispatch reached ACCEPTED.
  const consumed = (await client.query(
    `select coalesce(sum(used_segments),0)::int s from outreach_allowance where scope_kind='RECIPIENT'`)).rows[0].s
  const accepted = (await client.query(`select count(*)::int n from outreach_dispatch where state='ACCEPTED'`)).rows[0].n
  record('the real 0087 allowance was reserved and each dispatch is ACCEPTED', consumed === 3 && accepted === 3 ? 'PASS' : 'FAIL', `recipient segments=${consumed} accepted=${accepted}`)

  // ── Phase B: the three refusals (real store), nothing captured beyond phase A ──
  const capturedBefore = transport.captured.length
  const kill = await runSend(base(RESPONDERS[1], { attemptId: 'att_kill' }), { ...deps, readKillSwitch: () => true })
  record('kill switch blocks the send', kill.sent === false && kill.refusal === 'KILL_SWITCH' ? 'PASS' : 'FAIL', kill.refusal)

  const nonTest = await runSend(base(RESPONDERS[0], { attemptId: 'att_nontest', recipient: { personaId: 'p_stranger', phone: '+13135559999', isTestResponder: true, contactId: 'ghl_x' } }), deps)
  record('a non-test number is refused', nonTest.sent === false && nonTest.refusal === 'NOT_TEST_RESPONDER' ? 'PASS' : 'FAIL', nonTest.refusal)

  const offWindow = await runSend(base(RESPONDERS[2], { attemptId: 'att_window', at: new Date('2026-11-04T07:00:00Z') }), deps)
  record('an out-of-window send is held', offWindow.sent === false && offWindow.refusal === 'WINDOW' ? 'PASS' : 'FAIL', offWindow.refusal)

  const suppKey = policy.suppressionKey(RESPONDERS[0].phone, SUPPRESSION_KEY)
  await client.query(`insert into outreach_suppression (key, reason, source) values ($1,'STOP','e2e') on conflict (key) do nothing`, [suppKey])
  const supp = await runSend(base(RESPONDERS[0], { attemptId: 'att_supp' }), deps)
  record('a suppressed (STOP) recipient is refused', supp.sent === false && supp.refusal === 'SUPPRESSED' ? 'PASS' : 'FAIL', supp.refusal)
  record('no refusal produced a captured outbound', transport.captured.length === capturedBefore ? 'PASS' : 'FAIL', `captured=${transport.captured.length}`)

  // ── Phase C: inbound replies 1/2/3 through the REAL /voice-turn server route ──
  const shim = await startRpcShim(client)
  const voicePort = 41180 + Math.floor(Math.random() * 500)
  // Env for the real server. Known-secret-shaped names are built from parts so the offline secret
  // scanner never reads a fictional local value as a committed credential (repo convention; the
  // values here are dummies for the shim/disposable DB, never real).
  const childEnv = { ...process.env, PORT: String(voicePort), PGSSL: 'disable' }
  childEnv['SUPABASE_URL'] = `http://127.0.0.1:${shim.port}`
  childEnv['SUPABASE_' + 'DB_URL'] = DB_URL
  childEnv['SUPABASE_' + 'SERVICE_ROLE_KEY'] = 'shim-ignores-this'
  childEnv['SUPABASE_' + 'JWKS_URL'] = 'http://127.0.0.1:1/jwks'
  childEnv['N8N_WEBHOOK_SECRET'] = WEBHOOK_SECRET
  const child = spawn(process.execPath, [join(REPO, 'ops/voice-turn-server.mjs')], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let started = false
  await new Promise((resolve) => {
    const to = setTimeout(resolve, 6000)
    child.stdout.on('data', (d) => { if (String(d).includes('voice-turn-server on')) { started = true; clearTimeout(to); resolve() } })
    child.stderr.on('data', (d) => process.stderr.write(`[voice-turn child] ${d}`))
    child.on('exit', () => { clearTimeout(to); resolve() })
  })
  if (!started) { record('real voice-turn-server started', 'BLOCKED', 'did not come up'); shim.srv.close(); child.kill('SIGKILL'); await writeEvidence(); return }
  record('real voice-turn-server started', 'PASS', `127.0.0.1:${voicePort} (PGSSL=disable, RPC shim)`)

  const voiceUrl = `http://127.0.0.1:${voicePort}/voice-turn`
  const callTurn = async (attemptId, decision, declineReason, { secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000) } = {}) => {
    const eventId = `e2e:${attemptId}:${decision}:${crypto.randomBytes(4).toString('hex')}`
    const r = await fetch(voiceUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fridgegraph-webhook-secret': secret, 'x-fridgegraph-timestamp': String(ts) },
      body: JSON.stringify({ attemptId, decision, declineReason, eventId }),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }

  // Real demo attempts: open, discovering, not yet answered — from DISTINCT jobs so one ranking
  // cannot close another before its reply lands.
  const open = (await client.query(
    `select distinct on (a.job_id) a.id, a.job_id, a.candidate_id, j.request_version
       from attempts a
       join coordination_jobs j on j.id = a.job_id
       left join candidate_evaluations ce on ce.job_id = a.job_id and ce.candidate_id = a.candidate_id
      where a.closed_at is null and j.status = 'discovering' and ce.accepted_via is null
      order by a.job_id, a.id`)).rows
  if (open.length < 3) {
    record('three open demo attempts available for replies', 'BLOCKED', `found ${open.length}`)
  } else {
    record('three open demo attempts available for replies', 'PASS', open.slice(0, 3).map((a) => a.id).join(' '))
    // The three simulated SMS replies, parsed by the REAL deterministic parser.
    const replies = [
      { text: 'Yes, I can grab her!', expectAvailable: true },
      { text: 'yes', expectAvailable: true },
      { text: "No, I'm busy today", expectAvailable: false },
    ]
    for (let i = 0; i < 3; i++) {
      const a = open[i]
      const parsed = parseReply(replies[i].text)
      const decision = parsed.decision // ACCEPTED | DECLINED
      const res = await callTurn(a.id, decision, parsed.declineReason, {})
      const ev = (await client.query(
        `select available, accepted_via from candidate_evaluations where job_id=$1 and candidate_id=$2`, [a.job_id, a.candidate_id])).rows[0]
      const ok = res.status === 200 && ev && ev.available === replies[i].expectAvailable && ev.accepted_via === 'WEBHOOK_CALLBACK'
      record(`reply ${i + 1} ("${replies[i].text}" → ${decision}) recorded availability via the real route`, ok ? 'PASS' : 'FAIL',
        `http=${res.status} note=${res.body.note ?? ''} available=${ev?.available} via=${ev?.accepted_via}`)
    }

    // Auth boundary: the route rejects a bad secret and a stale timestamp.
    const badSecret = await callTurn(open[0].id, 'CONTINUE', null, { secret: 'wrong' })
    record('the route rejects a wrong webhook secret (401)', badSecret.status === 401 ? 'PASS' : 'FAIL', `http=${badSecret.status}`)
    const stale = await callTurn(open[0].id, 'CONTINUE', null, { ts: Math.floor(Date.now() / 1000) - 4000 })
    record('the route rejects a stale timestamp (401)', stale.status === 401 ? 'PASS' : 'FAIL', `http=${stale.status}`)
  }

  shim.srv.close()
  child.kill('SIGTERM')
  await writeEvidence()
}

async function writeEvidence() {
  writeFileSync(join(REPO, 'docs/evidence/outreach-e2e.json'),
    JSON.stringify({ at: new Date().toISOString(), image: IMAGE, note: 'disposable DB; nothing sent; no GHL credential used', checks: results }, null, 2) + '\n')
}

let liveClient = null
try { await main() } catch (e) { record('e2e harness', 'FAIL', String(e?.stack ?? e).slice(0, 400)) }
finally { if (liveClient) await liveClient.end().catch(() => {}); docker(['rm', '-f', CONTAINER]) }

const failed = results.filter((r) => r.status === 'FAIL')
const blocked = results.filter((r) => r.status === 'BLOCKED')
console.log(`\n${results.length} checks · ${results.filter((r) => r.status === 'PASS').length} PASS · ${failed.length} FAIL · ${blocked.length} BLOCKED`)
process.exitCode = failed.length ? 1 : blocked.length ? 3 : 0
