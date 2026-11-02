import { useState, type FormEvent } from 'react'
import { FgButton, Surface } from '@/components/fg/primitives'
import type { FridgeEditingAdapter, FridgeNoteRecord, FridgeViewer, GoalFields, GoalPeriod, GoalRecord, NoteFields, PaperColor } from './editingContract'
import { isParent } from './editingContract'
import { useFridgeEditing, type ReadState } from './useFridgeEditing'
import './fridge-editing.css'

export type FridgeEditingProps = { adapter: FridgeEditingAdapter; childId: string; viewer: FridgeViewer; section?: 'goals' | 'notes' | 'both'; childName?: string }
type Editing = ReturnType<typeof useFridgeEditing>
const periods: { value: GoalPeriod; label: string }[] = [{ value: 'DAY', label: 'Day' }, { value: 'WEEK', label: 'Week' }, { value: 'MONTH', label: 'Month' }]
const papers: { value: PaperColor; label: string }[] = [{ value: 'YELLOW', label: 'Yellow' }, { value: 'PINK', label: 'Pink' }, { value: 'BLUE', label: 'Blue' }, { value: 'GREEN', label: 'Green' }, { value: 'WHITE', label: 'White' }]
const completionTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'time not recorded'

function ReadBoundary<T>({ state, subject, retry }: { state: ReadState<T>; subject: string; retry: () => void }) {
  if (state.kind === 'loading') return <p role="status">Loading {subject}…</p>
  if (state.kind === 'refused') return <p role="alert">{subject} are not shared with this perspective.</p>
  if (state.kind === 'failed') return <div role="alert">Couldn’t load {subject}. <FgButton variant="secondary" onClick={retry}>Retry</FgButton></div>
  return null
}

function Notice({ editing, section }: { editing: Editing; section: 'goals' | 'notes' }) {
  if (editing.pending === section) return <p role="status">Saving {section}…</p>
  if (editing.notice?.section === section) return <p role={editing.notice.kind === 'failed' ? 'alert' : 'status'}>{editing.notice.text}</p>
  return null
}

function GoalForm({ initial, label, pending, onSave, onCancel }: { initial?: GoalRecord; label: string; pending: boolean; onSave: (fields: GoalFields) => Promise<boolean>; onCancel?: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [horizon, setHorizon] = useState(initial?.horizon ?? '')
  const [period, setPeriod] = useState<GoalPeriod | ''>(initial?.period ?? '')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    const saved = await onSave({ title: title.trim(), horizon: horizon.trim() || null, period: period || null })
    if (saved && !initial) { setTitle(''); setHorizon(''); setPeriod('') }
  }
  return <form className="fe-form" onSubmit={submit} aria-label={label}>
    <label>Goal title<input required value={title} onChange={event => setTitle(event.target.value)} disabled={pending} /></label>
    <label>Horizon <span className="fe-optional">optional · shown exactly as written</span><input value={horizon} onChange={event => setHorizon(event.target.value)} disabled={pending} /></label>
    <label>Period <span className="fe-optional">optional · chosen explicitly</span><select value={period} onChange={event => setPeriod(event.target.value as GoalPeriod | '')} disabled={pending}><option value="">No period selected</option>{periods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <div className="fe-actions"><FgButton type="submit" disabled={pending || !title.trim()}>{initial ? 'Save goal' : 'Add goal'}</FgButton>{onCancel && <FgButton variant="quiet" onClick={onCancel} disabled={pending}>Cancel</FgButton>}</div>
  </form>
}

function GoalItem({ goal, editing }: { goal: GoalRecord; editing: Editing }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const pending = editing.pending === 'goals'
  return <article className="fe-goal">
    {mode === 'edit' ? <GoalForm key={goal.id} initial={goal} label={`Edit ${goal.title}`} pending={pending} onSave={async fields => { const saved = await editing.updateGoal(goal.id, fields); if (saved) setMode('view'); return saved }} onCancel={() => setMode('view')} /> : <>
      <div className="fe-goal-head"><h4>{goal.title}</h4><span>{goal.status === 'APPROVED' ? 'Approved goal' : 'Proposed goal'}</span></div>
      {goal.horizon !== null && <p>Horizon: {goal.horizon}</p>}
      <p>{goal.completedAt ? <>Completed <time dateTime={goal.completedAt}>{completionTime(goal.completedAt)}</time></> : 'Not marked complete'}</p>
      {editing.canWrite && <div className="fe-actions">
        <FgButton variant="secondary" disabled={pending} onClick={() => void (goal.completedAt ? editing.uncompleteGoal(goal.id) : editing.completeGoal(goal.id))}>{goal.completedAt ? 'Reopen' : 'Mark complete'}</FgButton>
        <FgButton variant="quiet" disabled={pending} onClick={() => setMode('edit')}>Edit</FgButton>
        <FgButton variant="quiet" disabled={pending} onClick={() => setMode('delete')}>Delete</FgButton>
      </div>}
      {mode === 'delete' && <div className="fe-confirm" role="group" aria-label={`Delete ${goal.title}`}><p>Delete this goal from the child’s whiteboard?</p><FgButton variant="secondary" disabled={pending} onClick={async () => { if (await editing.deleteGoal(goal.id)) setMode('view') }}>Confirm delete</FgButton><FgButton variant="quiet" disabled={pending} onClick={() => setMode('view')}>Cancel</FgButton></div>}
    </>}
  </article>
}

export function FridgeGoalsEditor({ editing }: { editing: Editing }) {
  const groups = periods.map(period => ({ ...period, items: editing.goals.kind === 'ready' ? editing.goals.items.filter(goal => goal.period === period.value) : [] })).filter(group => group.items.length)
  const ungrouped = editing.goals.kind === 'ready' ? editing.goals.items.filter(goal => !goal.period) : []
  return <Surface className="fe-panel" role="region" aria-label="Whiteboard goals"><header><h2>Whiteboard goals</h2><p>Period is optional; completion is separate from proposal or approval.</p></header>
    <ReadBoundary state={editing.goals} subject="Goals" retry={editing.retry} />
    {editing.goals.kind === 'ready' && <>
      {editing.goals.items.length === 0 && <p>No goals are available to this view.</p>}
      {groups.map(group => <section key={group.value} className="fe-goal-group" aria-label={`${group.label} goals`}><h3>{group.label}</h3>{group.items.map(goal => <GoalItem key={goal.id} goal={goal} editing={editing} />)}</section>)}
      {ungrouped.map(goal => <GoalItem key={goal.id} goal={goal} editing={editing} />)}
      {editing.canWrite && <div className="fe-new"><h3>Add a goal</h3><GoalForm label="Add a goal" pending={editing.pending === 'goals'} onSave={editing.createGoal} /></div>}
    </>}
    <Notice editing={editing} section="goals" />
  </Surface>
}

function NoteForm({ initial, pending, onSave, onCancel }: { initial?: FridgeNoteRecord; pending: boolean; onSave: (fields: NoteFields) => Promise<boolean>; onCancel?: () => void }) {
  const [text, setText] = useState(initial?.text ?? '')
  const [paperColor, setPaperColor] = useState<PaperColor>(initial?.paperColor ?? 'YELLOW')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    const saved = await onSave({ text: text.trim(), paperColor })
    if (saved && !initial) { setText(''); setPaperColor('YELLOW') }
  }
  return <form className="fe-form" onSubmit={submit} aria-label={initial ? 'Edit fridge note' : 'Post a fridge note'}>
    <label>Note text<textarea required maxLength={500} rows={3} value={text} onChange={event => setText(event.target.value)} disabled={pending} /></label>
    <p className="fe-optional">{text.length} / 500 characters</p>
    <label>Paper color<select value={paperColor} onChange={event => setPaperColor(event.target.value as PaperColor)} disabled={pending}>{papers.map(paper => <option key={paper.value} value={paper.value}>{paper.label}</option>)}</select></label>
    <div className="fe-actions"><FgButton type="submit" disabled={pending || !text.trim()}>{initial ? 'Save note' : 'Post privately'}</FgButton>{onCancel && <FgButton variant="quiet" onClick={onCancel} disabled={pending}>Cancel</FgButton>}</div>
  </form>
}

function NoteItem({ note, editing, viewer }: { note: FridgeNoteRecord; editing: Editing; viewer: FridgeViewer }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view')
  const pending = editing.pending === 'notes'
  const own = note.author.id === viewer.personId
  return <article className="fe-note" data-paper={note.paperColor}>
    {mode === 'edit' ? <NoteForm key={note.id} initial={note} pending={pending} onSave={async fields => { const saved = await editing.updateNote(note.id, fields); if (saved) setMode('view'); return saved }} onCancel={() => setMode('view')} /> : <>
      <p className="fe-note-text">{note.text}</p>
      <p className="fe-note-meta">By {note.author.displayName} · {note.audience === 'SHARED' ? 'Shared with granted readers' : 'Parents only'}</p>
      {editing.canWrite && <div className="fe-actions">
        {own && <FgButton variant="quiet" disabled={pending} onClick={() => setMode('edit')}>Edit note</FgButton>}
        <FgButton variant="secondary" disabled={pending} onClick={() => void editing.setAudience(note.id, note.audience === 'SHARED' ? 'PARENTS_ONLY' : 'SHARED')}>{note.audience === 'SHARED' ? 'Unshare' : 'Share'}</FgButton>
        <FgButton variant="quiet" disabled={pending} onClick={() => setMode('remove')}>Remove</FgButton>
      </div>}
      {mode === 'remove' && <div className="fe-confirm" role="group" aria-label="Remove fridge note"><p>Remove this note from the child’s fridge?</p><FgButton variant="secondary" disabled={pending} onClick={async () => { if (await editing.removeNote(note.id)) setMode('view') }}>Confirm remove</FgButton><FgButton variant="quiet" disabled={pending} onClick={() => setMode('view')}>Cancel</FgButton></div>}
    </>}
  </article>
}

export function FridgeNotesEditor({ editing, viewer }: { editing: Editing; viewer: FridgeViewer }) {
  return <Surface className="fe-panel" role="region" aria-label="Fridge notes"><header><h2>Fridge notes</h2><p>Notes stay with parents until a parent explicitly shares one.</p></header>
    <ReadBoundary state={editing.notes} subject="Fridge notes" retry={editing.retry} />
    {editing.notes.kind === 'ready' && <>
      {editing.notes.items.length === 0 && <p>No notes are available to this view.</p>}
      <div className="fe-notes">{editing.notes.items.map(note => <NoteItem key={note.id} note={note} editing={editing} viewer={viewer} />)}</div>
      {editing.canWrite && <div className="fe-new"><h3>Post a note</h3><p>Audience: parents only. Use Share on the posted note to widen access.</p><NoteForm pending={editing.pending === 'notes'} onSave={editing.postNote} /></div>}
    </>}
    <Notice editing={editing} section="notes" />
  </Surface>
}

function FridgeEditingContext({ adapter, childId, viewer, section = 'both', childName }: FridgeEditingProps) {
  const editing = useFridgeEditing(adapter, childId, viewer)
  return <section className="fe" aria-label="Fridge editing">
    <header className="fe-header"><h1>{childName ? `${childName}’s fridge` : 'The Fridge'}</h1><p>{isParent(viewer) ? 'Record goals and notes for this child.' : 'Read-only perspective. Changes are available to a parent or guardian.'}</p></header>
    <div className="fe-grid">{section !== 'notes' && <FridgeGoalsEditor editing={editing} />}{section !== 'goals' && <FridgeNotesEditor editing={editing} viewer={viewer} />}</div>
  </section>
}

/** A new instance per caller/child/session clears drafts and discards late responses. */
export function FridgeEditing(props: FridgeEditingProps) {
  return <FridgeEditingContext key={`${props.viewer.sessionKey}:${props.viewer.personId}:${props.viewer.role}:${props.childId}`} {...props} />
}
