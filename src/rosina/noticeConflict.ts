/**
 * Notice → Plan, step 3 (check the child's real schedule): compare extracted facts against the
 * child's recorded schedule for the date and find the conflict. Contract: docs/contracts/notice-plan.md
 * §3, §5.3. Schedule facts are READ (as the caller) by the endpoint and passed in here — this module
 * never invents a schedule and never performs I/O.
 */
import type { NoticeFact } from './noticeFacts';

/** One recorded calendar event, as returned by the `events(childId, date)` read. */
export type ScheduleEvent = {
  id: string;
  title: string;
  start: string; // ISO; may be "...T15:00:00"
  end: string; // ISO
  location?: string | null;
};

export type PickupWindow = 'morning' | 'afternoon' | 'evening';

export type ConflictResult =
  | {
      hasConflict: true;
      detail: string;
      recordedPickup: { time: string; eventId: string; title: string };
      noticeTime: string; // HH:MM
      gapMinutes: number;
    }
  | { hasConflict: false; detail: string };

/** 24h HH:MM → minutes since midnight, or null. */
function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The local HH:MM of an ISO/"YYYY-MM-DDTHH:MM:SS" timestamp, taking the clock digits as written
 *  (the reads already carry local wall-clock times; we do not re-zone them). */
export function clockOf(iso: string): string | null {
  const m = /T([01]\d|2[0-3]):([0-5]\d)/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * The only time granularity `requestPickup` accepts (contract §5.3). America/Detroit local time of
 * the dismissal maps to a coarse window: < 12:00 morning, 12:00–16:59 afternoon, ≥ 17:00 evening.
 */
export function windowForTime(hhmm: string): PickupWindow {
  const mins = toMinutes(hhmm);
  if (mins === null) return 'afternoon'; // safe coarse default; the exact time stays in the proposal
  if (mins < 12 * 60) return 'morning';
  if (mins >= 17 * 60) return 'evening';
  return 'afternoon';
}

function fmtGap(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}m`;
}

/**
 * Detect an early-dismissal conflict for one date. The "recorded pickup" is the END of the latest
 * recorded event on that date (the end of the child's school day). A dismissal time EARLIER than
 * that recorded end is a conflict: the child is released before the recorded pickup.
 *
 * Returns hasConflict:false with an honest reason when there is no recorded event (we never invent
 * one) or when the dismissal is not earlier than the recorded pickup.
 */
export function detectEarlyDismissalConflict(
  fact: NoticeFact,
  date: string,
  events: ScheduleEvent[],
): ConflictResult {
  const dismissal = fact.times.find((t) => /dismiss|release|pickup|out/i.test(t.label)) ?? fact.times[0];
  if (!dismissal) return { hasConflict: false, detail: 'The notice gives no dismissal time, so no schedule comparison was possible.' };
  const noticeMins = toMinutes(dismissal.time);
  if (noticeMins === null) return { hasConflict: false, detail: 'The dismissal time could not be read as a clock time.' };

  const onDay = events.filter((e) => e.start.slice(0, 10) === date || e.end.slice(0, 10) === date);
  if (onDay.length === 0) {
    return { hasConflict: false, detail: `No recorded pickup was found for ${date}, so there is nothing to compare against.` };
  }

  // The recorded pickup = the latest end time among the day's events.
  let latest: { event: ScheduleEvent; mins: number } | null = null;
  for (const e of onDay) {
    const c = clockOf(e.end);
    const mins = c ? toMinutes(c) : null;
    if (mins === null) continue;
    if (!latest || mins > latest.mins) latest = { event: e, mins };
  }
  if (!latest) return { hasConflict: false, detail: `No recorded pickup time could be read for ${date}.` };

  const recordedTime = clockOf(latest.event.end) ?? '';
  if (noticeMins >= latest.mins) {
    return {
      hasConflict: false,
      detail: `The early dismissal at ${dismissal.time} is not earlier than the recorded pickup at ${recordedTime}, so there is no conflict.`,
    };
  }

  const gap = latest.mins - noticeMins;
  const where = latest.event.location ? ` (${latest.event.title}, ${latest.event.location})` : ` (${latest.event.title})`;
  return {
    hasConflict: true,
    detail: `Recorded pickup for ${date} is ${recordedTime}${where}; the notice releases at ${dismissal.time}, ${fmtGap(gap)} earlier.`,
    recordedPickup: { time: recordedTime, eventId: latest.event.id, title: latest.event.title },
    noticeTime: dismissal.time,
    gapMinutes: gap,
  };
}
