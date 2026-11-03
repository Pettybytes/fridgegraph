import { IlamyCalendar } from '@ilamy/calendar'
import type { CalendarEvent as IlamyEvent, Resource } from '@ilamy/calendar'
import { CALENDAR_ZONE, midnight } from './time'
import type { LaneEvent } from './ilamyMap'
import { CalendarEventPill } from './CalendarEventPill'
// Resource view: one lane (row) per caregiver for the pickup week - "who has Nora
// when". Care responsibility is projected from the same data the calendar uses; it
// is a schedule of responsibility, never a confirmed location. Read-only: the lanes
// carry no save channel, so nothing here is draggable. The caller precomputes the
// lane rows and events (see laneData builders in ilamyMap) so this stays data-shape
// agnostic across the mock and live calendars.
export function CaregiverLanes({ from, resources, events, emptyLabel, onEventClick }: {
  from: string
  resources: Resource[]
  events: LaneEvent[]
  emptyLabel: string
  onEventClick: (event: IlamyEvent) => void
}) {
  if (!resources.length) return <p className="cal-no-events" role="status">{emptyLabel}</p>
  return (
    <div className="cal-grid-host cal-lanes-host">
      <IlamyCalendar
        resources={resources}
        events={events}
        timezone={CALENDAR_ZONE}
        initialView="week"
        initialDate={new Date(midnight(from) + 12 * 3600000)}
        firstDayOfWeek="monday"
        orientation="horizontal"
        weekViewGranularity="daily"
        editable={false}
        disableCellClick
        hideExportButton
        renderEvent={(event, segment) => <CalendarEventPill event={event} segment={segment} />}
        onEventClick={onEventClick}
      />
    </div>
  )
}
