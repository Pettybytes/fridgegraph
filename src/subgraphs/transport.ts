import type { Ctx } from '../authz';
import { parse } from 'graphql';
import { SCOPE, authorizeChild, deny, hasScope, isParentOf, requireCaller } from '../authz';
import { childIds, pickupCandidatesFor } from '../derive';
import { store } from '../store';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    busRoster(childId: ID!, date: String!): BusRoster
    vehicles(personId: ID!): [Vehicle!]!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Person @key(fields: "id") {
    id: ID!
    vehicles: [Vehicle!]!
  }

  type BusRoster {
    date: String!
    child: Child!
    route: String!
    riding: Boolean!
  }

  type Vehicle {
    id: ID!
    owner: Person!
    year: Int!
    make: String!
    model: String!
    color: String!
    plate: String!
  }
`);

const vehiclesOf = (personId: string) => store.vehicles.filter((v) => v.ownerId === personId);

/**
 * Own vehicles are always readable. Otherwise the vehicle belongs to a person who is a
 * pickupCandidate for a child the caller is a parent of, or holds pickup.verify for.
 */
async function mayReadVehicles(ctx: Ctx, personId: string): Promise<boolean> {
  const callerId = requireCaller(ctx);
  if (callerId === personId) return true;
  for (const cid of await childIds(ctx)) {
    const allowed =
      (await isParentOf(ctx, cid)) || (await hasScope(ctx, cid, SCOPE.pickupVerify, ctx.today));
    if (!allowed) continue;
    const candidates = await pickupCandidatesFor(ctx, cid, ctx.today);
    if (candidates.some((c) => c.personId === personId)) return true;
  }
  return false;
}

const resolvers = {
  Query: {
    busRoster: async (_: unknown, { childId, date }: { childId: string; date: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.transport);
      const row = store.busRosters.find(
        (b) => b.childId === childId && b.date === date.slice(0, 10),
      );
      return row ?? null;
    },
    vehicles: async (
      _: unknown,
      { personId }: { personId: string },
      ctx: Ctx,
    ) => {
      if (!(await mayReadVehicles(ctx, personId))) throw deny();
      return vehiclesOf(personId);
    },
  },

  Person: {
    vehicles: async (p: { id: string }, __: unknown, ctx: Ctx) => {
      if (!(await mayReadVehicles(ctx, p.id))) throw deny();
      return vehiclesOf(p.id);
    },
  },

  BusRoster: {
    child: (b: { childId: string }) => ({ id: b.childId }),
  },

  Vehicle: {
    owner: (v: { ownerId: string }) => ({ id: v.ownerId }),
  },
};

export default { typeDefs, resolvers };
