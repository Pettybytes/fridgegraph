import { createRoot } from 'react-dom/client'
import '../../index.css'
import { SessionContext, type SessionContextValue } from '@/features/personas/Session'
import { Activity } from './Activity'
import type { StoredMissionControl } from '@/lib/frontendData/deliveredAdapter'
import type { FrontendAdapter } from '@/lib/frontendData/types'
import type { createGraphClient } from '@/lib/frontendData/graphqlAdapter'

// Standalone fictional sample for visual review only — no application navigation, no live reads,
// no SessionProvider/AuthAdapter. Reachable only at /activity-preview.html, never from the app.

const missionControl = {
  candidates: [], events: [],
  recordedRuns: [{
    job: { id: 'job_preview', status: 'OPEN', version: 1, candidateEvaluations: [], confirmation: null },
    attempts: [],
    timeline: [{ at: '2026-11-01T15:00:00Z', kind: 'JOB_CREATED', attemptId: null, candidate: null, detail: null }],
  }],
} as StoredMissionControl

const villagerAdditionsResponse = {
  villagerAdditions: [{
    id: 'vp_preview',
    person: { id: 'p_dana', displayName: 'Dana Coleman' },
    addedBy: { id: 'kendra' },
    relationshipType: 'family_friend',
    scopes: ['pickup.request'],
    confirmedAt: '2026-11-01T15:30:00Z',
  }],
}

function mockClient(): ReturnType<typeof createGraphClient> {
  return {
    query: ({ query }: { query: { definitions: { name?: { value: string } }[] } }) => {
      const name = query.definitions[0]?.name?.value
      if (name === 'WebActivitySlips') return Promise.resolve({ data: { permissionSlips: [] } })
      if (name === 'WebActivityOrbit') return Promise.resolve({ data: { orbitStatus: { status: null, latestResponses: [] } } })
      if (name === 'WebActivityCheck') return Promise.resolve({ data: { checkInStatus: { recorded: true } } })
      if (name === 'WebActivityVillagerAdditions') return Promise.resolve({ data: villagerAdditionsResponse })
      return Promise.resolve({ data: { schoolReports: [] } })
    },
  } as unknown as ReturnType<typeof createGraphClient>
}

const adapter: FrontendAdapter = {
  mode: 'graphql',
  readMissionControl: async () => missionControl,
  readVillage: async () => ({ nodes: [], edges: [] }),
}

const fakeSession: SessionContextValue = {
  session: {
    generation: 1,
    scope: { childId: 'p_nora', childName: 'Nora', parentName: 'kendra', villageId: 'v_nora' },
    persona: { id: 'kendra', personId: 'kendra', childId: 'p_nora', childName: 'Nora', name: 'Kendra', villageId: 'v_nora', parent: true, grants: [], role: 'test' },
  } as SessionContextValue['session'],
  switching: false, error: '', families: [], authMode: 'mock', notice: '',
  resetting: false, resetError: '', resetRetryAt: 0, unavailable: new Set(), retryAt: {},
  getSessionGeneration: () => 1,
  getCurrentSession: () => fakeSession.session,
  renewSession: async () => fakeSession.session,
  runRead: (read) => read(),
  switchPerson: async () => {},
  resetDemo: async () => false,
  createDemoFamily: async () => {},
  registerPrivateCleanup: () => () => {},
  registerResetVerification: () => () => {},
}

createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px' }}>
    <p style={{ color: '#666', fontSize: 13 }}>Preview — fictional sample data, no live reads.</p>
    <SessionContext.Provider value={fakeSession}>
      <Activity client={mockClient()} adapter={adapter} />
    </SessionContext.Provider>
  </main>,
)
