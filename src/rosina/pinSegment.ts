/**
 * "Pin it to the fridge" — SEGMENTATION. Meta SAM 3.1 finds the piece of paper in a phone photo and
 * returns its box, so the fridge can crop (and straighten) to just the document instead of showing
 * the whole kitchen counter. Behind a fixture default (PIN_LIVE != '1'), mirroring pinVision.ts.
 *
 * Request/response shape confirmed against Meta Model API docs (fetched 2026-11-03):
 *   - Model line + protocol: https://dev.meta.ai/docs/models#sam-3  (model `sam-3.1`, Responses API)
 *   - Request:              https://dev.meta.ai/docs/media-segmentation  (POST /v1/responses; a
 *                           `message` with an `input_text` noun phrase + an `input_image`)
 *   - Confidence flag:      https://dev.meta.ai/docs/sam/segmenting#confidence
 *                           (metadata.include_confidence = "true", a STRING not a bool)
 *   - Output grammar:       https://dev.meta.ai/docs/sam/reading-segmentation#structure
 *                           (`<Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H[;c=..]|><|mask;..|>`,
 *                            box coords in pixels of the WxH frame; c in [0,1])
 *
 * Design note (why the server records geometry, never re-rasters bytes): this repo is deliberately
 * dependency-free for media (pinMedia.ts hand-rolls EXIF strip; there is no sharp/jimp). SAM returns
 * a box; we record it as a normalized crop the FRIDGE applies at render time. The stored asset stays
 * the EXIF-stripped original; the crop is render-only and is NOT part of the signed confirm claims.
 * The raw image bytes are NEVER logged — only metadata provenance (model, concept, confidence).
 *
 * Honesty rules (contract §7): a plain photo skips SAM; if SAM is unavailable OR finds no paper, we
 * return { applied:false } so the caller places the photo UNCROPPED with an honest note. SAM never
 * blocks the upload, and we never invent a crop we did not get from the model.
 */
import { resolveProvider, type ProviderConfig, type ProviderId } from '../muse/providers';

/** Normalized (0..1 of the source image) crop rectangle the fridge applies at render time. */
export type CropRect = { x: number; y: number; width: number; height: number };

export type PinSegmentation =
  | { applied: true; source: 'SAM_3_1' | 'FIXTURE'; model: string | null; concept: string; crop: CropRect; rotationDeg: number; confidence: number | null }
  | { applied: false; source: 'SAM_3_1' | 'FIXTURE' | 'NONE'; reason: string };

export type SegmentProvenance = { source: PinSegmentation['source']; model: string | null; concept: string; confidence: number | null; applied: boolean };

/** `isDocument` is the caller's decision (a plain photo skips SAM). `concept` is the SAM noun phrase,
 *  e.g. "permission slip" or "sheet of paper". */
export type PinSegmenter = (input: { image: { bytes: Uint8Array; mimeType: string }; concept: string; isDocument: boolean }) => Promise<PinSegmentation>;

/** One record's box, parsed by key (never by position, so `c` being present or absent reads the same).
 *  Returns the highest-confidence box when several match (SAM returns every match). */
export function parseSamBox(outputText: string): { x1: number; y1: number; x2: number; y2: number; w: number; h: number; c: number | null } | null {
  const boxRe = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([0-9]*\.?[0-9]+))?\|>/g;
  let best: { x1: number; y1: number; x2: number; y2: number; w: number; h: number; c: number | null } | null = null;
  for (let m = boxRe.exec(outputText); m; m = boxRe.exec(outputText)) {
    const box = { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], h: +m[6], c: m[7] != null ? +m[7] : null };
    if (box.w <= 0 || box.h <= 0 || box.x2 <= box.x1 || box.y2 <= box.y1) continue; // malformed
    if (!best || (box.c ?? 0) > (best.c ?? 0)) best = box;
  }
  return best;
}

/** Collect every `output_text` string from a Responses-API body, tolerant of shape drift. */
function outputTextOf(json: unknown): string {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if ((o.type === 'output_text' || o.type === 'text') && typeof o.text === 'string') parts.push(o.text);
      if (typeof o.output_text === 'string') parts.push(o.output_text);
      Object.values(o).forEach(visit);
    }
  };
  visit(json);
  return parts.join('\n');
}

function cropFromBox(box: { x1: number; y1: number; x2: number; y2: number; w: number; h: number }): CropRect {
  const x = Math.max(0, Math.min(1, box.x1 / box.w));
  const y = Math.max(0, Math.min(1, box.y1 / box.h));
  return { x, y, width: Math.max(0, Math.min(1 - x, (box.x2 - box.x1) / box.w)), height: Math.max(0, Math.min(1 - y, (box.y2 - box.y1) / box.h)) };
}

/** Deterministic, offline FIXTURE. Never calls a model. For a document it returns a believable
 *  crop + a small straighten so the demo visibly tightens an angled phone photo to the paper; for a
 *  plain photo it returns { applied:false } (skip SAM). Fully configurable for tests. */
export function createFixtureSegmenter(result?: Partial<Extract<PinSegmentation, { applied: true }>>, log?: (p: SegmentProvenance) => void): PinSegmenter {
  return async ({ concept, isDocument }) => {
    if (!isDocument) { const out = { applied: false, source: 'NONE', reason: 'plain photo' } as const; log?.({ source: 'NONE', model: null, concept, confidence: null, applied: false }); return out; }
    const out: PinSegmentation = { applied: true, source: 'FIXTURE', model: null, concept, crop: { x: 0.14, y: 0.11, width: 0.72, height: 0.78 }, rotationDeg: -4.5, confidence: null, ...result };
    log?.({ source: out.source, model: null, concept, confidence: out.applied ? out.confidence : null, applied: out.applied });
    return out;
  };
}

/** Live SAM 3.1 over the Meta Model API Responses endpoint. Honest fallback: any transport/HTTP error
 *  or a no-paper-found result becomes { applied:false, reason } so the caller places it uncropped. */
export function createSamSegmenter(cfg: { provider: ProviderConfig; model?: string; fetchFn?: typeof fetch; log?: (p: SegmentProvenance) => void }): PinSegmenter {
  const base = cfg.provider.baseUrl.replace(/\/$/, '');
  const model = cfg.model ?? 'sam-3.1';
  const doFetch = cfg.fetchFn ?? fetch;
  return async ({ image, concept, isDocument }) => {
    if (!isDocument) { cfg.log?.({ source: 'NONE', model: null, concept, confidence: null, applied: false }); return { applied: false, source: 'NONE', reason: 'plain photo' }; }
    const dataUrl = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`;
    let json: unknown;
    try {
      const res = await doFetch(`${base}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.provider.apiKey}` },
        body: JSON.stringify({
          model,
          input: [{ type: 'message', role: 'user', content: [
            { type: 'input_text', text: concept },
            { type: 'input_image', image_url: dataUrl },
          ] }],
          metadata: { include_confidence: 'true' },
        }),
      });
      if (!res.ok) { cfg.log?.({ source: 'SAM_3_1', model, concept, confidence: null, applied: false }); return { applied: false, source: 'SAM_3_1', reason: `sam http ${res.status}` }; }
      json = await res.json();
    } catch { cfg.log?.({ source: 'SAM_3_1', model, concept, confidence: null, applied: false }); return { applied: false, source: 'SAM_3_1', reason: 'sam unavailable' }; }
    const box = parseSamBox(outputTextOf(json));
    if (!box) { cfg.log?.({ source: 'SAM_3_1', model, concept, confidence: null, applied: false }); return { applied: false, source: 'SAM_3_1', reason: 'no paper found' }; }
    // rotationDeg stays 0 on the live path: the axis-aligned box carries no angle, and straighten from
    // the mask raster needs meta-sam-parser (a follow-up). We never fabricate a rotation we did not compute.
    const out: Extract<PinSegmentation, { applied: true }> = { applied: true, source: 'SAM_3_1', model: typeof (json as { model?: unknown })?.model === 'string' ? (json as { model: string }).model : model, concept, crop: cropFromBox(box), rotationDeg: 0, confidence: box.c };
    cfg.log?.({ source: 'SAM_3_1', model: out.model, concept, confidence: out.confidence, applied: true });
    return out;
  };
}

/** Composition: live when PIN_LIVE=1 and a provider is configured; otherwise the offline fixture. */
export function buildPinSegmenter(cfg: { env?: NodeJS.ProcessEnv; fetchFn?: typeof fetch; fixture?: Partial<Extract<PinSegmentation, { applied: true }>>; log?: (p: SegmentProvenance) => void } = {}): PinSegmenter {
  const env = cfg.env ?? process.env;
  if (env.PIN_LIVE !== '1') return createFixtureSegmenter(cfg.fixture, cfg.log);
  const provider = resolveProvider((env.ROSINA_PROVIDER ?? 'meta') as ProviderId);
  const model = env.PIN_SEGMENT_MODEL ?? 'sam-3.1';
  return createSamSegmenter({ provider, model, fetchFn: cfg.fetchFn, log: cfg.log });
}
