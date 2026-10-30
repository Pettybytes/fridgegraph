#!/usr/bin/env node
/**
 * ops/e2-mint-probe.mjs — does the PRIMARY session-mint path work on this project?
 *
 * Design constraint: Supabase Auth issues the session; we never sign tokens. The primary path is
 *   admin.generateLink({ type: 'magiclink', email })   [service role, server-side]
 *   verifyOtp({ token_hash, type: 'magiclink' })       [one fresh client per request]
 * No password is involved anywhere.
 *
 * Prints outcomes only: booleans, counts, metadata key names. Never a link, OTP, token hash,
 * access token, refresh token or user id.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const MAP = JSON.parse(readFileSync('data/identity-map.json', 'utf8'))
const url = env.SUPABASE_URL.replace(/\/$/, '')
const service = env.SUPABASE_SERVICE_ROLE_KEY
const publishable = env.SUPABASE_PUBLISHABLE_KEY
const email = 'kendra.ellison@example.com'

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const anon = createClient(url, publishable, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

console.log('1. admin.generateLink(magiclink)')
const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (link.error) {
  console.log('   FAILED:', link.error.status, link.error.code ?? '(no code)', String(link.error.message).slice(0, 80))
  process.exit(1)
}
const hashed = link.data?.properties?.hashed_token
console.log('   ok; hashed token present:', Boolean(hashed), '; verification type:', link.data?.properties?.verification_type)

console.log('2. verifyOtp(token_hash, magiclink) on a fresh client')
const verified = await anon.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' })
if (verified.error) {
  console.log('   FAILED:', verified.error.status, verified.error.code ?? '(no code)', String(verified.error.message).slice(0, 80))
  process.exit(1)
}
const session = verified.data?.session
const user = verified.data?.user
console.log('   ok; session issued:', Boolean(session?.access_token), '; refresh token present:', Boolean(session?.refresh_token))
console.log('   user id maps to:', MAP[user?.id] ?? 'NOT IN IDENTITY MAP')
console.log('   app_metadata keys:', Object.keys(user?.app_metadata ?? {}).join(',') || '(none)')
console.log('   demo marker:', user?.app_metadata?.demo === true)
console.log('   guide marker:', user?.app_metadata?.demo_guide === true)

// The access token must verify against the same JWKS the servers already use.
const { createRemoteJWKSet, jwtVerify } = await import('jose')
const jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`))
const { payload } = await jwtVerify(session.access_token, jwks, {
  issuer: `${url}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'],
})
console.log('3. existing verifier accepts the minted token: true')
console.log('   claim app_metadata.demo:', payload.app_metadata?.demo === true)
console.log('   claim app_metadata.demo_guide:', payload.app_metadata?.demo_guide === true)
