import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginClientKey } from './server'

/**
 * The regression this guards: login keyed its per-IP window on `req.ip`, which behind cloudflared is
 * always the loopback peer — one bucket for every judge. These cases pin the resolver behaviour and,
 * just as importantly, pin that a spoofed header from an UNTRUSTED peer cannot choose a bucket.
 */
const req = (socket: string, forwardedFor?: string) => ({
  socket: { remoteAddress: socket },
  header: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? forwardedFor : undefined),
})

test('a caller behind the trusted proxy is keyed by the forwarded client address', () => {
  assert.equal(loginClientKey(req('127.0.0.1', '203.0.113.9')), '203.0.113.9')
})

test('the right-most untrusted hop wins, not the client-supplied left-most entry', () => {
  assert.equal(loginClientKey(req('127.0.0.1', '1.2.3.4, 203.0.113.9')), '203.0.113.9')
  assert.equal(loginClientKey(req('::1', '9.9.9.9, 198.51.100.4, 127.0.0.1')), '198.51.100.4')
})

test('a spoofed header from an UNTRUSTED peer is ignored', () => {
  assert.equal(loginClientKey(req('198.51.100.7', '127.0.0.1')), '198.51.100.7')
  assert.equal(loginClientKey(req('198.51.100.7', '10.0.0.1')), '198.51.100.7')
})

test('an all-trusted chain has no client identity and falls back to the peer', () => {
  assert.equal(loginClientKey(req('127.0.0.1', '127.0.0.1')), '127.0.0.1')
  assert.equal(loginClientKey(req('127.0.0.1')), '127.0.0.1')
})

test('two different callers no longer share one bucket', () => {
  const a = loginClientKey(req('127.0.0.1', '203.0.113.9'))
  const b = loginClientKey(req('127.0.0.1', '203.0.113.10'))
  assert.notEqual(a, b)
  assert.equal(a, loginClientKey(req('127.0.0.1', '203.0.113.9')))
})

test('a missing socket address still yields a stable opaque key', () => {
  assert.equal(loginClientKey({ socket: {}, header: () => undefined }), 'unknown')
})
