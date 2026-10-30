export const CALENDAR_ZONE = 'America/Detroit'
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
export function validDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
}
export function addDays(day: string, count: number): string {
  if (!validDay(day)) throw new Error('Invalid calendar day')
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
export function weekday(day: string): number { return new Date(`${day}T12:00:00Z`).getUTCDay() }
export function weekStart(day: string): string { return addDays(day, -((weekday(day) + 6) % 7)) }
export function localDay(instant: string | number): string {
  const entries = Object.fromEntries(parts.formatToParts(new Date(instant)).map(p => [p.type, p.value]))
  return `${entries.year}-${entries.month}-${entries.day}`
}
export function midnight(day: string): number {
  if (!validDay(day)) throw new Error('Invalid calendar day')
  const target = Date.parse(`${day}T00:00:00Z`)
  let guess = target
  // Solve civil midnight in Detroit. Never add 24h to a zoned midnight: DST days differ in length.
  for (let i = 0; i < 5; i++) {
    const p = Object.fromEntries(parts.formatToParts(new Date(guess)).map(p => [p.type, p.value]))
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
    const difference = target - wall
    if (!difference) return guess
    guess += difference
  }
  throw new Error('Unable to resolve Detroit midnight')
}
export function dayHours(day: string): number { return (midnight(addDays(day, 1)) - midnight(day)) / 3600000 }
function zoneName(instant: string | number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CALENDAR_ZONE, timeZoneName: 'short' }).formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName')!.value
}
function crossesClockChange(start: string, end: string): boolean { return zoneName(start) !== zoneName(end) }
export function formatTime(instant: string | number, showZone = dayHours(localDay(instant)) !== 24): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CALENDAR_ZONE, hour: 'numeric', minute: '2-digit', hour12: true, ...(showZone ? { timeZoneName: 'short' as const } : {}) }).format(new Date(instant))
}
export function formatDay(day: string, long = false): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: CALENDAR_ZONE, weekday: long ? 'long' : 'short', month: 'short', day: 'numeric' }).format(new Date(midnight(day) + 12 * 3600000))
}
export function formatInstant(instant: string, other?: string): string { return `${formatDay(localDay(instant), true)}, ${formatTime(instant, dayHours(localDay(instant)) !== 24 || !!other && crossesClockChange(instant, other))}` }
export function intersects(start: string, end: string, from: number, to: number): boolean { return Date.parse(start) < to && Date.parse(end) > from }
export function segmentLabel(start: string, end: string, day: string): string {
  const before = Date.parse(start) < midnight(day), after = Date.parse(end) > midnight(addDays(day, 1))
  return `${before ? 'Continues' : formatTime(start, dayHours(day) !== 24 || crossesClockChange(start, end))} – ${after ? 'continues next day' : formatTime(end, dayHours(day) !== 24 || crossesClockChange(start, end))}`
}
