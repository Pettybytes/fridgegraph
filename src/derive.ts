/**
 * Derivations that span tables. Reads only — writes belong to the owning subgraph.
 * Used by the `access` subgraph for the derived queries, and by `transport` for the
 * `Person.vehicles` guard.
 *
 * Every read goes through the caller's RLS client. Relationship rows for the candidate queries
 * come from `pickup_candidates_for(child, on_date)` (migration 0008), a narrow SECURITY DEFINER
 * function that returns only (from_id, type) for ACTIVE relationships to ONE child, and only to a
 * caller who is a parent of that child or holds pickup.verify on that date. The relationships
 * table itself stays parent-only.
 */
import { dbFor, memo, rows } from './db';
import { hasScope, householdIdsOfChild, inWindow, ownGrants, parentIdsOfChild, type Ctx } from './authz';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SIBLING_TYPES = ['brother', 'sister', 'sibling'];

/** Whole years between birthDate and asOf. Ages are always computed, never stored. */
export function ageOn(birthDate: string, asOf: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [ay, am, ad] = asOf.slice(0, 10).split('-').map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age;
}

export function weekdayOf(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()];
}

export function isSiblingType(type: string): boolean {
  return SIBLING_TYPES.includes(type);
}

export async function policyValue(ctx: Ctx, childId: string, rule: string): Promise<string | null> {
  const households = await householdIdsOfChild(ctx, childId);
  if (households.length === 0) return null;
  const data = await rows(
    dbFor(ctx)
      .from('household_policies')
      .select('rule,value')
      .in('household_id', households)
      .eq('rule', rule),
  );
  return data.length ? String(data[0].value) : null;
}

async function offersAny(ctx: Ctx, personId: string, names: string[]): Promise<boolean> {
  return memo(ctx, `offers:${personId}:${names.join(',')}`, async () => {
    const data = await rows(
      dbFor(ctx).from('capabilities').select('name').eq('person_id', personId).in('name', names),
    );
    return data.length > 0;
  });
}

/** ACTIVE relationships to the child, authorized by the DB for a parent or pickup.verify holder. */
async function activeRelationships(ctx: Ctx, childId: string, onDate: string) {
  return memo(ctx, `rel:${childId}:${onDate}`, async () => {
    const { data, error } = await dbFor(ctx).rpc('pickup_candidates_for', {
      child: childId,
      on_date: onDate,
    });
    if (error) throw error;
    return (data ?? []) as Array<{ from_id: string; type: string }>;
  });
}

/** Actor ids holding `scope` for the child on that date (narrow definer helper, migration 0010). */
async function grantHolders(ctx: Ctx, childId: string, scope: string, onDate: string): Promise<string[]> {
  return memo(ctx, `holders:${childId}:${scope}:${onDate}`, async () => {
    const { data, error } = await dbFor(ctx).rpc('grant_holders_for', {
      child: childId,
      scope,
      on_date: onDate,
    });
    if (error) throw error;
    return ((data as string[] | null) ?? []).map(String);
  });
}

type PersonLite = { id: string; birthDate: string };

async function personLite(ctx: Ctx, personId: string): Promise<PersonLite | null> {
  return memo(ctx, `personlite:${personId}`, async () => {
    const data = await rows(dbFor(ctx).from('people').select('id,birth_date').eq('id', personId));
    if (!data.length) return null;
    return { id: String(data[0].id), birthDate: String(data[0].birth_date) };
  });
}

export type CandidateRow = { personId: string; reason: string; availability: 'UNKNOWN' };

/** ACTIVE relationship + transport.child offer + pickup.request grant valid at asOf. */
export async function pickupCandidatesFor(ctx: Ctx, childId: string, asOf: string): Promise<CandidateRow[]> {
  const rels = await activeRelationships(ctx, childId, asOf);
  const holders = new Set(await grantHolders(ctx, childId, 'pickup.request', asOf));
  const typesByPerson = new Map<string, string[]>();
  for (const r of rels) {
    const fromId = String(r.from_id);
    if (!holders.has(fromId)) continue;
    if (!(await offersAny(ctx, fromId, ['transport.child']))) continue;
    const types = typesByPerson.get(fromId) ?? [];
    if (!types.includes(r.type)) types.push(r.type);
    typesByPerson.set(fromId, types);
  }

  const out: CandidateRow[] = [];
  for (const [personId, types] of typesByPerson) {
    out.push({
      personId,
      reason: `${types.join(' + ')} — transport.child offered, pickup.request grant valid ${asOf}`,
      availability: 'UNKNOWN',
    });
  }
  return out;
}

/** ACTIVE relationship + supervise.* offer + supervise.request grant; siblings must also be old enough. */
export async function supervisionCandidatesFor(ctx: Ctx, childId: string, asOf: string): Promise<CandidateRow[]> {
  const minAgeRaw = await policyValue(ctx, childId, 'sibling_supervision_min_age');
  const minAge = minAgeRaw === null ? null : Number(minAgeRaw);
  const rels = await activeRelationships(ctx, childId, asOf);
  const holders = new Set(await grantHolders(ctx, childId, 'supervise.request', asOf));
  const reasons = new Map<string, string>();

  for (const r of rels) {
    const fromId = String(r.from_id);
    if (!holders.has(fromId)) continue;
    if (!(await offersAny(ctx, fromId, ['supervise.child', 'supervise.sibling']))) continue;

    let reason = `${r.type} — supervise offer, supervise.request grant valid ${asOf}`;
    if (isSiblingType(r.type)) {
      const person = await personLite(ctx, fromId);
      if (!person) continue;
      const age = ageOn(person.birthDate, asOf);
      if (minAge !== null && age < minAge) continue;
      reason = `${r.type} — age ${age} at ${asOf} meets sibling_supervision_min_age ${minAge ?? 'unset'}`;
    }
    if (!reasons.has(fromId)) reasons.set(fromId, reason);
  }

  return [...reasons].map(([personId, reason]) => ({
    personId,
    reason,
    availability: 'UNKNOWN' as const,
  }));
}

/** Whoever holds the child on that date; everyone else who is a parent is FYI. */
export async function approverForChild(
  ctx: Ctx,
  childId: string,
  date: string,
): Promise<{ approverId: string | null; fyiParentIds: string[] }> {
  // The approver follows the EFFECTIVE schedule (0028): an APPROVED HolidayArrangement first, then
  // the weekly rule. Where no arrangement exists this is exactly the previous behaviour.
  const { data: effective, error: effectiveErr } = await dbFor(ctx).rpc('effective_schedule_for', {
    p_child: childId,
    p_day: date,
  });
  if (effectiveErr) throw effectiveErr;
  const row = (effective as Array<{ parent_id: string | null }> | null)?.[0];
  const approverId = row?.parent_id ? String(row.parent_id) : null;
  // Co-parents, from a definer helper: household_members is readable only inside your own
  // household, so a parent cannot see the other parent's membership row directly (migration 0010).
  const { data: parentIds, error: parentErr } = await dbFor(ctx).rpc('parent_ids_of', {
    child: childId,
  });
  if (parentErr) throw parentErr;
  const fyiParentIds = ((parentIds as string[] | null) ?? [])
    .map(String)
    .filter((id) => id !== approverId);
  return { approverId, fyiParentIds };
}

export async function childIds(ctx: Ctx): Promise<string[]> {
  const data = await rows(dbFor(ctx).from('children').select('person_id'));
  return data.map((r) => String(r.person_id));
}

export { ownGrants };

/**
 * The Detroit calendar day of a stored event time.
 *
 * `events.start_at` arrives as a timestamp string that may or may not carry a zone. A UTC slice of the
 * first ten characters is wrong for anything after 19:00 Eastern: 2026-11-01T19:30-05:00 is
 * 2026-11-02T00:30Z, and the map would file it under the wrong day. Zoned values are converted to
 * America/Detroit; unzoned values are already wall-clock time in Detroit and are taken as-is.
 */
const DETROIT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Detroit',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function detroitDay(value: string): string {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  if (!zoned) return value.slice(0, 10);
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value.slice(0, 10);
  return DETROIT.format(at); // en-CA yields YYYY-MM-DD
}
