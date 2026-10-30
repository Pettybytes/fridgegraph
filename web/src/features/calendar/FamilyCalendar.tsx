import { useEffect, useMemo, useState } from 'react'
import { Dialog } from 'radix-ui'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { BusyWindow, CalendarAdapter, CalendarChild, CalendarEvent, CalendarSnapshot, HolidayArrangement, LinkedRecord } from './types'
import { categoryLabel, statusLabel } from './types'
import { addDays, dayHours, formatDay, formatInstant, localDay, segmentLabel, validDay, weekStart } from './time'
import { careBand, dayItems } from './model'
import type { CareBand } from './model'
import './calendar.css'
type Selection = { kind: 'event'; record: CalendarEvent } | { kind: 'care'; band: CareBand; day: string } | { kind: 'busy'; record: BusyWindow } | { kind: 'arrangement'; record: HolidayArrangement }
type Loaded = { adapter: CalendarAdapter; key: string; snapshot: CalendarSnapshot; children: CalendarChild[]; day: string }
function params(hash: string) { return new URLSearchParams(hash.split('?')[1] ?? '') }
export function FamilyCalendar({ adapter }: { adapter: CalendarAdapter }) {
  const [route, setRoute] = useState(location.hash)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{ adapter: CalendarAdapter; key: string; message: string } | null>(null)
  const [selection, setSelection] = useState<{ adapter: CalendarAdapter; key: string; value: Selection } | null>(null)
  const [linked, setLinked] = useState<LinkedRecord | null>(null)
  const query = useMemo(() => params(route), [route])
  const view = query.get('view') === 'day' ? 'day' : 'week'
  const current = loaded?.adapter === adapter && loaded.key === route ? loaded : null
  const selected = selection?.adapter === adapter && selection.key === route && current ? selection.value : null
  const error = failure?.adapter === adapter && failure.key === route ? failure.message : null
  useEffect(() => {
    const follow = () => setRoute(location.hash)
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  useEffect(() => {
    let active = true, forbidden = false
    async function load() {
      try {
        const children = await adapter.listChildren()
        const requestedDay = query.get('day')
        if (requestedDay !== null && !validDay(requestedDay)) throw new Error('INVALID_DATE')
        const eventId = query.get('event'), event = eventId ? await adapter.readEvent(eventId) : null
        const childId = query.get('childId') ?? event?.child.id ?? children[0]?.id
        if (!childId || !children.some(child => child.id === childId) || (event && event.child.id !== childId)) throw new Error('UNAUTHORIZED')
        const day = requestedDay ?? (event ? localDay(event.start) : localDay(Date.now()))
        const from = view === 'week' ? weekStart(day) : day, to = view === 'week' ? addDays(from, 6) : day
        const snapshot = await adapter.readCalendar({ childId, from, to })
        if (!active) return
        setLoaded({ adapter, key: route, snapshot, children, day }); setFailure(null)
        if (event) setSelection({ adapter, key: route, value: { kind: 'event', record: event } })
      } catch (error) {
        if (!active) return
        forbidden = error instanceof Error && ['UNAUTHORIZED', 'INVALID_DATE'].includes(error.message)
        setLoaded(null); setSelection(null); setLinked(null)
        setFailure({ adapter, key: route, message: error instanceof Error && error.message === 'INVALID_DATE' ? 'Choose a valid calendar date.' : error instanceof Error && error.message === 'UNAUTHORIZED' ? 'Details not shared with you. Choose a child whose calendar is shared with you.' : 'The calendar is unavailable right now. Please try again.' })
      }
    }
    void load()
    const poll = setInterval(() => { if (!forbidden && document.visibilityState !== 'hidden') void load() }, 30000)
    return () => { active = false; clearInterval(poll) }
  }, [adapter, route, query, view])
  function navigate(day: string, childId: string, nextView = view) {
    const next = `#/calendar?day=${encodeURIComponent(day)}&childId=${encodeURIComponent(childId)}&view=${nextView}`
    setSelection(null); setLinked(null); setRoute(next); location.hash = next
  }
  function open(value: Selection) { setLinked(null); setSelection({ adapter, key: route, value }) }
  function close() {
    setSelection(null); setLinked(null)
    if (query.has('event') && current) navigate(current.day, current.snapshot.child.id)
  }
  if (error) return <section className="cal-empty" role="alert"><h2>Calendar information is private</h2><p>{error}</p><a href="#/calendar">Return to your shared calendar</a></section>
  if (!current) return <p role="status">Loading your shared calendar…</p>
  const { snapshot, day, children } = current
  const from = view === 'week' ? weekStart(day) : day
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDays(from, i))
  const name = snapshot.child.displayName.split(' ')[0]
  const title = selected?.kind === 'event' ? selected.record.title : selected?.kind === 'care' ? selected.band.label : selected?.kind === 'busy' ? 'Busy' : selected?.kind === 'arrangement' ? `${selected.record.status === 'DECLINED' ? 'Declined' : 'Proposed'} holiday arrangement` : ''
  return <section className="family-calendar" aria-label="Family Calendar" data-state={snapshot.state === 'mock' ? 'unavailable' : 'live'} data-projection="derived">
    <div className="cal-toolbar">
      <div className="cal-child"><label htmlFor="calendar-child">Calendar for</label><select id="calendar-child" value={snapshot.child.id} onChange={event => navigate(day, event.target.value)}>{children.map(child => <option key={child.id} value={child.id}>{child.displayName}</option>)}</select><span className="cal-authority">{snapshot.child.authority === 'guardian' ? 'Guardian view' : snapshot.child.authority === 'schedule.read' ? 'Shared calendar' : 'Family view'}</span></div>
      <div className="cal-view" aria-label="Calendar view"><button type="button" aria-pressed={view === 'week'} onClick={() => navigate(day, snapshot.child.id, 'week')}>Week</button><button type="button" aria-pressed={view === 'day'} onClick={() => navigate(day, snapshot.child.id, 'day')}>Day</button></div>
    </div>
    <div className="cal-period"><div><p>{snapshot.state === 'mock' ? 'Demo calendar · sample plans' : 'Shared calendar'} · Detroit time</p><h2>{formatDay(from)}{view === 'week' ? ` – ${formatDay(addDays(from, 6))}` : ''}, {from.slice(0, 4)}</h2></div><div className="cal-date-controls"><button type="button" aria-label={`Previous ${view}`} onClick={() => navigate(addDays(day, view === 'week' ? -7 : -1), snapshot.child.id)}><ChevronLeft size={19} /></button><label><span className="sr-only">Calendar date</span><input type="date" aria-label="Calendar date" value={day} onChange={event => { if (validDay(event.target.value)) navigate(event.target.value, snapshot.child.id) }} /></label><button type="button" aria-label={`Next ${view}`} onClick={() => navigate(addDays(day, view === 'week' ? 7 : 1), snapshot.child.id)}><ChevronRight size={19} /></button></div></div>
    <p className="cal-explainer">{name}'s plans and scheduled care. A care schedule describes responsibility, not a confirmed location.</p>
    <div className="cal-board"><div className={`cal-days ${view === 'day' ? 'is-day' : ''}`}>{days.map(date => {
      const band = careBand(snapshot, date), items = dayItems(snapshot, date)
      return <section className="cal-day" key={date} role="region" aria-label={`${formatDay(date, true)} day`}>
        <header className="cal-day-heading"><button type="button" onClick={() => navigate(date, snapshot.child.id, 'day')}><span>{formatDay(date).split(',')[0]}</span><strong>{formatDay(date).split(',').slice(1).join(',').trim()}</strong></button>{dayHours(date) !== 24 && <small>{dayHours(date)}-hour day · clocks change</small>}</header>
        <button type="button" className={`cal-care ${band.state === 'holiday' ? 'is-holiday' : ''}`} onClick={() => open({ kind: 'care', band, day: date })}>{band.label}</button>
        {items.arrangements.map(arrangement => <button type="button" className="cal-arrangement" key={arrangement.id} onClick={() => open({ kind: 'arrangement', record: arrangement })}>{arrangement.status === 'DECLINED' ? 'Declined' : 'Proposed'} holiday arrangement<span>Does not change the schedule</span></button>)}
        <div className="cal-events">{items.events.map(event => <button type="button" key={event.id} className={`cal-event category-${event.category.toLowerCase()} ${event.status === 'PROPOSED' ? 'is-proposed' : event.status === 'CANCELLED' ? 'is-cancelled' : ''}`} onClick={() => open({ kind: 'event', record: event })}>
          <span className="cal-event-category">{categoryLabel[event.category]}</span><strong>{event.title}</strong><span className="cal-time">{segmentLabel(event.start, event.end, date)}</span><span className="cal-event-status">{statusLabel[event.status]}</span>{event.attention.map(label => <span className="cal-attention" key={label}>{label}</span>)}
        </button>)}{!items.events.length && <p className="cal-no-events">No commitments recorded</p>}</div>
        {!!items.busy.length && <div className="cal-busy-list"><h3>Busy time</h3>{items.busy.map(slot => <button type="button" className="cal-busy" key={slot.id} aria-label={`${slot.person.displayName} · Busy · ${segmentLabel(slot.start, slot.end, date)}`} onClick={() => open({ kind: 'busy', record: slot })}><span>{slot.person.displayName} · Busy</span><small>{segmentLabel(slot.start, slot.end, date)}</small></button>)}</div>}
      </section>
    })}</div></div>
    <p className="cal-footnote"><CalendarDays size={15} aria-hidden="true" />A gap in busy time is not confirmed availability. Ask before arranging care.</p>
    <Dialog.Root open={!!selected} onOpenChange={value => { if (!value) close() }}><Dialog.Portal><Dialog.Overlay className="cal-overlay" /><Dialog.Content className="cal-sheet"><Dialog.Title>{linked ? linked.title : title}</Dialog.Title><Dialog.Description>{snapshot.state === 'mock' ? 'Demo record. ' : ''}{selected?.kind === 'busy' ? 'Busy time only; the reason is not shared here.' : 'Only recorded information shared with you is shown.'}</Dialog.Description><Dialog.Close className="cal-close" aria-label="Close details"><X size={20} /></Dialog.Close>
      {linked ? <><p className="cal-linked-text">{linked.text}</p><button type="button" className="cal-back" onClick={() => setLinked(null)}>Back to event</button></> : selected?.kind === 'event' ? <EventDetails event={selected.record} openLinked={setLinked} /> : selected?.kind === 'busy' ? <dl><dt>Who</dt><dd>{selected.record.person.displayName}</dd><dt>Status</dt><dd>Busy</dd><dt>Starts</dt><dd>{formatInstant(selected.record.start, selected.record.end)}</dd><dt>Ends</dt><dd>{formatInstant(selected.record.end, selected.record.start)}</dd></dl> : selected?.kind === 'care' ? <><dl><dt>Day</dt><dd>{formatDay(selected.day, true)}, {selected.day.slice(0, 4)}</dd><dt>Scheduled caregivers</dt><dd>{selected.band.caregivers.map(p => p.displayName).join(' & ') || 'Schedule needs review'}</dd><dt>Source</dt><dd>{selected.band.state === 'holiday' ? 'Approved holiday arrangement' : selected.band.state === 'weekly' ? 'Weekly care schedule' : 'No single schedule can be shown'}</dd></dl><p>This is a schedule of responsibility. It does not confirm where the child is.</p>{selected.band.arrangement && <p>{selected.band.arrangement.holidayName}: {formatDay(selected.band.arrangement.dateStart)} – {formatDay(selected.band.arrangement.dateEnd)}. The approved arrangement takes precedence over the weekly schedule.</p>}</> : selected?.kind === 'arrangement' ? <><dl><dt>Holiday</dt><dd>{selected.record.holidayName ?? 'One-off arrangement'}</dd><dt>Proposed caregiver</dt><dd>{selected.record.assignedParent.displayName}</dd><dt>Dates</dt><dd>{formatDay(selected.record.dateStart)} – {formatDay(selected.record.dateEnd)}</dd><dt>Status</dt><dd>{selected.record.status === 'DECLINED' ? 'Declined' : 'Proposed · not approved'}</dd></dl><p>This arrangement does not override the approved schedule.</p></> : null}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}
function EventDetails({ event, openLinked }: { event: CalendarEvent; openLinked: (record: LinkedRecord) => void }) {
  return <><dl><dt>Who</dt><dd>{event.participants.map(person => person.displayName).join(', ') || 'Participants not recorded'}</dd><dt>Starts</dt><dd>{formatInstant(event.start, event.end)}</dd><dt>Ends</dt><dd>{formatInstant(event.end, event.start)}</dd><dt>Where</dt><dd>{event.location.state === 'visible' ? event.location.value : event.location.state === 'hidden' ? 'Details not shared with you' : 'Location not provided'}</dd><dt>Status</dt><dd>{statusLabel[event.status]}</dd><dt>Confirmed by</dt><dd>{event.confirmedBy.state === 'visible' ? event.confirmedBy.value.displayName : event.confirmedBy.state === 'hidden' ? 'Details not shared with you' : event.status === 'PROPOSED' ? 'Not confirmed yet' : 'Confirmer not recorded'}</dd><dt>Confirmation time</dt><dd>{event.confirmedAt.state === 'visible' ? formatInstant(event.confirmedAt.value) : event.confirmedAt.state === 'hidden' ? 'Details not shared with you' : 'Confirmation time not recorded'}</dd></dl>
    {event.attention.map(label => <p className="cal-detail-attention" key={label}>{label}</p>)}<h3>Linked records</h3>{event.linkedRecords.state === 'visible' ? event.linkedRecords.value.map(record => <button type="button" className="cal-linked" key={record.id} onClick={() => openLinked(record)}>{record.title}</button>) : <p>{event.linkedRecords.state === 'hidden' ? 'Details not shared with you' : 'No linked records recorded'}</p>}
  </>
}
