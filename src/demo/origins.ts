/**
 * App-origin allow-list for the demo endpoints.
 *
 * WHY THIS EXISTS
 * `originAllowed()` used to accept only `http://localhost` / `http://127.0.0.1`. That is correct for
 * local development and useless the moment judges reach the demo through a tunnel: a browser on
 * `https://app.<domain>` sends that exact origin and was refused with `ORIGIN_NOT_ALLOWED`, while a
 * non-browser caller (no `Origin` header) sailed through.
 *
 * RULES IMPLEMENTED HERE
 *   - Localhost development behaviour is preserved unchanged (`http://localhost[:port]`,
 *     `http://127.0.0.1[:port]`, `http://[::1][:port]`).
 *   - Additional public origins are EXPLICIT runtime configuration. The default is **none**.
 *   - Configured values are validated at load and rejected unless they are bare `https://` origins.
 *     Wildcards, the opaque string `null`, embedded credentials, non-https schemes and anything with
 *     a path/query/fragment are refused rather than normalised into something permissive.
 *   - Comparison is on the PARSED origin, so `https://app.example.com.evil.test` and
 *     `https://app.example.com:8443` do not match `https://app.example.com`.
 *   - The allow-list is never derived from `Host` or `X-Forwarded-*`, and an `Origin` value is only
 *     echoed back after it has been checked. Nothing here reads request headers to decide what is
 *     trusted, except the `Origin` being validated against a pre-computed set.
 *   - A request with NO `Origin` header still passes this gate, exactly as before — this gate is not
 *     authentication. Authentication and authorization remain downstream and are unaffected.
 *
 * DELIBERATELY NOT HERE
 *   - This is the API app-origin list only. It is not a CSP `frame-ancestors` / embedding-page list;
 *     those are different policies with different trust models and must stay separate.
 *   - Environment variable NAME only; values are supplied at deployment.
 */
import type { NextFunction, Request, Response } from 'express';

export const ALLOWED_APP_ORIGINS_ENV = 'DEMO_ALLOWED_APP_ORIGINS';

export class OriginConfigError extends Error {
  constructor(message: string) {
    super(`${ALLOWED_APP_ORIGINS_ENV}: ${message}`);
    this.name = 'OriginConfigError';
  }
}

/** Local development origins, unchanged from the original behaviour. */
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Validate one configured entry and return its canonical origin.
 * Throws rather than skipping: a typo in a security allow-list must not silently become "no rule".
 */
function normalizeConfiguredOrigin(entry: string): string {
  if (entry === 'null') throw new OriginConfigError('the opaque origin "null" is not allowed');
  if (entry.includes('*')) throw new OriginConfigError(`wildcards are not allowed ("${entry}")`);

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new OriginConfigError(`"${entry}" is not an absolute URL`);
  }

  if (url.username || url.password) {
    throw new OriginConfigError(`credentials are not allowed in an origin ("${entry}")`);
  }
  if (url.protocol !== 'https:') {
    throw new OriginConfigError(`only https origins are allowed for public access ("${entry}")`);
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new OriginConfigError(`"${entry}" must be a bare origin, with no path, query or fragment`);
  }
  // `url.origin` is already lowercase and default-port-normalised, which is what we compare against.
  if (url.origin === 'null') throw new OriginConfigError(`"${entry}" does not resolve to an origin`);
  return url.origin;
}

/**
 * Parse the comma-separated allow-list. Absent/empty means "no additional public origins" — the
 * default, and what local development runs with.
 */
export function parseAllowedAppOrigins(raw: string | undefined | null): ReadonlySet<string> {
  const out = new Set<string>();
  const value = (raw ?? '').trim();
  if (!value) return out;
  for (const part of value.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    out.add(normalizeConfiguredOrigin(entry));
  }
  return out;
}

/**
 * Is this request `Origin` acceptable? A missing header is acceptable here (non-browser callers) and
 * proves nothing about authorization — the routes still require a bearer token.
 */
export function isAllowedRequestOrigin(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  if (LOCAL_ORIGIN.test(origin)) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === 'null' || parsed.username || parsed.password) return false;
  // Exact comparison on the parsed origin: no prefix/suffix matching, no case games.
  return allowed.has(parsed.origin);
}

/** The canonical value to echo back, valid only after the origin has passed the check. */
function echoableOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    return parsed.origin === 'null' ? origin : parsed.origin;
  } catch {
    return origin;
  }
}

/**
 * Express middleware: gate, then CORS/preflight. Mounted before every demo route, so `OPTIONS` is
 * answered here and the required headers are declared explicitly.
 */
export function createOriginGate(allowed: ReadonlySet<string>) {
  return function originGate(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    const raw = req.headers.origin;
    const origin = typeof raw === 'string' ? raw : undefined;

    if (!isAllowedRequestOrigin(origin, allowed)) {
      res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      return;
    }

    if (origin) {
      // Only reachable for an origin that already matched; never a blanket reflection.
      res.setHeader('Access-Control-Allow-Origin', echoableOrigin(origin));
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      // `authorization` is required for bearer-authenticated cross-origin calls (reset, day reads).
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
