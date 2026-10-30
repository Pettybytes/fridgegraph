/**
 * Verifies a Supabase-issued JWT and resolves it to a fixture person.
 *
 * The caller is whoever the *token* says, resolved through a server-side map. Email is never an
 * identity, and no client-supplied person id is trusted.
 *
 * FAIL CLOSED: anything not proven returns ok:false. Callers translate that into UNAUTHENTICATED.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Supabase signs these tokens with ES256. Nothing else is accepted, including HS256 and none. */
const ALGORITHMS = ['ES256'];
const CLOCK_TOLERANCE_SECONDS = 5;
const AUDIENCE = 'authenticated';

export type IdentityResult =
  | {
      ok: true;
      personId: string;
      sub: string;
      /**
       * Trusted markers, read ONLY from the verified token's `app_metadata`.
       *
       * `app_metadata` is server-writable only. A client can send `user_metadata`, a header or a
       * browser flag instead, and none of them reach here. Both markers default to false, so a
       * token minted before they existed can never be read as demo or guide.
       */
      demo: boolean;
      demoGuide: boolean;
    }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' | 'unmapped'; detail?: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedMap: Record<string, string> = {};
let cachedMtimeMs = -1;

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  return url.replace(/\/$/, '');
}

function issuer(): string {
  return `${supabaseUrl()}/auth/v1`;
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }
  return jwks;
}

function identityMapPath(): string {
  return process.env.IDENTITY_MAP_PATH ?? join(process.cwd(), 'data', 'identity-map.json');
}

/** Reloads when the file changes, so the map can be regenerated without restarting. */
function getIdentityMap(): Record<string, string> {
  const path = identityMapPath();
  if (!existsSync(path)) return {};
  const mtimeMs = statSync(path).mtimeMs;
  if (mtimeMs === cachedMtimeMs) return cachedMap;
  try {
    cachedMap = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    cachedMtimeMs = mtimeMs;
  } catch {
    return {};
  }
  return cachedMap;
}

export async function verifyBearer(header?: string): Promise<IdentityResult> {
  if (!header || header.trim() === '') return { ok: false, reason: 'missing' };

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'malformed' };

  try {
    const { payload } = await jwtVerify(match[1].trim(), getJwks(), {
      issuer: issuer(),
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'exp', 'iss', 'aud'],
    });

    const sub = payload.sub;
    if (!sub) return { ok: false, reason: 'invalid', detail: 'token has no sub' };

    const personId = getIdentityMap()[sub];
    if (!personId) return { ok: false, reason: 'unmapped', detail: 'sub is not a known person' };

    // Only the literal true (or the string "true") counts. Anything else is not a marker.
    const appMetadata = (payload as { app_metadata?: Record<string, unknown> }).app_metadata;
    const demo = appMetadata?.demo === true || appMetadata?.demo === 'true';
    const demoGuide = appMetadata?.demo_guide === true || appMetadata?.demo_guide === 'true';

    return { ok: true, personId, sub, demo, demoGuide };
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'verification failed';
    return { ok: false, reason: 'invalid', detail: code };
  }
}
