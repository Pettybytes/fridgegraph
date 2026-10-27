/**
 * x-demo-user and x-demo-date are INSECURE test inputs for local development only.
 * Replaced by validated JWTs in Milestone 3. Never deploy with these headers trusted.
 *
 * Access rules live here and are called from every resolver. The router is not an
 * authorization boundary: it only forwards the two demo headers.
 */
import { GraphQLError } from 'graphql';
import { store } from './store';

export type Ctx = { callerId?: string; today: string };

/** Field-level scopes, as strings in data — never enums. */
export const SCOPE = {
  schedule: 'schedule.read',
  transport: 'transport.read',
  goals: 'goals.read',
  careplan: 'careplan.read',
  school: 'school.read',
  contacts: 'contacts.read',
  pickupVerify: 'pickup.verify',
  pickupRequest: 'pickup.request',
  superviseRequest: 'supervise.request',
} as const;

export function deny(): GraphQLError {
  return new GraphQLError('UNAUTHORIZED', { extensions: { code: 'UNAUTHORIZED' } });
}

/** Unknown or missing caller -> deny. Returns the caller id when valid. */
export function requireCaller(ctx: Ctx): string {
  const callerId = ctx?.callerId;
  if (!callerId || !store.people.some((p) => p.id === callerId)) throw deny();
  return callerId;
}

export function householdIdsOfChild(childId: string): string[] {
  return store.householdMembers
    .filter((m) => m.personId === childId && m.role === 'child')
    .map((m) => m.householdId);
}

export function isParentOf(callerId: string | undefined, childId: string): boolean {
  if (!callerId) return false;
  const households = householdIdsOfChild(childId);
  return store.householdMembers.some(
    (m) => m.personId === callerId && m.role === 'parent' && households.includes(m.householdId),
  );
}

export function parentIdsOfChild(childId: string): string[] {
  const households = householdIdsOfChild(childId);
  return store.householdMembers
    .filter((m) => m.role === 'parent' && households.includes(m.householdId))
    .map((m) => m.personId);
}

/** A grant is valid when the date falls inside [validFrom, validUntil] (both inclusive, both optional). */
export function hasScope(
  callerId: string | undefined,
  childId: string,
  scope: string,
  onDate: string,
): boolean {
  if (!callerId) return false;
  return store.grants.some(
    (g) =>
      g.actorId === callerId &&
      g.childId === childId &&
      g.scopes.includes(scope) &&
      (!g.validFrom || onDate >= g.validFrom) &&
      (!g.validUntil || onDate <= g.validUntil),
  );
}

export function hasAnyGrant(callerId: string | undefined, childId: string, onDate: string): boolean {
  if (!callerId) return false;
  return store.grants.some(
    (g) =>
      g.actorId === callerId &&
      g.childId === childId &&
      (!g.validFrom || onDate >= g.validFrom) &&
      (!g.validUntil || onDate <= g.validUntil),
  );
}

export type AccessLevel = 'parent' | 'grant';

/** Parents of the child have full access; otherwise the exact field scope is required. */
export function authorizeChild(ctx: Ctx, childId: string, scope: string): AccessLevel {
  const callerId = requireCaller(ctx);
  if (isParentOf(callerId, childId)) return 'parent';
  if (hasScope(callerId, childId, scope, ctx.today)) return 'grant';
  throw deny();
}
