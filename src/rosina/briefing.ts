/**
 * Caregiver Briefing — the DETERMINISTIC composer. "What do I need to know for today?" answered
 * ONLY from what THIS caller may read for the selected child and day. Each caregiver's briefing is
 * exactly their own grant — on p_nora, Priya (sitter: schedule + careplan) sees the schedule AND
 * care notes; Loretta (grandmother: schedule + pickup + goals) sees the schedule but NOT care notes
 * (no careplan.read); a parent additionally sees the check-in; an unrelated caller sees nothing. No
 * caregiver strictly dominates. The boundary is enforced here by construction, not by a prompt: the
 * composer can only ever word what the gatherer put in the context, and the gatherer only ever
 * populates what the caller's own scopes permit (briefingGather.ts).
 *
 * Honesty rules, all enforced here:
 *  - "scheduled"/"expected", NEVER presence ("is at", "was seen").
 *  - nothing that isn't recorded; care notes worded as the recorded fact, never advice.
 *  - refusals stay refusals: an unknown child yields one generic line, no existence oracle.
 *  - limited access is stated plainly ("You have limited access to …"), never padded.
 *  - no coordinates — only place LABELS (from the authorized day read); coordinates would need
 *    geometry access (address.read) and are not emitted in v1 (see briefingGather.ts).
 */

export const SCHEDULE_SCOPE = 'schedule.read';
export const CAREPLAN_SCOPE = 'careplan.read';

export type BriefingAccess = {
  childId: string;
  /** Only set if an authorized read this turn actually supplied a name — never invented. */
  childName: string | null;
  /** The caller's own scopes for THIS child, from their fresh MyChildren result. */
  scopes: ReadonlySet<string>;
  /** address.read — gates place COORDINATES. v1 never emits coordinates regardless. */
  hasGeometryAccess: boolean;
  /** Whether the child is one the caller has real standing with (their own MyChildren). */
  isKnownChild: boolean;
};

export type BriefingEvent = {
  title: string;
  start: string; // ISO/local
  end: string;
  /** A place LABEL only (e.g. "Room 12, Lincoln Elementary"); never coordinates. */
  location: string | null;
  status: string; // proposed | confirmed | cancelled
};

/** The caller's own role for the day — only ever set from a recorded fact. */
export type BriefingRole =
  | { kind: 'approved_pickup'; time: string | null }
  | { kind: 'has_child'; source: 'ARRANGEMENT' | 'WEEKLY' }
  | null;

export type BriefingCareNote = { key: string; value: string; confidence: string };

export type BriefingCheckIn = { recorded: boolean; label: string } | null;

export type BriefingContext = {
  access: BriefingAccess;
  date: string;
  /** null = not read / not permitted; [] = permitted but nothing recorded. The distinction matters:
   *  null never claims "nothing is scheduled", it says the caller can't see the schedule. */
  events: BriefingEvent[] | null;
  role: BriefingRole;
  /** null = no careplan.read (excluded); [] = granted but none recorded. */
  careNotes: BriefingCareNote[] | null;
  /** null = not visible to this caller (e.g. non-parent); otherwise the recorded check-in state. */
  checkIn: BriefingCheckIn;
};

export type BriefingSection = { heading: string; lines: string[] };

export type Briefing = {
  childId: string;
  refused: boolean;
  limitedAccess: boolean;
  sections: BriefingSection[];
  text: string;
};

function who(access: BriefingAccess): string {
  return access.childName ?? 'this child';
}

function clock(iso: string): string | null {
  const m = /T([01]\d|2[0-3]):([0-5]\d)/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

function scheduledLine(e: BriefingEvent): string {
  const t = clock(e.start);
  const when = t ? `${t}` : 'time not recorded';
  const where = e.location ? ` at ${e.location}` : '';
  const status = e.status === 'confirmed' ? '' : ` (${e.status})`;
  return `${when} — ${e.title}${where}${status}`;
}

/**
 * Compose the briefing. Pure: identical context → identical briefing. Sections are only added when
 * the context actually carries that information; a section is never fabricated to fill space.
 */
export function composeBriefing(ctx: BriefingContext): Briefing {
  const name = who(ctx.access);

  // Refusal: an unknown child is one generic line — same answer whether or not the child exists.
  if (!ctx.access.isKnownChild) {
    const text = `I can't put together a briefing for that child — it isn't one you have access to.`;
    return { childId: ctx.access.childId, refused: true, limitedAccess: true, sections: [], text };
  }

  const sections: BriefingSection[] = [];

  // 1. What's scheduled and where (labels only).
  if (ctx.events === null) {
    sections.push({ heading: `Schedule`, lines: [`You don't have access to ${name}'s schedule.`] });
  } else if (ctx.events.length === 0) {
    sections.push({ heading: `Scheduled for ${ctx.date}`, lines: [`Nothing is scheduled for ${name} that you can see.`] });
  } else {
    const visible = ctx.events.filter((e) => e.status !== 'cancelled');
    const lines = (visible.length ? visible : ctx.events).map(scheduledLine);
    sections.push({ heading: `Scheduled for ${ctx.date}`, lines });
  }

  // 2. Your role today — only if recorded.
  if (ctx.role) {
    if (ctx.role.kind === 'approved_pickup') {
      sections.push({
        heading: `Your role today`,
        lines: [ctx.role.time ? `You're the approved pickup at ${ctx.role.time}.` : `You're the approved pickup.`],
      });
    } else {
      sections.push({
        heading: `Your role today`,
        lines: [ctx.role.source === 'ARRANGEMENT' ? `${name} is with you today (an approved arrangement).` : `${name} is with you today (the weekly schedule).`],
      });
    }
  }

  // 3. Care notes — only if granted; worded as the recorded fact, never advice.
  if (ctx.careNotes === null) {
    // Not granted — do not add a care section at all; the omission is listed under "what's unknown".
  } else if (ctx.careNotes.length === 0) {
    sections.push({ heading: `Care notes`, lines: [`No care notes are recorded for ${name}.`] });
  } else {
    const lines = ctx.careNotes.map((n) => {
      const conf = n.confidence === 'CONFIRMED' ? 'confirmed' : n.confidence === 'PROVISIONAL' ? 'provisional' : String(n.confidence).toLowerCase();
      return `${n.key}: ${n.value} (recorded, ${conf})`;
    });
    sections.push({ heading: `Care notes`, lines });
  }

  // 4. Check-in (parent view only) — the recorded state, never "missing"/"in danger".
  if (ctx.checkIn) {
    sections.push({ heading: `Check-in`, lines: [ctx.checkIn.recorded ? ctx.checkIn.label : `Not yet recorded.`] });
  }

  // 5. What's unknown / not visible to you — stated plainly.
  const unknown: string[] = [];
  if (ctx.events === null) unknown.push(`${name}'s schedule`);
  if (ctx.careNotes === null) unknown.push(`${name}'s care notes`);
  if (ctx.checkIn === null) unknown.push(`check-in status`);
  if (unknown.length) sections.push({ heading: `Not visible to you`, lines: unknown });

  // Limited access: the caller can see very LITTLE — say so plainly rather than pad. "Very little"
  // means nothing substantive at all (no schedule, no role, no care notes, no check-in); seeing the
  // full day's schedule is NOT limited, even if it is the only section the caller's grant allows
  // (e.g. Loretta: schedule but no care notes). So this flags only the genuinely sparse case.
  const informative =
    (ctx.events !== null && ctx.events.length > 0 ? 1 : 0) +
    (ctx.role ? 1 : 0) +
    (ctx.careNotes !== null && ctx.careNotes.length > 0 ? 1 : 0) +
    (ctx.checkIn !== null ? 1 : 0);
  const limitedAccess = informative === 0;

  const header = limitedAccess ? [`You have limited access to ${name}'s details.`] : [];
  const text = [
    ...header,
    ...sections.map((s) => `${s.heading}:\n${s.lines.map((l) => `  • ${l}`).join('\n')}`),
  ].join('\n\n');

  return { childId: ctx.access.childId, refused: false, limitedAccess, sections, text };
}
