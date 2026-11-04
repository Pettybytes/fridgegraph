import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { IlamyCalendar, dayjs } from '@ilamy/calendar'
import type { CalendarEvent as IlamyEvent, EventSegment, EventsChange, IlamyCalendarApi } from '@ilamy/calendar'
import type { LiveCalendarAdapter, LiveWindow, LiveEvent, ReadOutcome, EffectiveCare, Availability } from './liveAdapter'
import { outcomeCopy } from './liveAdapter'
import { addDays, CALENDAR_ZONE, formatDay, formatInstant, localDay, midnight, validDay, weekStart } from './time'
import { liveToIlamy, liveLaneData } from './ilamyMap'
import type { LiveLaneClick } from './ilamyMap'
import { CalendarEventPill } from './CalendarEventPill'
import { CaregiverLanes } from './CaregiverLanes'
import './calendar.css'
const eventStatus = (status: string) => status === 'proposed' ? 'Proposed' : status === 'confirmed' ? 'Confirmed' : status === 'cancelled' ? 'Cancelled' : 'Status not recorded'
// No move/resize mutation exists for live events (liveAdapter reads only), so a
// parent's drag is reverted and surfaced honestly - never a silent fake save.
const LIVE_NOT_SAVED = 'Not saved: there is no save channel for moves in this view, so the event stayed where it was.'
export function careLabel(result: ReadOutcome<EffectiveCare>) {
  if (result.state !== 'ready') return outcomeCopy[result.state]
  if (!result.value.parent) return outcomeCopy.empty
  const name = result.value.parent.displayName.split(' ')[0]
  return result.value.source === 'ARRANGEMENT' ? `Approved arrangement: scheduled with ${name}` : result.value.source === 'WEEKLY' ? `Scheduled with ${name}` : 'Schedule source not recorded'
}
function Outcome({ result, empty }: { result: ReadOutcome<unknown[]>; empty?: boolean }) { return <p className="cal-no-events" role={result.state === 'failed' ? 'alert' : undefined}>{result.state === 'ready' ? (empty ? outcomeCopy.empty : null) : outcomeCopy[result.state]}</p> }
type IlamyView = 'month' | 'week' | 'day'
export function LiveFamilyCalendar({ adapter }: { adapter: LiveCalendarAdapter }) {
  const [route, setRoute] = useState(location.hash), [cancelled, setCancelled] = useState(false)
  const [loaded, setLoaded] = useState<{ adapter: LiveCalendarAdapter; key: string; value: LiveWindow } | null>(null), [failed, setFailed] = useState('')
  const [availabilityDetail, setAvailabilityDetail] = useState<Availability | null>(null)
  const [selected, setSelected] = useState<LiveEvent | null>(null), [careDetail, setCareDetail] = useState<{ day: string; care: ReadOutcome<EffectiveCare> } | null>(null)
  const [notSaved, setNotSaved] = useState<string | null>(null), [lanes, setLanes] = useState(false)
  const api = useRef<IlamyCalendarApi>(null)
  const query = useMemo(() => new URLSearchParams(route.split('?')[1] ?? ''), [route])
  const requested = query.get('day'), eventId = query.get('event')
  const known = eventId ? adapter.knownEvent(eventId) : undefined
  const day = requested ?? (known ? localDay(known.start) : localDay(Date.now())), view: IlamyView = query.get('view') === 'day' ? 'day' : query.get('view') === 'month' ? 'month' : 'week'
  const childId = query.get('childId') ?? (eventId ? adapter.knownChild(eventId) : undefined) ?? adapter.scope.childId, from = validDay(day) ? weekStart(view === 'month' ? `${day.slice(0, 7)}-01` : day) : '', to = from ? addDays(from, view === 'month' ? 41 : 6) : ''
  const key = `${route}:${cancelled}`, current = loaded?.adapter === adapter && loaded.key === key ? loaded.value : null
  const canEdit = adapter.parent
  useEffect(() => { const follow = () => { setRoute(location.hash); setSelected(null); setCareDetail(null); setAvailabilityDetail(null) }; window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow) }, [])
  useEffect(() => {
    let active = true, refused = false
    setSelected(null); setCareDetail(null); setAvailabilityDetail(null); setFailed(''); setNotSaved(null)
    if (!from) { setFailed('Choose a valid calendar date.'); return }
    const load = async () => { try { const value = await adapter.readWindow({ childId, from, to, includeCancelled: cancelled }); if (active) { setLoaded({ adapter, key, value }); refused = value.events.state === 'refused'; if (eventId) setSelected(value.events.state === 'ready' ? value.events.value.find(e => e.id === eventId) ?? null : null) } } catch { if (active) setFailed(outcomeCopy.failed) } }
    void load(); const timer = setInterval(() => { if (!refused && document.visibilityState !== 'hidden') void load() }, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [adapter, key, childId, from, to, cancelled, eventId])
  function navigate(nextDay: string, nextView: IlamyView = view) { setSelected(null); setCareDetail(null); setAvailabilityDetail(null); const next = `#/calendar?day=${nextDay}&childId=${encodeURIComponent(childId)}&view=${nextView}`; setRoute(next); location.hash = next }
  useEffect(() => {
    if (!current || !api.current || !from) return
    const target = dayjs(midnight(day) + 12 * 3600000)
    if (!api.current.currentDate.isSame(target, 'day')) api.current.setCurrentDate(target)
    if (api.current.view !== view) api.current.setView(view)
  }, [current, view, day, from])
  if (failed) return <section className="cal-empty" role="alert"><p>{failed}</p></section>
  if (!current) return <p role="status">Loading your shared calendar…</p>
  if (current.events.state === 'refused') return <section className="cal-empty" role="alert"><h2>{outcomeCopy.refused}</h2><p>This calendar is only shown to people with permission to read it.</p><a href="#/calendar">Return to your calendar</a></section>
  const slots = current.availability.state === 'ready' ? current.availability.value : []
  const records = current.events.state === 'ready' ? current.events.value : []
  const conflicts = current.conflicts.state === 'ready' ? current.conflicts.value : []
  const childName = childId === adapter.scope.childId ? adapter.scope.childName : 'Selected child'
  const events = records.map(event => liveToIlamy(event, canEdit))
  return <section className="family-calendar cal-live" aria-label="Family Calendar" data-state="live">
    <div className="cal-toolbar">
      <div className="cal-child"><strong>{childName}</strong><span className="cal-authority">Live data · Detroit time</span></div>
      <div className="cal-lane-toggle"><button type="button" aria-pressed={!lanes} onClick={() => setLanes(false)}>Calendar</button><button type="button" aria-pressed={lanes} onClick={() => setLanes(true)}>Caregivers</button></div>
    </div>
    <div className="cal-live-key"><p>A care schedule describes responsibility, not a confirmed location.</p><label><input type="checkbox" checked={cancelled} onChange={e => setCancelled(e.target.checked)} /> Show cancelled events</label></div>
    {notSaved && <p className="cal-notsaved" role="status">{notSaved}</p>}
    {eventId && !selected && <p className="cal-attention">Event details are not available in the records read for this view.</p>}
    {lanes
      ? (() => { const data = liveLaneData(current.days, current.care, childName); return <CaregiverLanes from={from} resources={data.resources} events={data.events} emptyLabel="No care schedule is recorded for this week." onEventClick={event => { const click = event.data as LiveLaneClick | undefined; if (click?.kind === 'care') setCareDetail({ day: click.day, care: click.care }) }} /> })()
      : <div className="cal-grid-host">
          <IlamyCalendar
            ref={api}
            events={events}
            timezone={CALENDAR_ZONE}
            initialView={view}
            initialDate={new Date(midnight(day) + 12 * 3600000)}
            firstDayOfWeek="monday"
            editable={canEdit}
            eventResizableFromStart
            disableCellClick
            displayEventTime
            scrollTime="08:00"
            dayMaxEvents={4}
            renderEvent={(event: IlamyEvent, segment: EventSegment) => <CalendarEventPill event={event} segment={segment} />}
            onEventClick={(event: IlamyEvent) => { const original = event.data?.original as LiveEvent | undefined; if (original) setSelected(original) }}
            onDateChange={date => { const nextDay = localDay(date.valueOf()); if (nextDay !== day) navigate(nextDay) }}
            onViewChange={next => { const v = next === 'month' || next === 'day' ? next : 'week'; if (v !== view) navigate(day, v) }}
            onEventsChange={(change: EventsChange) => { change.revert(); setNotSaved(LIVE_NOT_SAVED) }}
          />
          {!records.length && <Outcome result={current.events} empty />}
        </div>}
    <section className="cal-schedule-notes">
      <h2 className="cal-section-title">Care schedule</h2>
      <p className="cal-section-sub">{childName}'s {view === 'month' ? `calendar range, ${formatDay(from)} to ${formatDay(to)}` : `week of ${formatDay(from)}`}. A care schedule describes responsibility, not a confirmed location.</p>
      <ul className="cal-care-list">{current.days.map(date => { const care = current.care[date]; return <li key={date}><span className="cal-care-day">{formatDay(date)}</span><button type="button" className={`cal-care ${care.state === 'ready' && care.value.source === 'ARRANGEMENT' ? 'is-holiday' : ''}`} onClick={() => setCareDetail({ day: date, care })}>{careLabel(care)}</button>{care.state === 'ready' && care.value.parent && <span className="cal-schedule-source">{care.value.source === 'WEEKLY' ? 'Weekly schedule' : care.value.source === 'ARRANGEMENT' ? 'Approved arrangement' : 'Source not recorded'}</span>}</li> })}</ul>
      <div className="cal-busy-list"><h3>Recorded Busy/Free time</h3>{slots.map((slot, i) => <button type="button" className={`cal-busy ${slot.state === 'FREE' ? 'is-free' : ''}`} key={i} onClick={() => setAvailabilityDetail(slot)}><span>{slot.person.displayName} · {slot.state === 'FREE' ? 'free time recorded' : slot.state === 'BUSY' ? 'Busy' : 'State not recorded'}</span><small>{formatInstant(slot.start, slot.end)}</small></button>)}{!slots.length && <Outcome result={current.availability} empty />}</div>
    </section>
    <section className="cal-conflicts"><h3>Schedule conflicts</h3><Outcome result={current.conflicts} empty={!conflicts.length} />{conflicts.map((c, i) => <p className="cal-attention" key={i}>{c.kind === 'OVERLAP' ? `Schedule needs review · overlapping arrangements on ${formatDay(c.onDay)}` : c.kind === 'GAP' ? `Needs coverage · no care schedule recorded on ${formatDay(c.onDay)}` : `Schedule needs review on ${formatDay(c.onDay)}`}</p>)}{!!conflicts.length && <p>Overlaps and gaps are shown on the affected days. No arrangement is chosen here to resolve a conflict.</p>}</section>
    <p className="cal-footnote">Free time recorded does not mean willingness, permission or suitability to provide care.</p>
    <Dialog.Root open={!!selected || !!careDetail || !!availabilityDetail} onOpenChange={value => { if (!value) { setSelected(null); setCareDetail(null); setAvailabilityDetail(null) } }}><Dialog.Portal><Dialog.Overlay className="cal-overlay" /><Dialog.Content className="cal-sheet"><Dialog.Title>{selected?.title ?? (availabilityDetail ? availabilityDetail.state === 'FREE' ? 'Free time recorded' : 'Busy' : careDetail ? careLabel(careDetail.care) : 'Calendar record')}</Dialog.Title><Dialog.Description>Only recorded information shared with you is shown.</Dialog.Description><Dialog.Close className="cal-close" aria-label="Close details"><X size={20} /></Dialog.Close>
      {availabilityDetail ? <dl><dt>Who</dt><dd>{availabilityDetail.person.displayName}</dd><dt>State</dt><dd>{availabilityDetail.state === 'FREE' ? 'Free time recorded' : 'Busy'}</dd><dt>Starts</dt><dd>{formatInstant(availabilityDetail.start, availabilityDetail.end)}</dd><dt>Ends</dt><dd>{formatInstant(availabilityDetail.end, availabilityDetail.start)}</dd></dl> : selected ? <dl><dt>Who</dt><dd>{childId === adapter.scope.childId ? adapter.scope.childName : 'Participant names not recorded'}</dd><dt>Starts</dt><dd>{formatInstant(selected.start, selected.end)}</dd><dt>Ends</dt><dd>{formatInstant(selected.end, selected.start)}</dd><dt>Where</dt><dd>{selected.location ?? 'Location not provided'}</dd><dt>Status</dt><dd>{eventStatus(selected.status)}</dd><dt>Category</dt><dd>Category not recorded</dd><dt>Confirmed by</dt><dd>{selected.status === 'proposed' ? 'Not confirmed yet' : 'Confirmer not recorded'}</dd></dl> : careDetail ? <><p>{formatDay(careDetail.day, true)}, {careDetail.day.slice(0, 4)}</p><p>{careLabel(careDetail.care)}</p>{careDetail.care.state === 'ready' && <p>{careDetail.care.value.source === 'ARRANGEMENT' ? 'An approved arrangement takes precedence over the weekly schedule for this day.' : careDetail.care.value.source === 'WEEKLY' ? 'This answer comes from the weekly schedule.' : 'Schedule source not recorded'}</p>}<p>This is scheduled responsibility, not a confirmed location.</p></> : null}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}
