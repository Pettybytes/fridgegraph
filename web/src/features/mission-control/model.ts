import type { MissionControlData } from '@/lib/frontendData/types'
import { reasonLabel } from '@/lib/frontendData/types'

// Keep all recorded caregiver rows. An over-limit row is not an approval or a fallback decision.
export function buildMissionControlView(data: MissionControlData) {
  const candidates = data.candidates.map(candidate => ({ ...candidate, statusLabel: reasonLabel(candidate.reasonCode) }))
  const timeline = [...data.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return {
    candidates,
    timeline,
    recommendation: candidates.find(candidate => candidate.reasonCode === 'RECOMMENDED' || candidate.reasonCode === 'APPROVAL_PENDING') ?? null,
    activityTrace: timeline.filter(event => event.kind === 'attempt' || event.kind === 'candidate_evaluation'),
  }
}
