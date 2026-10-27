import { randomUUID } from 'node:crypto';
import { parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  hasAnyGrant,
  hasScope,
  isParentOf,
  requireCaller,
  type Ctx,
} from '../authz';
import { approverForChild, pickupCandidatesFor, supervisionCandidatesFor } from '../derive';
import { dbFor, one, rows } from '../db';

/**
 * access — grants, approvals, household policies and parenting schedules.
 *
 * Owns the two mutations that change what a non-parent may see: grantAccess / revokeGrant.
 * `approveRelationship` stays on the village field (it changes a relationship) and writes its
 * single audit row into `approvals`; see HANDOFF §6 for why that one write crosses owners.
 */
const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


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

type GrantShape = {
  id: string;
  actorId: string;
  childId: string;
  scopes: string[];
  validFrom: string | null;
  validUntil: string | null;
  grantedBy: string;
};

const toGrant = (row: Record<string, unknown>): GrantShape => ({
  id: String(row.id),
  actorId: String(row.actor_id),
  childId: String(row.child_id),
  scopes: (row.scopes as string[]) ?? [],
  validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
  validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
  grantedBy: String(row.granted_by),
});

const GRANT_COLUMNS = 'id,actor_id,child_id,scopes,valid_from,valid_until,granted_by';

/** Writes the audit row for a grant decision. `access` owns `approvals`. */
async function recordApproval(
  ctx: Ctx,
  subjectId: string,
  decision: 'GRANTED' | 'REVOKED',
): Promise<void> {
  const { error } = await dbFor(ctx).from('approvals').insert({
    id: `ap_${randomUUID()}`,
    approver_id: requireCaller(ctx),
    subject_type: 'Grant',
    subject_id: subjectId,
    decision,
    at: ctx.today,
  });
  if (error) {
    console.error('[access] approval insert failed:', error.code);
    throw new Error('APPROVAL_WRITE_FAILED');
  }
}

/** The derived queries need the caller to be a parent or to hold some grant for that child. */
async function requireDerivedAccess(ctx: Ctx, childId: string, onDate: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  if (await hasAnyGrant(ctx, childId, onDate)) return;
  throw deny();
}

/**
 * Who may see the pickup candidate list: a parent of the child, or a grant holding pickup.verify.
 * Anyone else is UNAUTHORIZED — an empty list would imply "nobody can collect this child",
 * which is a different and misleading statement.
 */
async function requirePickupAccess(ctx: Ctx, childId: string, onDate: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  if (await hasScope(ctx, childId, SCOPE.pickupVerify, onDate)) return;
  throw deny();
}

/** Supervision candidates are for parents only. No new scope is introduced for them. */
async function requireSupervisionAccess(ctx: Ctx, childId: string): Promise<void> {
  requireCaller(ctx);
  if (await isParentOf(ctx, childId)) return;
  throw deny();
}

const resolvers = {
  Query: {
    grants: async (
      _: unknown,
      { childId, actorId }: { childId?: string; actorId?: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      const client = dbFor(ctx);
      if (!childId) {
        // Without a child, only a person's own grants are visible.
        const data = await rows(
          client.from('grants').select(GRANT_COLUMNS).eq('actor_id', callerId),
        );
        return data.map(toGrant);
      }
      if (!(await isParentOf(ctx, childId))) throw deny();
      const q = client.from('grants').select(GRANT_COLUMNS).eq('child_id', childId);
      const data = await rows(actorId ? q.eq('actor_id', actorId) : q);
      return data.map(toGrant);
    },
    approvals: async (_: unknown, { subjectId }: { subjectId?: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const q = dbFor(ctx)
        .from('approvals')
        .select('id,approver_id,subject_type,subject_id,decision,at');
      const data = await rows(subjectId ? q.eq('subject_id', subjectId) : q);
      return data.map((a) => ({
        id: String(a.id),
        approver: { id: String(a.approver_id) },
        subjectType: String(a.subject_type),
        subjectId: String(a.subject_id),
        decision: String(a.decision),
        at: String(a.at).slice(0, 10),
      }));
    },
    householdPolicy: async (_: unknown, { householdId }: { householdId: string }, ctx: Ctx) => {
      const callerId = requireCaller(ctx);
      const members = await rows(
        dbFor(ctx)
          .from('household_members')
          .select('person_id,role')
          .eq('household_id', householdId),
      );
      const childIds = members.filter((m) => m.role === 'child').map((m) => String(m.person_id));
      let anyParent = false;
      for (const childId of childIds) {
        if (await isParentOf(ctx, childId)) {
          anyParent = true;
          break;
        }
      }
      if (!anyParent) throw deny();
      const data = await rows(
        dbFor(ctx)
          .from('household_policies')
          .select('household_id,rule,value')
          .eq('household_id', householdId),
      );
      void callerId;
      return data.map((p) => ({
        household: { id: String(p.household_id) },
        rule: String(p.rule),
        value: String(p.value),
      }));
    },
    parentingSchedule: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const data = await rows(
        dbFor(ctx)
          .from('parenting_schedules')
          .select('child_id,parent_id,weekdays')
          .eq('child_id', childId),
      );
      return data.map((s) => ({
        child: { id: String(s.child_id) },
        parent: { id: String(s.parent_id) },
        weekdays: (s.weekdays as string[]) ?? [],
      }));
    },
    pickupCandidates: async (
      _: unknown,
      { childId, asOf }: { childId: string; asOf?: string },
      ctx: Ctx,
    ) => {
      const on = asOf ?? ctx.today;
      await requirePickupAccess(ctx, childId, on);
      const candidates = await pickupCandidatesFor(ctx, childId, on);
      return candidates.map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    supervisionCandidates: async (
      _: unknown,
      { childId, asOf }: { childId: string; asOf?: string },
      ctx: Ctx,
    ) => {
      const on = asOf ?? ctx.today;
      await requireSupervisionAccess(ctx, childId);
      const candidates = await supervisionCandidatesFor(ctx, childId, on);
      return candidates.map((c) => ({
        person: { id: c.personId },
        reason: c.reason,
        authorization: 'AUTHORIZED',
        availability: c.availability,
      }));
    },
    approverFor: async (
      _: unknown,
      { childId, date }: { childId: string; date?: string },
      ctx: Ctx,
    ) => {
      const on = date ?? ctx.today;
      await requireDerivedAccess(ctx, childId, ctx.today);
      const { approverId, fyiParentIds } = await approverForChild(ctx, childId, on);
      return {
        approver: approverId ? { id: approverId } : null,
        fyiParents: fyiParentIds.map((id) => ({ id })),
      };
    },
  },

  Mutation: {
    grantAccess: async (
      _: unknown,
      {
        actorId,
        childId,
        scopes,
        validFrom,
        validUntil,
      }: { actorId: string; childId: string; scopes: string[]; validFrom?: string; validUntil?: string },
      ctx: Ctx,
    ) => {
      const callerId = requireCaller(ctx);
      // HouseholdPolicy caregiver_approval = ANY_PARENT: any parent of this child may grant.
      if (!(await isParentOf(ctx, childId))) throw deny();
      const id = `g_${randomUUID()}`;
      const inserted = await one(
        dbFor(ctx)
          .from('grants')
          .insert({
            id,
            actor_id: actorId,
            child_id: childId,
            scopes,
            valid_from: validFrom ?? null,
            valid_until: validUntil ?? null,
            granted_by: callerId,
          })
          .select(GRANT_COLUMNS)
          .maybeSingle(),
      );
      if (!inserted) return null;
      await recordApproval(ctx, id, 'GRANTED');
      return toGrant(inserted);
    },
    revokeGrant: async (_: unknown, { id }: { id: string }, ctx: Ctx) => {
      requireCaller(ctx);
      const existing = await one(
        dbFor(ctx).from('grants').select(GRANT_COLUMNS).eq('id', id).maybeSingle(),
      );
      if (!existing) return false;
      if (!(await isParentOf(ctx, String(existing.child_id)))) throw deny();
      const deleted = await rows(dbFor(ctx).from('grants').delete().eq('id', id).select('id'));
      if (deleted.length === 0) return false;
      await recordApproval(ctx, id, 'REVOKED');
      return true;
    },
  },

  Grant: {
    actor: (g: GrantShape) => ({ id: g.actorId }),
    child: (g: GrantShape) => ({ id: g.childId }),
    grantedBy: (g: GrantShape) => ({ id: g.grantedBy }),
  },

  Approval: {
    approver: (a: { approver: { id: string }; approverId?: string }) =>
      a.approver ?? { id: a.approverId },
  },

  HouseholdPolicy: {
    household: (p: { household: { id: string }; householdId?: string }) =>
      p.household ?? { id: p.householdId },
  },

  ParentingSchedule: {
    child: (s: { child: { id: string }; childId?: string }) => s.child ?? { id: s.childId },
    parent: (s: { parent: { id: string }; parentId?: string }) => s.parent ?? { id: s.parentId },
  },
};

export default { typeDefs, resolvers };
