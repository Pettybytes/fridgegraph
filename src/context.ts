import type { Ctx } from './authz';

type HeaderBag = Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "now" is x-demo-date when present, otherwise the real date. Both are INSECURE dev conveniences. */
export function makeContext({ req }: { req?: { headers?: HeaderBag } }): Ctx {
  const headers = req?.headers ?? {};
  const callerId = readHeader(headers, 'x-demo-user');
  const demoDate = readHeader(headers, 'x-demo-date');
  const today =
    demoDate && ISO_DATE.test(demoDate) ? demoDate : new Date().toISOString().slice(0, 10);
  return { callerId, today };
}
