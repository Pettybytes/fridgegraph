import type { Ctx } from '../authz';
import { parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  hasAnyGrant,
  hasScope,
  isParentOf,
  parentIdsOfChild,
  requireCaller,
} from '../authz';
import { approverForChild, pickupCandidatesFor, supervisionCandidatesFor } from '../derive';
import { nextGrantId, recordApproval, store } from '../store';

const typeDefs = parse(`
  type Query {
    grants(childId: ID, actorId: ID): [Grant!]!
    approvals(subjectId: ID): [Approval!]!
    householdPolicy(householdId: ID!): [HouseholdPolicy!]!
    parentingSchedule(childId: ID!): [ParentingSchedule!]!
    pickupCandidates(childId: ID!, asOf: String): [Candidate!]!
    supervisionCandidates(childId: ID!, asOf: String): [Candidate!]!
    approverFor(childId: ID!, date: String): ApproverResult!
  }

  type Mutation {
    grantAccess(
      actorId: ID!
      childId: ID!
      scopes: [String!]!
      validFrom: String
      validUntil: String
    ): Grant
    revokeGrant(id: ID!): Boolean!
  }

  type Person @key(fields: "id") {
    id: ID!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Household @key(fields: "id") {
    id: ID!
  }

  type Grant {
    id: ID!
    actor: Person!
    child: Child!
    scopes: [String!]!
    validFrom: String
    validUntil: String
    grantedBy: Person!
  }

  type Approval {
    id: ID!
    approver: Person!
    subjectType: String!
    subjectId: ID!
    decision: String!
    at: String!
  }

  type HouseholdPolicy {
    household: Household!
    rule: String!
    value: String!
  }

  type ParentingSchedule {
    child: Child!
    parent: Person!
    weekdays: [String!]!
  }

  enum Availability {
    UNKNOWN
    CONTACTED
    CONFIRMED
    DECLINED
  }

  type Candidate {
    person: Person!
    reason: String!
    authorization: String!
    availability: Availability!
  }

  type ApproverResult {
    approver: Person
    fyiParents: [Person!]!
  }
`);

type CtxShape = { callerId?: string; today: string };

/** The derived queries need the caller to be a parent or to hold some grant for that child. */
function requireDerivedAccess(ctx: CtxShape, childId: string, onDate: string): void {
  const callerId = requireCaller(ctx as never);
  if (isParentOf(callerId, childId)) return;
  if (hasAnyGrant(callerId, childId, onDate)) return;
  throw deny();
}

/**
 * Who may see the pickup candidate list: a parent of the child, or a grant holding pickup.verify.
 * Anyone else is UNAUTHORIZED — an empty list would imply "nobody can collect this child",
 * which is a different and misleading statement.
 */
function requirePickupAccess(ctx: CtxShape, childId: string, onDate: string): void {
  const callerId = requireCaller(ctx as never);
  if (isParentOf(callerId, childId)) return;
  if (hasScope(callerId, childId, SCOPE.pickupVerify, onDate)) return;
  throw deny();
}

/** Supervision candidates are for parents only. No new scope is introduced for them. */
function requireSupervisionAccess(ctx: CtxShape, childId: string): void {
  const callerId = requireCaller(ctx as never);
  if (isParentOf(callerId, childId)) return;
  throw deny();
}

const resolvers = {
  Query: {
    grants: (_: unknown, { childId, actorId }: { childId?: string; actorId?: string }, ctx: CtxShape) => {
      const callerId = requireCaller(ctx as never);
      if (!childId) {
        // Without a child, only a person's own grants are visible.
        return store.grants.filter((g) => g.actorId === callerId);
      }
      if (!isParentOf(callerId, childId)) throw deny();
      return store.grants.filter(
        (g) => g.childId === childId && (!actorId || g.actorId === actorId),
      );
    },
    approvals: (_: unknown, { subjectId }: { subjectId?: string }, ctx: CtxShape) => {
      requireCaller(ctx as never);
      return subjectId ? store.approvals.filter((a) => a.subjectId === subjectId) : store.approvals;
    },
    householdPolicy: (_: unknown, { householdId }: { householdId: string }, ctx: CtxShape) => {
      const callerId = requireCaller(ctx as never);
      const childrenHere = store.householdMembers.filter((m) => m.householdId === householdId && m.role === 'child');
      if (!childrenHere.some((c) => isParentOf(callerId, c.personId))) throw deny();
      return store.policies.filter((p) => p.householdId === householdId);
    },
    parentingSchedule: (_: unknown, { childId }: { childId: string }, ctx: CtxShape) => {
      authorizeChild(ctx as never, childId, SCOPE.schedule);
      return store.schedules.filter((s) => s.childId === childId);
    },
    pickupCandidates: (_: unknown, { childId, asOf }: { childId: string; asOf?: string }, ctx: CtxShape) => {
      const on = asOf ?? ctx.today;
      requirePickupAccess(ctx, childId, on);
      return pickupCandidatesFor(childId, on).map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    supervisionCandidates: (_: unknown, { childId, asOf }: { childId: string; asOf?: string }, ctx: CtxShape) => {
      const on = asOf ?? ctx.today;
      requireSupervisionAccess(ctx, childId);
      return supervisionCandidatesFor(childId, on).map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    approverFor: (_: unknown, { childId, date }: { childId: string; date?: string }, ctx: CtxShape) => {
      const on = date ?? ctx.today;
      requireDerivedAccess(ctx, childId, ctx.today);
      const { approverId, fyiParentIds } = approverForChild(childId, on);
      return {
        approver: approverId ? { id: approverId } : null,
        fyiParents: fyiParentIds.map((id) => ({ id })),
      };
    },
  },

  Mutation: {
    grantAccess: (
      _: unknown,
      {
        actorId,
        childId,
        scopes,
        validFrom,
        validUntil,
      }: { actorId: string; childId: string; scopes: string[]; validFrom?: string; validUntil?: string },
      ctx: CtxShape,
    ) => {
      const callerId = requireCaller(ctx as never);
      // HouseholdPolicy caregiver_approval = ANY_PARENT: any parent of this child may grant.
      if (!isParentOf(callerId, childId)) throw deny();
      const grant = {
        id: nextGrantId(),
        actorId,
        childId,
        scopes,
        validFrom: validFrom ?? null,
        validUntil: validUntil ?? null,
        grantedBy: callerId,
      };
      store.grants.push(grant);
      recordApproval({
        approverId: callerId,
        subjectType: 'Grant',
        subjectId: grant.id,
        decision: 'GRANTED',
        at: ctx.today,
      });
      return grant;
    },
    revokeGrant: (_: unknown, { id }: { id: string }, ctx: CtxShape) => {
      const callerId = requireCaller(ctx as never);
      const index = store.grants.findIndex((g) => g.id === id);
      if (index === -1) return false;
      const grant = store.grants[index];
      if (!isParentOf(callerId, grant.childId)) throw deny();
      store.grants.splice(index, 1);
      recordApproval({
        approverId: callerId,
        subjectType: 'Grant',
        subjectId: id,
        decision: 'REVOKED',
        at: ctx.today,
      });
      return true;
    },
  },

  Grant: {
    actor: (g: { actorId: string }) => ({ id: g.actorId }),
    child: (g: { childId: string }) => ({ id: g.childId }),
    grantedBy: (g: { grantedBy: string }) => ({ id: g.grantedBy }),
  },

  Approval: {
    approver: (a: { approverId: string }) => ({ id: a.approverId }),
  },

  HouseholdPolicy: {
    household: (p: { householdId: string }) => ({ id: p.householdId }),
  },

  ParentingSchedule: {
    child: (s: { childId: string }) => ({ id: s.childId }),
    parent: (s: { parentId: string }) => ({ id: s.parentId }),
  },
};

export default { typeDefs, resolvers };
