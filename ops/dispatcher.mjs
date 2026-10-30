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
const K_DISPATCH = ['FG','DISPATCH','TOKEN'].join('_')
const TOKEN = env[K_DISPATCH]

export const dispatchShape = ({ attemptId, contactId, channel }) => ({ attemptId, contactId, channel })

export async function dispatchAttempt({ attemptId, contactId, channel }, opts = {}) {
  if (!attemptId || !contactId) throw new Error('attemptId and contactId are required')
  if (!['SMS', 'CALL'].includes(channel)) throw new Error('channel must be SMS or CALL')
  const body = dispatchShape({ attemptId, contactId, channel })

  if (opts.dry) return { dry: true, url: `${N8N}/webhook/fridgegraph-dispatch`, body }
  if (!TOKEN) throw new Error('FG_DISPATCH_TOKEN missing from .env (ops/set-env-secret.sh FG_DISPATCH_TOKEN)')

  const r = await fetch(`${N8N}/webhook/fridgegraph-dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-FG-Dispatch-Token': TOKEN },
    body: JSON.stringify(body),
  })
  return { status: r.status, text: await r.text() }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const [, , a, b, c] = process.argv
  if (a === '--dry') {
    console.log(JSON.stringify(await dispatchAttempt(
      { attemptId: 'att_example', contactId: 'ghl_contact_example', channel: 'CALL' }, { dry: true }), null, 2))
    console.log('dry run: nothing sent. Dispatch remains INACTIVE.')
  } else if (a) {
    console.log(JSON.stringify(await dispatchAttempt({ attemptId: a, contactId: b, channel: c }), null, 2))
  } else {
    console.log('usage: node ops/dispatcher.mjs --dry | <attemptId> <contactId> <SMS|CALL>')
    process.exit(2)
  }
}
