import type { OrbitState } from '@/features/orbit/controller'
import type { PulseOrbit, PulseRead } from './VillagePulse'

/** Refresh errors can leave a previous ACTIVE status in the controller. Never call it current. */
export function orbitPulseRead(state: Pick<OrbitState, 'phase' | 'status' | 'error'>): PulseRead<PulseOrbit> {
  if (state.error.trim()) return { kind: /isn't shared|not shared|unauthorized|read-only/i.test(state.error) ? 'refused' : 'failed' }
  if (state.phase === 'unavailable') return { kind: 'failed' }
  if (state.phase === 'loading') return { kind: 'loading' }
  return { kind: 'ready', value: { alertId: state.status?.alertId ?? null, status: state.status?.status ?? null } }
}
