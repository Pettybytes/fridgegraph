// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import type { OrbitState } from '@/features/orbit/controller'
import { VillagePulseView } from './VillagePulse'
import { orbitPulseRead } from './orbitPulseRead'
import { approvalBreakdown, dailyCurrentStatuses, pulseCohort, pulseWindow, recordedJobStatus, requestsByWeekday } from './model'

function run(id: string, type = 'PICKUP', status = 'awaiting_approval', created = '2026-11-01T13:00:00Z', attempts = 1, approved = false): StoredRun {
  return {
    job: { id, type, status, version: 1, candidateEvaluations: [], confirmation: approved ? { id: `confirmation-${id}` } : null },
    attempts: attempts ? [{ id: `attempt-${id}`, at: '2026-11-01T14:00:00Z', channel: 'SMS', candidate: null, destinationMode: 'TEST_RESPONDER', closedAt: '2026-11-01T15:00:00Z', closedReason: 'TIMEOUT' }] : [],
    timeline: [{ at: created, kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }],
  } as StoredRun
}
const now = Date.parse('2026-11-02T16:00:00Z')
const orbit = { kind: 'ready' as const, value: { alertId: null, status: null } }
function controllerState(error: string): Pick<OrbitState, 'phase' | 'status' | 'error'> {
  return { phase: 'active', status: { alertId: 'cached-private-alert', status: 'ACTIVE' } as OrbitState['status'], error }
}

describe('Village pulse: caller-visible recorded measures', () => {
  it('uses one Detroit dated pickup-job cohort and counts distinct jobs', () => {
    const range = pulseWindow(now)
    expect(range).toEqual({ from: '2026-10-04', through: '2026-11-02' })
    const jobs = [run('one'), run('one'), run('two', 'PICKUP', 'confirmed', '2026-10-04T04:00:00Z', 0, true), run('other', 'INVITATION'), run('old', 'PICKUP', 'pending', '2026-10-04T03:59:59Z')]
    expect(pulseCohort(jobs, range)).toMatchObject({ requests: 2, withContactAttempts: 1, withParentApproval: 1 })
  })

  it('uses current status and Detroit creation weekday, with exclusive approval categories', () => {
    const range = pulseWindow(now)
    const jobs = pulseCohort([run('one', 'PICKUP', 'confirmed', '2026-10-04T04:00:00Z', 0, true), run('two', 'PICKUP', 'awaiting_approval', '2026-10-04T05:00:00Z'), run('three', 'PICKUP', 'failed', '2026-10-05T03:59:59Z')], range).jobs
    expect(dailyCurrentStatuses(jobs, range).find(day => day.day === '2026-10-04')).toMatchObject({ total: 3, counts: { 'Parent approval recorded': 1, 'Waiting for parent approval': 1, 'Coordination ended': 1 } })
    expect(requestsByWeekday(jobs)).toEqual([0, 0, 0, 0, 0, 0, 3])
    expect(approvalBreakdown(jobs)).toEqual({ approved: 1, pending: 1 })
    expect(recordedJobStatus('confirmed')).toBe('Parent approval recorded')
  })

  it('renders the six supported source-shaped visuals with an actual read time and no LIVE badge', () => {
    render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [run('one')] }} orbit={orbit} readAt={Date.parse('2026-11-02T23:42:00Z')} />)
    for (const name of ['Requests over 30 days', 'Contact coverage', 'Status mix', 'Requests by weekday', 'Parent approvals', 'Open items']) expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(screen.getByText('Updated 6:42 PM')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Requests over 30 Detroit dates, grouped by current recorded status' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1 of 1 jobs have a contact attempt recorded' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Requests by Detroit creation weekday/ })).toBeInTheDocument()
    expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('How this is calculated'))
    expect(screen.getByRole('note')).toHaveTextContent('does not reconstruct historical status transitions')
    expect(screen.getByRole('note')).toHaveTextContent('Parent approval does not confirm pickup')
    expect(screen.queryByRole('region', { name: 'Response time' })).not.toBeInTheDocument()
  })

  it('has visible phone dots, button and keyboard navigation, touch swipe, and no autoplay', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const view = render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [run('one')] }} orbit={orbit} />)
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('1 of 2')
    expect(screen.getByRole('button', { name: 'Show Requests and status' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: 'Next pulse panel' }))
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 of 2')
    const viewport = document.querySelector('.vp-carousel')!
    fireEvent.keyDown(viewport, { key: 'ArrowLeft' })
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('1 of 2')
    fireEvent.touchStart(viewport, { changedTouches: [{ clientX: 100 }] })
    fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: 20 }] })
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 of 2')
    expect(screen.getByRole('region', { name: 'Requests over 30 days', hidden: true }).parentElement).toHaveAttribute('inert')
    view.unmount()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  })

  it('keeps loading, empty, refused and failed reads distinct', () => {
    const view = render(<VillagePulseView now={now} jobs={{ kind: 'loading' }} orbit={{ kind: 'loading' }} />)
    expect(screen.getAllByText(/^Loading /)).toHaveLength(7)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={orbit} />)
    expect(screen.getAllByText('No dated pickup requests are available in this window.')).toHaveLength(5)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'refused' }} orbit={{ kind: 'failed' }} readAt={Date.parse('2026-11-02T23:42:00Z')} />)
    expect(screen.getAllByText(/Access to request records is refused/)).toHaveLength(5)
    expect(screen.getByText(/Couldn’t load Orbit status/)).toBeInTheDocument()
    expect(screen.getByText('Last read 6:42 PM · refresh unavailable')).toBeInTheDocument()
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'failed' }} orbit={{ kind: 'failed' }} />)
    expect(screen.getAllByText(/Couldn’t load request records/)).toHaveLength(5)
    expect(screen.queryByText('No dated pickup requests are available in this window.')).not.toBeInTheDocument()
  })

  it('rejects cached ACTIVE Orbit status after a refresh failure or refusal', () => {
    for (const [error, kind] of [["Couldn't load Orbit right now.", 'failed'], ["This isn't shared with you.", 'refused']] as const) {
      const result = orbitPulseRead(controllerState(error))
      expect(result).toEqual({ kind })
      const view = render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={result} />)
      const items = screen.getByRole('region', { name: 'Open items' })
      expect(within(items).getByRole('alert')).toBeInTheDocument()
      expect(items).not.toHaveTextContent('cached-private-alert')
      expect(within(items).queryByRole('link', { name: 'Orbit' })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('shows only an active latest Orbit count and link, never alert payload', () => {
    render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={{ kind: 'ready', value: { alertId: 'private-id', status: 'ACTIVE' } }} />)
    const items = screen.getByRole('region', { name: 'Open items' })
    expect(within(items).getByRole('link', { name: 'Orbit' })).toHaveAttribute('href', '#/orbit')
    expect(items.textContent).not.toContain('private-id')
  })
})
