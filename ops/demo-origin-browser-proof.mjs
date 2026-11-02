#!/usr/bin/env node
/**
 * Browser proof for the demo app-origin gate, against MOCKED endpoints.
 *
 * Proves: a real browser on a real https origin sends the `Origin` header this gate checks, the gate
 * admits a configured origin, refuses an unlisted one, and the server's own record agrees with what
 * the page experienced. Nothing about this proves the real hosted hostname — that remains the reserved
 * hosting-window proof.
 *
 * WHY PLAYWRIGHT: measured on this machine, headless Chrome driven with `--dump-dom` could not
 * complete ANY https navigation to a local self-signed server (empty DOM even for a static page).
 * Playwright's Chromium with `ignoreHTTPSErrors` does. This is a property of the runner, not the gate.
 *
 * DEPENDENCY: playwright is NOT a dependency of this repo (adding it would bloat CI for one manual
 * proof). The script therefore:
 *   - imports `playwright`/`playwright-core` normally if present,
 *   - accepts `PLAYWRIGHT_MODULE=/abs/path` to point at an install elsewhere,
 *   - otherwise exits 3 BLOCKED with instructions.
 *
 * Exit: 0 pass · 1 fail · 3 BLOCKED (no browser bindings).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { createOriginGate, parseAllowedAppOrigins } from '../src/demo/origins.ts'

async function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)
  for (const spec of candidates) {
    try {
      const mod = await import(spec)
      if (mod?.chromium) return mod.chromium
    } catch {
      /* try the next candidate */
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
let key, cert
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' })
  key = readFileSync(join(dir, 'k.pem'))
  cert = readFileSync(join(dir, 'c.pem'))
} catch {
  console.log('BLOCKED: openssl unavailable, cannot make a throwaway cert')
  rmSync(dir, { recursive: true, force: true })
  process.exit(3)
}

const recorded = []
let appOrigin = ''

const app = express()
app.use(express.json({ limit: '2kb' }))
app.use((req, res, next) => {
  if (req.path.startsWith('/__')) return next() // control plane, not under test
  // Record EVERY api request with its origin and final status, including refusals. Recording only in
  // the route handler would miss exactly the case this proof exists to show: a denied origin.
  if (req.path.startsWith('/api/')) {
    const origin = req.headers.origin ?? null
    res.on('finish', () => recorded.push({ origin, status: res.statusCode }))
  }
  return createOriginGate(parseAllowedAppOrigins(appOrigin))(req, res, next)
})
app.get('/probe', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body><pre id="out">pending</pre><script>
(async () => {
  const out = document.getElementById('out');
  try {
    const r = await fetch('/api/demo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'kendra' }),
    });
    out.textContent = 'result:' + r.status;
  } catch (e) {
    out.textContent = 'error:' + (e && e.name ? e.name : 'unknown');
  }
})();
</script></body></html>`)
})
app.post('/api/demo/login', (_req, res) => {
  res.json({ ok: true })
})
app.get('/__recorded', (_req, res) => res.json({ recorded }))

const server = createServer({ key, cert }, app)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
appOrigin = `https://127.0.0.1:${port}`

const results = []
const rec = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
try {
  async function probe(host) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    await page.goto(`https://${host}:${port}/probe`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.getElementById('out')?.textContent !== 'pending', null, { timeout: 20000 })
    const text = await page.locator('#out').textContent()
    await ctx.close()
    return text ?? ''
  }

  const allowed = await probe('127.0.0.1')
  rec('configured https origin accepted (browser)', allowed === 'result:200', allowed)

  const unlisted = await probe('localhost')
  // CORS means the page usually cannot read a 403 body; either outcome proves refusal happened.
  rec('unlisted origin refused (browser)', unlisted === 'error:TypeError' || unlisted === 'result:403', unlisted)

  const sawConfigured = recorded.some((r) => r.origin === appOrigin && r.status === 200)
  const sawUnlisted = recorded.some((r) => typeof r.origin === 'string' && r.origin.startsWith('https://localhost') && r.status === 403)
  rec('server admitted the configured origin', sawConfigured, JSON.stringify(recorded))
  rec('server refused the unlisted origin', sawUnlisted, JSON.stringify(recorded))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${failed === 0 ? 'ALL BROWSER CHECKS PASS' : `${failed} FAILED`}`)
process.exit(failed === 0 ? 0 : 1)
