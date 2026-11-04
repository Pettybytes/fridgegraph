// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { FridgeEditing } from './FridgeEditing'
import { mockFridgeEditingAdapter, sampleGoals, sampleNotes } from './mockEditingAdapter'
import type { FridgeEditingAdapter, FridgeViewer, GoalRecord } from './editingContract'

const parent: FridgeViewer = { personId: 'kendra', role: 'PARENT', sessionKey: 'kendra-1' }
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const mount = (adapter: FridgeEditingAdapter = mockFridgeEditingAdapter(), viewer = parent) => render(<FridgeEditing adapter={adapter} childId="nora" viewer={viewer} childName="Nora" />)

// These are authorization and mutation-boundary tests, not a mirror of the form implementation.
describe('Phase 2 Fridge editing UI', () => {
  it('keeps completion separate from approval, groups only chosen periods, and preserves horizon text', async () => {
    const adapter = mockFridgeEditingAdapter()
    const complete = vi.spyOn(adapter, 'completeGoal')
    mount(adapter)
    const goals = screen.getByRole('region', { name: 'Whiteboard goals' })
    await within(goals).findByText('Read together after school')
    expect(within(goals).getByRole('region', { name: 'Week goals' })).toHaveTextContent('Read together after school')
    expect(within(goals).getByRole('region', { name: 'Month goals' })).toHaveTextContent('Walk to the library')
    expect(within(goals).getByText('Horizon: Before winter break')).toBeInTheDocument()
    expect(within(goals).getByText('Proposed goal')).toBeInTheDocument()
    const reading = within(goals).getByText('Read together after school').closest('article')!
    fireEvent.click(within(reading).getByRole('button', { name: 'Mark complete' }))
    await within(reading).findByRole('button', { name: 'Reopen' })
    expect(complete).toHaveBeenCalledWith({ id: 'goal_reading' })
    expect(reading).toHaveTextContent('Approved goal')
    expect(reading).toHaveTextContent('Completed')
    fireEvent.click(within(reading).getByRole('button', { name: 'Reopen' }))
    await within(reading).findByText('Not marked complete')
    expect(reading).toHaveTextContent('Approved goal')
  })

  it('creates an unperiodized PROPOSED goal with a verbatim optional horizon, then edits and deletes it', async () => {
    const adapter = mockFridgeEditingAdapter()
    const create = vi.spyOn(adapter, 'createGoal')
    const update = vi.spyOn(adapter, 'updateGoal')
    mount(adapter)
    const goals = screen.getByRole('region', { name: 'Whiteboard goals' })
    await within(goals).findByText('Read together after school')
    const form = within(goals).getByRole('form', { name: 'Add a goal' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Goal title' }), { target: { value: 'Plan a garden afternoon' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /Horizon/ }), { target: { value: 'when spring arrives' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add goal' }))
    const created = await within(goals).findByText('Plan a garden afternoon')
    expect(create).toHaveBeenCalledWith({ childId: 'nora', title: 'Plan a garden afternoon', horizon: 'when spring arrives', period: null, status: 'PROPOSED' })
    expect(created.closest('article')).toHaveTextContent('Horizon: when spring arrives')
    const article = created.closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: 'Edit' }))
    const edit = within(article).getByRole('form', { name: 'Edit Plan a garden afternoon' })
    fireEvent.change(within(edit).getByRole('combobox', { name: /Period/ }), { target: { value: 'DAY' } })
    fireEvent.click(within(edit).getByRole('button', { name: 'Save goal' }))
    await within(goals).findByRole('region', { name: 'Day goals' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ period: 'DAY', horizon: 'when spring arrives' }))
    const moved = within(goals).getByText('Plan a garden afternoon').closest('article')!
    fireEvent.click(within(moved).getByRole('button', { name: 'Delete' }))
    expect(within(moved).getByText(/Delete this goal/)).toBeInTheDocument()
    fireEvent.click(within(moved).getByRole('button', { name: 'Confirm delete' }))
    await screen.findByText('Saved.')
    expect(within(goals).queryByText('Plan a garden afternoon')).not.toBeInTheDocument()
  })

  it('posts privately, requires an explicit Share mutation, permits own edits and parent removal of any note', async () => {
    const adapter = mockFridgeEditingAdapter()
    const post = vi.spyOn(adapter, 'postFridgeNote')
    const audience = vi.spyOn(adapter, 'setFridgeNoteAudience')
    const updateNote = vi.spyOn(adapter, 'updateFridgeNote')
    const remove = vi.spyOn(adapter, 'removeFridgeNote')
    mount(adapter)
    const notes = screen.getByRole('region', { name: 'Fridge notes' })
    await within(notes).findByText(/Nora picked the next library book/)
    expect(within(notes).getAllByRole('button', { name: 'Edit note' })).toHaveLength(1)
    const kendra = within(notes).getByText(/Nora picked the next library book/).closest('article')!
    fireEvent.click(within(kendra).getByRole('button', { name: 'Edit note' }))
    const edit = within(kendra).getByRole('form', { name: 'Edit fridge note' })
    fireEvent.change(within(edit).getByRole('textbox', { name: 'Note text' }), { target: { value: 'The library book is by the door.' } })
    fireEvent.click(within(edit).getByRole('button', { name: 'Save note' }))
    await within(notes).findByText('The library book is by the door.')
    expect(updateNote).toHaveBeenCalledWith({ id: 'note_kendra', text: 'The library book is by the door.', paperColor: 'YELLOW' })
    const form = within(notes).getByRole('form', { name: 'Post a fridge note' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Note text' }), { target: { value: 'Bring the blue folder.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Post privately' }))
    await within(notes).findByText('Bring the blue folder.')
    expect(post).toHaveBeenCalledWith({ childId: 'nora', text: 'Bring the blue folder.', paperColor: 'YELLOW', audience: 'PARENTS_ONLY' })
    const newNote = within(notes).getByText('Bring the blue folder.').closest('article')!
    expect(newNote).toHaveTextContent('Parents only')
    fireEvent.click(within(newNote).getByRole('button', { name: 'Share' }))
    await within(newNote).findByText(/Shared with granted readers/)
    expect(audience).toHaveBeenCalledWith({ id: expect.any(String), audience: 'SHARED' })
    const dana = within(notes).getByText('The blue mittens are in the school bag.').closest('article')!
    fireEvent.click(within(dana).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(dana).getByRole('button', { name: 'Confirm remove' }))
    await screen.findByText('Saved.')
    expect(remove).toHaveBeenCalledWith({ id: 'note_dana' })
  })

  it('shows no edit controls for caregiver or guide; guide reads only the notes supplied by the server', async () => {
    const caregiver: FridgeViewer = { personId: 'dana', role: 'CAREGIVER', sessionKey: 'dana-1' }
    const view = mount(mockFridgeEditingAdapter(sampleGoals.filter(goal => goal.status === 'APPROVED'), sampleNotes.filter(note => note.audience === 'SHARED')), caregiver)
    await screen.findByText('Read together after school')
    expect(screen.getByText(/Read-only perspective/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add goal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    view.rerender(<FridgeEditing adapter={mockFridgeEditingAdapter(sampleGoals.filter(goal => goal.status === 'APPROVED'))} childId="nora" viewer={{ personId: 'guide', role: 'GUIDE', sessionKey: 'guide-1' }} />)
    expect(await screen.findByText(/Nora picked the next library book/)).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Post privately'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Edit note'})).not.toBeInTheDocument()
  })

  it('renders guardian editing controls against the parent/guardian contract', async () => {
    mount(mockFridgeEditingAdapter(), { personId: 'guardian', role: 'GUARDIAN', sessionKey: 'guardian-1' })
    await screen.findByText('Read together after school')
    expect(screen.getByRole('button', { name: 'Add goal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post privately' })).toBeInTheDocument()
  })

  it('does not announce saved or replace data before the server confirms, and surfaces a failure', async () => {
    const adapter = mockFridgeEditingAdapter()
    const flight = deferred<GoalRecord>()
    adapter.completeGoal = vi.fn(() => flight.promise)
    mount(adapter)
    const goals = screen.getByRole('region', { name: 'Whiteboard goals' })
    const reading = (await within(goals).findByText('Read together after school')).closest('article')!
    fireEvent.click(within(reading).getByRole('button', { name: 'Mark complete' }))
    expect(reading).toHaveTextContent('Not marked complete')
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
    expect(screen.getByText('Saving goals…')).toBeInTheDocument()
    await act(async () => flight.reject(new Error('SERVER_UNAVAILABLE')))
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save this change')
    expect(reading).toHaveTextContent('Not marked complete')
  })

  it('discards a late read from the previous child and keeps refusal distinct from empty', async () => {
    const old = deferred<GoalRecord[]>()
    const adapter = mockFridgeEditingAdapter([], [])
    adapter.readGoals = vi.fn((childId) => childId === 'nora' ? old.promise : Promise.resolve([{ ...sampleGoals[0], id: 'new-child-goal', title: 'New child goal' }]))
    adapter.readNotes = vi.fn((childId) => childId === 'nora' ? Promise.reject(new Error('UNAUTHORIZED')) : Promise.resolve([]))
    const view = mount(adapter)
    expect(await screen.findByText('Fridge notes are not shared with this perspective.')).toBeInTheDocument()
    view.rerender(<FridgeEditing adapter={adapter} childId="other-child" viewer={{ ...parent, sessionKey: 'kendra-2' }} />)
    await screen.findByText('New child goal')
    await act(async () => old.resolve([{ ...sampleGoals[0], title: 'Old child goal' }]))
    expect(screen.queryByText('Old child goal')).not.toBeInTheDocument()
  })
})
