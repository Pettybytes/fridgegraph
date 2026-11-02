// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import type { OrbitState } from '@/features/orbit/controller'
import { VillagePulseView } from './VillagePulse'
import { orbitPulseRead } from './orbitPulseRead'
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

function controllerState(error: string): Pick<OrbitState, 'phase' | 'status' | 'error'> {
  // A refresh error leaves the previous ACTIVE status and phase intact in OrbitController.
  return { phase: 'active', status: { alertId: 'cached-private-alert', status: 'ACTIVE' } as OrbitState['status'], error }
}

describe('Village pulse: caller-visible recorded measures', () => {
  it('uses one Detroit dated pickup-job cohort and counts distinct jobs, not attempts', () => {
    const window = pulseWindow(now)
    expect(window).toEqual({ from: '2026-10-04', through: '2026-11-02' })
    const jobs = [run('one'), run('one'), run('two', 'PICKUP', 'confirmed', '2026-10-04T04:00:00Z', 0, true), run('other', 'INVITATION'), run('old', 'PICKUP', 'pending', '2026-10-04T03:59:59Z')]
    expect(pulseCohort(jobs, window)).toMatchObject({ requests: 2, withContactAttempts: 1, withParentApproval: 1 })
  })

  it('uses conservative attempt wording and independent accessible bars', () => {
    expect(recordedJobStatus('confirmed')).toBe('Parent approval recorded')
    expect(recordedJobStatus('discovering')).toBe('Coordination in progress')
    render(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [run('one')] }} orbit={orbit} />)
    const counts = screen.getByRole('region', { name: 'Recorded request counts' })
    expect(within(counts).getByText('Jobs with contact attempts recorded')).toBeInTheDocument()
    expect(within(counts).getAllByRole('img')).toHaveLength(3)
    expect(counts).toHaveTextContent('Attempts do not prove delivery or response')
    expect(screen.queryByRole('region', { name: 'Response time' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('How this is calculated'))
    expect(screen.getByRole('note')).toHaveTextContent('No matching caregiver response timestamp is exposed')
  })

  it('keeps panel refusals and failures distinct from empty data', () => {
    render(<VillagePulseView now={now} jobs={{ kind: 'refused' }} orbit={{ kind: 'failed' }} />)
    expect(screen.getAllByText(/Access to request records is refused/)).toHaveLength(2)
    expect(screen.getByText(/Couldn’t load Orbit status/)).toBeInTheDocument()
    expect(screen.queryByText(/No dated pickup requests/)).not.toBeInTheDocument()
  })

  it('keeps loading, empty, and failed reads explicit per panel', () => {
    const view = render(<VillagePulseView now={now} jobs={{ kind: 'loading' }} orbit={{ kind: 'loading' }} />)
    expect(screen.getAllByRole('status')).toHaveLength(4)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'ready', value: [] }} orbit={orbit} />)
    expect(screen.getAllByText('No dated pickup requests are available in this window.')).toHaveLength(2)
    view.rerender(<VillagePulseView now={now} jobs={{ kind: 'failed' }} orbit={{ kind: 'failed' }} />)
    expect(screen.getAllByRole('alert')).toHaveLength(4)
    expect(screen.queryByText('Requests recorded')).not.toBeInTheDocument()
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
      expect(within(items).queryByText('1')).not.toBeInTheDocument()
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
