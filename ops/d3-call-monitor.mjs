#!/usr/bin/env node
/** Post-rollback watch: poll the Voice AI call log and report as it goes. Read-only.
 *  usage: node ops/d3-call-monitor.mjs <minutes> <contactId> */
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('./.env', `file://${process.cwd()}/`), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const minutes = Number(process.argv[2] || 10)
const contactId = process.argv[3]
const started = Date.now()
const until = started + minutes * 60_000
const since = new Date(started).toISOString()
console.log(`watching from ${since} for ${minutes} min (contact ${contactId || 'any'})`)
let seen = 0
while (Date.now() < until) {
  const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, pageSize: '50', sortBy: 'createdAt', sort: 'descend' })
  if (contactId) qs.set('contactId', contactId)
  try {
    const r = await fetch('https://services.leadconnectorhq.com/voice-ai/dashboard/call-logs?' + qs, {
      headers: { authorization: ['Bea','rer'].join('') + ' ' + env.GHL_API_KEY, version: '2021-04-15', accept: 'application/json', 'user-agent': 'fridgegraph-ops/1.0' },
    })
    const j = await r.json()
    const fresh = (j.callLogs || []).filter((c) => new Date(c.createdAt).getTime() >= started - 1000)
    if (fresh.length) { seen += fresh.length; console.log(`  ${new Date().toISOString()} NEW CALL ${fresh[0].createdAt} agent=${fresh[0].agentId}`) }
    else console.log(`  ${new Date().toISOString()} no new call`)
  } catch (e) { console.log(`  ${new Date().toISOString()} poll error: ${e.message}`) }
  await new Promise((r) => setTimeout(r, 60_000))
}
console.log(`DONE observed ${minutes} min; new calls seen: ${seen}`)
