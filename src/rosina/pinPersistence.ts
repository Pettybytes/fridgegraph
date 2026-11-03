/**
 * Real persistence for a confirmed pin → #157's `fridge_notes` (contract §5 "Persistence mapping").
 *
 *   reviewed.caption  → fridge_notes.text            (the parent's own words; required by the schema)
 *   audience          → fridge_notes.audience        (PARENTS_ONLY | SHARED — never silently widened)
 *   assetId           → fridge_notes.attachment_ref  (a plain ref; this intake owns the loader)
 *
 * The write goes through the CALLER's RLS client (author_id = current_person(), parent/guardian only
 * — enforced by the 0083 insert policy, not here). Idempotent: the row id is derived from the signed
 * idempotency key (which includes proposalId), so a confirm replay upserts the SAME row and never a
 * second; a distinct proposal for the same image is a different note.
 *
 * `fridge_notes.text` is NOT NULL with a non-empty check, and this intake never invents content, so a
 * pin WITHOUT a caption is refused (CAPTION_REQUIRED) rather than stored with fabricated text. The
 * structured extracted fields (date/term/event/…) have NO column in 0083 — their persistence stays
 * PENDING a teacher-persona column (see contract §5); they are returned to the client but not stored.
 */
import type { Ctx } from '../authz';
import { dbFor as realDbFor } from '../db';
import { detroitToday } from './localTime';
import { sha256 } from './pinConfirm';
import { PinPersistenceError, type PinStore } from './pinEndpoint';

export type FridgeNoteRow = { id: string; childId: string; authorId: string; text: string; audience: string; attachmentRef: string };
export type FridgeNoteWriter = (bearer: string, note: FridgeNoteRow) => Promise<'CREATED' | 'EXISTS'>;

type UpsertClient = {
  from(table: string): {
    upsert(values: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }): {
      select(cols: string): Promise<{ data: unknown; error: unknown }>;
    };
  };
};
type DbForUpsert = (ctx: Ctx) => UpsertClient;

/** The production writer: an idempotent, RLS-scoped upsert into fridge_notes as the caller. */
export function buildFridgeNoteWriter(cfg: { dbForFn?: DbForUpsert } = {}): FridgeNoteWriter {
  const dbForFn = cfg.dbForFn ?? (realDbFor as unknown as DbForUpsert);
  return async (bearer, note) => {
    const ctx: Ctx = { today: detroitToday(), token: bearer };
    const { data, error } = await dbForFn(ctx).from('fridge_notes').upsert(
      {
        id: note.id, child_id: note.childId, author_id: note.authorId, text: note.text,
        audience: note.audience, attachment_ref: note.attachmentRef, paper_color: 'yellow', sandbox: true,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    ).select('id');
    if (error) throw new PinPersistenceError('PERSIST_FAILED');
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.length > 0 ? 'CREATED' : 'EXISTS'; // ignoreDuplicates returns no row on conflict
  };
}

/** A PinStore that persists to fridge_notes via an injected writer (the real one, or a fake in tests). */
export function createFridgeNotePinStore(cfg: { writer: FridgeNoteWriter; idFor?: (key: string) => string }): PinStore {
  const idFor = cfg.idFor ?? ((key: string) => `fn_pin_${sha256(key).slice(0, 24)}`);
  return {
    async pin(key, bearer, make) {
      const candidate = make();
      const caption = candidate.caption;
      if (!caption || caption.trim() === '') throw new PinPersistenceError('CAPTION_REQUIRED');
      const id = idFor(key);
      const record = { ...candidate, pinId: id };
      const outcome = await cfg.writer(bearer, {
        id, childId: record.childId, authorId: record.callerId, text: caption, audience: record.audience, attachmentRef: record.assetId,
      });
      return { record, created: outcome === 'CREATED' };
    },
  };
}
