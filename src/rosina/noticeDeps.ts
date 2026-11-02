/**
 * Production wiring for the Notice → Plan endpoints: the schedule reader and the pickup requester,
 * both executed AS THE CALLER (the caller's bearer is forwarded to the router, never a service key).
 * Contract: docs/contracts/notice-plan.md §1.3, §5. Unit-tested behavior lives in the pure modules
 * and the endpoint tests with these deps stubbed; this file is the integration seam exercised at the
 * live-proof step. It logs only non-content metadata.
 */
import type { ScheduleReader, PickupRequester } from './noticeEndpoint';
import type { ScheduleEvent } from './noticeConflict';

/**
 * The GraphQL router URL the authorized reads + requestPickup run against, AS THE CALLER. There is
 * deliberately NO default and NO fallback to the MCP URL: the MCP endpoint is not a GraphQL endpoint,
 * so a silent `ROSINA_MCP_URL`-derived default (the old behavior) made every notice request fail
 * closed with 502 while the stack looked "up". If `ROSINA_GRAPHQL_URL` is unset, this throws so the
 * server fails fast at startup with a clear message instead of serving a broken feature.
 */
export function requireGraphqlUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.ROSINA_GRAPHQL_URL ?? '').trim();
  if (url) return url;
  throw new Error(
    'ROSINA_GRAPHQL_URL is required for the notice-plan feature and has no default. Set it to the ' +
      'GraphQL router (e.g. http://127.0.0.1:4012/) — NOT the MCP URL (ROSINA_MCP_URL / any /mcp ' +
      'endpoint). The authorized schedule read and requestPickup run as the caller against the ' +
      'router; pointing at the MCP port fails every notice request with 502.',
  );
}

type GqlError = { message?: string; extensions?: { code?: string } };

const EVENTS_QUERY = `
  query NoticeEvents($childId: ID!, $date: String!) {
    events(childId: $childId, date: $date) { id title start end location }
    effectiveScheduleFor(childId: $childId, date: $date) { source }
  }`;

const REQUEST_PICKUP = `
  mutation NoticeRequestPickup($childId: ID!, $asOf: String, $window: String) {
    requestPickup(childId: $childId, asOf: $asOf, window: $window) { id status }
  }`;

function isAuthCode(code?: string): boolean {
  return code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED' || code === 'FORBIDDEN';
}

async function gql<T>(
  url: string,
  bearer: string,
  query: string,
  variables: Record<string, unknown>,
  doFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<{ ok: true; data: T } | { ok: false; auth: boolean }> {
  const res = await doFetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) return { ok: false, auth: true };
  if (!res.ok) return { ok: false, auth: false };
  const body = (await res.json()) as { data?: T; errors?: GqlError[] };
  if (body.errors && body.errors.length > 0) {
    return { ok: false, auth: body.errors.some((e) => isAuthCode(e.extensions?.code)) };
  }
  if (!body.data) return { ok: false, auth: false };
  return { ok: true, data: body.data };
}

export type NoticeDepsConfig = {
  graphqlUrl: string;
  fetchFn?: typeof fetch;
};

/** Reads the child's events + effective-schedule source for the date, as the caller. Returns null
 *  on an authorization denial (the endpoint maps that to the generic 403 refusal — no oracle). */
export function buildScheduleReader(cfg: NoticeDepsConfig): ScheduleReader {
  const doFetch = cfg.fetchFn ?? fetch;
  return async ({ childId, date, bearer, signal }) => {
    const r = await gql<{ events: ScheduleEvent[]; effectiveScheduleFor: { source: string } | null }>(
      cfg.graphqlUrl, bearer, EVENTS_QUERY, { childId, date }, doFetch, signal,
    );
    if (!r.ok) {
      if (r.auth) return null; // generic refusal
      throw new Error('SCHEDULE_READ_FAILED');
    }
    return { events: r.data.events ?? [], effectiveSource: r.data.effectiveScheduleFor?.source ?? 'WEEKLY' };
  };
}

/** Calls the existing requestPickup as the caller. A non-parent is refused by the DB RPC → we
 *  surface that as UNAUTHORIZED (the endpoint returns 403); the job's own idempotency key makes a
 *  retry return the same job. */
export function buildPickupRequester(cfg: NoticeDepsConfig): PickupRequester {
  const doFetch = cfg.fetchFn ?? fetch;
  return async ({ childId, asOf, window, bearer, signal }) => {
    const r = await gql<{ requestPickup: { id: string; status: string } }>(
      cfg.graphqlUrl, bearer, REQUEST_PICKUP, { childId, asOf, window }, doFetch, signal,
    );
    if (!r.ok) return { ok: false, code: r.auth ? 'UNAUTHORIZED' : 'ERROR' };
    return { ok: true, jobId: r.data.requestPickup.id, status: r.data.requestPickup.status };
  };
}
