/**
 * App-origin allow-list tests.
 *
 * These cover the four behaviours the hosting boundary depends on:
 *   1. configured https origins are accepted exactly, and nothing that merely LOOKS like them;
 *   2. localhost development behaviour is unchanged;
 *   3. the middleware is exercised on a real Express app with a stubbed downstream handler, so
 *      "passes the gate" is proven to still be distinct from "is authorized";
 *   4. preflight declares POST/OPTIONS and `authorization`, because reset and day reads send a bearer.
 *
 * The downstream handler is a stub on purpose: this file tests the origin gate, not authentication.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
  ALLOWED_APP_ORIGINS_ENV,
  OriginConfigError,
  createOriginGate,
  isAllowedRequestOrigin,
  parseAllowedAppOrigins,
} from './origins';

const APP = 'https://app.example.com';

// ---------------------------------------------------------------- parsing / validation

test('empty configuration means no additional public origins', () => {
  assert.equal(parseAllowedAppOrigins(undefined).size, 0);
  assert.equal(parseAllowedAppOrigins('').size, 0);
  assert.equal(parseAllowedAppOrigins('   ').size, 0);
  assert.equal(parseAllowedAppOrigins(',').size, 0);
});

test('a bare https origin is accepted and canonicalised', () => {
  const set = parseAllowedAppOrigins(APP);
  assert.deepEqual([...set], [APP]);
  // trailing slash and uppercase host normalise to the same origin
  assert.deepEqual([...parseAllowedAppOrigins('https://App.Example.com/')], [APP]);
});

test('multiple origins are split on commas and trimmed', () => {
  const set = parseAllowedAppOrigins(` ${APP} , https://staging.example.com `);
  assert.deepEqual([...set].sort(), [APP, 'https://staging.example.com'].sort());
});

test('wildcards, opaque null, credentials and non-https are refused', () => {
  for (const bad of ['*', 'https://*.example.com', 'null', 'http://app.example.com', 'https://u:p@app.example.com']) {
    assert.throws(() => parseAllowedAppOrigins(bad), OriginConfigError, `expected refusal for ${bad}`);
  }
});

test('anything that is not a bare origin is refused', () => {
  for (const bad of ['https://app.example.com/path', 'https://app.example.com?x=1', 'https://app.example.com#frag', 'app.example.com', 'not a url']) {
    assert.throws(() => parseAllowedAppOrigins(bad), OriginConfigError, `expected refusal for ${bad}`);
  }
});

test('the error names the environment variable, so the failure is actionable', () => {
  assert.throws(() => parseAllowedAppOrigins('*'), new RegExp(ALLOWED_APP_ORIGINS_ENV));
});

// ---------------------------------------------------------------- comparison

test('a configured origin is allowed, and lookalikes are not', () => {
  const allowed = parseAllowedAppOrigins(APP);
  assert.equal(isAllowedRequestOrigin(APP, allowed), true);
  assert.equal(isAllowedRequestOrigin('https://app.example.com.evil.test', allowed), false);
  assert.equal(isAllowedRequestOrigin('https://evil.test', allowed), false);
  assert.equal(isAllowedRequestOrigin('https://app.example.com:8443', allowed), false);
  assert.equal(isAllowedRequestOrigin('http://app.example.com', allowed), false);
});

test('localhost development behaviour is preserved', () => {
  const allowed = parseAllowedAppOrigins(APP);
  for (const ok of ['http://localhost', 'http://localhost:5173', 'http://127.0.0.1:5189', 'http://[::1]:5173']) {
    assert.equal(isAllowedRequestOrigin(ok, allowed), true, ok);
  }
  assert.equal(isAllowedRequestOrigin('http://localhost.evil.test', allowed), false);
});

test('opaque and malformed origins are refused', () => {
  const allowed = parseAllowedAppOrigins(APP);
  assert.equal(isAllowedRequestOrigin('null', allowed), false);
  assert.equal(isAllowedRequestOrigin('not-a-url', allowed), false);
  assert.equal(isAllowedRequestOrigin('https://u:p@app.example.com', allowed), false);
});

test('a missing Origin is not itself a bypass decision', () => {
  const allowed = parseAllowedAppOrigins(APP);
  // The gate admits header-less callers (non-browser clients) exactly as before. Authorization is
  // enforced by the routes; the next test proves the request still reaches them and is refused.
  assert.equal(isAllowedRequestOrigin(undefined, allowed), true);
});

// ---------------------------------------------------------------- middleware on a real app

async function withServer(
  allowed: ReadonlySet<string>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(createOriginGate(allowed));
  // Demo login is intentionally NOT an authenticated route: it mints an allow-listed demo session
  // with no existing bearer. A 401 here would be meaningless, so this stub succeeds.
  app.post('/api/demo/login', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  // Separate protected mock route: exists only to prove the origin gate is not an authorization
  // substitute. It says nothing about real demo-login authentication.
  app.post('/api/protected', (req, res) => {
    if (typeof req.headers.authorization !== 'string') {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const allowed = parseAllowedAppOrigins(APP);

test('configured https origin reaches the demo login route', async () => {
  await withServer(allowed, async (base) => {
    const res = await fetch(`${base}/api/demo/login`, {
      method: 'POST',
      headers: { origin: APP, 'content-type': 'application/json' },
      body: '{"personaId":"kendra"}',
    });
    // Demo login is unauthenticated by design; success here means the gate admitted the origin.
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get('access-control-allow-origin'), APP);
    assert.equal(res.headers.get('vary'), 'Origin');
  });
});

test('unlisted, lookalike and opaque origins are refused with 403', async () => {
  await withServer(allowed, async (base) => {
    for (const origin of ['https://evil.test', 'https://app.example.com.evil.test', 'null']) {
      const res = await fetch(`${base}/api/demo/login`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 403, origin);
      assert.deepEqual(await res.json(), { error: 'ORIGIN_NOT_ALLOWED' });
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    }
  });
});

test('a missing Origin does NOT bypass authentication on a protected route', async () => {
  await withServer(allowed, async (base) => {
    const res = await fetch(`${base}/api/protected`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // Passes the origin gate (no header), then is refused by the PROTECTED route's own auth check.
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'UNAUTHENTICATED' });

    // And the same route succeeds with a bearer, which proves the 401 was the auth check and not
    // the gate refusing silently.
    const withAuth = await fetch(`${base}/api/protected`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer dummy-not-a-secret' },
      body: '{}',
    });
    assert.equal(withAuth.status, 200);
  });
});

test('localhost still works through the middleware', async () => {
  await withServer(allowed, async (base) => {
    const res = await fetch(`${base}/api/demo/login`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200); // reaches the route, i.e. not an origin refusal
  });
});

test('preflight declares POST/OPTIONS and the authorization header', async () => {
  await withServer(allowed, async (base) => {
    const res = await fetch(`${base}/api/demo/login`, {
      method: 'OPTIONS',
      headers: {
        origin: APP,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), APP);
    const methods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    assert.ok(methods.includes('POST'), methods);
    assert.ok(methods.includes('OPTIONS'), methods);
    const headers = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    assert.ok(headers.includes('authorization'), headers);
    assert.ok(headers.includes('content-type'), headers);
    assert.equal(res.headers.get('vary'), 'Origin');
  });
});

test('preflight from an unlisted origin is refused', async () => {
  await withServer(allowed, async (base) => {
    const res = await fetch(`${base}/api/demo/login`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
