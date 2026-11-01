/**
 * Day-read tests — the transport contract, not the happy path.
 *
 * These run with a STUBBED database transport, so they execute without applying migration 0061:
 * `event_day_places` does not exist in the live database yet, and a test that needed it applied
 * would be untestable exactly when it matters.
 *
 * Each case exists because it is a plausible way to lie to a parent:
 *  - reading with a token that is not the caller's own;
 *  - asking for the wrong child or the wrong day;
 *  - turning a withheld link into "no place", or an unlinked event into a place;
 *  - rendering a failed lookup as "nothing on the calendar".
 *
 * Run offline: node --import tsx --test src/village/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbDayTransport, isDay, readDayPlan, toDayPlan, type DayPlaceRow, type DayTransport } from './dayPlaces';
import type { Ctx } from '../authz';

const TOKEN = 'stub-bearer-not-a-credential';
const DAY = '2026-11-07';

const LINKED: DayPlaceRow = {
  event_id: 'e1', title: 'Soccer', start_at: '2026-11-07T15:00:00',
  state: 'linked', place_id: 'rp_field', place_label: 'Riverside Park',
};
const WITHHELD: DayPlaceRow = {
  event_id: 'e2', title: 'Dentist', start_at: '2026-11-07T10:00:00',
  state: 'withheld', place_id: null, place_label: null,
};
const UNLINKED: DayPlaceRow = {
  event_id: 'e3', title: 'Piano', start_at: '2026-11-07T18:00:00',
  state: 'unlinked', place_id: null, place_label: null,
};

/** Records every call; returns whatever the case says. */
function stub(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const calls: Array<{ token: string; childId: string; day: string }> = [];
  const transport: DayTransport = async (args) => {
    calls.push(args);
    return { data: result.data ?? null, error: result.error ?? null };
  };
  return { transport, calls };
}

test('the caller’s own bearer reaches the transport, unchanged', async () => {
  const { transport, calls } = stub({ data: [LINKED] });
  const read = await readDayPlan(transport, { token: TOKEN, childId: 'p_nora', day: DAY });

  assert.equal(read.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, TOKEN);
});

test('the child and day arguments are the requested ones — never defaulted or re-derived', async () => {
  const { transport, calls } = stub({ data: [] });
  await readDayPlan(transport, { token: TOKEN, childId: 'p_nora', day: DAY });

  assert.deepEqual(calls[0], { token: TOKEN, childId: 'p_nora', day: DAY });
});

test('the RPC is called with the accessor’s argument names: p_child and p_day', async () => {
  // A fake RLS client on the request context: dbFor() reuses ctx.db, so no network and no Supabase.
  const seen: Array<{ fn: string; args: unknown }> = [];
  const ctx = {
    today: DAY,
    token: TOKEN,
    db: {
      rpc: async (fn: string, args: unknown) => {
        seen.push({ fn, args });
        return { data: [LINKED], error: null };
      },
    },
  } as unknown as Ctx;

  const read = await readDayPlan(dbDayTransport(ctx), { token: TOKEN, childId: 'p_nora', day: DAY });

  assert.equal(read.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].fn, 'event_day_places');
  assert.deepEqual(seen[0].args, { p_child: 'p_nora', p_day: DAY });
});

test('a transport call with a token other than the request’s own is refused, not executed', async () => {
  let rpcTouched = false;
  const ctx = {
    today: DAY,
    token: TOKEN,
    db: { rpc: async () => { rpcTouched = true; return { data: [], error: null }; } },
  } as unknown as Ctx;

  const read = await readDayPlan(dbDayTransport(ctx), { token: 'somebody-elses-token', childId: 'p_nora', day: DAY });

  assert.deepEqual(read, { ok: false, reason: 'LOOKUP_FAILED' });
  assert.equal(rpcTouched, false, 'a foreign token must not reach the database');
});

test('linked rows carry the authorized place, and every existing day-plan field is preserved', async () => {
  const read = await readDayPlan(
    stub({ data: [LINKED, WITHHELD, UNLINKED] }).transport,
    { token: TOKEN, childId: 'p_nora', day: DAY },
  );
  assert.equal(read.ok, true);
  if (!read.ok) return;

  assert.equal(read.plan.date, DAY);
  assert.deepEqual(read.plan.items[0], {
    eventId: 'e1', title: 'Soccer', at: '2026-11-07T15:00:00',
    placeId: 'rp_field', placeName: 'Riverside Park', placeState: 'linked',
  });
  // Order is the accessor's (start_at, id) — the read does not re-sort.
  assert.deepEqual(read.plan.items.map((i) => i.eventId), ['e1', 'e2', 'e3']);
});

test('unlinked and withheld are distinct states, and neither exposes an id or a label', async () => {
  const read = await readDayPlan(
    // Deliberately hostile rows: a withheld link that still names the place, an unlinked event
    // that still carries one. Neither may be echoed.
    stub({
      data: [
        { ...WITHHELD, place_id: 'rp_dentist', place_label: 'Dentist Office' },
        { ...UNLINKED, place_id: 'rp_piano', place_label: 'Music School' },
      ],
    }).transport,
    { token: TOKEN, childId: 'p_nora', day: DAY },
  );
  assert.equal(read.ok, true);
  if (!read.ok) return;

  const [withheld, unlinked] = read.plan.items;
  assert.equal(withheld.placeState, 'withheld');
  assert.equal(withheld.placeId, null);
  assert.equal(withheld.placeName, null);

  assert.equal(unlinked.placeState, 'unlinked');
  assert.equal(unlinked.placeId, null);
  assert.equal(unlinked.placeName, null);
});

test('no item carries geometry — the day read is not a coordinate path', async () => {
  const read = await readDayPlan(stub({ data: [LINKED] }).transport, { token: TOKEN, childId: 'p_nora', day: DAY });
  assert.equal(read.ok, true);
  if (!read.ok) return;

  const keys = Object.keys(read.plan.items[0]).sort();
  assert.deepEqual(keys, ['at', 'eventId', 'placeId', 'placeName', 'placeState', 'title']);
});

test('a failed lookup is LOOKUP_FAILED — never an empty day', async () => {
  const read = await readDayPlan(
    stub({ error: { code: 'PGRST202', message: 'Could not find the function' } }).transport,
    { token: TOKEN, childId: 'p_nora', day: DAY },
  );
  assert.deepEqual(read, { ok: false, reason: 'LOOKUP_FAILED' });
});

test('a malformed payload fails closed instead of guessing a state or a place', async () => {
  const cases: unknown[] = [
    null,                                   // no payload at all
    { items: [] },                          // right-ish name, wrong shape
    [{ ...LINKED, state: 'granted' }],      // a state the contract does not define
    [{ ...LINKED, state: 'linked', place_label: null }],  // half a link
    [{ ...LINKED, start_at: null }],        // nothing to order the day by
  ];
  for (const data of cases) {
    const read = await readDayPlan(stub({ data }).transport, { token: TOKEN, childId: 'p_nora', day: DAY });
    assert.deepEqual(read, { ok: false, reason: 'LOOKUP_FAILED' }, `payload: ${JSON.stringify(data)}`);
  }
});

test('an empty result is a real answer: nothing scheduled, or nothing shared', async () => {
  const read = await readDayPlan(stub({ data: [] }).transport, { token: TOKEN, childId: 'p_nora', day: DAY });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.plan, { date: DAY, items: [] });
});

test('no token, no child, or a non-date day never reaches the database', async () => {
  const { transport, calls } = stub({ data: [] });
  for (const args of [
    { token: '', childId: 'p_nora', day: DAY },
    { token: TOKEN, childId: '', day: DAY },
    { token: TOKEN, childId: 'p_nora', day: '2026-11-7' },
    { token: TOKEN, childId: 'p_nora', day: 'yesterday' },
    { token: TOKEN, childId: 'p_nora', day: '2026-11-07T00:00:00Z' },
  ]) {
    const read = await readDayPlan(transport, args);
    assert.deepEqual(read, { ok: false, reason: 'LOOKUP_FAILED' }, `args: ${JSON.stringify(args)}`);
  }
  assert.equal(calls.length, 0);
});

test('the day argument accepts a plain calendar date only', () => {
  assert.equal(isDay('2026-11-07'), true);
  assert.equal(isDay('2026-11-07T00:00'), false);
  assert.equal(isDay('07/11/2026'), false);
});

test('toDayPlan is strict on its own: an unknown state throws rather than mapping', () => {
  assert.throws(() => toDayPlan([{ ...LINKED, state: 'whatever' }], DAY), /DAY_STATE_UNKNOWN/);
});
