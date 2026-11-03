import { createRoot } from 'react-dom/client'
import type { StoredRun } from '@/lib/frontendData/deliveredAdapter'
import { VillagePulseView } from './VillagePulse'
import '../../../index.css'

// Controlled fictional fixture for visual review only. This page makes no reads.
const jobs = [
  { job: { id: 'fixture-pickup-1', type: 'PICKUP', status: 'awaiting_approval', version: 1, candidateEvaluations: [], confirmation: null }, attempts: [{ id: 'fixture-attempt-1', at: '2026-11-01T17:00:00Z', channel: 'SMS', candidate: null, destinationMode: 'TEST_RESPONDER', closedAt: null, closedReason: null }], timeline: [{ at: '2026-11-01T16:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }] },
  { job: { id: 'fixture-pickup-2', type: 'PICKUP', status: 'confirmed', version: 2, candidateEvaluations: [], confirmation: { id: 'fixture-confirmation-2' } }, attempts: [], timeline: [{ at: '2026-10-30T15:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }] },
  ...[
    ['2026-10-07T15:00:00Z', 'failed'], ['2026-10-12T15:00:00Z', 'confirmed'],
    ['2026-10-12T16:00:00Z', 'pending'], ['2026-10-18T15:00:00Z', 'discovering'],
    ['2026-10-23T15:00:00Z', 'confirmed'], ['2026-10-23T16:00:00Z', 'awaiting_approval'],
    ['2026-10-27T15:00:00Z', 'pending'], ['2026-11-01T15:00:00Z', 'discovering'],
  ].map(([at, status], index) => ({ job: { id: `fixture-pickup-extra-${index}`, type: 'PICKUP', status, version: 1, candidateEvaluations: [], confirmation: status === 'confirmed' ? { id: `fixture-confirmation-extra-${index}` } : null }, attempts: index % 2 ? [{ id: `fixture-attempt-extra-${index}`, at, channel: 'SMS', candidate: null, destinationMode: 'TEST_RESPONDER', closedAt: null, closedReason: null }] : [], timeline: [{ at, kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }] })),
] as StoredRun[]

createRoot(document.getElementById('root')!).render(<main style={{ position: 'relative' }}>
  <p style={{ position: 'absolute', zIndex: 5, top: 8, left: 12, margin: 0, fontSize: 11, color: '#fff', textShadow: '0 1px 3px #000' }}>Controlled fictional fixture · no live reads</p>
  <VillagePulseView jobs={{ kind: 'ready', value: jobs }} orbit={{ kind: 'ready', value: { alertId: 'fixture-alert', status: 'ACTIVE' } }} now={Date.parse('2026-11-02T16:00:00Z')} readAt={Date.parse('2026-11-02T23:42:00Z')} />
</main>)
