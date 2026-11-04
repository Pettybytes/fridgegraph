import {createRoot} from 'react-dom/client'
import {OrbitController} from './controller'
import {AlertTakeover} from './AlertTakeover'
import type {Alert,OrbitAdapter,ResponseEntry} from './adapter'
import '@/index.css'

/**
 * Capture harness for the REAL AlertTakeover used by the Orbit route.
 *
 * This is a development aid, not a second app: the component, controller, adapter contract, CSS and
 * transition are the production ones. Only the data source is a labeled fixture, because the served
 * demo's backend is not contacted from a visual capture. Nothing here is presented as a live read.
 */
const guidance = 'If there is an emergency, call 911. A response is recorded only when it is sent.'
const audience = [
  {person: {id: 'p_gma', displayName: 'Loretta Brooks'}, eligible: true},
  {person: {id: 'p_bryan', displayName: 'Bryan Brooks'}, eligible: true},
  {person: {id: 'p_dad', displayName: 'Andre Ellison'}, eligible: true},
]
const response: ResponseEntry = {person: {id: 'p_gma', displayName: 'Loretta Brooks'}, respondedAt: '2026-11-03T02:08:00Z', response: 'ON_WAY'}

const activeAlert: Alert = {
  id: 'fixture-alert', child: {id: 'p_nora'}, status: 'ACTIVE',
  message: 'FridgeGraph Orbit: check-in not recorded for Nora. Wearing: blue jacket. Last seen: Lincoln Elementary School at 12:36 AM. Reply 1 = With me, 2 = On my way, 3 = Can\'t help.',
  share: {photoId: null, wearColor: 'Blue', wearGarment: 'Jacket', hair: 'Braided'},
  activatedAt: '2026-11-03T05:40:00Z', closedAt: null, closeOutcome: null, thankyou: null,
  lastSeenPlace: {id: 'rp_lincoln', kind: 'SCHOOL_PICKUP', label: 'Lincoln Elementary School'},
  lastSeenAt: '2026-11-03T05:36:00Z', lastSeenProvenance: 'PARENT_ENTERED',
  audience, responses: [response], latestResponses: [response], guidance,
}
const foundAlert: Alert = {
  ...activeAlert, status: 'CLOSED', closeOutcome: 'FOUND_SAFE', closedAt: '2026-11-03T05:52:00Z',
  thankyou: 'FridgeGraph Orbit: Nora was found safe and sound. Thank you for being there.',
}
// ?time=none drops the recorded provenance so the capture shows the "needs attention" tile dot.
const unverifiedActive: Alert = {...activeAlert, lastSeenProvenance: null}
const params = new URLSearchParams(location.search)
let record: Alert = params.get('state') === 'found' ? foundAlert : params.get('time') === 'none' ? unverifiedActive : activeAlert

const adapter: OrbitAdapter = {
  check: async () => ({recorded: false, label: 'check', text: 'not recorded', dueAt: null, guidance}),
  vocabulary: async () => [],
  places: async () => [{id: 'rp_lincoln', kind: 'SCHOOL_PICKUP', label: 'Lincoln Elementary School'}],
  status: async () => ({alertId: record.id, status: record.status, closeOutcome: record.closeOutcome ?? null, thankyou: record.thankyou ?? null, audienceCount: 3, notifiedCount: 3, latestResponses: record.latestResponses, guidance}),
  alert: async () => record,
  draft: async () => ({draftId: 'd', draftVersion: 1, status: 'PENDING_ACTIVATION', guidance}),
  preview: async () => ({draftId: 'd', draftVersion: 1, message: 'm', messageHash: 'h', audienceSize: 3, guidance}),
  activate: async () => record,
  respond: async () => {},
  close: async () => foundAlert,
  upload: async () => 'photo',
  photo: async () => new Blob(),
}
const controller = new OrbitController(
  adapter,
  {childId: 'p_nora', personId: 'p_gma', parent: false, readOnly: false, generation: 1},
  () => 1,
)

declare global {
  interface Window {
    __orbitCard?: {state: () => string; setState: (next: 'active' | 'found') => Promise<void>}
  }
}
window.__orbitCard = {
  state: () => record.status,
  setState: async (next) => {
    record = next === 'found' ? foundAlert : activeAlert
    await controller.refresh(record.id)
  },
}

await controller.load()
createRoot(document.getElementById('root')!).render(<AlertTakeover controller={controller} childName="Nora Ellison"/>)
