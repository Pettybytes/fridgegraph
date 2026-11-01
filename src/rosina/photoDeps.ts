/**
 * Production wiring for the photo → descriptors endpoint (#69 fix).
 *
 * The earlier server used `authorize: () => false`, `photoStore: () => null`,
 * `vocabulary: () => new Map()`, so it refused everyone. These are the REAL dependencies:
 * every decision is made with the CALLER'S OWN bearer through an RLS-scoped client — no
 * service-role bypass — reusing the same database authority (`orbit_photo_access`, 0037/0055)
 * and the same private photo path the upload used.
 *
 *  - authorize: `orbit_photo_access(photoId)` as the caller must return PARENT (parent/guardian
 *    of the child) for THIS photo, and the returned `child_id` must equal the requested child.
 *    Descriptor preparation is the parent's job — an AUDIENCE recipient (granted only while an
 *    alert is ACTIVE) is NOT allowed to run vision on the photo and gets the same generic 403.
 *    Missing, inaccessible and wrong-child all fail closed (no oracle). Works before activation:
 *    a parent gets PARENT any time.
 *  - photoStore: re-evaluates access on EVERY load, then reads the EXIF-stripped bytes from the
 *    private dir. No signed URL is ever minted; raw bytes and paths are never logged.
 *  - vocabulary: the real controlled vocabulary (`orbit_vocabulary`, selectable by authenticated)
 *    as the caller.
 *
 * `dbForFn` and `photoDir` are injectable so the real server composition can be exercised in a
 * test against a fake database + temp dir, with the production authorize/load/vocabulary code.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dbFor as realDbFor } from '../db';
import type { Ctx } from '../authz';
import type { PhotoEndpointDeps, PhotoIdentity } from './photoEndpoint';
import type { RateLimiter } from './rateLimit';
import type { VisionClient } from './photoDescriptors';

type PhotoAccessRow = { access?: string | null; storage_path?: string | null; child_id?: string | null };
/** The minimal RLS-scoped client surface we use — satisfied by the real Supabase client. */
export type DbLike = {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): { select(cols: string): Promise<{ data: unknown; error: unknown }> };
};
export type DbForFn = (ctx: Ctx) => DbLike;

const firstRow = (data: unknown): PhotoAccessRow | null => (Array.isArray(data) ? (data[0] ?? null) : (data as PhotoAccessRow | null));

async function accessFor(dbForFn: DbForFn, bearer: string, photoId: string, childId: string): Promise<PhotoAccessRow | null> {
  const ctx: Ctx = { today: new Date().toISOString().slice(0, 10), token: bearer };
  let res: { data: unknown; error: unknown };
  try { res = await dbForFn(ctx).rpc('orbit_photo_access', { p_photo: photoId }); }
  catch { return null; }
  const row = res.error ? null : firstRow(res.data);
  // Fail closed and PARENT-only: descriptor preparation is the parent's job. An AUDIENCE
  // recipient (who can see the photo only while an alert is ACTIVE) must NOT be able to run the
  // vision model on the child's photo — they get the same generic 403 as anyone else.
  if (row?.access !== 'PARENT' || !row.storage_path || row.child_id !== childId) return null;
  return row;
}

export function buildPhotoDeps(cfg: {
  verify: (header?: string) => Promise<PhotoIdentity>;
  rateLimiter: RateLimiter;
  vision: VisionClient | null;
  photoDir: string;
  dbForFn?: DbForFn;
}): PhotoEndpointDeps {
  const dbForFn = cfg.dbForFn ?? (realDbFor as unknown as DbForFn);
  return {
    verify: cfg.verify,
    rateLimiter: cfg.rateLimiter,
    vision: cfg.vision,
    authorize: async ({ childId, photoId, bearer }) => (await accessFor(dbForFn, bearer, photoId, childId)) !== null,
    photoStore: {
      async load({ childId, photoId, bearer }) {
        // Re-evaluate authority on every load, as the caller.
        const row = await accessFor(dbForFn, bearer, photoId, childId);
        if (!row?.storage_path) return null;
        const file = join(cfg.photoDir, basename(row.storage_path));
        if (!existsSync(file)) return null;
        return { data: new Uint8Array(readFileSync(file)), contentType: 'image/jpeg' };
      },
    },
    vocabulary: async ({ bearer }) => {
      const ctx: Ctx = { today: new Date().toISOString().slice(0, 10), token: bearer };
      const out = new Map<string, Set<string>>();
      let res: { data: unknown; error: unknown };
      try { res = await dbForFn(ctx).from('orbit_vocabulary').select('kind, value'); }
      catch { return out; }
      if (res.error || !Array.isArray(res.data)) return out;
      for (const r of res.data as { kind?: unknown; value?: unknown }[]) {
        if (typeof r.kind === 'string' && typeof r.value === 'string') {
          if (!out.has(r.kind)) out.set(r.kind, new Set());
          out.get(r.kind)!.add(r.value);
        }
      }
      return out;
    },
  };
}
