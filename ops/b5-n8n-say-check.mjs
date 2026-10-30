#!/usr/bin/env node
/**
 * ops/b5-n8n-say-check.mjs — B5's last requirement: re-prove ONE call through n8n after D5.
 *
 * Posts a real reply into the n8n webhook (no SMS is sent), then reads the response body that the
 * n8n "Call Voice Turn" node actually received, so the `say` line is evidence from the deployed
 * workflow rather than from a direct call to the server.
 *
 * Never prints the action token or the n8n key.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { tokenForPersonId } from './auth.mjs'

const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const N8N = (env.N8N_BASE_URL || 'https://fns2.app.n8n.cloud').replace(/\/$/, '')
const TOKEN = env['FG_GHL_' + 'ACTION_TOKEN']
const N8N_KEY = env['N8N_' + 'API_KEY']
const API = (env.SUPABASE_URL || '').replace(/\/$/, '')
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const WF = 'addWpgFfxXmq7GF1'

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let failed = 0
const check = (label, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (expected ${want})`}`)
}

await db.query(`update attempts set closed_at = now(), closed_reason = 'B5_RESET' where closed_at is null`)

const mom = await tokenForPersonId('p_mom')
const RUN = Date.now().toString(36)
const jr = await fetch(`${API}/rest/v1/rpc/request_pickup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: SVC, authorization: `Bearer ${mom}` },
  body: JSON.stringify({ p_child: 'p_nora', p_as_of: '2026-10-28', p_window: `b5-${RUN}` }),
})
if (!jr.ok) { console.log('request_pickup failed', jr.status, (await jr.text()).slice(0, 200)); process.exit(1) }
const job = (await jr.text()).replace(/"/g, '')
const att = (await db.query(
  `select id from attempts where job_id=$1 and candidate_id='p_tasha' and closed_at is null`, [job])).rows[0]?.id
if (!att) { console.log('no attempt for p_tasha'); process.exit(1) }
console.log(`job ${job}  attempt ${att}`)

const started = Date.now()
const r = await fetch(`${N8N}/webhook/ghl-reply`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-FG-Action-Token': TOKEN },
  body: JSON.stringify({ attemptId: att, message: 'Yes, I can!' }),
})
const body = await r.text()
console.log(`n8n replied ${r.status} ${body}`)
check('n8n accepted the reply', r.status, 200)

// Give n8n a moment to finish writing the execution, then read it back.
let say = null
const execId = await (async () => {
  for (let i = 0; i < 10; i++) {
    const er = await fetch(`${N8N}/api/v1/executions?workflowId=${WF}&limit=3`, {
      headers: { ['X-N8N-' + 'API-KEY']: N8N_KEY },
    })
    const j = await er.json()
    const hit = (j.data || []).find((e) => new Date(e.startedAt).getTime() >= started - 1000)
    if (hit) return hit.id
    await new Promise((res) => setTimeout(res, 400))
  }
  return null
})()
if (!execId) { console.log('no execution found'); process.exit(1) }

const ex = await (await fetch(`${N8N}/api/v1/executions/${execId}?includeData=true`, {
  headers: { ['X-N8N-' + 'API-KEY']: N8N_KEY },
})).json()
const runData = ex?.data?.resultData?.runData ?? {}
for (const [name, runs] of Object.entries(runData)) {
  for (const run of runs) {
    for (const branch of (run.data?.main || [])) {
      for (const item of (branch || [])) {
        const b = item.json?.body
        const parsed = typeof b === 'string' ? (() => { try { return JSON.parse(b) } catch { return null } })() : b
        if (parsed && typeof parsed.say === 'string') {
          console.log(`  node "${name}" received say: ${parsed.say}`)
          if (!say && parsed.say) say = parsed.say
        }
      }
    }
  }
}

check('the tunnel returned a say line through n8n', say !== null, true)
check('the line names the requester', say?.includes('Kendra'), true)
check('the line names the child', say?.includes('Nora'), true)
check('the line reads no placeholder', !/\{|\}|\[Requester\]|\[Child\]/.test(say || ''), true)

// Leave nothing open: this script's job would otherwise hold all four contacts' only slot, and the
// next pickup request would legitimately create no attempts at all (D2 working as designed).
await db.query(`update attempts set closed_at = now(), closed_reason = 'B5_DONE' where job_id=$1`, [job])
await db.query(`delete from coordination_jobs where id=$1`, [job])

await db.end()
if (failed) { console.log(`\nB5 N8N CHECK FAILED (${failed})`); process.exit(1) }
console.log('\nB5 N8N CHECK OK')
