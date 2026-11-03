/**
 * Production wiring for "Pin it to the fridge" — the real dependencies behind createPinHandlers.
 * Mirrors photoDeps/inviteDeps: every decision is made AS THE CALLER (bearer forwarded, never a
 * service key). Parent authority is pre-checked here (checkInStatus, same signal invites use) and is
 * ALSO enforced in the database (register_pin_media / fridge_notes RLS / pin_media_access).
 */
import { verifyBearer } from '../auth/verify';
import type { ParentAuthorizer, PinEndpointDeps } from './pinEndpoint';
import { buildPinMediaStore } from './pinMediaStore';
import { buildFridgeNoteWriter, createFridgeNotePinStore } from './pinPersistence';
import { buildPinExtractor, type PinVisionProvenance } from './pinVision';
import { buildPinSegmenter, type SegmentProvenance } from './pinSegment';
import { pinIntakeReadiness } from './pinReadiness';

/** Parent/guardian of the child, AS THE CALLER — the parent-only `checkInStatus` read (a clean result
 *  proves parent authority; non-parent / unseeable / missing all answer identically — no oracle). */
export function buildPinParentAuthorizer(cfg: { graphqlUrl: string; fetchFn?: typeof fetch }): ParentAuthorizer {
  const doFetch = cfg.fetchFn ?? fetch;
  const QUERY = 'query PinParent($c: ID!){ checkInStatus(childId: $c){ child { id } } }';
  return async ({ childId, bearer }) => {
    try {
      const res = await doFetch(cfg.graphqlUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query: QUERY, variables: { c: childId } }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { data?: { checkInStatus?: { child?: { id?: string } } | null }; errors?: unknown[] };
      if (body.errors && body.errors.length > 0) return false;
      return Boolean(body.data?.checkInStatus?.child?.id);
    } catch {
      return false;
    }
  };
}

export function buildPinDeps(cfg: {
  graphqlUrl: string;
  signingKey: string;
  mediaDir: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  log?: (p: PinVisionProvenance) => void;
  segmentLog?: (p: SegmentProvenance) => void;
}): PinEndpointDeps {
  const env = cfg.env ?? process.env;
  const media = buildPinMediaStore({ mediaDir: cfg.mediaDir });
  const writer = buildFridgeNoteWriter();
  return {
    verify: async (h) => { const id = await verifyBearer(h); return id.ok ? { ok: true, personId: id.personId, demoGuide: id.demoGuide } : { ok: false }; },
    authorizeParent: buildPinParentAuthorizer({ graphqlUrl: cfg.graphqlUrl, fetchFn: cfg.fetchFn }),
    media,
    extractor: buildPinExtractor({ env, fetchFn: cfg.fetchFn, log: cfg.log }),
    segmenter: buildPinSegmenter({ env, fetchFn: cfg.fetchFn, log: cfg.segmentLog }),
    pinStore: createFridgeNotePinStore({ writer }),
    mediaLoad: (input) => media.load(input),
    readiness: () => pinIntakeReadiness(env),
    signingKey: cfg.signingKey,
  };
}
