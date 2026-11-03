/**
 * REAL GraphQL execution against the coordination subgraph's own typeDefs + resolvers — built with
 * @apollo/subgraph's buildSubgraphSchema, the exact function src/server.ts uses to serve this
 * subgraph for real (not a hand call to a resolver function, and not a check against raw SQL
 * columns). Proves the client read contract this PR adds:
 *   - CandidateEvaluation.voiceNoteId links an authorized response to its voice note (0084's
 *     voice_notes.response_id, from the OTHER side).
 *   - VoiceNote.responseId, documented as required in docs/contracts/demo-history.schema.json,
 *     round-trips.
 *   - turnTimings survives a REAL (non-empty) case, not just the null the demo-history fixtures
 *     currently ship (every voice note there is still PENDING — see fixtures-demo-history.ts).
 *
 * A fake, in-memory Postgres-shaped client stands in for dbFor(ctx) (ctx.db directly — db.ts
 * returns it before needing a token/env var), same technique as school-report.test.ts. This proves
 * the GraphQL + resolver + mapping layer; it does NOT exercise Postgres RLS itself (voice_notes_read,
 * candidate_evaluations' own policies) — that half needs a live proof against a real database.
 *
 * Run with: node --import tsx --test src/subgraphs/coordination.voiceNoteContract.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphql } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import coordinationSubgraph from './coordination';
import type { Ctx } from '../authz';

type Row = Record<string, unknown>;

/** Minimal fake of the chainable subset of supabase-js this test's resolvers actually use. */
class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  constructor(private table: Row[]) {}
  select(_cols?: string) { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  then<T1, T2 = never>(
    onfulfilled?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    const matched = this.table.filter((r) => this.filters.every((f) => f(r)));
    return Promise.resolve({ data: matched, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeDb {
  constructor(private tables: Record<string, Row[]>) {}
  from(name: string) {
    if (!this.tables[name]) this.tables[name] = [];
    return new FakeQuery(this.tables[name]);
  }
}

const schema = buildSubgraphSchema([
  { typeDefs: coordinationSubgraph.typeDefs, resolvers: coordinationSubgraph.resolvers as never },
]);

function ctxWith(tables: Record<string, Row[]>): Ctx {
  return { callerId: 'p_mom', today: '2026-10-21', db: new FakeDb(tables) as never };
}

test('CandidateEvaluation.voiceNoteId links to the real voice note, and VoiceNote.responseId points back, under REAL graphql execution', async () => {
  const tables: Record<string, Row[]> = {
    coordination_jobs: [
      { id: 'job_t1', idempotency_key: 'k1', type: 'PICKUP', child_id: 'p_nora', status: 'confirmed', version: 1, over_limit_candidate_id: null },
    ],
    candidate_evaluations: [
      {
        id: 'ce_t1', job_id: 'job_t1', candidate_id: 'p_gma', reason_code: 'RECOMMENDED', available: true,
        decline_reason: null, accepted_via: 'CANDIDATE_JWT', estimated_ride_cost_usd: null, cost_basis: null,
        distance_miles: null, location_provenance: null, cost_calculated_at: null,
        responded_at: '2026-10-21T16:08:00.000Z', response_kind: 'ACCEPTED',
      },
    ],
    voice_notes: [
      {
        // READY: the delivered case — real transcript/duration/storage/hash all present.
        // proposedScript (the authored TTS input) stays populated even once READY — it is never
        // cleared or replaced by the transcript (data/demo-voice/README.md: "a transcript is
        // never replaced by its script"), the two are permanently distinct fields.
        id: 'vn_t1', response_id: 'ce_t1', speaker_person_id: 'p_gma', status: 'READY',
        proposed_script: 'Of course, I can grab her at three.',
        transcript: 'Of course — I can grab her at three.', duration_seconds: 9.8,
        // Pre-shaped exactly to the GraphQL contract (docs/contracts/demo-history.schema.json's
        // turnTiming $def) — the resolver passes turn_timings through verbatim, with no transform.
        turn_timings: [
          { speaker: { id: 'p_mom' }, startSec: 0, endSec: 4.5 },
          { speaker: { id: 'p_gma' }, startSec: 4.5, endSec: 9.8 },
        ],
        created_at: '2026-10-21T16:08:05.000Z',
      },
    ],
  };

  const query = `
    query {
      coordinationJobs(childId: "p_nora") {
        id
        candidateEvaluations {
          id
          responseKind
          respondedAt
          voiceNoteId
        }
      }
      voiceNote(id: "vn_t1") {
        id
        responseId
        status
        transcript
        proposedScript
        turnTimings {
          speaker { id }
          startSec
          endSec
        }
      }
    }
  `;

  const result = await graphql({ schema, source: query, contextValue: ctxWith(tables) });

  assert.deepEqual(result.errors, undefined, `expected no GraphQL errors, got ${JSON.stringify(result.errors)}`);
  const data = result.data as {
    coordinationJobs: Array<{ id: string; candidateEvaluations: Array<Record<string, unknown>> }>;
    voiceNote: Record<string, unknown>;
  };

  const ce = data.coordinationJobs[0].candidateEvaluations[0];
  assert.equal(ce.id, 'ce_t1');
  assert.equal(ce.responseKind, 'ACCEPTED');
  assert.equal(ce.respondedAt, '2026-10-21T16:08:00.000Z');
  assert.equal(ce.voiceNoteId, 'vn_t1', 'the authorized response -> voiceNoteId link must resolve');

  assert.equal(data.voiceNote.id, 'vn_t1');
  assert.equal(data.voiceNote.responseId, 'ce_t1', 'VoiceNote.responseId must round-trip to the response it was recorded against');
  assert.equal(data.voiceNote.status, 'READY');
  assert.equal(data.voiceNote.transcript, 'Of course — I can grab her at three.');
  assert.equal(data.voiceNote.proposedScript, 'Of course, I can grab her at three.', 'proposedScript is never cleared by delivery — script and transcript stay permanently distinct, even once READY');
  const turns = data.voiceNote.turnTimings as Array<{ speaker: { id: string }; startSec: number; endSec: number }>;
  assert.equal(turns.length, 2, 'non-empty turnTimings must survive real execution, not just a null case');
  assert.equal(turns[0].speaker.id, 'p_mom');
  assert.equal(turns[1].endSec, 9.8);
});

test('a response with no voice note gets voiceNoteId: null — no existence oracle', async () => {
  const tables: Record<string, Row[]> = {
    coordination_jobs: [
      { id: 'job_t2', idempotency_key: 'k2', type: 'PICKUP', child_id: 'p_nora', status: 'awaiting_approval', version: 1, over_limit_candidate_id: null },
    ],
    candidate_evaluations: [
      {
        id: 'ce_t2', job_id: 'job_t2', candidate_id: 'p_walter', reason_code: 'RECOMMENDED', available: true,
        decline_reason: null, accepted_via: 'CANDIDATE_JWT', estimated_ride_cost_usd: null, cost_basis: null,
        distance_miles: null, location_provenance: null, cost_calculated_at: null,
        responded_at: '2026-10-21T11:09:00.000Z', response_kind: 'ACCEPTED',
      },
    ],
    voice_notes: [],
  };

  const result = await graphql({
    schema,
    source: `query { coordinationJobs(childId: "p_nora") { candidateEvaluations { voiceNoteId } } }`,
    contextValue: ctxWith(tables),
  });

  assert.deepEqual(result.errors, undefined);
  const data = result.data as { coordinationJobs: Array<{ candidateEvaluations: Array<{ voiceNoteId: null }> }> };
  assert.equal(data.coordinationJobs[0].candidateEvaluations[0].voiceNoteId, null);
});

test('a PENDING voice note exposes its proposed script, never a delivered transcript', async () => {
  const tables: Record<string, Row[]> = {
    voice_notes: [
      {
        id: 'vn_t3', response_id: 'ce_t3', speaker_person_id: 'p_priya', status: 'PENDING',
        proposed_script: "Hi Kendra, it's Priya — yes, I can grab Nora at 3:30.",
        transcript: null, duration_seconds: null, turn_timings: null,
        created_at: '2026-10-12T16:08:05.000Z',
      },
    ],
  };

  const result = await graphql({
    schema,
    source: `query { voiceNote(id: "vn_t3") { status transcript proposedScript durationSeconds } }`,
    contextValue: ctxWith(tables),
  });

  assert.deepEqual(result.errors, undefined, `expected no GraphQL errors, got ${JSON.stringify(result.errors)}`);
  const data = result.data as { voiceNote: Record<string, unknown> };
  assert.equal(data.voiceNote.status, 'PENDING');
  assert.equal(data.voiceNote.transcript, null, 'a PENDING note must never present a delivered transcript');
  assert.equal(data.voiceNote.proposedScript, "Hi Kendra, it's Priya — yes, I can grab Nora at 3:30.");
  assert.equal(data.voiceNote.durationSeconds, null);
});
