/**
 * Authenticated endpoint for the Invites slice. Contract: docs/contracts/invites.md.
 *   POST /api/rosina/invite  { childId, request }  → structured editable event fields + art-only bytes
 *
 * Order is a hard guardrail: authenticate → refuse the demo guide → validate the body (no photo) →
 * per-caller rate limit → parent/guardian authorization → ONLY THEN any model call. A refused caller
 * triggers zero Spark/image calls. The image step is gated by a process-wide generation budget a new
 * login cannot reset. Every dependency is injected; the key lives only in the live image client and
 * is never logged. Logs non-content metadata only (never the request text, never the key).
 */
import type { Request, Response } from 'express';
import { buildArtPrompt, promptHash, assertNoPii } from './invitePrompt';
import { validateInviteFields, detroitToday, type RawInviteExtraction } from './inviteFields';
import type { InviteImageGenerator } from './inviteImage';
import type { InviteRateLimiter, GenerationBudget } from './inviteBudget';

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
  budget: GenerationBudget;
  /** The active image source, for provenance on a clarification (no image generated). */
  source: 'MUSE_IMAGE' | 'FIXTURE';
  now?: () => Date;
  maxRequestChars?: number;
};

const IMAGE_KEYS = ['image', 'photo', 'imageBase64', 'photoBase64', 'dataBase64', 'upload', 'file', 'attachment'];

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
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

    // Per-caller rate limit.
    const rl = deps.rateLimiter.take(identity.personId);
    if (!rl.allowed) { log(429, ' RATE_LIMITED'); res.status(429).json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }); return; }

    const bearer = bearerOf(req);
    // Parent/guardian authorization BEFORE any model call. A refusal is generic (no oracle) and
    // never reaches Spark or the image model.
    if (!(await deps.authorizeParent({ personId: identity.personId, childId, bearer }))) {
      log(403); res.status(403).json({ error: 'UNAUTHORIZED' }); return;
    }

    const today = detroitToday(now());

    // Muse Spark: extract fields. A failure folds into the single model-pipeline error (502).
    let raw: RawInviteExtraction;
    try {
      raw = await deps.extractor({ request, today });
    } catch {
      log(502, ' EXTRACTION'); res.status(502).json({ error: 'IMAGE_FAILED' }); return;
    }

    const validation = validateInviteFields(raw, { today });
    if (validation.status === 'NEEDS_CLARIFICATION') {
      log(200, ' NEEDS_CLARIFICATION');
      res.status(200).json({
        status: 'NEEDS_CLARIFICATION',
        clarification: validation.clarification,
        event: validation.event,
        art: null,
        provenance: { source: deps.source, model: null, cached: false, promptHash: '' },
      });
      return;
    }

    // READY → the generation budget gates the image step (a new login cannot reset it).
    if (!deps.budget.tryConsume()) { log(429, ' BUDGET'); res.status(429).json({ error: 'BUDGET_EXHAUSTED' }); return; }

    const prompt = buildArtPrompt(validation.event.occasion);
    const hash = promptHash(prompt);

    // Belt-and-suspenders: the prompt is built from fixed theme strings and never echoes input, so a
    // name/date/venue is impossible — but if the guard ever matches (a name that is exactly a theme
    // word), refuse cleanly and REFUND the budget: nothing was generated. Logs metadata only, never
    // the name/prompt/key.
    try {
      assertNoPii(prompt, validation.event);
    } catch {
      deps.budget.refund();
      log(502, ' PROMPT_GUARD');
      res.status(502).json({ error: 'IMAGE_FAILED' });
      return;
    }

    let result;
    try {
      result = await deps.image.generate({ prompt, promptHash: hash });
    } catch {
      log(502, ' IMAGE'); res.status(502).json({ error: 'IMAGE_FAILED' }); return;
    }

    log(200, ` READY source=${result.provenance.source} cached=${result.provenance.cached} promptHash=${hash.slice(0, 12)}`);
    res.status(200).json({
      status: 'READY',
      clarification: null,
      event: validation.event,
      art: result.art,
      provenance: result.provenance,
    });
  };
}
