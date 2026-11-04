/** Keep-alive warm-up (latency playbook 6): fires on mount, every ~60s while visible, never while
 * hidden, and the panel-open prefetch only when the last warm has gone stale. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { fireRosinaWarmIfStale, useRosinaWarmKeepAlive, WARM_KEEP_ALIVE_MS, WARM_STALE_MS } from './warm'

const warmCalls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => u === '/api/rosina/warm')
// The module tracks the last warm across tests (by design: several surfaces share one page);
// each test jumps the clock a day ahead so the previous test's warm is always stale.
let testClock = Date.now()

describe('rosina warm keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    testClock += 24 * 60 * 60 * 1000
    vi.setSystemTime(testClock)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('fires on mount and keeps alive every interval while visible', () => {
    renderHook(() => useRosinaWarmKeepAlive('tok', true))
    expect(warmCalls()).toHaveLength(1)
    expect(warmCalls()[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok' } })
    act(() => { vi.advanceTimersByTime(WARM_KEEP_ALIVE_MS) })
    expect(warmCalls()).toHaveLength(2)
  })

  it('stays quiet without a live session or while hidden, and fires on return once stale', () => {
    const { unmount: a } = renderHook(() => useRosinaWarmKeepAlive(null, true))
    const { unmount: b } = renderHook(() => useRosinaWarmKeepAlive('tok', false))
    expect(warmCalls()).toHaveLength(0)
    a(); b()

    renderHook(() => useRosinaWarmKeepAlive('tok', true))
    expect(warmCalls()).toHaveLength(1)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => { vi.advanceTimersByTime(WARM_KEEP_ALIVE_MS * 3) })
    expect(warmCalls()).toHaveLength(1)
    hidden.mockReturnValue(false)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(warmCalls()).toHaveLength(2)
  })

  it('panel-open prefetch skips while fresh and fires once stale', () => {
    renderHook(() => useRosinaWarmKeepAlive('tok', true))
    expect(warmCalls()).toHaveLength(1)
    fireRosinaWarmIfStale('tok')
    expect(warmCalls()).toHaveLength(1)
    vi.setSystemTime(testClock + WARM_STALE_MS + 1000)
    fireRosinaWarmIfStale('tok')
    expect(warmCalls()).toHaveLength(2)
  })
})
