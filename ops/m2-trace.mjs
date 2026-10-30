#!/usr/bin/env node
/**
 * ops/m2-trace.mjs — trace ONE authenticated PickupCandidates request hop by hop.
 *
 * Logs only: hop name, HTTP status, non-secret JWT claims, the resolved person, and error text.
 * Never prints the bearer token, the password, or any key.
 *
 *   1. token    — sign in as p_mom, decode claims, verify signature against SUPABASE_JWKS_URL,
 *                 check iss/aud/exp against the real clock, resolve identity_map -> person.
 *   2. subgraph — access subgraph (4102), which OWNS pickupCandidates.
 *   3. router   — through 4012 (Apollo Router serves POST at /, not /graphql).
 *   4. mcp      — through the MCP tool on 5051, with the required initialize handshake.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tokenForPersonId, envValue } from './auth.mjs'

const OP = readFileSync('./ops/PickupCandidates.graphql', 'utf8')
const VARS = { childId: 'p_nora', asOf: '2026-10-26' }

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const decode = (jwt) => {
  const [h, p, sigPart] = jwt.split('.')
  return { header: JSON.parse(b64(h).toString()), payload: JSON.parse(b64(p).toString()), sigPart, raw: h + '.' + p }
}

const token = await tokenForPersonId('p_mom')
const { header, payload, sigPart } = decode(token)
const now = Math.floor(Date.now() / 1000)

console.log('== 1. token =***')
console.log('  alg=' + header.alg + ' kid=' + (header.kid ?? '(none)') + ' typ=' + (header.typ ?? '-'))
console.log('  iss=' + payload.iss)
console.log('  aud=' + payload.aud + '  role=' + (payload.role ?? '-'))
console.log('  sub=' + payload.sub)
console.log('  exp=' + new Date(payload.exp * 1000).toISOString() +
  ' (now ' + new Date(now * 1000).toISOString() + ') -> ' +
  (payload.exp > now ? 'VALID' : 'EXPIRED') + ' (' + Math.round((payload.exp - now) / 60) + ' min left)')

const jwksUrl = envValue('SUPABASE_JWKS_URL')
let sigOk = false
let keyFound = false
try {
  const jwks = await (await fetch(jwksUrl)).json()
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid)
  keyFound = Boolean(jwk)
  if (jwk) {
    const key = createPublicKey({ key: jwk, format: 'jwk' })
    // Supabase signs ES256 here; JWS uses the raw r||s form.
    const [, , sigB64] = token.split('.')
    const signingInput = Buffer.from(token.split('.').slice(0, 2).join('.'))
    sigOk = cryptoVerify('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, b64(sigB64))
  }
} catch (e) {
  console.log('  jwks fetch/verify failed: ' + e.message)
}
console.log('  jwks kid match=' + (keyFound ? 'yes' : 'NO'))
console.log('  signature: ' + (sigOk ? 'VERIFIED' : 'INVALID'))

const hostOf = (u) => { try { return new URL(u).host.split('.')[0] } catch { return '' } }
console.log('  iss project=' + hostOf(payload.iss) + ' jwks project=' + hostOf(jwksUrl) +
  ' -> ' + (hostOf(payload.iss) === hostOf(jwksUrl) ? 'match' : 'MISMATCH'))

const { default: pg } = await import('pg')
const db = new pg.Client({ connectionString: envValue('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } })
await db.connect()
const mapped = (await db.query('select person_id from identity_map where user_id = $1', [payload.sub])).rows[0]
const name = (await db.query('select display_name from people where id=$1', [mapped?.person_id ?? 'p_mom'])).rows[0]
console.log('  identity_map -> ' + (mapped?.person_id ?? 'NOT MAPPED') + ' (' + (name?.display_name ?? '?') + ')')
if (mapped?.person_id !== 'p_mom') {
  console.log('  p_mom IS Kendra: NO — STOP HERE')
  await db.end(); process.exit(1)
}
console.log('  p_mom IS Kendra: yes')

const gql = async (label, url) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ query: OP, variables: VARS }),
  })
  const text = await r.text()
  let errs = null, n = null
  try {
    const j = JSON.parse(text)
    errs = j.errors ? j.errors.map((e) => e.message).join(' | ') : null
    const c = j.data?.pickupCandidates
    n = Array.isArray(c) ? c.length : null
  } catch { errs = text.slice(0, 200) }
  console.log('  ' + label + ': HTTP ' + r.status + ' candidates=' + (n ?? '-') + (errs ? ' errors: ' + errs : ''))
  return { status: r.status, n, errs }
}

console.log('\n== 2. access subgraph directly (4102) ==')
await gql('access', 'http://127.0.0.1:4102/graphql')

console.log('\n== 3. router 4012 (POST /) ==')
await gql('router', 'http://127.0.0.1:4012/')

console.log('\n== 4. MCP 5051 (initialize, then tool call) ==')
{
  const base = 'http://127.0.0.1:5051/mcp'
  const common = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer ' + token,
  }
  const init = await fetch(base, {
    method: 'POST',
    headers: common,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {},
                clientInfo: { name: 'm2-trace', version: '1.0.0' } } }),
  })
  const sid = init.headers.get('mcp-session-id')
  console.log('  initialize: HTTP ' + init.status + ' session=' + (sid ? 'yes' : 'no'))

  if (sid) {
    await fetch(base, {
      method: 'POST',
      headers: { ...common, 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
  }

  const call = await fetch(base, {
    method: 'POST',
    headers: sid ? { ...common, 'mcp-session-id': sid } : common,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'PickupCandidates', arguments: VARS } }),
  })
  const text = await call.text()
  const flat = text.replace(/\s+/g, ' ')
  console.log('  tools/call: HTTP ' + call.status +
    ' isError=' + /"isError":true/.test(flat) +
    ' UNAUTHENTICATED=' + /UNAUTHENTICATED/i.test(flat))
  console.log('  body: ' + flat.slice(0, 400))
}

await db.end()
