import { createRoot } from 'react-dom/client'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { VillagePulseView } from './VillagePulse'
import '../../../index.css'

// Controlled fictional fixture for visual review only. This page makes no reads.
const jobs = [
  { job: { id: 'fixture-pickup-1', type: 'PICKUP', status: 'awaiting_approval', version: 1, candidateEvaluations: [], confirmation: null }, attempts: [{ id: 'fixture-attempt-1', at: '2026-11-01T17:00:00Z', channel: 'SMS', candidate: null, destinationMode: 'TEST_RESPONDER', closedAt: null, closedReason: null }], timeline: [{ at: '2026-11-01T16:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }] },
  { job: { id: 'fixture-pickup-2', type: 'PICKUP', status: 'confirmed', version: 2, candidateEvaluations: [], confirmation: { id: 'fixture-confirmation-2' } }, attempts: [], timeline: [{ at: '2026-10-30T15:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }] },
] as StoredRun[]

createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1160, margin: '32px auto', padding: '0 16px' }}>
  <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Controlled fictional fixture · no live reads</p>
  <VillagePulseView jobs={{ kind: 'ready', value: jobs }} orbit={{ kind: 'ready', value: { alertId: 'fixture-alert', status: 'ACTIVE' } }} now={Date.parse('2026-11-02T16:00:00Z')} sourceLabel="Controlled fictional fixture, not live data" />
</main>)
