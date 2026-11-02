/**
 * Invite event fields: validate Muse Spark's raw extraction into structured, editable fields BEFORE
 * any image call. Required (childFirstName, occasion, a real America/Detroit date) are checked here;
 * anything missing or ambiguous returns a clarification question, never an invented fact. Pure.
 */

export type InviteEvent = {
  childFirstName: string;
  occasion: string;
  date: string | null; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  timezone: 'America/Detroit';
  placeLabel: string | null;
};

/** The shape we accept back from the Spark extractor (see inviteDeps.ts). All fields optional. */
export type RawInviteExtraction = {
  childFirstName?: unknown;
  occasion?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  placeLabel?: unknown;
  clarification?: unknown; // a single question string when the model found it ambiguous
};

export type InviteValidation =
  | { status: 'NEEDS_CLARIFICATION'; clarification: { question: string }; event: InviteEvent }
  | { status: 'READY'; event: InviteEvent };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// America/Detroit calendar day — invites are validated against the family's day, never UTC. (Mirrors
// localTime.detroitToday, which arrives with PR #118; kept local so this slice doesn't depend on it.)
const DETROIT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' });
export function detroitToday(now: Date = new Date()): string {
  return DETROIT_DAY.format(now);
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clar(question: string, event: InviteEvent): InviteValidation {
  return { status: 'NEEDS_CLARIFICATION', clarification: { question }, event };
}

export function validateInviteFields(raw: RawInviteExtraction, opts: { today: string }): InviteValidation {
  const childFirstName = str(raw.childFirstName, 60);
  const occasion = str(raw.occasion, 80);
  const rawDate = str(raw.date, 10);
  const date = isRealDate(rawDate) ? rawDate : null;
  const startTime = typeof raw.startTime === 'string' && TIME_RE.test(raw.startTime.trim()) ? raw.startTime.trim() : null;
  const endTime = typeof raw.endTime === 'string' && TIME_RE.test(raw.endTime.trim()) ? raw.endTime.trim() : null;
  const placeLabel = str(raw.placeLabel, 120) || null;

  const event: InviteEvent = { childFirstName, occasion, date, startTime, endTime, timezone: 'America/Detroit', placeLabel };

  // The model flagged it ambiguous → ask its question verbatim, never guess.
  const modelQuestion = str(raw.clarification, 300);
  if (modelQuestion) return clar(modelQuestion, event);

  // Required fields, checked deterministically.
  if (!childFirstName) return clar("Who is the party for — what's the child's first name?", event);
  if (!occasion) return clar("What's the occasion for the invitation?", event);
  if (!date) return clar('What date is the party? A specific calendar date works best.', event);
  if (date < opts.today) return clar(`That date (${date}) has already passed — which upcoming date did you mean?`, event);

  return { status: 'READY', event };
}
