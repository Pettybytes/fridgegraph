import { afterEach, expect, it, vi } from 'vitest'
import { announceNoticeConfirmed, onNoticeConfirmed, onNoticeSampleRequest, requestNoticeSample } from './sampleSignal'

afterEach(() => vi.restoreAllMocks())

it('latches a sample request so a listener mounting just after still runs exactly once', () => {
  // The card can request a frame before the composer mounts; the latch must not drop it.
  requestNoticeSample()
  const handler = vi.fn()
  const unsubscribe = onNoticeSampleRequest(handler)
  expect(handler).toHaveBeenCalledTimes(1)
  // A later request reaches the live listener.
  requestNoticeSample()
  expect(handler).toHaveBeenCalledTimes(2)
  // After unsubscribe the old handler stops firing; the pending request latches to the NEXT
  // listener instead — exactly the composer-remount race the latch exists to cover.
  unsubscribe()
  requestNoticeSample()
  expect(handler).toHaveBeenCalledTimes(2)
  const second = vi.fn()
  const unsubscribeSecond = onNoticeSampleRequest(second)
  expect(second).toHaveBeenCalledTimes(1)
  // Once consumed, a fresh listener with no pending request does not fire spuriously.
  unsubscribeSecond()
  const third = vi.fn()
  onNoticeSampleRequest(third)()
  expect(third).not.toHaveBeenCalled()
})

it('reports a confirmed notice and ignores malformed or out-of-shape details', () => {
  const seen: unknown[] = []
  const unsubscribe = onNoticeConfirmed(detail => seen.push(detail))
  announceNoticeConfirmed({ childId: 'p_nora', jobId: 'pickup_live_1', status: 'discovering', mode: 'live' })
  window.dispatchEvent(new CustomEvent('fg:notice-confirmed', { detail: { childId: '', jobId: 'x', mode: 'live' } }))
  window.dispatchEvent(new CustomEvent('fg:notice-confirmed', { detail: { childId: 'p_nora', jobId: 'y', mode: 'bogus' } }))
  window.dispatchEvent(new CustomEvent('fg:notice-confirmed', { detail: 'not-an-object' }))
  expect(seen).toEqual([{ childId: 'p_nora', jobId: 'pickup_live_1', status: 'discovering', mode: 'live' }])
  unsubscribe()
  announceNoticeConfirmed({ childId: 'p_nora', jobId: 'pickup_live_2', status: 'discovering', mode: 'live' })
  expect(seen).toHaveLength(1)
})
