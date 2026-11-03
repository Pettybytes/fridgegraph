/** Illustrative public fixture. It is not a jobTimeline or an authorization read. */
export const STORY_DATE = '2026-10-30' // Friday in America/Detroit
export const STORY_TIMEZONE = 'America/Detroit'
export type Viewer = 'parent' | 'caregiver' | 'teacher'
export type StoryKind = 'notice' | 'explanation' | 'request-approved' | 'offer' | 'parent-confirmed' | 'pickup-authorized' | 'today'
export type StoryEvent = Readonly<{
  id: string
  atMs: number
  viewer: Viewer
  kind: StoryKind
  title: string
  body: string
  detail?: string
}>

// Visibility is defined here. A teacher projection never receives the family messages.
export const ILLUSTRATIVE_STORY: readonly StoryEvent[] = [
  { id: 'notice', atMs: 0, viewer: 'teacher', kind: 'notice', title: 'School notice', body: 'Friday, October 30: early dismissal at 1:30 PM.' },
  { id: 'parent-notice', atMs: 1900, viewer: 'parent', kind: 'notice', title: 'Notice received', body: 'Nora’s school dismisses at 1:30 PM on Friday, October 30.' },
  { id: 'rosina', atMs: 4100, viewer: 'parent', kind: 'explanation', title: 'Rosina · proposal', body: 'Nora’s pickup is still at 3:15. She needs a new pickup plan. Ask Loretta?' },
  { id: 'approve-request', atMs: 7000, viewer: 'parent', kind: 'request-approved', title: 'Kendra · parent action', body: 'Approve request', detail: 'Pickup request created, not arranged yet.' },
  { id: 'caregiver-request', atMs: 8900, viewer: 'caregiver', kind: 'notice', title: 'Pickup request', body: 'Nora needs pickup Friday, October 30 at 1:30 PM.' },
  { id: 'offer', atMs: 11200, viewer: 'caregiver', kind: 'offer', title: 'Loretta · voice note', body: '“Yes, I can be there at 1:20.”', detail: 'Caregiver offer reported. Parent confirmation still needed.' },
  { id: 'parent-offer', atMs: 13500, viewer: 'parent', kind: 'offer', title: 'Loretta offers', body: '“Yes, I can be there at 1:20.”', detail: 'An offer, awaiting Kendra’s decision.' },
  { id: 'confirm', atMs: 15800, viewer: 'parent', kind: 'parent-confirmed', title: 'Kendra · parent action', body: 'Confirm Loretta', detail: 'Parent confirmation recorded.' },
  { id: 'caregiver-confirmed', atMs: 17700, viewer: 'caregiver', kind: 'parent-confirmed', title: 'Parent-confirmed pickup', body: 'Nora · Friday, October 30 at 1:30 PM', detail: 'Loretta confirmed. Pickup completion not recorded.' },
  { id: 'teacher-authorization', atMs: 19500, viewer: 'teacher', kind: 'pickup-authorized', title: 'Prototype pickup authorization', body: 'Nora · Loretta · Friday, October 30', detail: 'Parent-confirmed pickup at 1:30 PM.' },
  { id: 'today', atMs: 21100, viewer: 'parent', kind: 'today', title: 'Today', body: 'Friday pickup · Loretta confirmed', detail: 'Pickup completion not recorded.' },
] as const

export const FINAL_HOLD_MS = 3200
export const VOICE_START_MS = 11200
export const VOICE_BEAT_MS = 2300
export function storyDurationMs(voiceDurationMs = 0) {
  // The 2.3 s text beat can expand for real audio; downstream moments shift together.
  return 24300 + Math.max(0, voiceDurationMs - VOICE_BEAT_MS)
}
export function eventAt(event: StoryEvent, voiceDurationMs = 0) {
  return event.atMs + (event.atMs > VOICE_START_MS ? Math.max(0, voiceDurationMs - VOICE_BEAT_MS) : 0)
}
export function projectStory(viewer: Viewer, elapsedMs: number, voiceDurationMs = 0) {
  return ILLUSTRATIVE_STORY.filter(event => event.viewer === viewer && eventAt(event, voiceDurationMs) <= elapsedMs)
}
export function storyBeat(elapsedMs: number, voiceDurationMs = 0) {
  if (elapsedMs < eventAt(ILLUSTRATIVE_STORY[5], voiceDurationMs)) return 'The problem: school ends before Nora’s recorded pickup.'
  if (elapsedMs < eventAt(ILLUSTRATIVE_STORY[7], voiceDurationMs)) return 'Loretta offers. Kendra still needs to decide.'
  return 'Kendra confirms Loretta. Pickup completion is not recorded.'
}
