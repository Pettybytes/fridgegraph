/**
 * Real private-media backing for "Pin it to the fridge" (contract §6).
 *
 * Mirrors the orbit photo store (photoDeps.ts): every decision is made with the CALLER'S OWN bearer
 * through an RLS-scoped client — no service-role bypass — using the 0090 database authority
 * (`register_pin_media` / `pin_media_access`) and a private directory for the bytes. No public bucket,
 * no signed URL; access is re-evaluated on EVERY load. Raw bytes and paths are NEVER logged.
 *
 *  - put: sniff the REAL format from magic bytes (a lying mimeType is rejected), enforce the size cap,
 *    strip EXIF/GPS/XMP/text metadata, hash the STORED bytes, write them to the private dir with
 *    restrictive permissions, then register the row AS THE CALLER (parent-only, enforced in the db).
 *  - access: resolve a caller's authority for an asset (PARENT, or SHARED via a fridge.read grant on a
 *    SHARED note that references it) — missing / wrong-child / unauthorized all answer {ok:false}.
 *  - load: re-evaluate access, then read the stored bytes. Same generic miss for every refusal.
 *
 * `dbForFn` and `mediaDir` are injectable so the production code can be exercised against a fake db +
 * temp dir in tests.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { dbFor as realDbFor } from '../db';
import type { Ctx } from '../authz';
import type { DbForFn } from './photoDeps';
import { detroitToday } from './localTime';
import { sniffImageMime, stripImageMetadata, type SniffedMime } from './pinMedia';
import type { MediaStore } from './pinEndpoint';

export const PIN_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<SniffedMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

type AccessRow = { access?: string | null; storage_path?: string | null; child_id?: string | null; mime_type?: string | null };
type GrantedAccess = { access: string; storage_path: string; child_id: string; mime_type: string };
const firstRow = (data: unknown): AccessRow | null => (Array.isArray(data) ? (data[0] ?? null) : (data as AccessRow | null));

async function accessFor(dbForFn: DbForFn, bearer: string, assetId: string): Promise<GrantedAccess | null> {
  const ctx: Ctx = { today: detroitToday(), token: bearer };
  let res: { data: unknown; error: unknown };
  try { res = await dbForFn(ctx).rpc('pin_media_access', { p_media: assetId }); }
  catch { return null; }
  const row = res.error ? null : firstRow(res.data);
  if (!row?.access || !row.storage_path || !row.child_id || !row.mime_type) return null; // no oracle
  return { access: row.access, storage_path: row.storage_path, child_id: row.child_id, mime_type: row.mime_type };
}

export type PinMediaLoad = { bytes: Uint8Array; mimeType: string; childId: string; access: string };

export interface RealPinMediaStore extends MediaStore {
  /** Re-authorize as the caller and read the stored bytes (for the retrieval endpoint). */
  load(input: { assetId: string; personId: string; bearer: string }): Promise<PinMediaLoad | null>;
}

export function buildPinMediaStore(cfg: { mediaDir: string; dbForFn?: DbForFn; now?: () => number }): RealPinMediaStore {
  const dbForFn = cfg.dbForFn ?? (realDbFor as unknown as DbForFn);
  const now = cfg.now ?? Date.now;

  return {
    async put({ childId, mimeType, bytes, personId, bearer }) {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      if (buf.length === 0) return { ok: false, code: 'UNSUPPORTED' };
      if (buf.length > PIN_MEDIA_MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };
      // The sniff, not the caller's claim, decides what the bytes are; a mismatch is rejected.
      const sniffed = sniffImageMime(buf);
      if (!sniffed || sniffed !== mimeType) return { ok: false, code: 'UNSUPPORTED' };
      let stored: Buffer;
      try { stored = stripImageMetadata(buf, sniffed); }
      catch { return { ok: false, code: 'UNSUPPORTED' }; } // cannot prove the strip → refuse
      if (stored.length > PIN_MEDIA_MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };
      const sha = createHash('sha256').update(stored).digest('hex');

      mkdirSync(cfg.mediaDir, { recursive: true, mode: 0o700 });
      const fileName = `pin-${now().toString(36)}-${createHash('sha256').update(sha + personId + Math.random()).digest('hex').slice(0, 12)}.${EXT[sniffed]}`;
      const filePath = join(cfg.mediaDir, fileName);
      writeFileSync(filePath, stored, { mode: 0o600 });

      // Register AS THE CALLER — parent-only is enforced in the database, not here.
      const ctx: Ctx = { today: detroitToday(), token: bearer };
      let res: { data: unknown; error: unknown };
      try { res = await dbForFn(ctx).rpc('register_pin_media', { p_child: childId, p_sha256: sha, p_mime: sniffed, p_path: fileName, p_size: stored.length }); }
      catch { if (existsSync(filePath)) unlinkSync(filePath); return { ok: false, code: 'UNSUPPORTED' }; }
      if (res.error || typeof res.data !== 'string' || !res.data) {
        if (existsSync(filePath)) unlinkSync(filePath);
        return { ok: false, code: 'UNSUPPORTED' }; // parent re-check / validation failed in the db
      }
      return { ok: true, assetId: res.data };
    },

    async access({ assetId, personId: _personId, bearer }) {
      const row = await accessFor(dbForFn, bearer, assetId);
      if (!row) return { ok: false };
      return { ok: true, childId: row.child_id, mimeType: row.mime_type };
    },

    async load({ assetId, personId: _personId, bearer }) {
      const row = await accessFor(dbForFn, bearer, assetId);
      if (!row) return null;
      const file = join(cfg.mediaDir, basename(row.storage_path));
      if (!existsSync(file)) return null;
      return { bytes: new Uint8Array(readFileSync(file)), mimeType: row.mime_type, childId: row.child_id, access: row.access };
    },
  };
}
