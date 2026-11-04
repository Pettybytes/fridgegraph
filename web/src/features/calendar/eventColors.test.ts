import { describe, expect, it } from 'vitest'
import { EVENT_COLORS, eventInk, eventTone } from './eventColors'

describe('calendar display colors', () => {
  it.each([
    ['School pickup', 'pickup'], ['Field trip', 'school'], ['Karate', 'sports'],
    ["Emma's birthday", 'celebration'], ['Piano lesson', 'learning'],
    ['Dentist appointment', 'appointment'], ['Thanksgiving', 'holiday'],
    ['Family dinner', 'family'], ['An uncategorized commitment', 'family'],
  ] as const)('gives %s a useful display hint', (title, tone) => {
    expect(eventTone(title)).toBe(tone)
  })
  it('prefers a recorded category over title hints', () => {
    expect(eventTone('School pickup', 'PARTY')).toBe('celebration')
  })
  it('keeps readable ink for all pastels and existing custom swatches', () => {
    for (const { color } of Object.values(EVENT_COLORS)) expect(eventInk(color)).toBe('#000000')
    expect(eventInk('#000000')).toBe('#ffffff')
    expect(eventInk('#ffffff')).toBe('#000000')
    expect(eventInk('oklch(0.66 0.15 62)')).toBe('#000000')
    expect(eventInk('oklch(0.56 0.16 252)')).toBe('#ffffff')
  })
})
