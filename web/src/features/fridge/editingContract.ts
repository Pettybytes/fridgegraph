/** Mirrors the staged Phase 2 graph contract in PR #157. No transport is created here. */
export type GoalPeriod = 'DAY' | 'WEEK' | 'MONTH'
export type GoalStatus = 'PROPOSED' | 'APPROVED'
export type PaperColor = 'YELLOW' | 'PINK' | 'BLUE' | 'GREEN' | 'WHITE'
export type NoteAudience = 'PARENTS_ONLY' | 'SHARED'
export type FridgeRole = 'PARENT' | 'GUARDIAN' | 'CAREGIVER' | 'GUIDE'

export type FridgeViewer = { personId: string; role: FridgeRole; sessionKey: string }
export type GoalRecord = {
  id: string
  title: string
  horizon: string | null
  status: GoalStatus
  period: GoalPeriod | null
  completedAt: string | null
}
export type FridgeNoteRecord = {
  id: string
  author: { id: string; displayName: string | null }
  text: string
  attachmentRef?: string | null
  paperColor: PaperColor
  audience: NoteAudience
  createdAt: string
  updatedAt: string
  revision: number
}

export type GoalFields = { title: string; horizon: string | null; period: GoalPeriod | null }
export type NoteFields = { text: string; paperColor: PaperColor }

/** The mount supplies methods backed by its signed-in Apollo client and caller token. */
export interface FridgeEditingAdapter {
  readGoals(childId: string, signal: AbortSignal): Promise<GoalRecord[]>
  readNotes(childId: string, signal: AbortSignal): Promise<FridgeNoteRecord[]>
  createGoal(args: { childId: string; title: string; horizon: string | null; period: GoalPeriod | null; status: 'PROPOSED' }): Promise<GoalRecord>
  updateGoal(args: { id: string } & GoalFields): Promise<GoalRecord>
  completeGoal(args: { id: string }): Promise<GoalRecord>
  uncompleteGoal(args: { id: string }): Promise<GoalRecord>
  deleteGoal(args: { id: string }): Promise<boolean>
  postFridgeNote(args: { childId: string; text: string; paperColor: PaperColor; audience: 'PARENTS_ONLY'; attachmentRef?: string }): Promise<FridgeNoteRecord>
  updateFridgeNote(args: { id: string } & NoteFields): Promise<FridgeNoteRecord>
  setFridgeNoteAudience(args: { id: string; audience: NoteAudience }): Promise<FridgeNoteRecord>
  removeFridgeNote(args: { id: string }): Promise<boolean>
}

export function isParent(viewer: FridgeViewer): boolean {
  return viewer.role === 'PARENT' || viewer.role === 'GUARDIAN'
}

export function writeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/UNAUTHORIZED|FORBIDDEN|NOT_SHARED/.test(message)) return 'This change is not allowed for this perspective.'
  if (/UNAUTHENTICATED/.test(message)) return 'Your perspective needs a fresh session. Try again.'
  if (message === 'GOAL_STYLE_FAILED') return 'Goal text saved, but the marker choices did not save. Try Save goal again.'
  if (message === 'GOAL_STYLE_UNAVAILABLE') return 'Marker choices are still loading. Try again shortly.'
  if (message === 'NETWORK_ERROR') return 'Couldn’t confirm this change. Check the records before trying again.'
  if (message === 'DB_UNAVAILABLE') return 'Couldn’t save this change just now. Try again.'
  return 'Couldn’t save this change. Try again.'
}
