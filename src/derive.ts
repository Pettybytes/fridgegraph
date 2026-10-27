/**
 * Derivations that span tables. Reads only — writes belong to the owning subgraph.
 * Used by the `access` subgraph for the derived queries, and by `transport` for the
 * `Person.vehicles` guard.
 */
import { hasScope, householdIdsOfChild, parentIdsOfChild } from './authz';
import { store } from './store';

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

/** No hardcoded ages: the threshold comes from the household policy row. */
export function policyValue(childId: string, rule: string): string | null {
  const households = householdIdsOfChild(childId);
  const row = store.policies.find((p) => households.includes(p.householdId) && p.rule === rule);
  return row ? row.value : null;
}

export type CandidateRow = { personId: string; reason: string; availability: 'UNKNOWN' };

function offersAny(personId: string, names: string[]): boolean {
  return store.capabilities.some((c) => c.personId === personId && names.includes(c.name));
}

/** ACTIVE relationship + transport.child offer + pickup.request grant valid at asOf. */
export function pickupCandidatesFor(childId: string, asOf: string): CandidateRow[] {
  const typesByPerson = new Map<string, string[]>();
  for (const r of store.relationships) {
    if (r.toId !== childId || r.status !== 'ACTIVE') continue;
    if (!offersAny(r.fromId, ['transport.child'])) continue;
    if (!hasScope(r.fromId, childId, 'pickup.request', asOf)) continue;
    const types = typesByPerson.get(r.fromId) ?? [];
    if (!types.includes(r.type)) types.push(r.type);
    typesByPerson.set(r.fromId, types);
  }
  return [...typesByPerson].map(([personId, types]) => ({
    personId,
    reason: `${types.join(' + ')} — transport.child offered, pickup.request grant valid ${asOf}`,
    availability: 'UNKNOWN' as const,
  }));
}

/** ACTIVE relationship + supervise.* offer + supervise.request grant; siblings must also be old enough. */
export function supervisionCandidatesFor(childId: string, asOf: string): CandidateRow[] {
  const minAgeRaw = policyValue(childId, 'sibling_supervision_min_age');
  const minAge = minAgeRaw === null ? null : Number(minAgeRaw);
  const reasons = new Map<string, string>();

  for (const r of store.relationships) {
    if (r.toId !== childId || r.status !== 'ACTIVE') continue;
    if (!offersAny(r.fromId, ['supervise.child', 'supervise.sibling'])) continue;
    if (!hasScope(r.fromId, childId, 'supervise.request', asOf)) continue;

    let reason = `${r.type} — supervise offer, supervise.request grant valid ${asOf}`;
    if (isSiblingType(r.type)) {
      const person = store.people.find((p) => p.id === r.fromId);
      if (!person) continue;
      const age = ageOn(person.birthDate, asOf);
      if (minAge !== null && age < minAge) continue;
      reason = `${r.type} — age ${age} at ${asOf} meets sibling_supervision_min_age ${minAge ?? 'unset'}`;
    }
    if (!reasons.has(r.fromId)) reasons.set(r.fromId, reason);
  }

  return [...reasons].map(([personId, reason]) => ({
    personId,
    reason,
    availability: 'UNKNOWN' as const,
  }));
}

/** Whoever holds the child on that date; everyone else who is a parent is FYI. */
export function approverForChild(
  childId: string,
  date: string,
): { approverId: string | null; fyiParentIds: string[] } {
  const weekday = weekdayOf(date);
  const row = store.schedules.find(
    (s) => s.childId === childId && s.weekdays.includes(weekday),
  );
  const approverId = row ? row.parentId : null;
  const fyiParentIds = parentIdsOfChild(childId).filter((id) => id !== approverId);
  return { approverId, fyiParentIds };
}

export function childIds(): string[] {
  return store.children.map((c) => c.id);
}
