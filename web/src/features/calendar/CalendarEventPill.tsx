import type { CalendarEvent as IlamyEvent, EventSegment } from '@ilamy/calendar'
import type { CalType } from './ilamyMap'
import { formatTime } from './time'
// The event bar inside @ilamy/calendar's grid. A custom renderEvent replaces the
// default content entirely, so the design-v2 type color (carried on data.type)
// and the honest status (proposed/cancelled) are applied here by class - never a
// decorative hue. Time is formatted from the recorded instant with our own
// Detroit formatter (not ilamy's dayjs), so a recorded time is never shifted and
// a repeated DST hour still reads "1:15 AM EDT" vs "1:15 AM EST".
export function CalendarEventPill({ event, segment }: { event: IlamyEvent; segment: EventSegment }) {
  const data = event.data as { type?: CalType; status?: string; original?: { start?: string } } | undefined
  const type: CalType = data?.type ?? 'neutral'
  const status = data?.status ?? 'confirmed'
  const startIso = data?.original?.start
  return (
    <div className={`cal-pill cal-type-${type} is-${status}`} data-type={type} data-status={status} data-event-title={event.title}>
      {segment.isStart && !event.allDay && startIso && <span className="cal-pill-time">{formatTime(startIso)}</span>}
      <span className="cal-pill-title">{event.title}</span>
      {status === 'proposed' && <span className="cal-pill-tag">Proposed</span>}
      {status === 'cancelled' && <span className="cal-pill-tag">Cancelled</span>}
    </div>
  )
}
