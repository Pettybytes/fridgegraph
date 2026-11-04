import { EVENT_COLORS } from './eventColors'

export function CalendarLegend() {
  return <ul className="cal-legend" aria-label="Event colors">
    {Object.entries(EVENT_COLORS).map(([tone, entry]) => <li key={tone} style={{ backgroundColor: entry.color }}>{entry.label}</li>)}
  </ul>
}
