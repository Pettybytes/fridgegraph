/**
 * Authenticated endpoint for the Invites slice. Contract: docs/contracts/invites.md.
 *   POST /api/rosina/invite  { childId, request }  → structured editable event fields + art-only bytes
 *
 * Order is a hard guardrail: authenticate → refuse the demo guide → validate the body (no photo) →
 * per-caller rate limit → parent/guardian authorization → ONLY THEN any model call. A refused
 * caller triggers zero Spark/image calls. Every dependency is injected; the key lives only in the
 * live image client and is never logged. Logs non-content metadata only (never the request text,
 * never the key).
 *
 * Budget (money-adjacent, AGENTS.md §1.6 — built on explicit instruction, staged, human review
 * required before any apply): gated per-CHILD by the real persistent ledger (0085,
 * inviteLedgerBudget.ts) — reserved before the image call, settled after. ONLY for source ===
 * 'MUSE_IMAGE': FIXTURE makes no real model call and spends nothing, so it never touches the
 * ledger at all, by construction (no code path reaches reserve/settle in fixture mode). Price is
 * decided server-side only — this file never sends a cost figure. A cache hit (provenance.cached)
 * settles free; a CONFIRMED pre-generation/provider refusal settles FAILED, free; an UNCERTAIN
 * outcome (a network error after send, or a local validation failure on an otherwise-200
 * response — see inviteImage.ts's error classes) settles charged, conservatively, never refunded
 * by default.
 *
 * Deduplication: a double-click, a network retry, or two tabs firing the identical request
 * (same caller, same child, same request text) share ONE real extraction+image+budget pipeline
 * (inviteDedup.ts) — never two. Authorization and the per-request rate limit still run for every
 * incoming HTTP request; only the expensive, money-relevant work is deduplicated.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { buildArtPrompt, promptHash, assertNoPii } from './invitePrompt';
import { validateInviteFields, detroitToday, type RawInviteExtraction, type InviteEvent } from './inviteFields';
import { InviteImageUncertainFailure, type InviteImageGenerator, type InviteArt, type InviteProvenance } from './inviteImage';
import type { InviteRateLimiter } from './inviteBudget';
import type { InviteLedgerBudget } from './inviteLedgerBudget';
import type { InviteDedup } from './inviteDedup';
import { dedupKey } from './inviteDedup';
import { sniffImageMime, stripImageMetadata, readImageDimensions, type ImageMime } from './imageHygiene';
import type { ReferenceStyleExtractor, ReferenceStyleHint } from './inviteReference';

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

/**
 * Bounds on the two provider calls. Without them a stalled provider left the request (and every
 * deduplicated retry of it) hanging indefinitely, which the UI renders as "Generating art…" —
 * indistinguishable from progress. A timeout turns that into a definite, honest failure.
 */
const EXTRACT_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 45_000;

export type InviteExtractor = (input: { request: string; today: string; signal?: AbortSignal }) => Promise<RawInviteExtraction>;

/** True only when the caller is a parent/guardian of the child. Runs AS THE CALLER. */
export type ParentAuthorizer = (input: { personId: string; childId: string; bearer: string; signal?: AbortSignal }) => Promise<boolean>;

export type InviteEndpointDeps = {
  verify: (header?: string) => Promise<InviteIdentity>;
  authorizeParent: ParentAuthorizer;
  extractor: InviteExtractor;
  image: InviteImageGenerator;
  /** Optional reference-image STYLE extractor (Muse vision). Used only when a valid reference image
   *  is supplied AND source === 'MUSE_IMAGE'. Absent → references validate but are never style-applied. */
  referenceExtractor?: ReferenceStyleExtractor;
  rateLimiter: InviteRateLimiter;
  dedup: InviteDedup;
  /** Unused (never called) when source === 'FIXTURE'. No cost is ever passed to it — price is
   *  decided server-side only, inside the 0085 RPCs themselves. */
  ledgerBudget: InviteLedgerBudget;
  /** The active image source, for provenance on a clarification (no image generated). */
  source: 'MUSE_IMAGE' | 'FIXTURE';
  now?: () => Date;
  maxRequestChars?: number;
};

type PipelineResult =
  | { kind: 'NEEDS_CLARIFICATION'; clarification: { question: string }; event: InviteEvent }
  | { kind: 'READY'; event: InviteEvent; art: InviteArt; provenance: InviteProvenance; reference: { requested: boolean; applied: boolean } }
  | { kind: 'ERROR'; status: number; body: Record<string, unknown> };

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
    // Demo guide is read-only everywhere and never generates: refuse before any model call.
    if (identity.demoGuide) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const childId = typeof body.childId === 'string' ? body.childId : '';
    const request = typeof body.request === 'string' ? body.request : '';
    // The only supported upload field is `referenceImage`; any other loose image/photo/file key is
    // still rejected outright.
    if (IMAGE_KEYS.some((k) => k in body)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (!childId || !request || request.length > maxRequestChars) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    // Validate the optional reference in memory (type/size/dimensions, EXIF stripped) before any
    // rate limit, authorization or model call — a bad reference fails fast with a specific status.
    const parsedRef = parseReference(body);
    if (parsedRef && 'error' in parsedRef) { res.status(parsedRef.error.status).json({ error: parsedRef.error.code }); return; }
    const reference = parsedRef && 'image' in parsedRef ? parsedRef.image : null;

    const log = (status: number, extra = '') =>
      console.log(`[rosina:invite] person=${identity.personId} child=${childId} status=${status}${extra}`);

    // Per-caller rate limit — runs for EVERY incoming request, dedup or not.
    const rl = deps.rateLimiter.take(identity.personId);
    if (!rl.allowed) { log(429, ' RATE_LIMITED'); res.status(429).json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }); return; }

    const bearer = bearerOf(req);
    // Parent/guardian authorization BEFORE any model call, EVERY request — a refusal is generic
    // (no oracle) and never reaches Spark or the image model, and is never deduplicated away.
    if (!(await deps.authorizeParent({ personId: identity.personId, childId, bearer }))) {
      log(403); res.status(403).json({ error: 'UNAUTHORIZED' }); return;
    }

    const today = detroitToday(now());
    // A different reference image must NOT be deduplicated into a prior reference-less (or different-
    // reference) pipeline, so its content hash is part of the key. Bytes are never logged.
    const refSha = reference ? createHash('sha256').update(reference.bytes).digest('hex') : '';
    const key = dedupKey(identity.personId, childId, refSha ? `${request} ref:${refSha}` : request);

    const pipeline: PipelineResult = await deps.dedup.run(key, async (): Promise<PipelineResult> => {
      // Muse Spark: extract fields. A failure folds into the single model-pipeline error (502).
      let raw: RawInviteExtraction;
      try {
        raw = await deps.extractor({ request, today, signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS) });
      } catch {
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      const validation = validateInviteFields(raw, { today });
      if (validation.status === 'NEEDS_CLARIFICATION') {
        return { kind: 'NEEDS_CLARIFICATION', clarification: validation.clarification, event: validation.event };
      }

      // Optional reference image → extract bounded STYLE via Muse vision and let it nudge the art
      // (explicitly an alternative to real reference-image generation; the upload never appears in
      // the card — contract §8.3). Live source only; best-effort. Because the prompt (and its cache
      // key) depend on the extracted style, we CANNOT peek the cache first, so when a reference is
      // active we reserve BEFORE the vision call — an exhausted budget then makes ZERO provider calls.
      const referenceActive = deps.source === 'MUSE_IMAGE' && reference != null && deps.referenceExtractor != null;
      let generationId: string | null = null;
      let hint: ReferenceStyleHint | null = null;
      let referenceApplied = false;
      if (referenceActive) {
        const reservation = await deps.ledgerBudget.reserve({ childId, source: 'MUSE_IMAGE', promptHash: '', bearer });
        if (!reservation.allowed) return { kind: 'ERROR', status: 429, body: { error: 'BUDGET_EXHAUSTED' } };
        generationId = reservation.generationId;
        try {
          hint = await deps.referenceExtractor!({ image: reference!, signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS) });
          referenceApplied = Boolean(hint && (hint.palette || hint.style || hint.subject || hint.mood));
        } catch {
          hint = null; referenceApplied = false; // best-effort: fall back to plain art, reported honestly below
        }
      }

      const prompt = buildArtPrompt(validation.event.occasion, hint);
      const hash = promptHash(prompt);

      // Belt-and-suspenders: the prompt is built from fixed theme strings + fixed-vocabulary style
      // words and never echoes input, so a name/date/venue is impossible — but if the guard ever
      // matches, refuse cleanly (settling any reservation already made for a reference) before any
      // image call.
      try {
        assertNoPii(prompt, validation.event);
      } catch {
        if (generationId) await deps.ledgerBudget.settle({ generationId, status: 'FAILED', model: null, outputSha256: null, cached: false, bearer });
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      // No reference: keep the existing cache-aware reservation (a known cache hit is never billed).
      if (!referenceActive && deps.source === 'MUSE_IMAGE' && !deps.image.peekCached(hash)) {
        // No costUsd argument — the server charges its own fixed per-generation price.
        const reservation = await deps.ledgerBudget.reserve({ childId, source: 'MUSE_IMAGE', promptHash: hash, bearer });
        if (!reservation.allowed) return { kind: 'ERROR', status: 429, body: { error: 'BUDGET_EXHAUSTED' } };
        generationId = reservation.generationId;
      }

      let result;
      try {
        result = await deps.image.generate({ prompt, promptHash: hash, signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
      } catch (err) {
        if (generationId) {
          // UNCERTAIN (the provider may have billed even though we have no usable result) is
          // charged conservatively — never silently released. Only a CONFIRMED pre-generation
          // refusal (never reached the provider at all) settles FAILED, free.
          const uncertain = err instanceof InviteImageUncertainFailure;
          await deps.ledgerBudget.settle({
            generationId, status: uncertain ? 'UNCERTAIN' : 'FAILED', model: null, outputSha256: null, cached: false, bearer,
          });
        }
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      if (generationId) {
        // `cached` is a FACT this process observed (the image client's own cache) — the server
        // decides the actual charge from it; a cache hit is never billed.
        await deps.ledgerBudget.settle({
          generationId, status: 'SUCCEEDED', model: result.provenance.model,
          outputSha256: sha256Base64(result.art.base64), cached: result.provenance.cached, bearer,
        });
      }

      return { kind: 'READY', event: validation.event, art: result.art, provenance: result.provenance, reference: { requested: reference != null, applied: referenceApplied } };
    }, (result) => result.kind !== 'ERROR'); // an 'ERROR' result is a HANDLED failure (caught, never rejected)
    // — never cached for a later retry, or an explicit retry after failure would be served the
    // same stale failure instead of actually retrying.

    if (pipeline.kind === 'ERROR') {
      log(pipeline.status, ` ${String(pipeline.body.error)}`);
      res.status(pipeline.status).json(pipeline.body);
      return;
    }
    if (pipeline.kind === 'NEEDS_CLARIFICATION') {
      log(200, ' NEEDS_CLARIFICATION');
      res.status(200).json({
        status: 'NEEDS_CLARIFICATION',
        clarification: pipeline.clarification,
        event: pipeline.event,
        art: null,
        provenance: { source: deps.source, model: null, cached: false, promptHash: '' },
      });
      return;
    }
    log(200, ` READY source=${pipeline.provenance.source} cached=${pipeline.provenance.cached} promptHash=${pipeline.provenance.promptHash.slice(0, 12)}`);
    res.status(200).json({
      status: 'READY',
      clarification: null,
      event: pipeline.event,
      art: pipeline.art,
      provenance: pipeline.provenance,
      reference: pipeline.reference,
    });
  };
}
