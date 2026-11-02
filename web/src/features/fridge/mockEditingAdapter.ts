import type { FridgeEditingAdapter, FridgeNoteRecord, GoalRecord } from './editingContract'

export const sampleGoals: GoalRecord[] = [
  { id: 'goal_reading', title: 'Read together after school', horizon: 'June 2027', period: 'WEEK', status: 'APPROVED', completedAt: null },
  { id: 'goal_passing', title: 'Practice a calm handoff', horizon: 'Before winter break', period: null, status: 'PROPOSED', completedAt: null },
  { id: 'goal_walk', title: 'Walk to the library', horizon: null, period: 'MONTH', status: 'APPROVED', completedAt: '2026-10-30T18:00:00Z' },
]
export const sampleNotes: FridgeNoteRecord[] = [
  { id: 'note_kendra', author: { id: 'kendra', displayName: 'Kendra' }, text: 'Nora picked the next library book. Leave it by the door for Saturday.', paperColor: 'YELLOW', audience: 'PARENTS_ONLY', createdAt: '2026-11-01T14:00:00Z', updatedAt: '2026-11-01T14:00:00Z', revision: 1 },
  { id: 'note_dana', author: { id: 'dana', displayName: 'Dana' }, text: 'The blue mittens are in the school bag.', paperColor: 'BLUE', audience: 'SHARED', createdAt: '2026-10-31T16:00:00Z', updatedAt: '2026-10-31T16:00:00Z', revision: 1 },
]

/** Controlled fictional fixture only. Mounting this in the app would not authorize any write. */
export function mockFridgeEditingAdapter(initialGoals = sampleGoals, initialNotes = sampleNotes): FridgeEditingAdapter {
  let goals = initialGoals.map(goal => ({ ...goal }))
  let notes = initialNotes.map(note => ({ ...note, author: { ...note.author } }))
  let next = 1
  const now = () => '2026-11-02T17:00:00Z'
  const goal = (id: string) => { const found = goals.find(item => item.id === id); if (!found) throw Error('NOT_FOUND'); return found }
  const note = (id: string) => { const found = notes.find(item => item.id === id); if (!found) throw Error('NOT_FOUND'); return found }
  return {
    readGoals: async () => goals.map(item => ({ ...item })),
    readNotes: async () => notes.map(item => ({ ...item, author: { ...item.author } })),
    createGoal: async args => { const created: GoalRecord = { id: `fixture-goal-${next++}`, title: args.title, horizon: args.horizon, period: args.period, status: args.status, completedAt: null }; goals = [...goals, created]; return { ...created } },
    updateGoal: async args => { const old = goal(args.id); const updated = { ...old, title: args.title, horizon: args.horizon, period: args.period }; goals = goals.map(item => item.id === args.id ? updated : item); return { ...updated } },
    completeGoal: async ({ id }) => { const updated = { ...goal(id), completedAt: now() }; goals = goals.map(item => item.id === id ? updated : item); return { ...updated } },
    uncompleteGoal: async ({ id }) => { const updated = { ...goal(id), completedAt: null }; goals = goals.map(item => item.id === id ? updated : item); return { ...updated } },
    deleteGoal: async ({ id }) => { goal(id); goals = goals.filter(item => item.id !== id); return true },
    postFridgeNote: async args => { const created: FridgeNoteRecord = { id: `fixture-note-${next++}`, author: { id: 'kendra', displayName: 'Kendra' }, text: args.text, paperColor: args.paperColor, audience: args.audience, createdAt: now(), updatedAt: now(), revision: 1 }; notes = [...notes, created]; return { ...created } },
    updateFridgeNote: async args => { const old = note(args.id); const updated = { ...old, text: args.text, paperColor: args.paperColor, updatedAt: now(), revision: old.revision + 1 }; notes = notes.map(item => item.id === args.id ? updated : item); return { ...updated } },
    setFridgeNoteAudience: async args => { const old = note(args.id); const updated = { ...old, audience: args.audience, updatedAt: now(), revision: old.revision + 1 }; notes = notes.map(item => item.id === args.id ? updated : item); return { ...updated } },
    removeFridgeNote: async ({ id }) => { note(id); notes = notes.filter(item => item.id !== id); return true },
  }
}
