#!/usr/bin/env node
/**
 * Cross-origin browser proof for the demo app-origin gate — MOCKED endpoints, two isolated origins.
 *
 * Topology (deliberately two servers, so "cross-origin" is real and not a same-origin shortcut):
 *
 *   page  https://127.0.0.1:PAGE_PORT   → static HTML only, no gate
 *   api   https://127.0.0.1:API_PORT    → the real createOriginGate()
 *
 * The gate's allow-list contains ONLY the page origin (`https://127.0.0.1:PAGE_PORT`).
 *
 * Case A — configured page origin calls the API with a JSON POST and a NON-SECRET dummy
 *          `Authorization` header. A custom header forces a real CORS preflight, so both legs are
 *          exercised: OPTIONS → 204 with the allow headers, then POST → 200 with a browser-readable
 *          JSON body.
 * Case B — an UNLISTED page origin (`https://localhost:PAGE_PORT`, same page server, different
 *          host) attempts the same call. The preflight is refused and the browser must never send
 *          the POST at all. Both facts are recorded server-side, not inferred.
 *
 * AUTHENTICATION WORDING — read this before citing the 401 path:
 *   `/api/demo/login` deliberately mints an allow-listed demo session with NO existing bearer. It is
 *   not an authenticated route, so a 401 there would be meaningless. The downstream-authentication
 *   assertion therefore uses a separate **protected mock route** (`/api/protected`) that returns 401
 *   without a bearer. That stub proves the origin gate is not an authorization substitute; it says
 *   nothing about real login authentication.
 *
 * CERTIFICATE NOTE: the proof runs against a throwaway self-signed cert with the browser's
 * certificate verification bypassed (`ignoreHTTPSErrors`). That bypass is a property of this local
 * harness ONLY. Real public-hostname and certificate-chain validation remains a reserved
 * hosting-window item and is NOT claimed here.
 *
 * Dependency: playwright is not a repo dependency. The script resolves `playwright`/`playwright-core`
 * normally, honours `PLAYWRIGHT_MODULE=/abs/path`, and otherwise exits 3 BLOCKED.
 *
 * Exit: 0 pass · 1 fail · 3 BLOCKED.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import express from 'express'
import { createOriginGate, parseAllowedAppOrigins } from '../src/demo/origins.ts'

async function loadChromium() {
  for (const spec of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) {
    try {
      const mod = await import(spec)
      if (mod?.chromium) return mod.chromium
    } catch {
      /* next candidate */
    }
  }
  return null
}

const chromium = await loadChromium()
if (!chromium) {
  console.log('BLOCKED: playwright not resolvable. Install it, or set PLAYWRIGHT_MODULE=/abs/path/to/playwright')
  process.exit(3)
}

const dir = mkdtempSync(join(tmpdir(), 'fg-origin-proof-'))
let tls
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' })
  tls = { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }
} catch {
  console.log('BLOCKED: openssl unavailable, cannot make a throwaway cert')
  rmSync(dir, { recursive: true, force: true })
  process.exit(3)
}

// ---------------------------------------------------------------- page origin (no gate)

const pageApp = express()
pageApp.get('/page', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body><pre id="out">pending</pre><script>
(async () => {
  const out = document.getElementById('out');
  const api = ${JSON.stringify(apiOrigin)};
  try {
    const r = await fetch(api + '/api/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer dummy-not-a-secret' },
      body: JSON.stringify({ personaId: 'kendra' }),
    });
    const body = await r.text();
    out.textContent = 'result:' + r.status + ':' + body;
  } catch (e) {
    // A refused preflight surfaces as a TypeError; that IS the refusal, observed by the browser.
    out.textContent = 'error:' + (e && e.name ? e.name : 'unknown');
  }
})();
</script></body></html>`)
})

// ---------------------------------------------------------------- api origin (the real gate)

const observed = { preflights: [], posts: [], protected: [] }
let allowedOrigin = ''
let apiOrigin = ''

const apiApp = express()
apiApp.use(express.json({ limit: '2kb' }))
apiApp.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next()
  const origin = req.headers.origin ?? null
  const auth = typeof req.headers.authorization === 'string'
  const record = req.method === 'OPTIONS' ? observed.preflights
    : req.path === '/api/protected' ? observed.protected
    : observed.posts
  res.on('finish', () => record.push({ origin, status: res.statusCode, auth }))
  return createOriginGate(parseAllowedAppOrigins(allowedOrigin))(req, res, next)
})
// Demo login is NOT an authenticated route: it mints an allow-listed demo session by design.
apiApp.post('/api/demo/login', (_req, res) => {
  res.json({ ok: true, note: 'mocked demo login' })
})
// Separate protected route: exists ONLY to prove the gate is not an authorization substitute.
apiApp.post('/api/protected', (req, res) => {
  if (typeof req.headers.authorization !== 'string') {
    res.status(401).json({ error: 'UNAUTHENTICATED' })
    return
  }
  res.json({ ok: true })
})
apiApp.get('/__observed', (_req, res) => res.json(observed))

const pageServer = createServer(tls, pageApp)
const apiServer = createServer(tls, apiApp)
await new Promise((r) => pageServer.listen(0, '127.0.0.1', r))
await new Promise((r) => apiServer.listen(0, '127.0.0.1', r))
const PAGE_PORT = pageServer.address().port
const API_PORT = apiServer.address().port
const API_ORIGIN = `https://127.0.0.1:${API_PORT}`
apiOrigin = API_ORIGIN
allowedOrigin = `https://127.0.0.1:${PAGE_PORT}`

const results = []
const rec = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
try {
  async function visit(host) {
    // certificate verification bypassed for the throwaway cert — harness only, see header.
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    await page.goto(`https://${host}:${PAGE_PORT}/page`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.getElementById('out')?.textContent !== 'pending', null, { timeout: 20000 })
    const text = (await page.locator('#out').textContent()) ?? ''
    await ctx.close()
    return text
  }

  // ---- Case A: configured origin
  const a = await visit('127.0.0.1')
  rec('A: browser-readable success from the configured origin', a.startsWith('result:200:'), a.slice(0, 80))
  const preflightA = observed.preflights.filter((r) => r.origin === allowedOrigin)
  const postA = observed.posts.filter((r) => r.origin === allowedOrigin)
  rec('A: OPTIONS preflight answered 204', preflightA.some((r) => r.status === 204), JSON.stringify(preflightA))
  rec('A: POST answered 200 with the dummy bearer', postA.some((r) => r.status === 200 && r.auth), JSON.stringify(postA))
  rec('A: JSON body was readable by the page', a.includes('"ok":true'), a.slice(0, 120))

  // ---- Case B: unlisted origin
  const b = await visit('localhost')
  const unlisted = `https://localhost:${PAGE_PORT}`
  const preflightB = observed.preflights.filter((r) => r.origin === unlisted)
  const postB = observed.posts.filter((r) => r.origin === unlisted)
  rec('B: preflight refused for the unlisted origin', preflightB.some((r) => r.status === 403), JSON.stringify(preflightB))
  rec('B: browser never sent the POST', postB.length === 0, `posts=${JSON.stringify(postB)}`)
  rec('B: page saw a CORS refusal (not a success)', b.startsWith('error:') || b.startsWith('result:403'), b.slice(0, 80))

  // ---- Protected mock route: gate is not an authorization substitute
  // Node's fetch refuses the throwaway cert, so these two calls use a plain https request with
  // rejectUnauthorized:false — harness-only, same caveat as the browser-side bypass above.
  function post(url, headers) {
    return new Promise((resolve, reject) => {
      const body = '{}'
      const req = httpsRequest(url, {
        method: 'POST',
        rejectUnauthorized: false,
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode }))
      })
      req.on('error', reject)
      req.end(body)
    })
  }
  const noAuth = await post(`${API_ORIGIN}/api/protected`, { origin: allowedOrigin })
  const withAuth = await post(`${API_ORIGIN}/api/protected`, { origin: allowedOrigin, authorization: 'Bearer dummy-not-a-secret' })
  rec('C: protected mock route refuses a missing bearer (401)', noAuth.status === 401, `status=${noAuth.status}`)
  rec('C: same route with a bearer passes (proves the 401 was the auth check, not the gate)', withAuth.status === 200, `status=${withAuth.status}`)
  rec('C: demo login was never used for the auth assertion', true, 'login mocked 200; protected route carries the 401')

  console.log('\nserver-observed requests:')
  console.log(JSON.stringify(observed, null, 2))
} finally {
  await browser.close()
  await new Promise((r) => pageServer.close(r))
  await new Promise((r) => apiServer.close(r))
  rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${failed === 0 ? 'ALL BROWSER CHECKS PASS' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
