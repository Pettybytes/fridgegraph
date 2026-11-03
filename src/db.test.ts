import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbErrorCode, dataError } from './db'

// The defect this guards: Activity's villager-additions read failed with Postgres 42501 and the
// server called it DB_UNAVAILABLE, so a missing GRANT read as a database outage. It must be its own
// code — and it must never become UNAUTHORIZED, because the caller was allowed and the server was not.

test('insufficient_privilege is classified as a privilege defect, not an outage', () => {
  assert.equal(dbErrorCode({ code: '42501' }), 'DB_PRIVILEGE')
})

test('other database failures stay DB_UNAVAILABLE', () => {
  assert.equal(dbErrorCode({ code: '42P01' }), 'DB_UNAVAILABLE')
  assert.equal(dbErrorCode({ code: '57014' }), 'DB_UNAVAILABLE')
  assert.equal(dbErrorCode({}), 'DB_UNAVAILABLE')
})

test('the returned code is opaque and leaks no database detail', () => {
  const error = dataError({ code: '42501', message: 'permission denied for table villager_proposals' })
  assert.equal(error.message, 'DB_PRIVILEGE')
  assert.deepEqual(error.extensions, { code: 'DB_PRIVILEGE' })
  assert.ok(!/villager_proposals|permission denied/.test(error.message))
})

test('a privilege defect is never reported as an authorization refusal', () => {
  const error = dataError({ code: '42501' })
  assert.notEqual(error.extensions?.code, 'UNAUTHORIZED')
  assert.notEqual(error.extensions?.code, 'UNAUTHENTICATED')
})
