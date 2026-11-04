// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreePhoneStory } from './ThreePhoneStory'
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockAudio(audio: HTMLAudioElement, behavior: 'resolve' | 'reject' = 'resolve') {
  let paused = true
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused })
  const play = vi.spyOn(audio, 'play').mockImplementation(() => {
    if (behavior === 'reject') return Promise.reject(new Error('NotAllowedError'))
    paused = false
    return Promise.resolve()
  })
  vi.spyOn(audio, 'pause').mockImplementation(() => { paused = true })
  return play
}

describe('replay story model', () => {
  it('walks the whole path on the parent phone in order, with approval before any outreach', () => {
    const ids = PARENT_JOURNEY.map(event => event.id)
    expect(ids).toEqual(['notice', 'proposal', 'approve-request', 'request-sent', 'reply', 'confirm', 'confirmed', 'today'])
    expect([...PARENT_JOURNEY].every((event, index, all) => index === 0 || all[index - 1].atMs < event.atMs)).toBe(true)
    expect(PARENT_JOURNEY.at(-1)!.atMs).toBeLessThan(REPLAY_DURATION_MS)
    expect(journeyAt(0)).toHaveLength(0)
    expect(journeyAt(20000).some(event => event.kind === 'confirmed')).toBe(false)
    expect(journeyAt(31000).some(event => event.kind === 'confirmed')).toBe(true)
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
    const early = traceAt(9000).find(entry => entry.line.id === 't-mychildren')!
    const later = traceAt(9400).find(entry => entry.line.id === 't-mychildren')!
    expect(later.chars).toBeGreaterThan(early.chars)
    expect(traceAt(REPLAY_DURATION_MS).every(entry => !entry.typing)).toBe(true)
    expect(traceClock(0)).toBe('13:29:56.0')
    expect(traceClock(35000)).toBe('13:30:31.0')
    expect(traceTokens('mutation requestPickup(childId: "child_nora")').map(token => token.cls).join(' ')).toContain('kw')
  })

  it('keeps one narration track whose segments fit the replay and never overlap', () => {
    expect(REPLAY_NARRATION.durationMs).toBeLessThan(REPLAY_DURATION_MS)
    const segments = REPLAY_NARRATION.segments
    expect(segments.length).toBe(6)
    for (let index = 1; index < segments.length; index += 1) expect(segments[index].startMs).toBeGreaterThanOrEqual(segments[index - 1].endMs)
    const loretta = segments.find(segment => segment.speaker === 'loretta')!
    expect(loretta.endMs - loretta.startMs).toBe(4133)
    expect(loretta.text).toContain('I can be there at 1.20')
    expect(speakerAt(REPLAY_NARRATION, loretta.startMs + 100)).toBe('loretta')
    expect(speakerAt(REPLAY_NARRATION, segments[0].startMs + 100)).toBe('rosina')
    expect(speakerAt(REPLAY_NARRATION, REPLAY_DURATION_MS - 1)).toBeNull()
    expect(captionAt(0)).toContain('school notice')
    expect(captionAt(REPLAY_DURATION_MS)).toContain('Mission Control')
  })

  it('traces the route from start to end monotonically', () => {
    const [startX, startY] = routePoint(0)
    const [endX, endY] = routePoint(1)
    expect([startX, startY]).toEqual([52, 288])
    expect([endX, endY]).toEqual([196, 312])
    expect(routePoint(0.5)).not.toEqual([startX, startY])
  })
})

describe('ThreePhoneStory playback', () => {
  it('populates all three phones from the first frame', () => {
    render(<ThreePhoneStory initialAutoplay={false} />)
    expect(screen.getByText('Good afternoon, Kendra')).toBeInTheDocument()
    expect(screen.getByText(/replay trace · demo flow/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Village map replay/ })).toBeInTheDocument()
    expect(screen.getByText(/Pickup route · waiting/)).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'One plan, three perspectives' })
    expect(section.querySelectorAll('audio')).toHaveLength(1)
  })

  it('pauses, resumes and replays from one master progress clock', () => {
    vi.useFakeTimers()
    render(<ThreePhoneStory />)
    const progress = screen.getByRole('progressbar')
    act(() => { vi.advanceTimersByTime(5000) })
    const first = Number(progress.getAttribute('aria-valuenow'))
    expect(first).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    act(() => { vi.advanceTimersByTime(3000) })
    expect(Number(progress.getAttribute('aria-valuenow'))).toBe(first)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeGreaterThan(first)
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(progress).toHaveAttribute('aria-valuenow', '0')
  })

  it('plays the one audio element after a sound gesture, pulses Rosina only on her segments, and rewinds each loop', () => {
    vi.useFakeTimers()
    render(<ThreePhoneStory />)
    const section = screen.getByRole('region', { name: 'One plan, three perspectives' })
    const audio = section.querySelector('audio')!
    const play = mockAudio(audio)
    fireEvent.click(screen.getByRole('button', { name: 'Sound off' }))
    expect(screen.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'true')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('img', { name: 'Rosina, speaking' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(21000) })
    expect(screen.getByRole('img', { name: 'Rosina, ready' })).toBeInTheDocument()
    const callsBeforeLoop = play.mock.calls.length
    for (let second = 0; second < 25; second++) act(() => { vi.advanceTimersByTime(1000) })
    expect(section).toHaveAttribute('data-loop-count', '1')
    expect(play.mock.calls.length).toBeGreaterThan(callsBeforeLoop)
    expect(section.querySelectorAll('audio')).toHaveLength(1)
  })

  it('shows a visible fallback when the browser blocks audio', async () => {
    render(<ThreePhoneStory initialAutoplay={false} />)
    const section = screen.getByRole('region', { name: 'One plan, three perspectives' })
    mockAudio(section.querySelector('audio')!, 'reject')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sound off' })) })
    expect(screen.getByRole('status')).toHaveTextContent(/blocked audio/i)
    expect(screen.getByRole('button', { name: 'Sound off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a final readable static frame under reduced motion, with user-initiated replay', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    render(<ThreePhoneStory />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('Plan confirmed')).toBeInTheDocument()
    expect(screen.getByText(/confirmed plans this week/)).toBeInTheDocument()
    expect(screen.getByText(/replay complete/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('preserves playback position while changing the phone perspective', () => {
    render(<ThreePhoneStory initialAutoplay={false} />)
    const progress = screen.getByRole('progressbar')
    fireEvent.click(screen.getByRole('button', { name: 'Under the hood' }))
    expect(screen.getByRole('button', { name: 'Under the hood' })).toHaveAttribute('aria-pressed', 'true')
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Village' }))
    expect(screen.getByRole('button', { name: 'Village' })).toHaveAttribute('aria-pressed', 'true')
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('button', { name: 'Sound off' })).toBeEnabled()
  })

  it('labels the replay honestly and separates the offer from the parent decision', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    render(<ThreePhoneStory />)
    const section = screen.getByRole('region', { name: 'One plan, three perspectives' })
    expect(within(section).getByText(/Demo story replay · fictional people/)).toBeInTheDocument()
    expect(section.querySelectorAll('.sr-replay-chip')).toHaveLength(3)
    expect(section.textContent).toContain('pickup completion is not recorded')
    const journey = within(section).getByLabelText('Kendra’s replayed journey')
    expect(within(journey).getByText(/Confirm Loretta for the pickup/)).toBeInTheDocument()
    expect(within(journey).getByRole('img', { name: /Waveform derived/ })).toBeInTheDocument()
  })
})
