// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { VillagePulseView } from './VillagePulse'
import { pulseCohort, pulseWindow, recordedJobStatus } from './model'

function run(id: string, type = 'PICKUP', status = 'awaiting_approval', created = '2026-11-01T13:00:00Z', attempts = 1, approved = false): StoredRun {
  return {
    job: { id, type, status, version: 1, candidateEvaluations: [], confirmation: approved ? { id: `confirmation-${id}` } : null },
    attempts: attempts ? [{ id: `attempt-${id}`, at: '2026-11-01T14:00:00Z', channel: 'SMS', candidate: null, destinationMode: 'TEST_RESPONDER', closedAt: '2026-11-01T15:00:00Z', closedReason: 'TIMEOUT' }] : [],
    timeline: [{ at: created, kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }],
  } as StoredRun
}
const now = Date.parse('2026-11-02T16:00:00Z')
const orbit = { kind: 'ready' as const, value: { alertId: null, status: null } }

describe('Village pulse: caller-visible recorded measures', () => {
  it('uses one Detroit dated pickup-job cohort and counts distinct jobs, not attempts', () => {
    const window = pulseWindow(now)
    expect(window).toEqual({ from: '2026-10-04', through: '2026-11-02' })
    const jobs = [run('one'), run('one'), run('two', 'PICKUP', 'confirmed', '2026-10-04T04:00:00Z', 0, true), run('other', 'INVITATION'), run('old', 'PICKUP', 'pending', '2026-10-04T03:59:59Z')]
    expect(pulseCohort(jobs, window)).toMatchObject({ requests: 2, withOutreach: 1, withParentApproval: 1 })
  })

  it('labels approval as parent approval and does not derive a response duration from timeout', () => {
    expect(recordedJobStatus('confirmed')).toBe('Parent approval recorded')
    render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [run('one')] }} orbit={orbit} />)
    const response = screen.getByRole('region', { name: 'Response time' })
    expect(within(response).getByText(/no matching caregiver response timestamps/i)).toBeInTheDocument()
    expect(within(response).getByText(/Sample size: unavailable/)).toBeInTheDocument()
    expect(response.textContent).not.toMatch(/60 minutes|1 hour/)
    expect(screen.getByRole('region', { name: 'Coverage' })).toHaveTextContent('Coverage classification unavailable')
  })

  it('keeps panel refusals and failures distinct from empty data', () => {
    render(<VillagePulseView now={now} jobs={{ kind: 'refused' }} orbit={{ kind: 'failed' }} />)
    expect(screen.getAllByText(/Access to request records is refused/)).toHaveLength(3)
    expect(screen.getByText(/Couldn’t load Orbit status/)).toBeInTheDocument()
    expect(screen.queryByText(/No records are available/)).not.toBeInTheDocument()
  })

  it('keeps loading, empty, and failed reads explicit per panel', () => {
    const view = render(<VillagePulseView now={now} jobs={{ kind: 'loading' }} orbit={{ kind: 'loading' }} />)
    // Open items reports its job and Orbit reads separately.
    expect(screen.getAllByRole('status')).toHaveLength(5)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={orbit} />)
    expect(screen.getAllByText('No dated pickup requests are available in this window.')).toHaveLength(3)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'failed' }} orbit={{ kind: 'failed' }} />)
    expect(screen.getAllByRole('alert')).toHaveLength(5)
    expect(screen.queryByText('Requests recorded')).not.toBeInTheDocument()
  })

  it('shows only an active Orbit status link, never alert payload', () => {
    render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={{ kind: 'ready', value: { alertId: 'private-id', status: 'ACTIVE' } }} />)
    const items = screen.getByRole('region', { name: 'Open items' })
    expect(within(items).getByRole('link', { name: 'Open Orbit' })).toHaveAttribute('href', '#/orbit')
    expect(items.textContent).not.toContain('private-id')
  })
})
