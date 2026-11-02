import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DadStatusChip, type SharedStatus } from './DadStatusChip'

const status: SharedStatus = {
  personId: 'p_dad', emoji: '🍼', text: 'Changing a diaper', etaText: 'unknown',
  setAt: '2026-11-01T15:00:00Z', expiresAt: '2026-11-01T16:00:00Z',
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Dad shared-status chip', () => {
  it('renders only the recorded emoji, text and ETA, clearly labeled as a sample in mock mode', () => {
    vi.setSystemTime(new Date('2026-11-01T15:30:00Z'))
    render(<DadStatusChip personId="p_dad" sharedStatus={status} />)
    expect(screen.getByRole('status')).toHaveTextContent('🍼Changing a diaper· ETA: unknown')
    expect(screen.getByText('Sample')).toBeVisible()
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Sample shared status: 🍼 Changing a diaper, ETA: unknown')
  })
  it('shows no inferred status from surrounding Busy/Free data when the read is null', () => {
    vi.setSystemTime(new Date('2026-11-01T15:30:00Z'))
    render(<><span>Busy</span><span>Free</span><DadStatusChip personId="p_dad" sharedStatus={null} /></>)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('Sample')).not.toBeInTheDocument()
  })
  it('hides expired, invalid and cross-person statuses', () => {
    vi.setSystemTime(new Date('2026-11-01T16:00:01Z'))
    const view = render(<DadStatusChip personId="p_dad" sharedStatus={status} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    vi.setSystemTime(new Date('2026-11-01T15:30:00Z'))
    view.rerender(<DadStatusChip personId="p_mom" sharedStatus={status} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    view.rerender(<DadStatusChip personId="p_dad" sharedStatus={{ ...status, expiresAt: 'bad-date' }} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    view.rerender(<DadStatusChip personId="p_dad" sharedStatus={{ ...status, text: 'x'.repeat(61) }} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('hides an active chip when its expiry passes without a parent rerender', () => {
    vi.setSystemTime(new Date('2026-11-01T15:59:59Z'))
    render(<DadStatusChip personId="p_dad" sharedStatus={status} />)
    expect(screen.getByRole('status')).toBeVisible()
    act(() => vi.advanceTimersByTime(1001))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('omits absent emoji and ETA, and treats text as plain text', () => {
    vi.setSystemTime(new Date('2026-11-01T15:30:00Z'))
    render(<DadStatusChip personId="p_dad" sharedStatus={{ ...status, emoji: null, text: '<b>At school</b>', etaText: null }} mode="live" />)
    expect(screen.getByRole('status')).toHaveTextContent('<b>At school</b>')
    expect(screen.queryByText(/ETA:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sample')).not.toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })
  it('clears the chip immediately when the displayed person changes', () => {
    vi.setSystemTime(new Date('2026-11-01T15:30:00Z'))
    const view = render(<DadStatusChip personId="p_dad" sharedStatus={status} />)
    expect(screen.getByRole('status')).toBeVisible()
    view.rerender(<DadStatusChip personId="p_mom" sharedStatus={status} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
