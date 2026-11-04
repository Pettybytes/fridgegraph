import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import type { EventDraft, WriteResult } from './liveAdapter'
import { localDay } from './time'
// The parent event form: title, child, date, start/end, location, notes and a colour the parent
// picks. Saving and deleting each require an explicit confirm ("Save this change to Nora's
// calendar?" / "Delete this event..."), never a silent write. Parents only; the caller does not
// mount this for a caregiver.
export type EventChild = { id: string; displayName: string }
export type EventFormInitial = { id: string; draft: EventDraft; childId: string } | null
// Swatches are the design-v2 --type-* palette as concrete CSS colours (stored verbatim and used as
// the pill fill). "No colour" falls back to the neutral type colour.
const SWATCHES: { label: string; value: string }[] = [
  { label: 'Pickup', value: 'oklch(0.66 0.15 62)' },
  { label: 'School', value: 'oklch(0.56 0.16 252)' },
  { label: 'Activity', value: 'oklch(0.57 0.13 155)' },
  { label: 'Care', value: 'oklch(0.60 0.10 195)' },
  { label: 'Celebration', value: 'oklch(0.57 0.20 330)' },
  { label: 'Orbit', value: 'oklch(0.57 0.22 25)' },
]
function splitInstant(iso: string): { date: string; time: string } {
  const day = localDay(iso)
  const m = /T(\d{2}:\d{2})/.exec(iso)
  return { date: day, time: m ? m[1] : '09:00' }
}
export function EventForm({ childName, childId, children, initial, onSubmit, onDelete, onClose }: {
  childName: string
  childId: string
  children: EventChild[]
  initial: EventFormInitial
  onSubmit: (childId: string, draft: EventDraft) => Promise<WriteResult<unknown>>
  onDelete: (() => Promise<WriteResult<unknown>>) | null
  onClose: () => void
}) {
  const editing = initial !== null
  const start0 = initial ? splitInstant(initial.draft.start) : { date: localDay(Date.now()), time: '15:00' }
  const end0 = initial ? splitInstant(initial.draft.end) : { date: localDay(Date.now()), time: '16:00' }
  const [child, setChild] = useState(initial?.childId ?? childId)
  const [title, setTitle] = useState(initial?.draft.title ?? '')
  const [date, setDate] = useState(start0.date)
  const [startTime, setStartTime] = useState(start0.time)
  const [endTime, setEndTime] = useState(end0.time)
  const [location, setLocation] = useState(initial?.draft.location ?? '')
  const [notes, setNotes] = useState(initial?.draft.notes ?? '')
  const [color, setColor] = useState<string>(initial?.draft.color ?? SWATCHES[0].value)
  const [confirm, setConfirm] = useState<null | 'save' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function draft(): EventDraft {
    return { title: title.trim(), start: `${date}T${startTime}:00`, end: `${date}T${endTime}:00`, location: location.trim() || null, notes: notes.trim() || null, color, status: initial?.draft.status ?? 'confirmed' }
  }
  const valid = title.trim().length > 0 && endTime > startTime
  async function run(kind: 'save' | 'delete') {
    setBusy(true); setError('')
    const result = kind === 'delete' && onDelete ? await onDelete() : await onSubmit(child, draft())
    setBusy(false)
    if (result.ok) { onClose(); return }
    setConfirm(null)
    setError(result.reason === 'refused' ? 'Only a parent can change this calendar.' : "Couldn't save that just now. Please try again.")
  }
  return (
    <Dialog.Root open={!busy} onOpenChange={value => { if (!value && !busy) onClose() }}>
      <Dialog.Portal><Dialog.Overlay className="cal-overlay" />
        <Dialog.Content className="cal-sheet cal-form" aria-describedby={undefined}>
          <Dialog.Title>{editing ? 'Edit event' : 'Add event'}</Dialog.Title>
          <Dialog.Close className="cal-close" aria-label="Close" onClick={() => { if (!busy) onClose() }}><X size={20} /></Dialog.Close>
          <div className="cal-field"><label htmlFor="ef-title">Title</label><input id="ef-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Soccer practice" /></div>
          <div className="cal-field"><label htmlFor="ef-child">Child</label><select id="ef-child" value={child} onChange={e => setChild(e.target.value)} disabled={editing}>{children.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></div>
          <div className="cal-field"><label htmlFor="ef-date">Date</label><input id="ef-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="cal-field-row">
            <div className="cal-field"><label htmlFor="ef-start">Starts</label><input id="ef-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
            <div className="cal-field"><label htmlFor="ef-end">Ends</label><input id="ef-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
          </div>
          <div className="cal-field"><label htmlFor="ef-loc">Location</label><input id="ef-loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="Field 3" /></div>
          <div className="cal-field"><label htmlFor="ef-notes">Notes</label><textarea id="ef-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Bring shin guards" /></div>
          <div className="cal-field"><span className="cal-field-label">Color</span>
            <div className="cal-swatches" role="radiogroup" aria-label="Event color">
              {SWATCHES.map(s => <button type="button" key={s.value} role="radio" aria-checked={color === s.value} aria-label={s.label} className="cal-swatch" style={{ background: s.value }} data-selected={color === s.value} onClick={() => setColor(s.value)} />)}
              <label className="cal-swatch-custom"><span className="sr-only">Custom color</span><input type="color" value="#6aa0ff" onChange={e => setColor(e.target.value)} /></label>
            </div>
          </div>
          {error && <p className="cal-form-error" role="alert">{error}</p>}
          <div className="cal-form-actions">
            {editing && onDelete && <button type="button" className="cal-btn cal-btn-danger" onClick={() => setConfirm('delete')} disabled={busy}>Delete</button>}
            <span className="cal-form-spacer" />
            <button type="button" className="cal-btn" onClick={() => onClose()} disabled={busy}>Cancel</button>
            <button type="button" className="cal-btn cal-btn-primary" onClick={() => setConfirm('save')} disabled={busy || !valid}>Save</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      {/* Explicit confirm: a write never happens on the first click. */}
      <Dialog.Root open={confirm !== null && !busy} onOpenChange={value => { if (!value && !busy) setConfirm(null) }}>
        <Dialog.Portal><Dialog.Overlay className="cal-overlay" />
          <Dialog.Content className="cal-sheet cal-confirm">
            <Dialog.Title>{confirm === 'delete' ? `Delete this event from ${childName}'s calendar?` : `Save this change to ${childName}'s calendar?`}</Dialog.Title>
            <Dialog.Description>{confirm === 'delete' ? 'Everyone who shares this calendar will see it removed.' : 'Everyone who shares this calendar will see this change.'}</Dialog.Description>
            {error && <p className="cal-form-error" role="alert">{error}</p>}
            <div className="cal-form-actions">
              <span className="cal-form-spacer" />
              <button type="button" className="cal-btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              {confirm === 'delete'
                ? <button type="button" className="cal-btn cal-btn-danger" onClick={() => run('delete')} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
                : <button type="button" className="cal-btn cal-btn-primary" onClick={() => run('save')} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  )
}
