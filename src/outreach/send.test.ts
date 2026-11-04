/**
 * Unit proof for the outreach send orchestration (src/outreach/send.ts) with an in-memory store and
 * a capturing transport. NOTHING is sent. Proves:
 *  - the three test responders each produce the exact captured outbound (E.164, body, auth scheme);
 *  - the kill switch blocks a send at the boundary;
 *  - a non-test recipient is refused before any claim;
 *  - an out-of-window send is held;
 *  - suppression, empty body, bad phone, a deferred kind, and a non-showcase sender are each refused
 *    without touching the provider.
 *
 * The phone numbers here are fictional 555-line test values, never a real roster number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSend, type OutreachStore, type SendRequest, SHOWCASE_PARENT_PERSONA } from './send'
import { makeCapturingTransport } from './ghlTransport'
import { suppressionKey, CAPS } from './policy'

const SERVER_KEY = 'unit-test-server-key'

// Fictional test responders — persona id → fake 555 phone. Not real numbers.
const RESPONDERS = {
  p_gma: { name: 'Loretta Brooks', phone: '+13135550101', contactId: 'ghl_loretta' },
  p_tasha: { name: 'Tasha Ellison', phone: '+13135550102', contactId: 'ghl_tasha' },
  p_bryan: { name: 'Bryan Brooks', phone: '+13135550103', contactId: 'ghl_bryan' },
} as const

/** Minimal in-memory OutreachStore that honours the claim/reserve/caps/handoff contract. */
function makeFakeStore(opts: { suppressed?: Set<string>; preUsedRecipient?: Record<string, number> } = {}): OutreachStore {
  const suppressed = opts.suppressed ?? new Set<string>()
  const dispatches = new Map<string, { state: string; token: string | null; handoff: boolean }>()
  const reservedByRecipient = new Map<string, number>(Object.entries(opts.preUsedRecipient ?? {}))
  let tokenSeq = 0
  return {
    async isSuppressed(key) {
      return suppressed.has(key)
    },
    async counters({ recipientKey }) {
      return { RUN: 0, RECIPIENT: reservedByRecipient.get(recipientKey) ?? 0, DAY: 0, runCostMicros: 0 }
    },
    async dispatchId({ attemptId, candidateId, jobVersion, kind }) {
      return `disp:${attemptId}:${candidateId}:${jobVersion}:${kind}`
    },
    async ensureDispatch({ dispatchId }) {
      if (!dispatches.has(dispatchId)) dispatches.set(dispatchId, { state: 'PENDING', token: null, handoff: false })
    },
    async claimAndReserve({ dispatchId, recipientKey, segments }) {
      const d = dispatches.get(dispatchId)
      if (!d || d.state !== 'PENDING') return { ok: false, reason: 'NOT_CLAIMABLE' }
      const already = reservedByRecipient.get(recipientKey) ?? 0
      if (already + segments > CAPS.RECIPIENT) return { ok: false, reason: 'LIMIT_RECIPIENT' }
      reservedByRecipient.set(recipientKey, already + segments)
      const token = `tok-${++tokenSeq}`
      d.state = 'CLAIMED'
      d.token = token
      return { ok: true, token }
    },
    async markHandoff({ dispatchId, token }) {
      const d = dispatches.get(dispatchId)
      if (!d || d.token !== token || d.state !== 'CLAIMED') return false
      d.state = 'HANDOFF_STARTED'
      d.handoff = true
      return true
    },
    async markAccepted({ dispatchId }) {
      const d = dispatches.get(dispatchId)
      if (d) d.state = 'ACCEPTED'
    },
    async markUnknown({ dispatchId }) {
      const d = dispatches.get(dispatchId)
      if (d) d.state = 'UNKNOWN'
    },
  }
}

function baseReq(personaId: keyof typeof RESPONDERS, over: Partial<SendRequest> = {}): SendRequest {
  const r = RESPONDERS[personaId]
  return {
    sender: { personaId: SHOWCASE_PARENT_PERSONA },
    recipient: { personaId, phone: r.phone, isTestResponder: true, contactId: r.contactId },
    attemptId: `att_${personaId}`,
    candidateId: personaId,
    jobVersion: 1,
    runId: 'run_demo',
    body: `Hi, this is Rosina on behalf of the family. Can you pick up Mia at 3:00pm from Maplewood today? Reply YES or NO.`,
    // 2026-11-04 15:00 America/Detroit (EST, UTC-5) — inside the 08:00–20:00 window.
    at: new Date('2026-11-04T20:00:00Z'),
    ...over,
  }
}

test('each of the three test responders produces an exact captured outbound (nothing sent)', async () => {
  const transport = makeCapturingTransport()
  const deps = { store: makeFakeStore(), transport, suppressionServerKey: SERVER_KEY, readKillSwitch: () => false }

  for (const persona of ['p_gma', 'p_tasha', 'p_bryan'] as const) {
    const out = await runSend(baseReq(persona), deps)
    assert.equal(out.sent, true, `${persona} should send`)
    if (!out.sent) return
    assert.equal(out.outbound.to, RESPONDERS[persona].phone)
    assert.equal(out.outbound.contactId, RESPONDERS[persona].contactId)
    assert.equal(out.outbound.channel, 'SMS')
    assert.ok(out.providerMessageId)
  }

  assert.equal(transport.captured.length, 3)
  assert.deepEqual(
    transport.captured.map((c) => c.message.to),
    [RESPONDERS.p_gma.phone, RESPONDERS.p_tasha.phone, RESPONDERS.p_bryan.phone],
  )
  // Auth scheme is Bearer GHL key + Version, and it is explicitly a capture (not sent).
  for (const c of transport.captured) {
    assert.match(c.authScheme, /Bearer <GHL_API_KEY>/)
    assert.match(c.authScheme, /captured, not sent/)
    assert.equal(c.message.segments, 1) // the body is one GSM-7 segment
  }
})

test('the kill switch blocks the send at the boundary — no capture, no provider call', async () => {
  const transport = makeCapturingTransport()
  const out = await runSend(baseReq('p_tasha'), {
    store: makeFakeStore(),
    transport,
    suppressionServerKey: SERVER_KEY,
    readKillSwitch: () => true,
  })
  assert.equal(out.sent, false)
  if (out.sent) return
  assert.equal(out.refusal, 'KILL_SWITCH')
  assert.equal(transport.captured.length, 0)
})

test('a non-test recipient is refused before any claim or send', async () => {
  const transport = makeCapturingTransport()
  const deps = { store: makeFakeStore(), transport, suppressionServerKey: SERVER_KEY, readKillSwitch: () => false }

  // Not on the roster at all.
  const stranger = await runSend(
    baseReq('p_gma', { recipient: { personaId: 'p_stranger', phone: '+13135559999', isTestResponder: true, contactId: 'ghl_x' } }),
    deps,
  )
  assert.equal(stranger.sent, false)
  if (!stranger.sent) assert.equal(stranger.refusal, 'NOT_TEST_RESPONDER')

  // On the roster but missing the fg-test-responder tag.
  const untagged = await runSend(
    baseReq('p_gma', { recipient: { personaId: 'p_gma', phone: RESPONDERS.p_gma.phone, isTestResponder: false, contactId: 'ghl_loretta' } }),
    deps,
  )
  assert.equal(untagged.sent, false)
  if (!untagged.sent) assert.equal(untagged.refusal, 'NOT_TEST_RESPONDER')

  assert.equal(transport.captured.length, 0)
})

test('an out-of-window send is held (02:00 Detroit), not sent', async () => {
  const transport = makeCapturingTransport()
  const out = await runSend(
    // 2026-11-04 02:00 America/Detroit → 07:00Z; before 08:00 local.
    baseReq('p_bryan', { at: new Date('2026-11-04T07:00:00Z') }),
    { store: makeFakeStore(), transport, suppressionServerKey: SERVER_KEY, readKillSwitch: () => false },
  )
  assert.equal(out.sent, false)
  if (!out.sent) assert.equal(out.refusal, 'WINDOW')
  assert.equal(transport.captured.length, 0)
})

test('a suppressed recipient is refused by the HMAC key, not the raw number', async () => {
  const key = suppressionKey(RESPONDERS.p_tasha.phone, SERVER_KEY)
  const transport = makeCapturingTransport()
  const out = await runSend(baseReq('p_tasha'), {
    store: makeFakeStore({ suppressed: new Set([key]) }),
    transport,
    suppressionServerKey: SERVER_KEY,
    readKillSwitch: () => false,
  })
  assert.equal(out.sent, false)
  if (!out.sent) assert.equal(out.refusal, 'SUPPRESSED')
  assert.equal(transport.captured.length, 0)
})

test('sender that is not the showcase parent is refused', async () => {
  const transport = makeCapturingTransport()
  const out = await runSend(baseReq('p_gma', { sender: { personaId: 'p_dana' } }), {
    store: makeFakeStore(),
    transport,
    suppressionServerKey: SERVER_KEY,
    readKillSwitch: () => false,
  })
  assert.equal(out.sent, false)
  if (!out.sent) assert.equal(out.refusal, 'SENDER_NOT_AUTHORIZED')
  assert.equal(transport.captured.length, 0)
})

test('empty body and a deferred (non-REQUEST) kind are refused', async () => {
  const transport = makeCapturingTransport()
  const deps = { store: makeFakeStore(), transport, suppressionServerKey: SERVER_KEY, readKillSwitch: () => false }

  const empty = await runSend(baseReq('p_gma', { body: '   ' }), deps)
  assert.equal(empty.sent, false)
  if (!empty.sent) assert.equal(empty.refusal, 'EMPTY_BODY')

  const nudge = await runSend(baseReq('p_gma', { kind: 'NUDGE' }), deps)
  assert.equal(nudge.sent, false)
  if (!nudge.sent) assert.equal(nudge.refusal, 'DEFERRED_KIND')

  assert.equal(transport.captured.length, 0)
})

test('the per-recipient cap (15 segments) refuses once exhausted', async () => {
  const transport = makeCapturingTransport()
  const key = suppressionKey(RESPONDERS.p_bryan.phone, SERVER_KEY)
  const out = await runSend(baseReq('p_bryan'), {
    store: makeFakeStore({ preUsedRecipient: { [key]: 15 } }),
    transport,
    suppressionServerKey: SERVER_KEY,
    readKillSwitch: () => false,
  })
  assert.equal(out.sent, false)
  if (!out.sent) assert.equal(out.refusal, 'LIMIT_RECIPIENT')
  assert.equal(transport.captured.length, 0)
})
