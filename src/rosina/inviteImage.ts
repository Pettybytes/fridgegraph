/**
 * Invite art generation. Two implementations behind one interface: a FIXTURE generator (default) and
 * a live muse-image-1.0 generator (behind INVITE_LIVE). Both return bounded bytes + provenance (model
 * id, prompt hash, generated-vs-cached). The live client sends the ART-ONLY prompt and the key only in
 * the Authorization header — it never logs the key and never returns a provider URL. n=1, size and a
 * bounded output size are forced server-side. Contract: docs/contracts/invites.md.
 */
import {
  INVITE_FIXTURE_BASE64,
  INVITE_FIXTURE_HEIGHT,
  INVITE_FIXTURE_WIDTH,
  INVITE_QUIET_AREA,
} from './inviteFixture';

export type InviteArt = {
  mimeType: string;
  width: number;
  height: number;
  base64: string;
  quietArea: { x: number; y: number; w: number; h: number };
};

export type InviteProvenance = {
  source: 'MUSE_IMAGE' | 'FIXTURE';
  model: 'muse-image-1.0' | null;
  cached: boolean;
  promptHash: string;
};

export type InviteImageResult = { art: InviteArt; provenance: InviteProvenance };

export interface InviteImageGenerator {
  generate(input: { prompt: string; promptHash: string; signal?: AbortSignal }): Promise<InviteImageResult>;
  /** True if this exact prompt is already cached — answerable with NO provider call, so the
   *  caller (inviteEndpoint.ts) can skip reserving budget for a request it already knows will be
   *  free. This is an optimization only: if the cache state changes between this check and the
   *  actual generate() call (a race with a concurrent request), generate()'s own
   *  `provenance.cached` remains the single source of truth the ledger settles against — a
   *  reservation made because this returned false is still correctly charged $0 if the real call
   *  turns out cached anyway. */
  peekCached(promptHash: string): boolean;
}

/** The provider gave a clear, synchronous error BEFORE any image was produced — safe to treat as
 *  never billed. Thrown only for a definite provider-side rejection (a non-2xx HTTP status). */
export class InviteImageConfirmedFailure extends Error {}

/** The provider MAY have generated (and billed for) the image even though this process has no
 *  usable result — a network error/timeout/abort after the request was sent (we never learn
 *  whether the provider received and processed it), or a local validation failure on an
 *  otherwise-200 response (malformed/empty/oversized body — the provider likely did generate;
 *  our own parsing or bound check is what rejected it). Must be charged conservatively, never
 *  silently released. */
export class InviteImageUncertainFailure extends Error {}

export const INVITE_IMAGE_MODEL = 'muse-image-1.0';
const QUIET = { x: INVITE_QUIET_AREA.x, y: INVITE_QUIET_AREA.y, w: INVITE_QUIET_AREA.w, h: INVITE_QUIET_AREA.h };

/** The default: a labelled fixture. Never calls the model; always a cache miss (nothing is cached). */
export function createFixtureImageGenerator(): InviteImageGenerator {
  return {
    async generate({ promptHash }) {
      return {
        art: { mimeType: 'image/png', width: INVITE_FIXTURE_WIDTH, height: INVITE_FIXTURE_HEIGHT, base64: INVITE_FIXTURE_BASE64, quietArea: { ...QUIET } },
        provenance: { source: 'FIXTURE', model: null, cached: false, promptHash },
      };
    },
    // Fixture mode never reserves budget at all (gated on source, not on this) — moot either way.
    peekCached: () => false,
  };
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // bounded server-side output

/**
 * Live muse-image-1.0. UNVERIFIED tonight — the exact Meta request shape must be reconfirmed before
 * enabling (see contract §live). A process cache keyed by promptHash makes a repeat prompt a cache
 * HIT (source still MUSE_IMAGE, cached:true). The key is used only in the Authorization header.
 */
export function createLiveImageGenerator(cfg: {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
}): InviteImageGenerator {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const doFetch = cfg.fetchFn ?? fetch;
  const cache = new Map<string, string>(); // promptHash -> base64

  return {
    peekCached: (promptHash) => cache.has(promptHash),
    async generate({ prompt, promptHash, signal }) {
      const cachedB64 = cache.get(promptHash);
      if (cachedB64) {
        return {
          art: { mimeType: 'image/png', width: 1024, height: 1024, base64: cachedB64, quietArea: { ...QUIET } },
          provenance: { source: 'MUSE_IMAGE', model: INVITE_IMAGE_MODEL, cached: true, promptHash },
        };
      }
      // The request itself may or may not have reached the provider if this throws (network
      // error, timeout, abort) — we never learn which, so that case is UNCERTAIN, not confirmed
      // failed.
      let res: Response;
      try {
        res = await doFetch(`${base}/images/generations`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: INVITE_IMAGE_MODEL, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
        });
      } catch (err) {
        throw new InviteImageUncertainFailure(`IMAGE_NETWORK_${err instanceof Error ? err.message : String(err)}`);
      }
      // A clean, synchronous provider rejection — the provider explicitly refused before
      // producing anything. Safe to treat as never billed.
      if (!res.ok) throw new InviteImageConfirmedFailure(`IMAGE_HTTP_${res.status}`);
      // Past this point the provider returned 200 — it most likely DID generate (and bill for)
      // an image. Any failure below is OUR local parsing/validation rejecting an otherwise-
      // successful response, which is exactly the "local validation failure" case that must be
      // charged conservatively, not released.
      let json: { data?: { b64_json?: string }[] };
      try {
        json = (await res.json()) as { data?: { b64_json?: string }[] };
      } catch {
        throw new InviteImageUncertainFailure('IMAGE_BODY_UNPARSEABLE');
      }
      const b64 = json.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || b64.length === 0) throw new InviteImageUncertainFailure('IMAGE_EMPTY');
      if (Buffer.byteLength(b64, 'base64') > MAX_IMAGE_BYTES) throw new InviteImageUncertainFailure('IMAGE_TOO_LARGE');
      cache.set(promptHash, b64);
      return {
        art: { mimeType: 'image/png', width: 1024, height: 1024, base64: b64, quietArea: { ...QUIET } },
        provenance: { source: 'MUSE_IMAGE', model: INVITE_IMAGE_MODEL, cached: false, promptHash },
      };
    },
  };
}
