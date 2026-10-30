import { createPickupDemoAdapter } from '@/features/mission-control/demoAdapter'
import type { FrontendAdapter } from '@/lib/frontendData/types'
import type { AuthSession } from './auth'
// Unavailable real auth; conservative MOCK surface responses, not client-side authz for live data.
export function createPersonaDataAdapter(session: AuthSession): FrontendAdapter {
  const base = createPickupDemoAdapter()
  function assertScope(childId: string) { if (childId !== session.scope.childId) throw new Error('UNAUTHORIZED') }
  return {
    mode: 'mock',
    async readMissionControl(scope) {
      assertScope(scope.childId)
      if (!session.persona.parent) throw new Error('UNAUTHORIZED')
      return scope.childId === 'p_nora' ? base.readMissionControl(scope) : { candidates: [], events: [] }
    },
    async readVillage(scope) {
      assertScope(scope.childId)
      if (!session.persona.parent) throw new Error('UNAUTHORIZED')
      if (scope.childId === 'p_nora') return base.readVillage(scope)
      if (scope.childId !== 'p_jax') throw new Error('UNAVAILABLE')
      return { nodes: [
        { person: { id: 'p_jax', displayName: 'Jax Coleman' }, household: { id: 'h_c' }, role: 'child' },
        { person: { id: 'p_dana', displayName: 'Dana Coleman' }, household: { id: 'h_c' }, role: 'parent' },
        { person: { id: 'p_ray', displayName: 'Ray Coleman' }, household: { id: 'h_d' }, role: 'parent' },
      ], edges: [] }
    },
    async readParentChat() { throw new Error('UNAVAILABLE: Ask Rosina replaces parent chat') },
    ...(session.persona.id === 'kendra' ? { approvePickup: base.approvePickup } : {}),
  }
}
