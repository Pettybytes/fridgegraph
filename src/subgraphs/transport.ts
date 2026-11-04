import { parse } from 'graphql';
import { SCOPE, authorizeChild, deny, guideCanReadChild, guideCanReadPerson, hasScope, isParentOf, requireCaller, type Ctx } from '../authz';
import { childIds, pickupCandidatesFor } from '../derive';
import { dbFor, one, rows } from '../db';

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

const vehiclesOf = async (ctx: Ctx, personId: string) => {
  const data = await rows(
    dbFor(ctx)
      .from('vehicles')
      .select('id,owner_id,year,make,model,color,plate')
      .eq('owner_id', personId),
  );
  return data.map((v) => ({
    id: String(v.id),
    owner: { id: String(v.owner_id) },
    year: Number(v.year),
    make: String(v.make),
    model: String(v.model),
    color: String(v.color),
    plate: String(v.plate),
  }));
};

/**
 * Own vehicles are always readable. Otherwise the vehicle belongs to a person who is a
 * pickupCandidate for a child the caller is a parent of, or holds pickup.verify for.
 */
async function mayReadVehicles(ctx: Ctx, personId: string): Promise<boolean> {
  const callerId = requireCaller(ctx);
  if (callerId === personId || await guideCanReadPerson(ctx, personId)) return true;
  for (const cid of await childIds(ctx)) {
    const allowed =
      (await isParentOf(ctx, cid))
      || (await hasScope(ctx, cid, SCOPE.pickupVerify, ctx.today))
      // E2c: the guide reads sandbox candidates, and a candidate's vehicle is part of that row.
      || (await guideCanReadChild(ctx, cid));
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
      const row = await one(
        dbFor(ctx)
          .from('bus_rosters')
          .select('date,child_id,route,riding')
          .eq('child_id', childId)
          .eq('date', date.slice(0, 10))
          .maybeSingle(),
      );
      return row
        ? {
            date: String(row.date).slice(0, 10),
            child: { id: String(row.child_id) },
            route: String(row.route),
            riding: Boolean(row.riding),
          }
        : null;
    },
    vehicles: async (
      _: unknown,
      { personId }: { personId: string },
      ctx: Ctx,
    ) => {
      if (!(await mayReadVehicles(ctx, personId))) throw deny();
      return vehiclesOf(ctx, personId);
    },
  },

  Person: {
    vehicles: async (p: { id: string }, __: unknown, ctx: Ctx) => {
      if (!(await mayReadVehicles(ctx, p.id))) throw deny();
      return vehiclesOf(ctx, p.id);
    },
  },

  BusRoster: {
    child: (b: { child: { id: string }; childId?: string }) => b.child ?? { id: b.childId },
  },

  Vehicle: {
    owner: (v: { owner: { id: string }; ownerId?: string }) => v.owner ?? { id: v.ownerId },
  },
};

export default { typeDefs, resolvers };
