import {createRoot} from 'react-dom/client'
import {useEffect, useRef} from 'react'
import {createMockAuthAdapter} from '@/features/personas/auth'
import {SessionProvider, useSession} from '@/features/personas/Session'
import {OrbitController} from './controller'
import {OrbitProvider} from './runtime'
import {OrbitView} from './Orbit'
import type {Alert, OrbitAdapter} from './adapter'
import '@/index.css'

/**
 * Capture harness for the REAL parent Orbit page (OrbitView as Kendra). The component, controller,
 * adapter contract, session and CSS are production; only the data source is a labeled fixture, so a
 * visual capture does not contact the served demo backend. Nothing here is presented as a live read.
 */
const guidance = 'If there is an emergency, call 911. A response is recorded only when it is sent.'
const activeAlert: Alert = {
  id: 'fixture-parent-alert', child: {id: 'p_nora'}, status: 'ACTIVE',
  message: 'FridgeGraph Orbit: check-in not recorded for Nora. Wearing: blue jacket. Last seen: Lincoln Elementary School at 12:36 AM.',
  share: {photoId: null, wearColor: 'Blue', wearGarment: 'Jacket'},
  activatedAt: '2026-11-03T05:40:00Z', closedAt: null, closeOutcome: null, thankyou: null,
  lastSeenPlace: {id: 'rp_lincoln', kind: 'SCHOOL_PICKUP', label: 'Lincoln Elementary School'},
  lastSeenAt: '2026-11-03T05:36:00Z', lastSeenProvenance: 'PARENT_ENTERED',
  audience: [{person: {id: 'p_gma', displayName: 'Loretta Brooks'}, eligible: true}, {person: {id: 'p_dad', displayName: 'Andre Ellison'}, eligible: true}],
  responses: [{person: {id: 'p_gma', displayName: 'Loretta Brooks'}, respondedAt: '2026-11-03T05:44:00Z', response: 'ON_WAY'}],
  latestResponses: [{person: {id: 'p_gma', displayName: 'Loretta Brooks'}, respondedAt: '2026-11-03T05:44:00Z', response: 'ON_WAY'}],
  guidance,
}
const foundAlert: Alert = {...activeAlert, status: 'CLOSED', closeOutcome: 'FOUND_SAFE', closedAt: '2026-11-03T05:52:00Z', thankyou: 'FridgeGraph Orbit: Nora was found safe and sound. Thank you for being there.'}
let record: Alert = new URLSearchParams(location.search).get('state') === 'found' ? foundAlert : activeAlert

const adapter: OrbitAdapter = {
  check: async () => ({recorded: false, label: 'check', text: 'not recorded', dueAt: null, guidance}),
  vocabulary: async () => [],
  places: async () => [{id: 'rp_lincoln', kind: 'SCHOOL_PICKUP', label: 'Lincoln Elementary School'}],
  status: async () => ({alertId: record.id, status: record.status, closeOutcome: record.closeOutcome ?? null, thankyou: record.thankyou ?? null, audienceCount: 2, notifiedCount: 2, latestResponses: record.latestResponses, guidance}),
  alert: async () => record,
  draft: async () => ({draftId: 'd', draftVersion: 1, status: 'PENDING_ACTIVATION', guidance}),
  preview: async () => ({draftId: 'd', draftVersion: 1, message: 'm', messageHash: 'h', audienceSize: 2, guidance}),
  activate: async () => record,
  respond: async () => {},
  close: async () => { record = foundAlert; return foundAlert },
  upload: async () => 'photo',
  photo: async () => new Blob(),
}
const controller = new OrbitController(adapter, {childId: 'p_nora', personId: 'p_mom', parent: true, readOnly: false, generation: 1}, () => 1)

declare global {
  interface Window { __orbitParent?: {setState: (next: 'active' | 'found') => Promise<void>} }
}
window.__orbitParent = {setState: async next => { record = next === 'found' ? foundAlert : activeAlert; await controller.refresh(record.id) }}

function Auto() {
  const {session, switchPerson} = useSession()
  const started = useRef(false)
  // Defer the one-shot login out of the commit phase: the session transition uses flushSync, which
  // must not run while React is rendering. This is a harness-only concern, not product code.
  useEffect(() => { if (started.current || session) return; started.current = true; const t = setTimeout(() => void switchPerson('kendra'), 0); return () => clearTimeout(t) }, [session, switchPerson])
  return session ? <OrbitProvider controller={controller}><OrbitView controller={controller}/></OrbitProvider> : null
}
await controller.load()
createRoot(document.getElementById('root')!).render(<SessionProvider adapter={createMockAuthAdapter()}><Auto/></SessionProvider>)
