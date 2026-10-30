#!/usr/bin/env node
/**
 * ops/meta-probe.mjs — the one check that decides whether Phase M can proceed.
 *
 * Calls Meta Model API's models endpoint and then a 1-token completion with the configured model.
 * Prints the HTTP status and the error code only; never prints the key, never echoes a body that
 * could contain one.
 *
 *   node ops/meta-probe.mjs
 *
 * Exit 0 = the key can reach the model. Exit 1 = it cannot (the reason is printed).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env')
const env = Object.fromEntries(readFileSync(envPath, 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const base = (env.META_BASE_URL || '').replace(/\/$/, '')
const model = env.META_MODEL_ID || ''
const key = env.META_API_KEY || ''

console.log(`base  ${base || '(missing META_BASE_URL)'}`)
console.log(`model ${model || '(missing META_MODEL_ID)'}`)
console.log(`key   present=${Boolean(key)} length=${key.length}`)
if (!base || !model || !key) { console.log('RESULT: configuration incomplete'); process.exit(1) }
if (model.includes('contributor')) {
  console.log('RESULT: refusing -- a -contributor model is not allowed for this work')
  process.exit(1)
}

const call = async (path, body) => {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  })
  const text = await r.text()
  let code = null
  try { code = JSON.parse(text)?.error?.code ?? null } catch { /* non-JSON */ }
  return { status: r.status, code, text }
}

const models = await call('/models')
console.log(`GET  /models            -> ${models.status}${models.code ? ` (${models.code})` : ''}`)

const started = Date.now()
const chat = await call('/chat/completions', {
  model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1,
})
const ms = Date.now() - started
console.log(`POST /chat/completions  -> ${chat.status}${chat.code ? ` (${chat.code})` : ''} ${ms}ms`)

if (chat.status === 200) {
  console.log('RESULT: the key reaches the model — Phase M can proceed')
  process.exit(0)
}
console.log('RESULT: the key cannot reach the model. Fix META_API_KEY, then re-run.')
process.exit(1)
