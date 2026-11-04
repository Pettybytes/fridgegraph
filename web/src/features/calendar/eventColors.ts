import type { EventCategory } from './types'

// Display hints only: title matching never changes a recorded category or permissions.
export const EVENT_COLORS = {
  school: { label: 'School', color: '#d7ecff' },
  pickup: { label: 'Pickup / drop-off', color: '#cef2e3' },
  sports: { label: 'Sports', color: '#ffe7ae' },
  learning: { label: 'Clubs / learning', color: '#e5ddff' },
  celebration: { label: 'Birthdays / parties', color: '#ffd9ea' },
  appointment: { label: 'Appointments', color: '#ffe2cf' },
  family: { label: 'Family / other', color: '#ffdad2' },
  holiday: { label: 'Holidays', color: '#eeddf7' },
} as const
export type EventTone = keyof typeof EVENT_COLORS
const categories: Record<EventCategory, EventTone> = {
  PARENTING_HANDOFF: 'pickup', PRACTICE: 'sports', GAME: 'sports',
  FIELD_TRIP: 'school', SCHOOL_CLOSURE: 'school', RECITAL: 'learning',
  PARTY: 'celebration', SLEEPOVER: 'family', HOLIDAY: 'holiday', HOLIDAY_CAMP: 'holiday',
}
export function eventTone(title: string, category?: EventCategory | null): EventTone {
  if (category) return categories[category]
  if (/\b(pick.?up|drop.?off|handoff)\b/i.test(title)) return 'pickup'
  if (/\b(birthday|party|celebration)\b/i.test(title)) return 'celebration'
  if (/\b(doctor|dentist|appointment|check.?up|therapy|clinic)\b/i.test(title)) return 'appointment'
  if (/\b(holiday|thanksgiving|christmas|halloween|spring break)\b/i.test(title)) return 'holiday'
  if (/\b(soccer|karate|basketball|swim\w*|sport\w*|practice|game|gym|baseball|tennis)\b/i.test(title)) return 'sports'
  if (/\b(club|lesson|recital|music|piano|dance|tutor\w*|robotics|library)\b/i.test(title)) return 'learning'
  if (/\b(school|field trip|class|conference|homework|dismissal)\b/i.test(title)) return 'school'
  return 'family'
}

// Stored colors are hex picker values or the existing OKLCH swatches. Choose
// black or white by relative luminance, preserving the parent's exact fill.
export function eventInk(color: string): string {
  let rgb: number[] = []
  const hex = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(color)
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  } else {
    const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color)
    if (oklch) {
      const [, light, chroma, hue] = oklch.map(Number)
      const a = chroma * Math.cos(hue * Math.PI / 180), b = chroma * Math.sin(hue * Math.PI / 180)
      const l = (light + .3963377774 * a + .2158037573 * b) ** 3
      const m = (light - .1055613458 * a - .0638541728 * b) ** 3
      const s = (light - .0894841775 * a - 1.291485548 * b) ** 3
      rgb = [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s].map(v => Math.max(0, Math.min(1, v)))
    }
  }
  const luminance = rgb.length ? .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] : 1
  return luminance > .179 ? '#000000' : '#ffffff'
}
