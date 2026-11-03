// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneReplay } from './PhoneReplay'
import { ThreePhoneStory } from './ThreePhoneStory'
import { ILLUSTRATIVE_STORY, projectStory, storyBeat, storyDurationMs, eventAt, STORY_DATE } from './story'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('illustrative story adapter', () => {
  it('keeps one fixed Detroit date and one synchronized timeline for all viewers', () => {
    expect(STORY_DATE).toBe('2026-10-30')
    expect(new Date(`${STORY_DATE}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/Detroit', weekday: 'long' })).toBe('Friday')
    expect(projectStory('teacher', 20000).map(item => item.id)).toEqual(['notice', 'teacher-authorization'])
    expect(projectStory('parent', 20000).at(-1)?.id).toBe('confirm')
    expect(projectStory('caregiver', 20000).at(-1)?.id).toBe('caregiver-confirmed')
    expect(storyBeat(12500)).toContain('Loretta offers')
  })

  it('separates the offer, the parent decision and physical pickup', () => {
    const offer = projectStory('caregiver', 13000).find(item => item.kind === 'offer')
    expect(offer?.detail).toContain('Parent confirmation still needed')
    expect(projectStory('parent', 15000).some(item => item.kind === 'parent-confirmed')).toBe(false)
    expect(projectStory('parent', 16000).some(item => item.kind === 'parent-confirmed')).toBe(true)
    expect(ILLUSTRATIVE_STORY.some(item => /picked up|completed pickup/i.test(item.title))).toBe(false)
  })

  it('expands the voice beat for actual clip duration without speeding it up', () => {
    const afterOffer = ILLUSTRATIVE_STORY.find(item => item.id === 'parent-offer')!
    expect(storyDurationMs(5000)).toBe(27000)
    expect(eventAt(afterOffer, 5000)).toBe(16200)
    expect(projectStory('parent', 15000, 5000).some(item => item.id === 'parent-offer')).toBe(false)
  })

  it('never sends family conversation into the teacher projection', () => {
    const teacher = projectStory('teacher', storyDurationMs())
    render(<PhoneReplay viewer="teacher" events={teacher} />)
    expect(screen.getByText(/Prototype pickup authorization/)).toBeInTheDocument()
    expect(screen.queryByText(/Ask Loretta|Yes, I can be there|Confirm Loretta/)).not.toBeInTheDocument()
    expect(teacher.every(item => item.viewer === 'teacher')).toBe(true)
  })
})

describe('ThreePhoneStory playback', () => {
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

  it('pauses off-screen, resumes only a playing replay, and keeps a manual pause', () => {
    vi.useFakeTimers()
    let observe: IntersectionObserverCallback = () => {}
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { observe = callback } observe() {} disconnect() {} })
    render(<ThreePhoneStory />)
    const progress = screen.getByRole('progressbar')
    act(() => { vi.advanceTimersByTime(1000) })
    const beforeHide = progress.getAttribute('aria-valuenow')
    act(() => { observe([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(progress).toHaveAttribute('aria-valuenow', beforeHide)
    act(() => { observe([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(beforeHide))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const manual = progress.getAttribute('aria-valuenow')
    act(() => { observe([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver); observe([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); vi.advanceTimersByTime(1000) })
    expect(progress).toHaveAttribute('aria-valuenow', manual)
  })

  it('shows a final readable static frame under reduced motion, with user-initiated replay', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    render(<ThreePhoneStory />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    const teacher = screen.getByLabelText('Teacher story events')
    expect(within(teacher).getByText(/Prototype pickup authorization/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('preserves playback position while changing the phone perspective', () => {
    render(<ThreePhoneStory initialAutoplay={false} />)
    const progress = screen.getByRole('progressbar')
    fireEvent.click(screen.getByRole('button', { name: 'Teacher' }))
    expect(screen.getByRole('button', { name: 'Teacher' })).toHaveAttribute('aria-pressed', 'true')
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Caregiver' }))
    expect(screen.getByRole('button', { name: 'Caregiver' })).toHaveAttribute('aria-pressed', 'true')
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('button', { name: 'Sound unavailable' })).toBeDisabled()
  })

  it('uses a supplied verbatim transcript only in the permitted parent and caregiver views', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    render(<ThreePhoneStory voice={{ src: '', transcript: 'Recorded words from the approved clip.', durationMs: 5000, peaks: [0.2, 0.5, 0.8] }} />)
    const parent = screen.getByLabelText('Parent story events')
    const caregiver = screen.getByLabelText('Caregiver story events')
    const teacher = screen.getByLabelText('Teacher story events')
    expect(within(parent).getByText('Recorded words from the approved clip.')).toBeInTheDocument()
    expect(within(caregiver).getByText('Recorded words from the approved clip.')).toBeInTheDocument()
    expect(within(caregiver).getByRole('img', { name: /Waveform derived/ })).toBeInTheDocument()
    expect(teacher).not.toHaveTextContent('Recorded words from the approved clip.')
  })
})
