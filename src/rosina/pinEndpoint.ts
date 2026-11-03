/**
 * "Pin it to the fridge" endpoints (Phase 2, STAGED/MOCKED). Contract: docs/contracts/pin-to-fridge.md.
 *   POST /api/rosina/pin/upload   { childId, mimeType, dataBase64 } -> { assetId }   (private media)
 *   POST /api/rosina/pin          { childId, assetId, caption?, audience? } -> typed classification proposal
 *   POST /api/rosina/pin/confirm  { claims, signature } -> pins it (bound, re-authorized, idempotent)
 *
 * Every dependency is injected; NO model/provider or stack call runs here. Guardrails: the caller's
 * own bearer; parent/guardian of that child only; access to the private asset is re-checked on every
 * use (upload authorizes the child; prepare/confirm re-check the asset, so a cross-caller asset is
 * refused); uploaded text is untrusted content, never instructions; the confirm is bound to caller +
 * child + asset + caption + fields + audience + kind + version + expiry and is idempotent.
 */
import type { Request, Response } from 'express';
import { classifyPin, type RawPinExtraction, type PinProposalBody } from './pinClassify';
import { AUDIENCE_OPTIONS, type Audience, type PinExtracted } from './pinTypes';
import {
  buildPinProposal,
  captionHashOf,
  fieldsHashOf,
  pinIdempotencyKey,
  verifyClaims,
  type PinSignedClaims,
} from './pinConfirm';

export type PinIdentity = { ok: true; personId: string; demoGuide: boolean } | { ok: false };
export type ParentAuthorizer = (input: { personId: string; childId: string; bearer: string }) => Promise<boolean>;

/** Private media. Authorization is checked on EVERY access; no public bucket, no ambient id access. */
export interface MediaStore {
  /** Store EXIF/metadata-stripped bytes for a child; returns an opaque assetId. */
  put(input: { childId: string; mimeType: string; bytes: Buffer; personId: string }): Promise<{ ok: true; assetId: string } | { ok: false; code: 'TOO_LARGE' | 'UNSUPPORTED' }>;
  /** Resolve an asset for a caller — only if they are authorized for its child. A non-owner, a wrong
   *  child and a missing asset all answer `{ ok:false }` (no oracle). */
  access(input: { assetId: string; personId: string; bearer: string }): Promise<{ ok: true; childId: string; mimeType: string } | { ok: false }>;
}

export type PinExtractor = (input: { assetId: string; childId: string; caption: string | null; today: string }) => Promise<RawPinExtraction>;

export type PinRecord = { pinId: string; callerId: string; childId: string; assetId: string; kind: string; audience: string; caption: string | null; extracted: PinExtracted | null };
export interface PinStore {
  /** Idempotent: a repeated key returns the SAME pin (created:false), never a second. */
  pin(key: string, make: () => PinRecord): { record: PinRecord; created: boolean };
}

export type PinEndpointDeps = {
  verify: (header?: string) => Promise<PinIdentity>;
  authorizeParent: ParentAuthorizer;
  media: MediaStore;
  extractor: PinExtractor;
  pinStore: PinStore;
  signingKey: string;
  now?: () => Date;
  ttlMs?: number;
  today?: () => string;
  newId?: (prefix: string) => string;
};

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const DETROIT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' });

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function createPinHandlers(deps: PinEndpointDeps) {
  const now = deps.now ?? (() => new Date());
  const ttlMs = deps.ttlMs ?? 15 * 60_000;
  const today = deps.today ?? (() => DETROIT_DAY.format(now()));
  let seq = 0;
  const newId = deps.newId ?? ((p: string) => `${p}_${Date.now().toString(36)}_${seq++}`);

  async function upload(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (identity.demoGuide) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const childId = typeof b.childId === 'string' ? b.childId : '';
    const mimeType = typeof b.mimeType === 'string' ? b.mimeType : '';
    const dataBase64 = typeof b.dataBase64 === 'string' ? b.dataBase64 : '';
    if (!childId || !dataBase64) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (!ALLOWED_MIME.has(mimeType)) { res.status(415).json({ error: 'UNSUPPORTED_MEDIA_TYPE' }); return; }
    let bytes: Buffer;
    try { bytes = Buffer.from(dataBase64, 'base64'); } catch { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (bytes.length === 0) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    if (bytes.length > MAX_BYTES) { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
    const bearer = bearerOf(req);
    // Only a parent/guardian may upload a child's private asset.
    if (!(await deps.authorizeParent({ personId: identity.personId, childId, bearer }))) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const stored = await deps.media.put({ childId, mimeType, bytes, personId: identity.personId });
    if (!stored.ok) { res.status(stored.code === 'TOO_LARGE' ? 413 : 415).json({ error: stored.code === 'TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'UNSUPPORTED_MEDIA_TYPE' }); return; }
    res.status(200).json({ assetId: stored.assetId, mimeType });
  }

  async function prepare(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (identity.demoGuide) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const childId = typeof b.childId === 'string' ? b.childId : '';
    const assetId = typeof b.assetId === 'string' ? b.assetId : '';
    const caption = typeof b.caption === 'string' ? b.caption.slice(0, 500) : null; // untrusted content
    const audienceOverride = AUDIENCE_OPTIONS.includes(b.audience as Audience) ? (b.audience as Audience) : null;
    if (!childId || !assetId) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }

    const bearer = bearerOf(req);
    // Re-check asset access AS THE CALLER (cross-caller / wrong-child asset → generic refusal).
    const asset = await deps.media.access({ assetId, personId: identity.personId, bearer });
    if (!asset.ok || asset.childId !== childId) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    if (!(await deps.authorizeParent({ personId: identity.personId, childId, bearer }))) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }

    const raw = await deps.extractor({ assetId, childId, caption, today: today() });
    const body: PinProposalBody = classifyPin({ ...raw, caption: caption ?? raw.caption }, { today: today() });
    const selectedAudience = audienceOverride ?? body.audience.selected;
    const audienceOut = { selected: selectedAudience, options: body.audience.options };

    if (body.status === 'NEEDS_CLARIFICATION') {
      res.status(200).json({ ...body, audience: audienceOut, asset: { assetId, mimeType: asset.mimeType }, proposal: null });
      return;
    }

    const proposal = buildPinProposal({
      proposalId: newId('pin'), version: 1, callerId: identity.personId, childId, assetId,
      kind: body.classification.kind, audience: selectedAudience, caption: body.extracted.caption,
      extracted: body.extracted, now: now(), ttlMs, signingKey: deps.signingKey,
    });
    res.status(200).json({ ...body, audience: audienceOut, asset: { assetId, mimeType: asset.mimeType }, proposal });
  }

  async function confirm(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (identity.demoGuide) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const claimsIn = body.claims as Record<string, unknown> | undefined;
    if (!signature || !claimsIn || typeof claimsIn !== 'object') { res.status(400).json({ error: 'INVALID_PROPOSAL' }); return; }

    // callerId comes from the AUTHENTICATED id, never the body — caller binding.
    const claims: PinSignedClaims = {
      proposalId: String(claimsIn.proposalId ?? ''),
      version: Number(claimsIn.version ?? -1),
      callerId: identity.personId,
      childId: String(claimsIn.childId ?? ''),
      assetId: String(claimsIn.assetId ?? ''),
      kind: claimsIn.kind as PinSignedClaims['kind'],
      audience: claimsIn.audience as Audience,
      captionHash: String(claimsIn.captionHash ?? ''),
      fieldsHash: String(claimsIn.fieldsHash ?? ''),
      expiresAt: String(claimsIn.expiresAt ?? ''),
    };
    if (!verifyClaims(claims, signature, deps.signingKey)) { res.status(400).json({ error: 'INVALID_PROPOSAL' }); return; }

    const expMs = Date.parse(claims.expiresAt);
    if (!Number.isFinite(expMs) || now().getTime() > expMs) { res.status(410).json({ error: 'PROPOSAL_EXPIRED' }); return; }

    const bearer = bearerOf(req);
    // Re-authorize at confirm, and re-check asset access (it may have been revoked since propose).
    if (!(await deps.authorizeParent({ personId: identity.personId, childId: claims.childId, bearer }))) { res.status(403).json({ error: 'UNAUTHORIZED' }); return; }
    const asset = await deps.media.access({ assetId: claims.assetId, personId: identity.personId, bearer });
    if (!asset.ok || asset.childId !== claims.childId) { res.status(409).json({ error: 'ASSET_CHANGED' }); return; }

    // Preserve the EXACT reviewed content — do NOT re-extract at confirm. The client echoes the
    // reviewed caption + fields; we accept them only if they match the signed hashes (so the stored
    // content is provably the content the parent reviewed, bound to this proposal's signature).
    const reviewed = (body.reviewed ?? {}) as { caption?: unknown; extracted?: unknown };
    const caption: string | null = typeof reviewed.caption === 'string' ? reviewed.caption : null;
    const extracted = (reviewed.extracted && typeof reviewed.extracted === 'object' ? reviewed.extracted : null) as PinExtracted | null;
    if (captionHashOf(caption) !== claims.captionHash || fieldsHashOf((extracted ?? {}) as PinExtracted) !== claims.fieldsHash) {
      res.status(400).json({ error: 'INVALID_PROPOSAL' }); return; // reviewed content does not match what was signed
    }

    // Idempotent pin, bound to this proposal (key includes proposalId): a retry returns the same pin;
    // a distinct proposal for the same image is a different pin with its own content + audience.
    const { record, created } = deps.pinStore.pin(pinIdempotencyKey(claims), () => ({
      pinId: newId('pinned'), callerId: claims.callerId, childId: claims.childId, assetId: claims.assetId,
      kind: claims.kind, audience: claims.audience, caption, extracted,
    }));
    res.status(200).json({ status: 'PINNED', created, pin: { id: record.pinId, childId: record.childId, assetId: record.assetId, kind: record.kind, audience: record.audience, caption: record.caption, extracted: record.extracted } });
  }

  return { upload, prepare, confirm };
}

// ---- mocked, in-memory implementations (for the staged slice + tests; no storage, no network) ----

export function createInMemoryMediaStore(): MediaStore & { grant(assetId: string, personId: string): void } {
  const assets = new Map<string, { childId: string; mimeType: string }>();
  const authorized = new Map<string, Set<string>>(); // assetId -> personIds allowed
  let n = 0;
  return {
    async put({ childId, mimeType, personId }) {
      if (!ALLOWED_MIME.has(mimeType)) return { ok: false, code: 'UNSUPPORTED' };
      const assetId = `pma_${n++}`;
      assets.set(assetId, { childId, mimeType }); // NOTE: real impl strips EXIF/metadata before storing
      authorized.set(assetId, new Set([personId]));
      return { ok: true, assetId };
    },
    async access({ assetId, personId }) {
      const a = assets.get(assetId);
      if (!a || !authorized.get(assetId)?.has(personId)) return { ok: false }; // no oracle
      return { ok: true, childId: a.childId, mimeType: a.mimeType };
    },
    grant(assetId: string, personId: string) {
      (authorized.get(assetId) ?? authorized.set(assetId, new Set()).get(assetId)!).add(personId);
    },
  };
}

export function createInMemoryPinStore(): PinStore {
  const pins = new Map<string, PinRecord>();
  return {
    pin(key, make) {
      const existing = pins.get(key);
      if (existing) return { record: existing, created: false };
      const record = make();
      pins.set(key, record);
      return { record, created: true };
    },
  };
}

export { captionHashOf, fieldsHashOf };
