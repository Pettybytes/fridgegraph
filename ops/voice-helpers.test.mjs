/**
 * voice-helpers tests — the browser-voice server honors the bounded conversation history the client
 * sends (the fix for the old history:[] that gave voice turns no memory), and ignores anything
 * malformed. Run: node --test ops/voice-helpers.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHistory } from './voice-helpers.mjs'

// The client encodes with btoa(unescape(encodeURIComponent(JSON))) — base64 of the UTF-8 JSON bytes.
const encodeLikeClient = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')

test('decodes a base64 header into normalized history (incl. UTF-8)', () => {
  const history = [{ role: 'user', content: 'quand est la fête de Noé? 🎉' }, { role: 'assistant', content: 'Vendredi.' }]
  assert.deepEqual(parseHistory(encodeLikeClient(history)), history)
})

test('empty / malformed input yields no history (never throws)', () => {
  assert.deepEqual(parseHistory(undefined), [])
  assert.deepEqual(parseHistory(''), [])
  assert.deepEqual(parseHistory('@@not base64@@'), [])
  assert.deepEqual(parseHistory(encodeLikeClient({ not: 'an array' })), [])
})

test('normalizes roles, drops empty content, caps at 40 messages', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'ROSINA' : 'user', content: `m${i}` }))
  const out = parseHistory(encodeLikeClient(many))
  assert.equal(out.length, 40) // last 40
  assert.equal(out[0].content, 'm10')
  assert.ok(out.every((m) => m.role === 'user' || m.role === 'assistant')) // unknown role → 'user'
  // empties removed
  assert.deepEqual(parseHistory(encodeLikeClient([{ role: 'user', content: '' }, { role: 'user', content: 7 }, { role: 'user', content: 'ok' }])), [{ role: 'user', content: 'ok' }])
})

test('clamps very long content to 4000 chars', () => {
  const out = parseHistory(encodeLikeClient([{ role: 'user', content: 'x'.repeat(5000) }]))
  assert.equal(out[0].content.length, 4000)
})
