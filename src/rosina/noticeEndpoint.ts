/**
 * Authenticated endpoints behind the Rosina server for Notice → Plan. Contract:
 * docs/contracts/notice-plan.md §2, §4, §5.
 *
 *   POST /api/rosina/notice-plan          prepare a REVIEW-ONLY proposal from a notice
 *   POST /api/rosina/notice-plan/confirm  confirm a prior proposal (server-enforced gates)
 *
 * Every dependency is injected so the server wires real implementations and tests force each
 * refusal. No raw document bytes and no signed URL are ever logged — only non-content metadata.
 * The caller's own bearer drives every authorized read and the one pickup write; identity is never
 * minted. The confirm's caller binding comes from the AUTHENTICATED person id (never the request
 * body): the signature was signed with the original caller's id, so a different caller cannot verify.
 */
import type { Request, Response } from 'express';
import type { RateLimiter } from './rateLimit';
import type { RawExtraction } from './noticeFacts';
import { validateExtraction, type ProcessingSource } from './noticeFacts';
import {
  detectEarlyDismissalConflict,
  type ConflictResult,
  type PickupWindow,
  type ScheduleEvent,
} from './noticeConflict';
import {
  buildSignedProposal,
  scheduleFingerprint,
  verifyClaims,
  type SignedClaims,
} from './noticeProposal';

export type NoticeIdentity = { ok: true; personId: string } | { ok: false };

export type NoticeInput =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'pdf'; mimeType: string; bytes: Buffer };

export type ScheduleReadResult = { events: ScheduleEvent[]; effectiveSource: string };

/** Reads the child's schedule AS THE CALLER. Returns null when the caller is not authorized for the
 *  child (fail closed) — the endpoint maps that to the generic refusal, no existence oracle. */
export type ScheduleReader = (input: {
  childId: string; date: string; bearer: string; signal?: AbortSignal;
}) => Promise<ScheduleReadResult | null>;

export type NoticeExtractor = (input: {
  notice: NoticeInput; referenceDate: string; timezone: string; answer?: string; signal?: AbortSignal;
}) => Promise<RawExtraction & { processingSource: ProcessingSource }>;

/** Calls the real `requestPickup` as the caller. UNAUTHORIZED is the parent-only DB refusal. */
export type PickupRequester = (input: {
  childId: string; asOf: string; window: PickupWindow; bearer: string; signal?: AbortSignal;
}) => Promise<{ ok: true; jobId: string; status: string } | { ok: false; code: 'UNAUTHORIZED' | 'ERROR' }>;

export type NoticeEndpointDeps = {
  verify: (header?: string) => Promise<NoticeIdentity>;
  rateLimiter: RateLimiter;
  scheduleReader: ScheduleReader;
  extractor: NoticeExtractor;
  requestPickup: PickupRequester;
  signingKey: string;
  scenarioDate: string; // the explicit reference date for this deployment's scenario
  timezone?: string; // default America/Detroit
  fallbackModelId?: string; // default muse-spark-1.3
  now?: () => Date;
  newProposalId?: () => string;
  ttlMs?: number; // default 15 min
  maxDecodedBytes?: number; // default 8 MB
  maxTextChars?: number; // default 20 000
};

const ALLOWED_IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp']);

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

/** Parse + validate the notice body, enforcing MIME and size. Returns the input or a typed error. */
function parseNotice(
  body: unknown,
  limits: { maxDecodedBytes: number; maxTextChars: number },
): { ok: true; childId: string; notice: NoticeInput; resume?: { proposalId: string; version: number; answer: string } }
  | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'INVALID_REQUEST' };
  const b = body as Record<string, unknown>;
  const childId = typeof b.childId === 'string' ? b.childId : '';
  if (!childId) return { ok: false, status: 400, error: 'INVALID_REQUEST' };

  let resume: { proposalId: string; version: number; answer: string } | undefined;
  if (b.resume && typeof b.resume === 'object') {
    const r = b.resume as Record<string, unknown>;
    if (typeof r.proposalId === 'string' && typeof r.version === 'number' && typeof r.answer === 'string') {
      resume = { proposalId: r.proposalId, version: r.version, answer: r.answer.slice(0, 500) };
    }
  }

  const n = b.notice;
  if (!n || typeof n !== 'object') return { ok: false, status: 400, error: 'INVALID_REQUEST' };
  const no = n as Record<string, unknown>;
  const kind = no.kind;

  if (kind === 'text') {
    if (typeof no.text !== 'string' || no.text.trim() === '') return { ok: false, status: 400, error: 'INVALID_REQUEST' };
    if (no.text.length > limits.maxTextChars) return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
    return { ok: true, childId, notice: { kind: 'text', text: no.text }, resume };
  }

  if (kind === 'image' || kind === 'pdf') {
    const mimeType = typeof no.mimeType === 'string' ? no.mimeType : '';
    if (kind === 'image' && !ALLOWED_IMAGE.has(mimeType)) return { ok: false, status: 415, error: 'UNSUPPORTED_MEDIA_TYPE' };
    if (kind === 'pdf' && mimeType !== 'application/pdf') return { ok: false, status: 415, error: 'UNSUPPORTED_MEDIA_TYPE' };
    if (typeof no.dataBase64 !== 'string' || no.dataBase64.length === 0) return { ok: false, status: 400, error: 'INVALID_REQUEST' };
    let bytes: Buffer;
    try {
      bytes = Buffer.from(no.dataBase64, 'base64');
    } catch {
      return { ok: false, status: 400, error: 'INVALID_REQUEST' };
    }
    if (bytes.length === 0) return { ok: false, status: 400, error: 'INVALID_REQUEST' };
    if (bytes.length > limits.maxDecodedBytes) return { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' };
    return { ok: true, childId, notice: { kind, mimeType, bytes }, resume };
  }

  return { ok: false, status: 415, error: 'UNSUPPORTED_MEDIA_TYPE' };
}

export function createNoticePlanHandlers(deps: NoticeEndpointDeps) {
  const timezone = deps.timezone ?? 'America/Detroit';
  const fallbackModelId = deps.fallbackModelId ?? 'muse-spark-1.3';
  const now = deps.now ?? (() => new Date());
  const ttlMs = deps.ttlMs ?? 15 * 60_000;
  const maxDecodedBytes = deps.maxDecodedBytes ?? 8 * 1024 * 1024;
  const maxTextChars = deps.maxTextChars ?? 20_000;
  let seq = 0;
  const newProposalId = deps.newProposalId ?? (() => `np_${Date.now().toString(36)}_${seq++}`);

  async function prepare(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!deps.rateLimiter.allow(identity.personId)) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }

    const parsed = parseNotice(req.body, { maxDecodedBytes, maxTextChars });
    if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error }); return; }

    const bearer = bearerOf(req);
    const log = (status: number, extra = '') =>
      console.log(`[rosina:notice] person=${identity.personId} child=${parsed.childId} kind=${parsed.notice.kind} status=${status}${extra}`);

    // Read the schedule AS THE CALLER. A null result is the generic refusal (fail closed, no oracle).
    const schedule = await deps.scheduleReader({ childId: parsed.childId, date: deps.scenarioDate, bearer });
    if (schedule === null) { log(403); res.status(403).json({ error: 'UNAUTHORIZED' }); return; }

    let raw: RawExtraction & { processingSource: ProcessingSource };
    try {
      raw = await deps.extractor({ notice: parsed.notice, referenceDate: deps.scenarioDate, timezone, answer: parsed.resume?.answer });
    } catch (err) {
      if (err instanceof Error && err.message === 'PDF_NOT_SUPPORTED') { log(501); res.status(501).json({ error: 'PDF_NOT_SUPPORTED' }); return; }
      log(502); res.status(502).json({ error: 'EXTRACTION_FAILED' }); return;
    }

    const submittedText = parsed.notice.kind === 'text' ? parsed.notice.text : null;
    const extraction = validateExtraction(raw, { processingSource: raw.processingSource, submittedText, fallbackModelId });

    const conflicts: ConflictResult[] = extraction.facts.map((fact) =>
      fact.kind === 'early_dismissal'
        ? detectEarlyDismissalConflict(fact, fact.dates[0] ?? deps.scenarioDate, schedule.events)
        : { hasConflict: false, detail: 'No schedule comparison applies to this change.' },
    );

    const proposal = buildSignedProposal({
      proposalId: parsed.resume?.proposalId ?? newProposalId(),
      version: parsed.resume ? parsed.resume.version + 1 : 1,
      callerId: identity.personId,
      childId: parsed.childId,
      scenarioDate: deps.scenarioDate,
      timezone,
      processingSource: raw.processingSource,
      modelId: extraction.modelId,
      now: now(),
      ttlMs,
      signingKey: deps.signingKey,
      clarification: extraction.clarification,
      facts: extraction.facts,
      conflicts,
      fingerprint: scheduleFingerprint(schedule.events, schedule.effectiveSource),
    });

    log(200, ` facts=${extraction.facts.length} dropped=${extraction.dropped.length} clarify=${extraction.clarification ? 1 : 0} action=${proposal.changes.some((c) => 'action' in c.onConfirm) ? 1 : 0}`);
    res.status(200).json(proposal);
  }

  async function confirm(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!deps.rateLimiter.allow(identity.personId)) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }

    const b = (req.body ?? {}) as Record<string, unknown>;
    const signature = typeof b.signature === 'string' ? b.signature : '';
    const claimsIn = b.claims as Record<string, unknown> | undefined;
    if (!signature || !claimsIn || typeof claimsIn !== 'object') { res.status(400).json({ error: 'INVALID_PROPOSAL' }); return; }

    // Reconstruct the signed claims, taking callerId from the AUTHENTICATED id, never the body.
    const claims: SignedClaims = {
      proposalId: String(claimsIn.proposalId ?? ''),
      version: Number(claimsIn.version ?? -1),
      callerId: identity.personId,
      childId: String(claimsIn.childId ?? ''),
      scenarioDate: String(claimsIn.scenarioDate ?? ''),
      action: claimsIn.action === 'requestPickup' ? 'requestPickup' : 'none',
      params:
        claimsIn.params && typeof claimsIn.params === 'object'
          ? { asOf: String((claimsIn.params as Record<string, unknown>).asOf ?? ''), window: (claimsIn.params as Record<string, unknown>).window as PickupWindow }
          : null,
      scheduleFingerprint: String(claimsIn.scheduleFingerprint ?? ''),
      expiresAt: String(claimsIn.expiresAt ?? ''),
    };

    const bearer = bearerOf(req);
    const log = (status: number) =>
      console.log(`[rosina:notice-confirm] person=${identity.personId} child=${claims.childId} proposal=${claims.proposalId} v=${claims.version} status=${status}`);

    // 1. Signature over the exact claims (callerId from auth → caller binding enforced here).
    if (!verifyClaims(claims, signature, deps.signingKey)) { log(400); res.status(400).json({ error: 'INVALID_PROPOSAL' }); return; }

    // 2. Review-only proposals have nothing to confirm.
    if (claims.action !== 'requestPickup' || claims.params === null) { log(422); res.status(422).json({ error: 'NO_ACTION_AVAILABLE' }); return; }

    // 3. Expiry.
    const expMs = Date.parse(claims.expiresAt);
    if (!Number.isFinite(expMs) || now().getTime() > expMs) { log(410); res.status(410).json({ error: 'PROPOSAL_EXPIRED' }); return; }

    // 4. Stale check: re-read the schedule AS THE CALLER (also the generic refusal gate) and compare.
    const schedule = await deps.scheduleReader({ childId: claims.childId, date: claims.scenarioDate, bearer });
    if (schedule === null) { log(403); res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const fresh = scheduleFingerprint(schedule.events, schedule.effectiveSource);
    if (fresh !== claims.scheduleFingerprint) { log(409); res.status(409).json({ error: 'PROPOSAL_STALE' }); return; }

    // 5. Act: requestPickup exactly once. Its own idempotency key makes a retry return the same job.
    const result = await deps.requestPickup({ childId: claims.childId, asOf: claims.params.asOf, window: claims.params.window, bearer });
    if (!result.ok) {
      const status = result.code === 'UNAUTHORIZED' ? 403 : 502;
      log(status);
      res.status(status).json({ error: result.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'PICKUP_FAILED' });
      return;
    }

    log(200);
    res.status(200).json({ job: { id: result.jobId, status: result.status } });
  }

  return { prepare, confirm };
}
