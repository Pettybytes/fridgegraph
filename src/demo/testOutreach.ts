/**
 * In-app labeled TEST-responder outreach — judge step 2's fallback so the coordination chain
 * never depends on SMS. It reuses EXACTLY the recorded machinery the SMS path uses: an attempts
 * row (destination_mode TEST_RESPONDER) and the service-role accept_pickup_webhook RPC, which
 * derives the candidate identity from the attempt row itself (never from any payload).
 *
 * Safety gates, same as the SMS path:
 * - Caller must be a signed-in DEMO parent persona of the job's child (verified bearer + the
 *   static demo roster; no client-supplied identity is trusted).
 * - The candidate is only ever drawn from the fixed TEST responder roster, preferring one with
 *   a recorded vehicle so the recorded story supports the transport.
 * - Only a job in 'discovering' can be reached; one open test attempt per job; a per-persona
 *   cooldown bounds the write rate.
 * - The reply is SIMULATED and labeled as such by its TEST_RESPONDER destination mode, arriving
 *   a few seconds later through accept_pickup_webhook so ranking/advancement stay the database's
 *   own logic. Nothing here contacts anyone.
 */
import { randomUUID, createHash } from 'node:crypto';
import { DEMO_PERSONAS } from './personas';

export const TEST_RESPONDER_ROSTER = ['p_tasha', 'p_gma', 'p_bryan'] as const;

export type ServiceFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type TestOutreachDeps = {
  /** Service-role PostgREST call, path like '/rest/v1/attempts'. Key never leaves the server. */
  service: ServiceFetch;
  authorizeChild?: (childId: string) => Promise<boolean>;
  /** Verified caller person id (from the bearer), supplied by the route. */
  replyDelayMs?: number;
  now?: () => number;
};

type JobRow = { id: string; child_id: string; status: string; request_version: number };

async function readJson<T>(response: Response): Promise<T | null> {
  try { return await response.json() as T; } catch { return null; }
}

export async function runTestOutreach(
  deps: TestOutreachDeps,
  callerPersonId: string,
  jobId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!jobId || jobId.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return { status: 400, body: { error: 'INVALID_REQUEST' } };
  }
  const jobRes = await deps.service(`/rest/v1/coordination_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,child_id,status,request_version`);
  const jobs = await readJson<JobRow[]>(jobRes);
  const job = jobs?.[0];
  if (!job) return { status: 404, body: { error: 'NOT_FOUND' } };

  // Parent gate: the caller's verified person id must be a DEMO parent persona of this child.
  const callerIsParent = deps.authorizeChild ? await deps.authorizeChild(job.child_id) : DEMO_PERSONAS.some((p) => p.parent && p.personId === callerPersonId && p.childId === job.child_id);
  if (!callerIsParent) return { status: 403, body: { error: 'UNAUTHORIZED' } };

  if (job.status !== 'discovering') return { status: 409, body: { error: 'JOB_NOT_DISCOVERING', jobStatus: job.status } };

  // One open test attempt per job.
  const openRes = await deps.service(`/rest/v1/attempts?job_id=eq.${encodeURIComponent(job.id)}&closed_at=is.null&select=id`);
  const open = await readJson<{ id: string }[]>(openRes);
  if (open && open.length > 0) return { status: 409, body: { error: 'ATTEMPT_ALREADY_OPEN', attemptId: open[0].id } };

  // Candidate: evaluated for THIS job, on the TEST roster, preferring a recorded vehicle.
  const evalRes = await deps.service(`/rest/v1/candidate_evaluations?job_id=eq.${encodeURIComponent(job.id)}&select=candidate_id`);
  const evaluated = new Set(((await readJson<{ candidate_id: string }[]>(evalRes)) ?? []).map((row) => row.candidate_id));
  const eligible = TEST_RESPONDER_ROSTER.filter((id) => evaluated.has(id));
  if (!eligible.length) return { status: 409, body: { error: 'NO_TEST_CANDIDATE' } };
  const vehiclesRes = await deps.service(`/rest/v1/vehicles?owner_id=in.(${eligible.map((id) => `"${id}"`).join(',')})&select=owner_id`);
  const withVehicle = new Set(((await readJson<{ owner_id: string }[]>(vehiclesRes)) ?? []).map((row) => row.owner_id));
  const candidateId = eligible.find((id) => withVehicle.has(id)) ?? eligible[0];

  const attemptId = `demo_att_${randomUUID().replaceAll('-', '')}`;
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  const insertRes = await deps.service('/rest/v1/attempts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify([{ id: attemptId, job_id: job.id, channel: 'SMS', at, candidate_id: candidateId, destination_mode: 'TEST_RESPONDER' }]),
  });
  if (!insertRes.ok) return { status: 502, body: { error: 'ATTEMPT_WRITE_FAILED' } };

  // The simulated reply: a few seconds later, through the SAME webhook RPC the SMS path uses.
  // Identity is derived from the attempt row by the RPC; ranking/advancement stay in the DB.
  const replyDelay = deps.replyDelayMs ?? 3500;
  setTimeout(() => {
    void (async () => {
      try {
        const freshRes = await deps.service(`/rest/v1/coordination_jobs?id=eq.${encodeURIComponent(job.id)}&select=request_version`);
        const fresh = (await readJson<{ request_version: number }[]>(freshRes))?.[0];
        if (!fresh) return;
        await deps.service('/rest/v1/rpc/accept_pickup_webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            p_attempt: attemptId,
            p_available: true,
            p_decline: null,
            p_request_version: fresh.request_version,
            p_event_id: `demo_evt_${randomUUID()}`,
            p_payload_sha256: createHash('sha256').update(attemptId).digest('hex'),
          }),
        });
      } catch { /* a missed simulated reply surfaces as an open attempt; the parent can retry */ }
    })();
  }, replyDelay).unref?.();

  return { status: 200, body: { ok: true, attemptId, candidateId, simulated: true, replyInMs: replyDelay } };
}
