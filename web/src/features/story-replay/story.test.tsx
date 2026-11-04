// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CALL_TRACE, PARENT_JOURNEY, REPLAY_DURATION_MS, captionAt, journeyAt, traceAt, traceClock,
} from './story'
import { REPLAY_NARRATION, speakerAt } from './narration'
import { routePoint, traceTokens } from './phones'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('replay story model', () => {
  it('walks the whole path on the parent phone in order, with approval before any outreach', () => {
    const ids = PARENT_JOURNEY.map(event => event.id)
    expect(ids).toEqual(['notice', 'proposal', 'approve-request', 'request-sent', 'reply', 'confirm', 'confirmed', 'today'])
    expect([...PARENT_JOURNEY].every((event, index, all) => index === 0 || all[index - 1].atMs < event.atMs)).toBe(true)
    expect(PARENT_JOURNEY.at(-1)!.atMs).toBeLessThan(REPLAY_DURATION_MS)
    expect(journeyAt(0)).toHaveLength(0)
    expect(journeyAt(20000).some(event => event.kind === 'confirmed')).toBe(false)
    expect(journeyAt(26000).some(event => event.kind === 'confirmed')).toBe(true)
    expect(PARENT_JOURNEY.some(event => /picked up|completed pickup/i.test(event.title))).toBe(false)
  })

  it('types the real call chain with fictional ids and no credentials', () => {
    expect(traceAt(0).map(entry => entry.line.id)).toEqual(['t-boot'])
    expect(traceAt(0)[0].chars).toBeGreaterThan(0)
    expect([...CALL_TRACE].every((line, index, all) => index === 0 || all[index - 1].atMs < line.atMs)).toBe(true)
    expect(CALL_TRACE.at(-1)!.atMs).toBeLessThan(REPLAY_DURATION_MS)
    const text = CALL_TRACE.map(line => line.text).join('\n')
    expect(text).toMatch(/requestPickup/)
    expect(text).toMatch(/acceptPickup/)
    expect(text).toMatch(/approvePickup/)
    expect(text).toMatch(/MyChildren/)
    expect(text).toMatch(/PickupCandidates/)
    expect(text).toMatch(/TEST_RESPONDER/)
    expect(text).not.toMatch(/secret|bearer|password|api[_-]?key|service[_-]?role|\+1\d|[0-9a-f]{8}-[0-9a-f]{4}/i)
    const early = traceAt(7600).find(entry => entry.line.id === 't-mychildren')!
    const later = traceAt(8000).find(entry => entry.line.id === 't-mychildren')!
    expect(later.chars).toBeGreaterThan(early.chars)
    expect(traceAt(REPLAY_DURATION_MS).every(entry => !entry.typing)).toBe(true)
    expect(traceClock(0)).toBe('13:29:56.0')
    expect(traceClock(35000)).toBe('13:30:31.0')
    expect(traceTokens('mutation requestPickup(childId: "child_nora")').map(token => token.cls).join(' ')).toContain('kw')
  })

  it('keeps one Rosina narration track whose segments fit the replay and never overlap', () => {
    expect(REPLAY_NARRATION.durationMs).toBeLessThan(REPLAY_DURATION_MS)
    const segments = REPLAY_NARRATION.segments
    expect(segments.length).toBe(5)
    expect(segments.every(segment => segment.speaker === 'rosina')).toBe(true)
    for (let index = 1; index < segments.length; index += 1) expect(segments[index].startMs).toBeGreaterThanOrEqual(segments[index - 1].endMs)
    expect(speakerAt(REPLAY_NARRATION, segments[0].startMs + 100)).toBe('rosina')
    expect(speakerAt(REPLAY_NARRATION, segments[0].endMs + 50)).toBeNull()
    expect(speakerAt(REPLAY_NARRATION, REPLAY_DURATION_MS - 1)).toBeNull()
    expect(captionAt(0)).toContain('school notice')
    expect(captionAt(REPLAY_DURATION_MS)).toContain('Mission Control')
  })

  it('traces the pickup route over the real map from start to end monotonically', () => {
    const [startX, startY] = routePoint(0)
    const [endX, endY] = routePoint(1)
    expect([startX, startY]).toEqual([66, 252])
    expect([endX, endY]).toEqual([214, 300])
    expect(routePoint(0.5)).not.toEqual([startX, startY])
  })
})
