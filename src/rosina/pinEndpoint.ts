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
  /** Store EXIF/metadata-stripped bytes for a child; returns an opaque assetId. The caller's bearer
   *  is required so the real store registers the row AS THE CALLER (parent-only, enforced in the db). */
  put(input: { childId: string; mimeType: string; bytes: Buffer; personId: string; bearer: string }): Promise<{ ok: true; assetId: string } | { ok: false; code: 'TOO_LARGE' | 'UNSUPPORTED' }>;
  /** Resolve an asset for a caller — only if they are authorized for its child. A non-owner, a wrong
   *  child and a missing asset all answer `{ ok:false }` (no oracle). */
  access(input: { assetId: string; personId: string; bearer: string }): Promise<{ ok: true; childId: string; mimeType: string } | { ok: false }>;
}

/** Re-authorized byte load for the retrieval endpoint (the real store's `load`). */
export type MediaLoad = (input: { assetId: string; personId: string; bearer: string }) => Promise<{ bytes: Uint8Array; mimeType: string; access: string } | null>;

/** Readiness: the web checks this before offering the real intake. Default OFF. */
export type PinReadiness = () => { ready: boolean; reasons: string[] };

export type PinExtractor = (input: { assetId: string; childId: string; caption: string | null; today: string; image: { bytes: Uint8Array; mimeType: string } | null }) => Promise<RawPinExtraction>;

export type PinRecord = { pinId: string; callerId: string; childId: string; assetId: string; kind: string; audience: string; caption: string | null; extracted: PinExtracted | null };
export interface PinStore {
  /** Idempotent: a repeated key returns the SAME pin (created:false), never a second. Async and
   *  bearer-bound because the real store writes a fridge_notes row through the CALLER's RLS client.
   *  May throw a PinPersistenceError (e.g. CAPTION_REQUIRED) which confirm maps to a bounded status. */
  pin(key: string, bearer: string, make: () => PinRecord): Promise<{ record: PinRecord; created: boolean }> | { record: PinRecord; created: boolean };
}

export class PinPersistenceError extends Error {
  constructor(public code: 'CAPTION_REQUIRED' | 'PERSIST_FAILED') { super(code); this.name = 'PinPersistenceError'; }
}

export type PinEndpointDeps = {
  verify: (header?: string) => Promise<PinIdentity>;
  authorizeParent: ParentAuthorizer;
  media: MediaStore;
  extractor: PinExtractor;
  pinStore: PinStore;
  signingKey: string;
  mediaLoad?: MediaLoad;
  readiness?: PinReadiness;
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
    const stored = await deps.media.put({ childId, mimeType, bytes, personId: identity.personId, bearer });
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

    // Load the authorized bytes (re-checked as the caller) for the extractor. The fixture extractor
    // ignores them; the live Muse vision extractor reads them. Absent loader → no image (fixture path).
    const loaded = deps.mediaLoad ? await deps.mediaLoad({ assetId, personId: identity.personId, bearer }) : null;
    const image = loaded ? { bytes: loaded.bytes, mimeType: loaded.mimeType } : null;
    const raw = await deps.extractor({ assetId, childId, caption, today: today(), image });
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
    let record: PinRecord, created: boolean;
    try {
      ({ record, created } = await deps.pinStore.pin(pinIdempotencyKey(claims), bearer, () => ({
        pinId: newId('pinned'), callerId: claims.callerId, childId: claims.childId, assetId: claims.assetId,
        kind: claims.kind, audience: claims.audience, caption, extracted,
      })));
    } catch (e) {
      if (e instanceof PinPersistenceError && e.code === 'CAPTION_REQUIRED') { res.status(422).json({ error: 'CAPTION_REQUIRED' }); return; }
      res.status(502).json({ error: 'PERSIST_FAILED' }); return;
    }
    res.status(200).json({ status: 'PINNED', created, pin: { id: record.pinId, childId: record.childId, assetId: record.assetId, kind: record.kind, audience: record.audience, caption: record.caption, extracted: record.extracted } });
  }

  /** GET the pinned image. Caller-scoped: the loader re-evaluates authority (parent, or SHARED via a
   *  fridge.read grant) on every fetch. A refusal and a missing asset return the SAME generic 404 —
   *  no oracle. No durable URL is ever handed out; bytes are served no-store. */
  async function download(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    const assetId = (req.params?.id ?? (typeof req.query?.id === 'string' ? req.query.id : '')) || '';
    if (!assetId) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const bearer = bearerOf(req);
    const loaded = deps.mediaLoad ? await deps.mediaLoad({ assetId, personId: identity.personId, bearer }) : null;
    if (!loaded) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    res.setHeader('Content-Type', loaded.mimeType);
    res.setHeader('X-Pin-Media-Access', loaded.access);
    res.send(Buffer.from(loaded.bytes));
  }

  /** Unauthenticated capability probe. Default OFF — the web must not offer the real intake until the
   *  deployment reports ready. Reasons are intentionally generic (no config values). */
  function readiness(_req: Request, res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(deps.readiness ? deps.readiness() : { ready: false, reasons: ['not configured'] });
  }

  return { upload, prepare, confirm, download, readiness };
}

// ---- mocked, in-memory implementations (for the staged slice + tests; no storage, no network) ----

export function createInMemoryMediaStore(): MediaStore & { grant(assetId: string, personId: string): void } {
  const assets = new Map<string, { childId: string; mimeType: string }>();
  const authorized = new Map<string, Set<string>>(); // assetId -> personIds allowed
  let n = 0;
  return {
    async put({ childId, mimeType, personId }: { childId: string; mimeType: string; bytes: Buffer; personId: string; bearer: string }) {
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
    async pin(key, _bearer, make) {
      const existing = pins.get(key);
      if (existing) return { record: existing, created: false };
      const record = make();
      pins.set(key, record);
      return { record, created: true };
    },
  };
}

export { captionHashOf, fieldsHashOf };
