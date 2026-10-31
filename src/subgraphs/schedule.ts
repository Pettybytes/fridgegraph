import { parse } from 'graphql';
import { SCOPE, authorizeChild, requireCaller, type Ctx } from '../authz';
import { dbFor, rows } from '../db';

const typeDefs = parse(`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])


  type Query {
    events(childId: ID!, date: String!): [Event!]!

    """
    A child's calendar across a date range (YYYY-MM-DD, both ends inclusive). Cancelled entries are
    hidden unless includeCancelled is true; proposed and confirmed are returned with their status.
    """
    childEvents(childId: ID!, from: String!, to: String!, includeCancelled: Boolean = false): [CalendarEvent!]!

    """
    Recorded Busy/Free windows for a person.

    FREE means RECORDED FREE TIME. It is NOT confirmation of willingness, permission, or suitability
    to care for a child, and it never means the person can pick a child up. Never read it that way to
    a parent: say "has free time recorded", not "is available to watch" or "can pick up".
    """
    adultAvailability(personId: ID!, from: String!, to: String!): [AvailabilityWindow!]!

    """
    Who has the child on a date and which rule produced it: an APPROVED holiday arrangement first
    (its interval is inclusive at both ends), otherwise the weekly schedule.
    """
    effectiveScheduleFor(childId: ID!, date: String!): EffectiveSchedule!

    """
    Overlaps and gaps in parenting coverage for a window. Surfaced, never resolved silently.
    """
    scheduleConflicts(childId: ID!, from: String!, to: String!): [ScheduleConflict!]!
  }

  type Child @key(fields: "id") {
    id: ID!
  }

  type Event {
    id: ID!
    child: Child!
    title: String!
    start: String!
    end: String!
    location: String
  }

  type Person @key(fields: "id") {
    id: ID!
  }

  type CalendarEvent {
    id: ID!
    child: Child!
    title: String!
    start: String!
    end: String!
    location: String
    """proposed | confirmed | cancelled"""
    status: String!
  }

  """Busy/Free only. The reason is private to its owner and is not part of this type."""
  type AvailabilityWindow {
    person: Person!
    start: String!
    end: String!
    """BUSY | FREE — recorded state, never a statement of consent or willingness."""
    state: String!
  }

  type EffectiveSchedule {
    parent: Person
    """ARRANGEMENT | WEEKLY — which rule produced the answer."""
    source: String!
    arrangementId: ID
  }

  type ScheduleConflict {
    """OVERLAP | GAP"""
    kind: String!
    onDay: String!
    arrangementIds: [ID!]!
    detail: String!
  }
`);

const resolvers = {
  Query: {
    events: async (_: unknown, { childId, date }: { childId: string; date: string }, ctx: Ctx) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const data = await rows(
        dbFor(ctx)
          .from('events')
          .select('id,child_id,title,start_at,end_at,location')
          .eq('child_id', childId),
      );
      return data
        .filter((e) => String(e.start_at).startsWith(date.slice(0, 10)))
        .map((e) => ({
          id: String(e.id),
          child: { id: String(e.child_id) },
          title: String(e.title),
          start: String(e.start_at),
          end: String(e.end_at),
          location: (e.location as string | null) ?? null,
        }));
    },

    childEvents: async (
      _: unknown,
      { childId, from, to, includeCancelled }: { childId: string; from: string; to: string; includeCancelled?: boolean },
      ctx: Ctx,
    ) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const data = await rows(
        dbFor(ctx)
          .from('events')
          .select('id,child_id,title,start_at,end_at,location,status')
          .eq('child_id', childId)
          .gte('start_at', `${from}T00:00:00`)
          .lte('start_at', `${to}T23:59:59`),
      );
      return data
        .filter((e) => includeCancelled === true || String(e.status ?? 'confirmed') !== 'cancelled')
        .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
        .map((e) => ({
          id: String(e.id),
          child: { id: String(e.child_id) },
          title: String(e.title),
          start: String(e.start_at),
          end: String(e.end_at),
          location: (e.location as string | null) ?? null,
          status: String(e.status ?? 'confirmed'),
        }));
    },

    /**
     * Busy/Free only. Reads the masking view, never the base table, so a `reason` cannot leak even
     * if a future policy on the table were widened. The view itself decides who may see whose row.
     */
    adultAvailability: async (
      _: unknown,
      { personId, from, to }: { personId: string; from: string; to: string },
      ctx: Ctx,
    ) => {
      requireCaller(ctx);
      const data = await rows(
        dbFor(ctx)
          .from('adult_availability_free_busy')
          .select('person_id,start_at,end_at,state')
          .eq('person_id', personId)
          .gte('start_at', `${from}T00:00:00Z`)
          .lte('start_at', `${to}T23:59:59Z`),
      );
      return data
        .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
        .map((a) => ({
          person: { id: String(a.person_id) },
          start: String(a.start_at),
          end: String(a.end_at),
          state: String(a.state),
        }));
    },

    effectiveScheduleFor: async (
      _: unknown,
      { childId, date }: { childId: string; date: string },
      ctx: Ctx,
    ) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const { data, error } = await dbFor(ctx).rpc('effective_schedule_for', {
        p_child: childId,
        p_day: date,
      });
      if (error) throw error;
      const row = (data as Array<{ parent_id: string | null; source: string; arrangement_id: string | null }> | null)?.[0];
      return {
        parent: row?.parent_id ? { id: String(row.parent_id) } : null,
        source: row?.source ?? 'WEEKLY',
        arrangementId: row?.arrangement_id ? String(row.arrangement_id) : null,
      };
    },

    scheduleConflicts: async (
      _: unknown,
      { childId, from, to }: { childId: string; from: string; to: string },
      ctx: Ctx,
    ) => {
      await authorizeChild(ctx, childId, SCOPE.schedule);
      const { data, error } = await dbFor(ctx).rpc('schedule_conflicts', {
        p_child: childId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data as Array<{ kind: string; on_day: string; arrangement_ids: string[] | null; detail: string }> | null ?? []).map(
        (r) => ({
          kind: String(r.kind),
          onDay: String(r.on_day),
          arrangementIds: (r.arrangement_ids ?? []).map(String),
          detail: String(r.detail),
        }),
      );
    },
  },

  Event: {
    child: (e: { child: { id: string }; childId?: string }) => e.child ?? { id: e.childId },
  },

  CalendarEvent: {
    child: (e: { child: { id: string } }) => e.child,
  },

  AvailabilityWindow: {
    person: (a: { person: { id: string } }) => a.person,
  },

  EffectiveSchedule: {
    parent: (e: { parent: { id: string } | null }) => e.parent,
  },
};

export default { typeDefs, resolvers };
