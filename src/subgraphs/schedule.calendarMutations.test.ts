/**
 * REAL GraphQL execution against the schedule subgraph's own typeDefs + resolvers (buildSubgraphSchema,
 * the same call src/server.ts uses) for the parent calendar-editing mutations added with migration
 * 0095. A fake supabase-shaped client stands in for dbFor(ctx) (ctx.db directly), capturing the
 * single rpc call each resolver makes. This proves the GraphQL + resolver + mapping + authz-forwarding
 * layer; it does NOT exercise the SQL function's own is_parent_of guard — that half needs a live DB.
 *
 * Run with: node --import tsx --test src/subgraphs/schedule.calendarMutations.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphql } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import scheduleSubgraph from './schedule';
import type { Ctx } from '../authz';

type Row = Record<string, unknown>;

/** Captures each rpc(fn, args) and replies with a preset result (or error) per function name. */
class FakeDb {
  calls: Array<{ fn: string; args: Row }> = [];
  constructor(private replies: Record<string, { data?: unknown; error?: { code?: string; message?: string } }>) {}
  rpc(fn: string, args: Row) {
    this.calls.push({ fn, args });
    const r = this.replies[fn] ?? { data: null };
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  }
}

const schema = buildSubgraphSchema([
  { typeDefs: scheduleSubgraph.typeDefs, resolvers: scheduleSubgraph.resolvers as never },
]);

function ctx(db: FakeDb, over: Partial<Ctx> = {}): Ctx {
  return { callerId: 'p_mom', today: '2026-11-04', db: db as never, ...over };
}

const EVENT_ROW: Row = {
  id: 'ev-abc', child_id: 'p_nora', title: 'Dentist', start_at: '2026-11-12T15:00:00',
  end_at: '2026-11-12T15:45:00', location: 'Maple Dental', status: 'confirmed',
  notes: 'bring insurance card', color: '#2f9e8f',
};

test('createCalendarEvent forwards the fixed args to create_calendar_event and maps the row (time not reshaped)', async () => {
  const db = new FakeDb({ create_calendar_event: { data: EVENT_ROW } });
  const result = await graphql({
    schema,
    source: `mutation {
      createCalendarEvent(childId: "p_nora", title: "Dentist", start: "2026-11-12T15:00:00", end: "2026-11-12T15:45:00", location: "Maple Dental", notes: "bring insurance card", color: "#2f9e8f") {
        id child { id } title start end location status notes color
      }
    }`,
    contextValue: ctx(db),
  });
  assert.deepEqual(result.errors, undefined, JSON.stringify(result.errors));
  const ev = (result.data as { createCalendarEvent: Row }).createCalendarEvent;
  assert.equal(ev.id, 'ev-abc');
  assert.equal((ev.child as { id: string }).id, 'p_nora');
  assert.equal(ev.start, '2026-11-12T15:00:00', 'the recorded wall-clock time is passed through unshifted');
  assert.equal(ev.notes, 'bring insurance card');
  assert.equal(ev.color, '#2f9e8f');
  // Exactly one write, with the documented argument set and no caller-influenced extras.
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].fn, 'create_calendar_event');
  assert.deepEqual(db.calls[0].args, {
    p_child: 'p_nora', p_title: 'Dentist', p_start: '2026-11-12T15:00:00', p_end: '2026-11-12T15:45:00',
    p_location: 'Maple Dental', p_notes: 'bring insurance card', p_color: '#2f9e8f', p_status: 'confirmed',
  });
});

test('updateCalendarEvent and deleteCalendarEvent call their own functions', async () => {
  const db = new FakeDb({ update_calendar_event: { data: { ...EVENT_ROW, title: 'Dentist (moved)' } }, delete_calendar_event: { data: 'ev-abc' } });
  const up = await graphql({
    schema,
    source: `mutation { updateCalendarEvent(id: "ev-abc", title: "Dentist (moved)", start: "2026-11-12T16:00:00", end: "2026-11-12T16:45:00") { id title } }`,
    contextValue: ctx(db),
  });
  assert.deepEqual(up.errors, undefined, JSON.stringify(up.errors));
  assert.equal((up.data as { updateCalendarEvent: Row }).updateCalendarEvent.title, 'Dentist (moved)');
  assert.equal(db.calls[0].fn, 'update_calendar_event');
  assert.equal(db.calls[0].args.p_id, 'ev-abc');

  const del = await graphql({ schema, source: `mutation { deleteCalendarEvent(id: "ev-abc") }`, contextValue: ctx(db) });
  assert.deepEqual(del.errors, undefined, JSON.stringify(del.errors));
  assert.equal((del.data as { deleteCalendarEvent: string }).deleteCalendarEvent, 'ev-abc');
  assert.equal(db.calls[1].fn, 'delete_calendar_event');
});

test('a demo guide is refused before any write (read-only)', async () => {
  const db = new FakeDb({ create_calendar_event: { data: EVENT_ROW } });
  const result = await graphql({
    schema,
    source: `mutation { createCalendarEvent(childId: "p_nora", title: "x", start: "2026-11-12T15:00:00", end: "2026-11-12T15:45:00") { id } }`,
    contextValue: ctx(db, { demoGuide: true }),
  });
  assert.ok(result.errors && result.errors.length > 0, 'a guide must be refused');
  assert.equal(result.errors![0].extensions?.code, 'DEMO_GUIDE_READ_ONLY');
  assert.equal(db.calls.length, 0, 'no write may reach the database for a guide');
});

test('a non-parent FORBIDDEN from the DB surfaces as UNAUTHORIZED, never the raw error', async () => {
  const db = new FakeDb({ create_calendar_event: { error: { code: '42501', message: 'FORBIDDEN' } } });
  const result = await graphql({
    schema,
    source: `mutation { createCalendarEvent(childId: "p_nora", title: "x", start: "2026-11-12T15:00:00", end: "2026-11-12T15:45:00") { id } }`,
    contextValue: ctx(db),
  });
  assert.ok(result.errors && result.errors.length > 0);
  assert.equal(result.errors![0].extensions?.code, 'UNAUTHORIZED');
  assert.ok(!/FORBIDDEN|42501/.test(result.errors![0].message), 'the raw DB error must not leak');
});

test('the schema exposes the three mutations and CalendarEvent.notes/color', async () => {
  const intro = await graphql({
    schema,
    source: `{ __type(name: "Mutation") { fields { name } } notes: __type(name: "CalendarEvent") { fields { name } } }`,
  });
  const mut = (intro.data as { __type: { fields: Array<{ name: string }> } }).__type.fields.map((f) => f.name);
  for (const m of ['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent']) assert.ok(mut.includes(m), `missing mutation ${m}`);
  const ce = (intro.data as { notes: { fields: Array<{ name: string }> } }).notes.fields.map((f) => f.name);
  assert.ok(ce.includes('notes') && ce.includes('color'), 'CalendarEvent must expose notes and color');
});
