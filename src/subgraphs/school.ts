import { randomUUID } from 'node:crypto';
import { parse } from 'graphql';
import {
  SCOPE,
  authorizeChild,
  deny,
  householdIdsOfChild,
  isParentOf,
  refuseDemoGuideWrite,
  requireCaller,
  type Ctx,
} from '../authz';
import { dbFor, one, rows } from '../db';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    schoolReports(childId: ID!): [SchoolReport!]!
    permissionSlips(childId: ID!): [PermissionSlip!]!
  }

  type Mutation {
    approveConsent(slipId: ID!): SlipDecision!
  }

  type Person @key(fields: "id") {
    id: ID!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type SchoolReport {
    id: ID!
    child: Child!
    kind: String!
    text: String!
    at: String!
  }

  type PermissionSlip {
    id: ID!
    child: Child!
    title: String!
    signed: Boolean!
    history: [SlipDecision!]!
  }

  """A recorded consent decision. at is the day it was recorded, never a time."""
  type SlipDecision {
    slip: PermissionSlip!
    approver: Person!
    decision: String!
    at: String!
  }
`);

type SlipRow = { id: string; child_id: string; title: string; signed: boolean };

type DecisionRow = { approver_id: string; decision: string; at: string };

function toDecision(slipId: string, childId: string, d: DecisionRow) {
  return {
    slip: { id: slipId, child: { id: childId } },
    approver: { id: String(d.approver_id) },
    decision: String(d.decision),
    at: String(d.at).slice(0, 10),
  };
}

/**
 * CONSENT authority for one child, resolved from the household's `consent_approval` policy.
 *
 *   'parent'      -> any parent or guardian of the child (the authority fact)
 *   a person id   -> ONLY that person. Deliberately NOT "parent OR the named approver": naming
 *                    someone takes the decision away from everybody else.
 *   (no rule)     -> parent or guardian of the child. This is the documented default, never a
 *                    rejection: a household that has not configured consent still has parents.
 *
 * Never derived from parenting time, `schedule_swap_approval`, `resident_adult` or a care-plan
 * grant — those are different authorities for different decisions.
 *
 * More than one named approver across the child's households is an ambiguous configuration, so it
 * refuses everyone rather than picking a winner.
 */
async function mayApproveConsent(ctx: Ctx, childId: string, callerId: string): Promise<boolean> {
  const households = await householdIdsOfChild(ctx, childId);
  if (households.length === 0) return false;

  const data = await rows(
    dbFor(ctx)
      .from('household_policies')
      .select('value')
      .eq('rule', 'consent_approval')
      .in('household_id', households),
  );
  const values = data.map((r) => String(r.value));
  const named = [...new Set(values.filter((v) => v !== 'parent' && v !== ''))];

  if (named.length > 1) return false;
  if (named.length === 1) return callerId === named[0];
  return isParentOf(ctx, childId);
}

/** The one recorded decision for a slip, read through the caller's own RLS-scoped client. */
async function existingDecision(ctx: Ctx, slipId: string): Promise<DecisionRow | null> {
  const row = await one(
    dbFor(ctx)
      .from('approvals')
      .select('approver_id,decision,at')
      .eq('subject_type', 'permission_slip')
      .eq('subject_id', slipId)
      .maybeSingle(),
  );
  return row
    ? { approver_id: String(row.approver_id), decision: String(row.decision), at: String(row.at) }
    : null;
}

const resolvers = {
  Query: {
    schoolReports: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.school);
      const data = await rows(
        dbFor(ctx)
          .from('school_reports')
          .select('id,child_id,kind,text,at')
          .eq('child_id', childId),
      );
      return data.map((r) => ({
        id: String(r.id),
        child: { id: String(r.child_id) },
        kind: String(r.kind),
        text: String(r.text),
        at: String(r.at).slice(0, 10),
      }));
    },
    permissionSlips: async (_: unknown, { childId }: { childId: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.school);
      const data = await rows(
        dbFor(ctx)
          .from('permission_slips')
          .select('id,child_id,title,signed')
          .eq('child_id', childId),
      );
      return data.map((s) => ({
        id: String(s.id),
        child: { id: String(s.child_id) },
        title: String(s.title),
        signed: Boolean(s.signed),
      }));
    },
  },

  Mutation: {
    approveConsent: async (_: unknown, { slipId }: { slipId: string }, ctx: Ctx) => {
      // The guide observes and never decides. Refused again in the database (0025, 0048).
      refuseDemoGuideWrite(ctx);
      const callerId = requireCaller(ctx);

      // The slip is read through the caller's own client, so a hidden slip and a nonexistent one
      // are the same answer. An unauthorized caller, a hidden slip, a malformed id and a missing id
      // all end in the same UNAUTHORIZED — no existence oracle.
      const slip = (await one(
        dbFor(ctx)
          .from('permission_slips')
          .select('id,child_id,title,signed')
          .eq('id', slipId)
          .maybeSingle(),
      )) as SlipRow | null;
      if (!slip) throw deny();

      const childId = String(slip.child_id);
      if (!(await mayApproveConsent(ctx, childId, callerId))) throw deny();

      // The database decides what a duplicate is (0047: one decision per slip). An application
      // pre-check would be a race, so the insert is attempted and 23505 means "already decided".
      const { error } = await dbFor(ctx).from('approvals').insert({
        id: `ap_${randomUUID()}`,
        approver_id: callerId,
        subject_type: 'permission_slip',
        subject_id: String(slip.id),
        decision: 'APPROVED',
        at: ctx.today,
      });

      if (error && error.code !== '23505') {
        console.error('[school.approveConsent] approval insert failed:', error.code);
        throw new Error('APPROVAL_WRITE_FAILED');
      }

      // Either we just wrote it, or it already existed: both return the recorded decision. When a
      // different eligible approver repeats it, they get the existing decision and who made it, and
      // nothing changes.
      const decided = await existingDecision(ctx, String(slip.id));
      if (!decided) throw deny();
      return toDecision(String(slip.id), childId, decided);
    },
  },

  SchoolReport: {
    child: (r: { child: { id: string }; childId?: string }) => r.child ?? { id: r.childId },
  },

  PermissionSlip: {
    child: (s: { child: { id: string }; childId?: string }) => s.child ?? { id: s.childId },
    history: async (s: { id: string; child: { id: string } }, _args: unknown, ctx: Ctx) => {
      await authorizeChild(ctx, s.child.id, SCOPE.school);
      const data = await rows(
        dbFor(ctx)
          .from('approvals')
          .select('approver_id,decision,at')
          .eq('subject_type', 'permission_slip')
          .eq('subject_id', s.id)
          .order('at', { ascending: true }),
      );
      return data.map((d) => toDecision(s.id, s.child.id, d as DecisionRow));
    },
  },
};

export default { typeDefs, resolvers };
