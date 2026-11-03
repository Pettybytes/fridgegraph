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
 * ledger at all, by construction (no code path reaches reserve/settle in fixture mode).
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
import type { InviteImageGenerator, InviteArt, InviteProvenance } from './inviteImage';
import type { InviteRateLimiter } from './inviteBudget';
import type { InviteLedgerBudget } from './inviteLedgerBudget';
import type { InviteDedup } from './inviteDedup';
import { dedupKey } from './inviteDedup';

export type InviteIdentity = { ok: true; personId: string; demoGuide: boolean } | { ok: false };

export type InviteExtractor = (input: { request: string; today: string; signal?: AbortSignal }) => Promise<RawInviteExtraction>;

/** True only when the caller is a parent/guardian of the child. Runs AS THE CALLER. */
export type ParentAuthorizer = (input: { personId: string; childId: string; bearer: string; signal?: AbortSignal }) => Promise<boolean>;

export type InviteEndpointDeps = {
  verify: (header?: string) => Promise<InviteIdentity>;
  authorizeParent: ParentAuthorizer;
  extractor: InviteExtractor;
  image: InviteImageGenerator;
  rateLimiter: InviteRateLimiter;
  dedup: InviteDedup;
  /** Unused (never called) when source === 'FIXTURE'. */
  ledgerBudget: InviteLedgerBudget;
  /** Per-generation cost in USD, charged only for source === 'MUSE_IMAGE'. */
  generationCostUsd: number;
  /** The active image source, for provenance on a clarification (no image generated). */
  source: 'MUSE_IMAGE' | 'FIXTURE';
  now?: () => Date;
  maxRequestChars?: number;
};

type PipelineResult =
  | { kind: 'NEEDS_CLARIFICATION'; clarification: { question: string }; event: InviteEvent }
  | { kind: 'READY'; event: InviteEvent; art: InviteArt; provenance: InviteProvenance }
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
    // No uploaded photo is ever accepted or sent.
    if (IMAGE_KEYS.some((k) => k in body)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (!childId || !request || request.length > maxRequestChars) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }

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
    const key = dedupKey(identity.personId, childId, request);

    const pipeline: PipelineResult = await deps.dedup.run(key, async (): Promise<PipelineResult> => {
      // Muse Spark: extract fields. A failure folds into the single model-pipeline error (502).
      let raw: RawInviteExtraction;
      try {
        raw = await deps.extractor({ request, today });
      } catch {
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      const validation = validateInviteFields(raw, { today });
      if (validation.status === 'NEEDS_CLARIFICATION') {
        return { kind: 'NEEDS_CLARIFICATION', clarification: validation.clarification, event: validation.event };
      }

      const prompt = buildArtPrompt(validation.event.occasion);
      const hash = promptHash(prompt);

      // Belt-and-suspenders: the prompt is built from fixed theme strings and never echoes input,
      // so a name/date/venue is impossible — but if the guard ever matches (a name that is
      // exactly a theme word), refuse cleanly before any reservation or model call.
      try {
        assertNoPii(prompt, validation.event);
      } catch {
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      // READY, live source → the per-CHILD ledger gates the image step (a new login cannot reset
      // it; a different parent of the SAME child shares the SAME budget). FIXTURE spends nothing
      // and never reaches this branch at all.
      let generationId: string | null = null;
      if (deps.source === 'MUSE_IMAGE') {
        const reservation = await deps.ledgerBudget.reserve({
          childId, costUsd: deps.generationCostUsd, source: 'MUSE_IMAGE', promptHash: hash, bearer,
        });
        if (!reservation.allowed) return { kind: 'ERROR', status: 429, body: { error: 'BUDGET_EXHAUSTED' } };
        generationId = reservation.generationId;
      }

      let result;
      try {
        result = await deps.image.generate({ prompt, promptHash: hash });
      } catch {
        if (generationId) await deps.ledgerBudget.settle({ generationId, status: 'FAILED', model: null, outputSha256: null, bearer });
        return { kind: 'ERROR', status: 502, body: { error: 'IMAGE_FAILED' } };
      }

      if (generationId) {
        await deps.ledgerBudget.settle({
          generationId, status: 'SUCCEEDED', model: result.provenance.model, outputSha256: sha256Base64(result.art.base64), bearer,
        });
      }

      return { kind: 'READY', event: validation.event, art: result.art, provenance: result.provenance };
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
    });
  };
}
