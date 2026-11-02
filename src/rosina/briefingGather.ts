/**
 * Caregiver Briefing — the GATHERER. Turns the caller's own authorized reads into a BriefingContext
 * for the composer. This is where the trust boundary is applied to the reads: a care-notes read is
 * only ISSUED when the caller holds careplan.read for the child; the schedule is only read with
 * schedule.read; coordinates are never requested (labels only; coordinates would need geometry
 * access and are not consumed in v1); and an unknown child short-circuits to a refusal before any
 * read happens. Every read runs AS THE CALLER (the readers forward the caller's bearer) — identity
 * is never minted. Readers are injected so tests stub them and the server wires real MCP reads.
 */
import {
  CAREPLAN_SCOPE,
  SCHEDULE_SCOPE,
  type BriefingCareNote,
  type BriefingContext,
  type BriefingEvent,
  type BriefingRole,
} from './briefing';

/** A read either returns a value or is DENIED (unauthorized / not visible) — never an oracle. */
export type ReadResult<T> = { ok: true; value: T } | { ok: false };

export type EffectiveScheduleRead = { parentId: string | null; source: 'ARRANGEMENT' | 'WEEKLY' | string };

export type BriefingReaders = {
  childEvents(input: { childId: string; date: string }): Promise<ReadResult<BriefingEvent[]>>;
  effectiveSchedule(input: { childId: string; date: string }): Promise<ReadResult<EffectiveScheduleRead>>;
  careFacts(input: { childId: string }): Promise<ReadResult<BriefingCareNote[]>>;
  checkIn(input: { childId: string }): Promise<ReadResult<{ recorded: boolean; label: string }>>;
  /** The caller's own approved-pickup status for the day, or null if they are not the approved
   *  pickup. Denied is treated the same as "not the pickup" — no oracle. */
  pickupRole(input: { childId: string; date: string; callerId: string }): Promise<ReadResult<{ time: string | null } | null>>;
};

export type GatherInput = {
  childId: string;
  date: string;
  callerId: string;
  access: {
    childName: string | null;
    scopes: ReadonlySet<string>;
    hasGeometryAccess: boolean;
    isKnownChild: boolean;
  };
  readers: BriefingReaders;
};

export async function gatherBriefing(input: GatherInput): Promise<BriefingContext> {
  const { childId, date, callerId, access, readers } = input;

  const baseAccess = {
    childId,
    childName: access.childName,
    scopes: access.scopes,
    hasGeometryAccess: access.hasGeometryAccess,
    isKnownChild: access.isKnownChild,
  };

  // Unknown child → refuse before issuing any read (no existence oracle, no wasted calls).
  if (!access.isKnownChild) {
    return { access: baseAccess, date, events: null, role: null, careNotes: null, checkIn: null };
  }

  const hasSchedule = access.scopes.has(SCHEDULE_SCOPE);
  const hasCareplan = access.scopes.has(CAREPLAN_SCOPE);

  // Schedule (labels only). Only read with schedule.read; otherwise the caller simply can't see it.
  let events: BriefingEvent[] | null = null;
  if (hasSchedule) {
    const r = await readers.childEvents({ childId, date });
    events = r.ok ? r.value : [];
  }

  // Role today — recorded facts only. Approved-pickup takes precedence over "has the child".
  let role: BriefingRole = null;
  const pr = await readers.pickupRole({ childId, date, callerId });
  if (pr.ok && pr.value) {
    role = { kind: 'approved_pickup', time: pr.value.time };
  } else if (hasSchedule) {
    const es = await readers.effectiveSchedule({ childId, date });
    if (es.ok && es.value.parentId === callerId) {
      const source = es.value.source === 'ARRANGEMENT' ? 'ARRANGEMENT' : 'WEEKLY';
      role = { kind: 'has_child', source };
    }
  }

  // Care notes — only ISSUE the read when careplan.read is held. No scope → excluded (null), which
  // the composer surfaces under "not visible to you" rather than pretending none exist.
  let careNotes: BriefingCareNote[] | null = null;
  if (hasCareplan) {
    const r = await readers.careFacts({ childId });
    careNotes = r.ok ? r.value : [];
  }

  // Check-in is parent-only at the backend; a non-parent read is DENIED and becomes null (not
  // visible), never a fabricated "all clear".
  const ci = await readers.checkIn({ childId });
  const checkIn = ci.ok ? ci.value : null;

  return { access: baseAccess, date, events, role, careNotes, checkIn };
}
