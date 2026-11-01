/**
 * Authenticated endpoint behind the Rosina server for photo → descriptor SUGGESTIONS.
 * RosinaPanel calls it with `{ childId, photoId }` and the caller's bearer. It:
 *   1. authenticates the bearer,
 *   2. rate-limits per caller,
 *   3. authorizes the caller for THAT child AND THAT photo (fail closed),
 *   4. loads the EXIF-stripped photo from authorized storage itself,
 *   5. fetches the child's controlled vocabulary,
 *   6. calls the one Meta vision client and maps to in-vocabulary suggestions.
 * It returns only a review proposal — it never drafts, activates, or sends. Every dependency
 * is injected so the server wires real implementations and tests can force each refusal.
 * Logs non-content metadata only (never the raw image, never descriptor values).
 */
import type { Request, Response } from 'express';
import type { RateLimiter } from './rateLimit';
import { proposePhotoDescriptors, type VisionClient, type VisionImage } from './photoDescriptors';

export type PhotoIdentity = { ok: true; personId: string } | { ok: false };
export type PhotoAuthorizer = (input: {
  personId: string; childId: string; photoId: string; bearer: string; signal?: AbortSignal;
}) => Promise<boolean>;
export type PhotoStore = {
  /** Returns the EXIF-stripped image, or null when it does not exist / is not this caller's. */
  load(input: { photoId: string; childId: string; bearer: string; signal?: AbortSignal }): Promise<VisionImage | null>;
};
export type VocabularyFetcher = (input: {
  childId: string; bearer: string; signal?: AbortSignal;
}) => Promise<ReadonlyMap<string, ReadonlySet<string>>>;

export type PhotoEndpointDeps = {
  verify: (header?: string) => Promise<PhotoIdentity>;
  rateLimiter: RateLimiter;
  authorize: PhotoAuthorizer;
  photoStore: PhotoStore;
  vocabulary: VocabularyFetcher;
  vision: VisionClient | null; // null when no vision provider is configured
};

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function createPhotoDescriptorsHandler(deps: PhotoEndpointDeps) {
  return async function handle(req: Request, res: Response): Promise<void> {
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!deps.rateLimiter.allow(identity.personId)) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }

    const body = (req.body ?? {}) as { childId?: unknown; photoId?: unknown };
    const childId = typeof body.childId === 'string' ? body.childId : '';
    const photoId = typeof body.photoId === 'string' ? body.photoId : '';
    if (!childId || !photoId) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }

    const bearer = bearerOf(req);
    const log = (status: number, extra = '') =>
      console.log(`[rosina:photo] person=${identity.personId} child=${childId} photo=${photoId} status=${status}${extra}`);

    try {
      // Fail closed: the caller must be authorized for both the child and the photo.
      if (!(await deps.authorize({ personId: identity.personId, childId, photoId, bearer }))) {
        log(403); res.status(403).json({ error: 'NOT_AUTHORIZED' }); return;
      }
      if (!deps.vision) { log(503); res.status(503).json({ error: 'VISION_UNAVAILABLE' }); return; }

      const image = await deps.photoStore.load({ photoId, childId, bearer });
      if (!image) { log(404); res.status(404).json({ error: 'PHOTO_NOT_FOUND' }); return; }

      const vocabularyByKind = await deps.vocabulary({ childId, bearer });
      const proposal = await proposePhotoDescriptors({ image, childId, vocabularyByKind, vision: deps.vision });

      log(200, ` model=${proposal.modelId} source=${proposal.source} kept=${Object.keys(proposal.descriptors).length} dropped=${proposal.dropped.length}`);
      res.status(200).json(proposal);
    } catch {
      log(502); res.status(502).json({ error: 'VISION_ERROR' });
    }
  };
}
