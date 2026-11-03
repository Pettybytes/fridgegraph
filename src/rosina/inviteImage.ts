/**
 * Invite art generation on Meta's DOCUMENTED Muse Image interfaces:
 *   - generations: POST ${baseUrl}/images/generations  { model, prompt, n, size, response_format,
 *     output_format }  (https://dev.meta.ai/docs/image-generation)
 *   - edits:       POST ${baseUrl}/images/edits         { model, prompt, images:[{image_url}], n,
 *     response_format, output_format }  (https://dev.meta.ai/docs/api-reference/images/edit-image)
 *
 * `size` is an ASPECT RATIO, not an exact pixel size, and `output_format` defaults to webp — so we
 * request png but READ the actual `output_format` from the response and the actual pixel dimensions
 * from the returned bytes (never assume PNG 1024×1024). A reference image (parent upload, or the prior
 * generated result for a revision) routes to /images/edits so the actual image guides the result. The
 * key lives only in the Authorization header and is never logged; no provider URL is returned.
 */
import { readImageDimensions, sniffImageMime, type ImageMime } from './imageHygiene';
import {
  INVITE_FIXTURE_BASE64, INVITE_FIXTURE_HEIGHT, INVITE_FIXTURE_WIDTH, INVITE_QUIET_AREA,
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
  /** The actual output format the provider returned (verified, never assumed). */
  outputFormat?: string;
  /** Whether a reference image was used (an /images/edits remix/revision rather than a fresh generation). */
  edited?: boolean;
};

export type InviteImageResult = { art: InviteArt; provenance: InviteProvenance };

/** A reference image for an edit/revision — raw bytes + its real mime. */
export type InviteImageRef = { bytes: Uint8Array; mimeType: ImageMime };

export interface InviteImageGenerator {
  generate(input: { prompt: string; promptHash: string; images?: InviteImageRef[]; signal?: AbortSignal }): Promise<InviteImageResult>;
  peekCached(promptHash: string): boolean;
}

export class InviteImageConfirmedFailure extends Error {}
export class InviteImageUncertainFailure extends Error {}

export const INVITE_IMAGE_MODEL = 'muse-image-1.0';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The bottom-third text band as a fraction of the ACTUAL image, so it tracks any aspect/size. The
 *  brief keeps this band empty of model lettering and the renderer plates over it regardless. */
export function quietAreaFor(width: number, height: number): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(width * 0.08), y: Math.round(height * 0.67), w: Math.round(width * 0.84), h: Math.round(height * 0.29) };
}

/** The default: a labelled fixture. Never calls the model; always a cache miss. */
export function createFixtureImageGenerator(): InviteImageGenerator {
  return {
    async generate({ promptHash, images }) {
      return {
        art: { mimeType: 'image/png', width: INVITE_FIXTURE_WIDTH, height: INVITE_FIXTURE_HEIGHT, base64: INVITE_FIXTURE_BASE64, quietArea: { ...INVITE_QUIET_AREA } },
        provenance: { source: 'FIXTURE', model: null, cached: false, promptHash, outputFormat: 'png', edited: Boolean(images?.length) },
      };
    },
    peekCached: () => false,
  };
}

const MIME_FOR: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' };

/** Live muse-image-1.0 over Meta's generations + edits endpoints. UNVERIFIED against a running
 *  provider until the Bentley window; the request/response shapes follow the published docs. */
export function createLiveImageGenerator(cfg: { apiKey: string; baseUrl: string; fetchFn?: typeof fetch; size?: string }): InviteImageGenerator {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const doFetch = cfg.fetchFn ?? fetch;
  const size = cfg.size ?? '1024x1536'; // a portrait-ish invitation aspect ratio
  const cache = new Map<string, InviteImageResult>();

  return {
    peekCached: (promptHash) => cache.has(promptHash),
    async generate({ prompt, promptHash, images, signal }) {
      const cached = cache.get(promptHash);
      if (cached) return { art: cached.art, provenance: { ...cached.provenance, cached: true } };

      const edit = Boolean(images && images.length);
      const url = edit ? `${base}/images/edits` : `${base}/images/generations`;
      const body: Record<string, unknown> = { model: INVITE_IMAGE_MODEL, prompt, n: 1, size, response_format: 'b64_json', output_format: 'png' };
      if (edit) {
        body.images = images!.map((im) => ({ image_url: `data:${im.mimeType};base64,${Buffer.from(im.bytes).toString('base64')}` }));
      }

      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) });
      } catch (err) {
        throw new InviteImageUncertainFailure(`IMAGE_NETWORK_${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) throw new InviteImageConfirmedFailure(`IMAGE_HTTP_${res.status}`);

      let json: { data?: { b64_json?: string }[]; output_format?: string };
      try { json = (await res.json()) as typeof json; } catch { throw new InviteImageUncertainFailure('IMAGE_BODY_UNPARSEABLE'); }
      const b64 = json.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || b64.length === 0) throw new InviteImageUncertainFailure('IMAGE_EMPTY');
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES) throw new InviteImageUncertainFailure('IMAGE_TOO_LARGE');

      // VERIFY the actual format + dimensions from the bytes — never assume.
      const sniffed = sniffImageMime(bytes);
      const outputFormat = (json.output_format ?? (sniffed ? sniffed.split('/')[1] : 'png')).toLowerCase();
      const mimeType = (sniffed as string | null) ?? MIME_FOR[outputFormat] ?? 'image/png';
      const dims = sniffed ? readImageDimensions(bytes, sniffed) : null;
      if (!dims || dims.width < 1 || dims.height < 1) throw new InviteImageUncertainFailure('IMAGE_DIMENSIONS_UNREADABLE');

      const result: InviteImageResult = {
        art: { mimeType, width: dims.width, height: dims.height, base64: b64, quietArea: quietAreaFor(dims.width, dims.height) },
        provenance: { source: 'MUSE_IMAGE', model: INVITE_IMAGE_MODEL, cached: false, promptHash, outputFormat, edited: edit },
      };
      cache.set(promptHash, result);
      return result;
    },
  };
}
