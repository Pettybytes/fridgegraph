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
}

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
    async generate({ prompt, promptHash, signal }) {
      const cachedB64 = cache.get(promptHash);
      if (cachedB64) {
        return {
          art: { mimeType: 'image/png', width: 1024, height: 1024, base64: cachedB64, quietArea: { ...QUIET } },
          provenance: { source: 'MUSE_IMAGE', model: INVITE_IMAGE_MODEL, cached: true, promptHash },
        };
      }
      const res = await doFetch(`${base}/images/generations`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: INVITE_IMAGE_MODEL, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
      });
      if (!res.ok) throw new Error(`IMAGE_HTTP_${res.status}`);
      const json = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = json.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || b64.length === 0) throw new Error('IMAGE_EMPTY');
      if (Buffer.byteLength(b64, 'base64') > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
      cache.set(promptHash, b64);
      return {
        art: { mimeType: 'image/png', width: 1024, height: 1024, base64: b64, quietArea: { ...QUIET } },
        provenance: { source: 'MUSE_IMAGE', model: INVITE_IMAGE_MODEL, cached: false, promptHash },
      };
    },
  };
}
