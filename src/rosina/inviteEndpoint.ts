/**
 * Authenticated endpoint for the Invites slice. Contract: docs/contracts/invites.md.
 *   POST /api/rosina/invite  { childId, request, referenceImage?, revise? }
 *     → editable event fields + generated art bytes (+ provenance, reference, suggestion)
 *
 * The art is driven by the PARENT'S OWN creative request (Muse Image generations), and an optional
 * reference image — a parent upload OR the prior generated result for a revision — routes to Muse
 * Image /images/edits so the actual image guides the result. Event fields are a best-effort, editable
 * convenience: they are NEVER required to make art, never block it, and never invented.
 *
 * Order is a hard guardrail: authenticate → refuse the demo guide → validate the body + optional
 * reference (type/size/dims, EXIF stripped, in memory) → per-caller rate limit → parent/guardian
 * authorization → ONLY THEN any model call. A refused caller triggers zero model calls. Only the
 * parent's typed `request` (and their uploaded reference) reach the provider — never any graph-derived
 * private data. The key lives only in the image client and is never logged; the request text and the
 * image bytes are never logged.
 *
 * Budget (money-adjacent, AGENTS.md §1.6): gated per-CHILD by the real persistent ledger (0085,
 * inviteLedgerBudget.ts) — reserved before the image call, settled after, ONLY for source ===
 * 'MUSE_IMAGE'. FIXTURE spends nothing and never touches the ledger. A cache hit settles free; a
 * CONFIRMED provider refusal settles FAILED (free); an UNCERTAIN outcome settles charged
 * conservatively, never refunded by default. Deduplication (inviteDedup.ts) collapses an identical
 * (caller, child, request, reference, revise) into ONE real pipeline; authz + rate limit still run per
 * HTTP request.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { buildCreativeBrief, promptHash } from './invitePrompt';
import { validateInviteFields, detroitToday, type RawInviteExtraction, type InviteEvent } from './inviteFields';
import { InviteImageUncertainFailure, type InviteImageGenerator, type InviteArt, type InviteProvenance } from './inviteImage';
import type { InviteRateLimiter } from './inviteBudget';
import type { InviteLedgerBudget } from './inviteLedgerBudget';
import type { InviteDedup } from './inviteDedup';
import { dedupKey } from './inviteDedup';
import { sniffImageMime, stripImageMetadata, readImageDimensions, type ImageMime } from './imageHygiene';

// Reference-image safety bounds (checked server-side, in memory).
const REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
const REFERENCE_MIN_DIM = 16;
const REFERENCE_MAX_DIM = 4096;

type ParsedReference = { image: { bytes: Buffer; mimeType: ImageMime } } | { error: { status: number; code: string } } | null;

/** Validate an OPTIONAL reference image entirely in memory: sniff the real type (a lying mimeType is
 *  rejected), enforce ≤5MB and server-read dimensions, then STRIP EXIF/GPS/XMP. Returns null when no
 *  reference was supplied, the stripped image when valid, or a typed error otherwise. Never persists,
 *  never logs the bytes. */
function parseReference(body: Record<string, unknown>): ParsedReference {
  const raw = body.referenceImage;
  if (raw == null) return null;
  if (typeof raw !== 'object') return { error: { status: 400, code: 'INVALID_REQUEST' } };
  const dataBase64 = (raw as { dataBase64?: unknown }).dataBase64;
  if (typeof dataBase64 !== 'string' || dataBase64 === '') return { error: { status: 400, code: 'INVALID_REQUEST' } };
  let bytes: Buffer;
  try { bytes = Buffer.from(dataBase64, 'base64'); } catch { return { error: { status: 400, code: 'INVALID_REQUEST' } }; }
  if (bytes.length === 0) return { error: { status: 400, code: 'INVALID_REQUEST' } };
  if (bytes.length > REFERENCE_MAX_BYTES) return { error: { status: 413, code: 'PAYLOAD_TOO_LARGE' } };
  const mime = sniffImageMime(bytes);
  if (!mime) return { error: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' } }; // PNG/JPEG/WebP only, by magic bytes
  const dims = readImageDimensions(bytes, mime);
  if (!dims || dims.width < REFERENCE_MIN_DIM || dims.height < REFERENCE_MIN_DIM || dims.width > REFERENCE_MAX_DIM || dims.height > REFERENCE_MAX_DIM) {
    return { error: { status: 400, code: 'INVALID_REQUEST' } };
  }
  let stripped: Buffer;
  try { stripped = stripImageMetadata(bytes, mime); } catch { return { error: { status: 400, code: 'INVALID_REQUEST' } }; }
  if (stripped.length > REFERENCE_MAX_BYTES) return { error: { status: 413, code: 'PAYLOAD_TOO_LARGE' } };
  return { image: { bytes: stripped, mimeType: mime } };
}

export type InviteIdentity = { ok: true; personId: string; demoGuide: boolean } | { ok: false };

const EXTRACT_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 45_000;

export type InviteExtractor = (input: { request: string; today: string; signal?: AbortSignal }) => Promise<RawInviteExtraction>;

/** True only when the caller is a parent/guardian of the child. Runs AS THE CALLER. */
export type ParentAuthorizer = (input: { personId: string; childId: string; bearer: string; signal?: AbortSignal }) => Promise<boolean>;

export type InviteEndpointDeps = {
  verify: (header?: string) => Promise<InviteIdentity>;
  authorizeParent: ParentAuthorizer;
  /** Best-effort Muse Spark extraction of editable event fields — NEVER required to make art. */
  extractor: InviteExtractor;
  image: InviteImageGenerator;
  rateLimiter: InviteRateLimiter;
  dedup: InviteDedup;
  ledgerBudget: InviteLedgerBudget;
  source: 'MUSE_IMAGE' | 'FIXTURE';
  now?: () => Date;
  maxRequestChars?: number;
};

type PipelineResult =
  | { kind: 'READY'; event: InviteEvent; art: InviteArt; provenance: InviteProvenance; reference: { requested: boolean; applied: boolean }; suggestion: string | null }
  | { kind: 'ERROR'; status: number; body: Record<string, unknown> };

/** Non-blocking nudge: which event fields the family still needs to add (never invented). */
function missingDetailSuggestion(event: InviteEvent): string | null {
  const missing: string[] = [];
  if (!event.childFirstName) missing.push('the child’s name');
  if (!event.occasion) missing.push('the occasion');
  if (!event.date) missing.push('a date');
  if (!missing.length) return null;
  return `Add ${missing.join(', ')} below to finish the invitation.`;
}

const IMAGE_KEYS = ['image', 'photo', 'imageBase64', 'photoBase64', 'dataBase64', 'upload', 'file', 'attachment'];

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}
function sha256Base64(base64: string): string {
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

export function createInviteHandler(deps: InviteEndpointDeps) {
  const now = deps.now ?? (() => new Date());
  const maxRequestChars = deps.maxRequestChars ?? 2000;

  return async function handle(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (identity.demoGuide) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const childId = typeof body.childId === 'string' ? body.childId : '';
    const request = typeof body.request === 'string' ? body.request : '';
    // The only supported upload field is `referenceImage`; any other loose image/photo/file key is refused.
    if (IMAGE_KEYS.some((k) => k in body)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (!childId || !request || request.length > maxRequestChars) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const parsedRef = parseReference(body);
    if (parsedRef && 'error' in parsedRef) { res.status(parsedRef.error.status).json({ error: parsedRef.error.code }); return; }
    const reference = parsedRef && 'image' in parsedRef ? parsedRef.image : null;

    const log = (status: number, extra = '') =>
      console.log(`[rosina:invite] person=${identity.personId} child=${childId} status=${status}${extra}`);

    const rl = deps.rateLimiter.take(identity.personId);
    if (!rl.allowed) { log(429, ' RATE_LIMITED'); res.status(429).json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }); return; }

    const bearer = bearerOf(req);
    if (!(await deps.authorizeParent({ personId: identity.personId, childId, bearer }))) {
      log(403); res.status(403).json({ error: 'UNAUTHORIZED' }); return;
    }

    const today = detroitToday(now());
    const revise = body.revise === true; // a follow-up revision of a prior generated result (sent as the reference)
    const refSha = reference ? createHash('sha256').update(reference.bytes).digest('hex') : '';
    const key = dedupKey(identity.personId, childId, `${request}${refSha ? ` ref:${refSha}` : ''}${revise ? ' revise' : ''}`);

    const pipeline: PipelineResult = await deps.dedup.run(key, async (): Promise<PipelineResult> => {
      // Best-effort editable fields (NEVER required to make art, never blocks, never invents). A Spark
      // failure just means empty fields the family fills in the card editor.
      let event: InviteEvent;
      try {
        const raw = await deps.extractor({ request, today, signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS) });
        event = validateInviteFields(raw, { today }).event;
      } catch {
        event = { childFirstName: '', occasion: '', date: null, startTime: null, endTime: null, timezone: 'America/Detroit', placeLabel: null };
      }

      // The creative brief is driven by the parent's OWN request (subject/transformation/style/
      // composition/wording). A reference (upload remix, or the prior result on a revision) routes to
      // /images/edits so the actual image guides the result. Only the parent's typed text + their
      // reference reach the provider — never graph data.
      const prompt = buildCreativeBrief(request, { hasReference: reference != null, revise });
      const hash = promptHash(refSha ? `${prompt}:${refSha}` : prompt);

      // Budget (live only). Reserve BEFORE the provider call; a known cache hit (no reference) is never
      // billed and skips reservation.
      let generationId: string | null = null;
      if (deps.source === 'MUSE_IMAGE' && (reference != null || !deps.image.peekCached(hash))) {
        const reservation = await deps.ledgerBudget.reserve({ childId, source: 'MUSE_IMAGE', promptHash: hash, bearer });
        if (!reservation.allowed) return { kind: 'ERROR', status: 429, body: { error: 'BUDGET_EXHAUSTED' } };
        generationId = reservation.generationId;
      }

      let result;
      try {
        result = await deps.image.generate({
          prompt, promptHash: hash,
          images: reference ? [{ bytes: reference.bytes, mimeType: reference.mimeType }] : undefined,
          signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        });
      } catch (err) {
        if (generationId) {
          const uncertain = err instanceof InviteImageUncertainFailure;
          await deps.ledgerBudget.settle({ generationId, status: uncertain ? 'UNCERTAIN' : 'FAILED', model: null, outputSha256: null, cached: false, bearer });
        }
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      if (generationId) {
        await deps.ledgerBudget.settle({
          generationId, status: 'SUCCEEDED', model: result.provenance.model,
          outputSha256: sha256Base64(result.art.base64), cached: result.provenance.cached, bearer,
        });
      }

      return {
        kind: 'READY', event, art: result.art, provenance: result.provenance,
        reference: { requested: reference != null, applied: reference != null && deps.source === 'MUSE_IMAGE' },
        suggestion: missingDetailSuggestion(event),
      };
    }, (result) => result.kind !== 'ERROR'); // a handled ERROR is never cached, so an explicit retry really retries

    if (pipeline.kind === 'ERROR') {
      log(pipeline.status, ` ${String(pipeline.body.error)}`);
      res.status(pipeline.status).json(pipeline.body);
      return;
    }
    log(200, ` READY source=${pipeline.provenance.source} cached=${pipeline.provenance.cached} edited=${pipeline.provenance.edited === true} fmt=${pipeline.provenance.outputFormat ?? '?'} ${pipeline.art.width}x${pipeline.art.height}`);
    res.status(200).json({
      status: 'READY',
      clarification: null,
      event: pipeline.event,
      art: pipeline.art,
      provenance: pipeline.provenance,
      reference: pipeline.reference,
      suggestion: pipeline.suggestion,
    });
  };
}
