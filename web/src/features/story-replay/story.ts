/** Illustrative public fixture. It is not a jobTimeline or an authorization read. */
export const STORY_DATE = '2026-11-02' // Monday; Kendra's recorded parenting-schedule day
export const STORY_TIMEZONE = 'America/Detroit'
export const STORY_DATE_LABEL = 'Monday, November 2, 2026'
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
// Every viewer has an atMs 0 event so all three phones show content from the first frame.
export const ILLUSTRATIVE_STORY: readonly StoryEvent[] = [
  { id: 'parent-today', atMs: 0, viewer: 'parent', kind: 'today', title: 'Today', body: 'Nora · school 8:15 AM – 3:00 PM. Pickup recorded for 3:15 PM.' },
  { id: 'caregiver-today', atMs: 0, viewer: 'caregiver', kind: 'today', title: 'Village', body: 'Loretta · available for school-day pickups after 1 PM.' },
  { id: 'notice', atMs: 0, viewer: 'teacher', kind: 'notice', title: 'School notice', body: 'Monday, November 2: early dismissal at 1:30 PM.' },
  { id: 'parent-notice', atMs: 1900, viewer: 'parent', kind: 'notice', title: 'Notice received', body: 'Nora’s school dismisses at 1:30 PM on Monday, November 2.' },
  { id: 'rosina', atMs: 4100, viewer: 'parent', kind: 'explanation', title: 'Rosina · proposal', body: 'Nora’s pickup is still at 3:15. She needs a new pickup plan. Ask Loretta?' },
  { id: 'approve-request', atMs: 7000, viewer: 'parent', kind: 'request-approved', title: 'Kendra · parent action', body: 'Approve request', detail: 'Pickup request created for Loretta.' },
  { id: 'caregiver-request', atMs: 8900, viewer: 'caregiver', kind: 'notice', title: 'Pickup request', body: 'Nora needs pickup Monday, November 2 at 1:30 PM.' },
  { id: 'offer', atMs: 11200, viewer: 'caregiver', kind: 'offer', title: 'Loretta · voice note', body: '“Yes, I can be there at 1:20.”', detail: 'Loretta offered a 1:20 PM arrival.' },
  { id: 'parent-offer', atMs: 13500, viewer: 'parent', kind: 'offer', title: 'Loretta offers', body: '“Yes, I can be there at 1:20.”', detail: 'Offer recorded for Kendra’s review.' },
  { id: 'confirm', atMs: 15800, viewer: 'parent', kind: 'parent-confirmed', title: 'Kendra · parent action', body: 'Confirm Loretta', detail: 'Parent confirmation recorded.' },
  { id: 'caregiver-confirmed', atMs: 17700, viewer: 'caregiver', kind: 'parent-confirmed', title: 'Parent-confirmed pickup', body: 'Nora · Monday, November 2 at 1:30 PM', detail: 'Loretta confirmed by Kendra.' },
  { id: 'teacher-authorization', atMs: 19500, viewer: 'teacher', kind: 'pickup-authorized', title: 'Prototype pickup authorization', body: 'Nora · Loretta · Monday, November 2', detail: 'Parent-confirmed pickup at 1:30 PM.' },
  { id: 'today', atMs: 21100, viewer: 'parent', kind: 'today', title: 'Today', body: 'Monday pickup · Loretta confirmed' },
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
  const offer = ILLUSTRATIVE_STORY.find(event => event.id === 'offer')!
  const confirm = ILLUSTRATIVE_STORY.find(event => event.id === 'confirm')!
  if (elapsedMs < eventAt(offer, voiceDurationMs)) return 'The problem: school ends before Nora’s recorded pickup.'
  if (elapsedMs < eventAt(confirm, voiceDurationMs)) return 'Loretta offers. Kendra still needs to decide.'
  return 'Kendra confirms Loretta for Monday’s pickup.'
}
