import type { Ctx } from './authz';
import { verifyBearer } from './auth/verify';

type HeaderBag = Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The household calendar is a LOCAL calendar. Using toISOString() here made "today" flip to the
 * next day at 20:00 Detroit time, which silently expired a grant that was valid for the whole
 * local day. Grants, schedules and policies are all day-granular, so the day must be local.
 */
function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Identity comes from a verified Supabase JWT only.
 *
 * x-demo-date survives ONLY as a test clock, and only when the server runs with DEMO_CLOCK=1.
 * Otherwise the real local date is used even if a client sends the header. x-demo-user is gone.
 */
export async function makeContext({ req }: { req?: { headers?: HeaderBag } }): Promise<Ctx> {
  const headers = req?.headers ?? {};
  const authorization = readHeader(headers, 'authorization');
  const identity = await verifyBearer(authorization);
  // The raw token is kept only to build this request's RLS-scoped Postgres client. It is never
  // logged, never stored, and never forwarded anywhere except the Supabase endpoint.
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  const timeZone = process.env.APP_TIME_ZONE ?? 'America/Detroit';
  const realToday = todayIn(timeZone);
  const demoDate = readHeader(headers, 'x-demo-date');
  const demoClock = process.env.DEMO_CLOCK === '1';
  const today = demoClock && demoDate && ISO_DATE.test(demoDate) ? demoDate : realToday;

  if (identity.ok) {
    return {
      callerId: identity.personId,
      today,
      token: bearer,
      demo: identity.demo,
      demoGuide: identity.demoGuide,
    };
  }

  // Never surfaced to the client; resolvers raise UNAUTHENTICATED without detail.
  return { today, identityError: identity.reason };
}
