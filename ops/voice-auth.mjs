/**
 * Caller verification for the browser-voice routes, in plain Node (the voice-turn server runs as
 * `node --env-file=.env ops/voice-turn-server.mjs`, no TS loader). This MIRRORS src/auth/verify.ts —
 * the app's identity path — exactly: a Supabase-issued ES256 JWT verified against the project JWKS
 * (issuer + audience + exp), then `sub` mapped to a fixture person through data/identity-map.json.
 * Token length is NOT authentication; a token that is missing, malformed, unsigned, for the wrong
 * issuer/audience, or EXPIRED fails closed here, before any paid provider is touched.
 *
 * Kept byte-for-byte aligned with verify.ts (same algorithms/audience/issuer/clock-tolerance/claims);
 * if that file changes, change this too.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ALGORITHMS = ['ES256']
const AUDIENCE = 'authenticated'
const CLOCK_TOLERANCE_SECONDS = 5

const base = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const issuer = () => `${base()}/auth/v1`

let jwksCache = null
function defaultGetJwks() {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL(`${base()}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    })
  }
  return jwksCache
}

let cachedMap = {}
let cachedMtimeMs = -1
function defaultIdentityMap() {
  const path = process.env.IDENTITY_MAP_PATH ?? join(process.cwd(), 'data', 'identity-map.json')
  if (!existsSync(path)) return {}
  const mtimeMs = statSync(path).mtimeMs
  if (mtimeMs === cachedMtimeMs) return cachedMap
  try { cachedMap = JSON.parse(readFileSync(path, 'utf8')); cachedMtimeMs = mtimeMs } catch { return {} }
  return cachedMap
}

/** Injectable for tests (jwtVerify/getJwks/identityMap). Returns an async verifyBearer(header). */
export function createVerifier(opts = {}) {
  const verify = opts.jwtVerify ?? jwtVerify
  const getJwks = opts.getJwks ?? defaultGetJwks
  const identityMap = opts.identityMap ?? defaultIdentityMap
  return async function verifyBearer(header) {
    if (!header || String(header).trim() === '') return { ok: false, reason: 'missing' }
    const match = String(header).match(/^Bearer\s+(.+)$/i)
    if (!match) return { ok: false, reason: 'malformed' }
    try {
      const { payload } = await verify(match[1].trim(), getJwks(), {
        issuer: issuer(), audience: AUDIENCE, algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS, requiredClaims: ['sub', 'exp', 'iss', 'aud'],
      })
      const sub = payload.sub
      if (!sub) return { ok: false, reason: 'invalid', detail: 'no sub' }
      const personId = identityMap()[sub]
      if (!personId) return { ok: false, reason: 'unmapped' }
      return { ok: true, personId, sub }
    } catch (error) {
      return { ok: false, reason: 'invalid', detail: error?.code ?? 'verification failed' }
    }
  }
}

export const verifyBearer = createVerifier()
