/**
 * Illustrative public fixture for the "One plan, three perspectives" replay.
 * Not a jobTimeline read, not an authorization read, no API calls. Every id in
 * the trace (child_nora, job_01, att_01) is fictional; the operation and field
 * names mirror the real schema (src/subgraphs, ops/*.graphql) so the trace is
 * honest about what runs under the hood without exposing a real record.
 *
 * Beat times are keyed to the measured narration segments in
 * assets/replay-narration.json so audio and visuals stay in sync.
 */
export const STORY_DATE_LABEL = 'Monday, November 2, 2026'
export const REPLAY_DURATION_MS = 44000
/** Phone 1 shows the app home screen until the notice lands. */
export const HOME_UNTIL_MS = 2600

export type JourneyKind = 'notice' | 'rosina' | 'parent-action' | 'request' | 'reply' | 'confirmed' | 'today'
export type JourneyEvent = Readonly<{ id: string; atMs: number; kind: JourneyKind; title: string; body: string; detail?: string }>

/** Nora's whole path on the one parent phone (Kendra). */
export const PARENT_JOURNEY: readonly JourneyEvent[] = [
  { id: 'notice', atMs: 2600, kind: 'notice', title: 'School notice', body: 'Early dismissal Monday, November 2 at 1:30 PM.', detail: 'Posted by Nora’s school.' },
  { id: 'proposal', atMs: 8600, kind: 'rosina', title: 'Rosina · proposal', body: 'Nora’s pickup is still recorded for 3:15 PM. She needs a new plan. Ask Loretta?', detail: 'Grounded in recorded schedule and candidates.' },
  { id: 'approve-request', atMs: 14200, kind: 'parent-action', title: 'Parent action · Kendra', body: 'Approve the outreach', detail: 'Recorded before any request left the family.' },
  { id: 'request-sent', atMs: 16200, kind: 'request', title: 'Pickup request sent', body: 'Loretta · test caregiver · Monday 1:30 PM.', detail: 'Simulated outreach to a test responder.' },
  { id: 'reply', atMs: 22400, kind: 'reply', title: 'Loretta replies', body: '“Yes, I can be there at 1.20. I’ll head I’ll head out now so I’m not rushing.”', detail: 'Voice note transcript, recorded offer.' },
  { id: 'confirm', atMs: 27950, kind: 'parent-action', title: 'Parent action · Kendra', body: 'Confirm Loretta for the pickup', detail: 'The offer waited for Kendra’s decision.' },
  { id: 'confirmed', atMs: 30400, kind: 'confirmed', title: 'Plan confirmed', body: 'Nora · Loretta · Monday at 1:30 PM.', detail: 'Confirmation recorded. Pickup completion is not recorded.' },
  { id: 'today', atMs: 33500, kind: 'today', title: 'Today', body: 'Monday pickup · Loretta confirmed.', detail: 'Activity and Mission Control updated.' },
] as const

export function journeyAt(elapsedMs: number): readonly JourneyEvent[] {
  return PARENT_JOURNEY.filter(event => event.atMs <= elapsedMs)
}

export type TraceTag = 'school' | 'muse' | 'mcp' | 'router' | 'coord' | 'rosina'
export type TraceLine = Readonly<{ id: string; atMs: number; tag: TraceTag; text: string }>

/**
 * The real call chain, replayed: Muse (Meta model) -> Rosina agent -> MCP tools
 * (ops/MyChildren.graphql, ChildEvents, PickupCandidates, JobTimeline) ->
 * Apollo Router -> subgraph operations (coordination.requestPickup,
 * acceptPickup, approvePickup). Ids are fictional.
 */
export const CALL_TRACE: readonly TraceLine[] = [
  { id: 't-boot', atMs: 0, tag: 'rosina', text: 'replay trace · demo flow · fictional ids' },
  { id: 't-notice', atMs: 900, tag: 'school', text: 'notice posted · earlyDismissal 13:30 · 2026-11-02' },
  { id: 't-turn', atMs: 2000, tag: 'muse', text: 'turn start · provider meta · Muse model · agent rosina' },
  { id: 't-mychildren', atMs: 8600, tag: 'mcp', text: 'tool MyChildren { myChildren { child { id } scopes } }' },
  { id: 't-r1', atMs: 9700, tag: 'router', text: 'POST /graphql · query MyChildren → access subgraph' },
  { id: 't-events', atMs: 10600, tag: 'mcp', text: 'tool ChildEvents(childId: "child_nora", from: "2026-11-02")' },
  { id: 't-r2', atMs: 11600, tag: 'router', text: 'query ChildEvents → schedule.childEvents · 2 rows' },
  { id: 't-cand', atMs: 12400, tag: 'mcp', text: 'tool PickupCandidates(childId: "child_nora", asOf: "13:30")' },
  { id: 't-r3', atMs: 13300, tag: 'router', text: 'query PickupCandidates → coordination · 4 candidates' },
  { id: 't-prop', atMs: 14300, tag: 'rosina', text: 'proposal ready · waiting for parent approval' },
  { id: 't-req', atMs: 16200, tag: 'router', text: 'mutation requestPickup(childId: "child_nora", window: "13:30")' },
  { id: 't-job', atMs: 17600, tag: 'coord', text: 'CoordinationJob job_01 created · status OUTREACH' },
  { id: 't-att', atMs: 18800, tag: 'coord', text: 'attempt att_01 opened · Loretta · destinationMode TEST_RESPONDER' },
  { id: 't-accept', atMs: 22600, tag: 'router', text: 'mutation acceptPickup(attemptId: "att_01", available: true)' },
  { id: 't-eval', atMs: 24100, tag: 'coord', text: 'CandidateEvaluation · Loretta · arrival 13:20 offered' },
  { id: 't-approve', atMs: 28100, tag: 'router', text: 'mutation approvePickup(jobId: "job_01", version: 3, decision: APPROVE)' },
  { id: 't-confirm', atMs: 29600, tag: 'coord', text: 'CONFIRMATION recorded · the parent decision controls the plan' },
  { id: 't-timeline', atMs: 33600, tag: 'mcp', text: 'tool JobTimeline(jobId: "job_01") → 5 entries' },
  { id: 't-done', atMs: 35000, tag: 'rosina', text: 'replay complete · Activity + Mission Control updated' },
] as const

/** Characters revealed per second by the typing animation. */
export const TYPE_SPEED = 55

export type RevealedLine = Readonly<{ line: TraceLine; chars: number; typing: boolean }>

export function traceAt(elapsedMs: number): readonly RevealedLine[] {
  const revealed: RevealedLine[] = []
  for (const line of CALL_TRACE) {
    if (line.atMs > elapsedMs) break
    // The boot line is fully present from the first frame; later lines type in.
    const chars = line.atMs === 0 ? line.text.length : Math.min(line.text.length, Math.floor((elapsedMs - line.atMs) / 1000 * TYPE_SPEED) + 1)
    revealed.push({ line, chars, typing: chars < line.text.length })
  }
  return revealed
}

/** Replay-clock label for a trace line: a fictional 13:29:56 base plus the beat offset. */
export function traceClock(atMs: number): string {
  const total = 13 * 3600_000 + 29 * 60_000 + 56_000 + atMs
  const h = Math.floor(total / 3600_000), m = Math.floor(total / 60_000) % 60, s = Math.floor(total / 1000) % 60
  const tenth = Math.floor(total / 100) % 10
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`
}

/** Phone 3 phases: route trace, then the Activity entry, then the Mission Control metric. */
export const ROUTE_START_MS = 33600
export const ROUTE_DURATION_MS = 4600
export const ACTIVITY_AT_MS = 38900
export const METRIC_AT_MS = 41000
export const LORETTA_PIN_AT_MS = 16200
export const PLAN_CONFIRMED_AT_MS = 30400

export function routeProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, (elapsedMs - ROUTE_START_MS) / ROUTE_DURATION_MS))
}

export function captionAt(elapsedMs: number): string {
  if (elapsedMs < 8444) return 'A school notice changes Nora’s day.'
  if (elapsedMs < 15579) return 'Rosina drafts a plan from recorded facts. Kendra decides.'
  if (elapsedMs < 22292) return 'With approval, the request goes to a test caregiver.'
  if (elapsedMs < 27825) return 'Loretta replies with a recorded offer.'
  if (elapsedMs < 33273) return 'Kendra confirms. The plan is recorded.'
  return 'The route, the activity log, and Mission Control update.'
}
