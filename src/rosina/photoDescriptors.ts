/**
 * Photo → Orbit descriptors (PR F).
 *
 * When a parent attaches a child's photo for Orbit, we may offer vocabulary-constrained
 * descriptor SUGGESTIONS for the parent to confirm or edit. This module owns the one
 * intended Meta vision call and the mapping; it never drafts, activates, or sends, and it
 * never widens the controlled vocabulary.
 *
 * Hard rules, enforced here by construction:
 *  - The image goes ONLY to authorized storage (an EXIF-stripped `photoId` reference the
 *    caller already holds) and the ONE injected vision client; no other provider sees it,
 *    and the raw image is never logged (this module logs nothing, and never receives bytes).
 *  - The image is never modified — we pass a reference, not pixels.
 *  - Suggestions map ONLY to the five controlled kinds (WEAR_COLOR, WEAR_GARMENT, HAIR,
 *    CARRY_COLOR, CARRY_ITEM) and ONLY to values present in THIS child's fetched vocabulary.
 *    An off-vocabulary value is DROPPED, never forced onto the nearest vocabulary value.
 *    Unknown stays unknown (the key is simply omitted).
 *  - Any text found in the image is returned as inert DATA for the parent to see; it is
 *    never interpreted as an instruction and never mapped to a descriptor.
 *  - Location is never inferred — there is no location output, by design.
 *  - The model id and whether the result was live or cached are always recorded.
 *  - Fictional images only (a product/test constraint, not enforced in code).
 */
import { DESCRIPTOR_KEYS, DESCRIPTOR_VOCAB_KIND, type DescriptorKey } from './orbit';

export const VISION_MODEL_ID = 'muse-spark-1.3';

/** A single raw suggestion from the vision model: `key` may be a descriptor key
 *  ("wearColor") or a vocabulary kind ("WEAR_COLOR"); either is normalised below. */
export type VisionRawDescriptor = { key: string; value: string };

export type VisionResult = {
  /** The exact model that produced this, e.g. "muse-spark-1.3". */
  modelId: string;
  /** Whether this was a fresh model call or served from an authorized cache. */
  source: 'live' | 'cached';
  descriptors: VisionRawDescriptor[];
  /** Any text the model read in the image, surfaced to the parent as DATA only. */
  textInImage?: string[];
};

/** An EXIF-stripped image the authorized store loaded; bytes only ever flow to the vision
 *  call, never to a log. */
export type VisionImage = { data: Uint8Array; contentType: string };

/**
 * The one intended Meta vision call, injected so nothing else in the process can reach the
 * image and so tests run without a key. An implementation MUST send the image ONLY to the
 * Meta vision endpoint and MUST NOT log the raw image.
 */
export type VisionClient = {
  describe(input: { image: VisionImage; childId: string; signal?: AbortSignal }): Promise<VisionResult>;
};

export type DroppedDescriptor = { key: string; value: string; reason: 'UNKNOWN_KEY' | 'NOT_IN_VOCABULARY' };

export type PhotoDescriptorProposal = {
  modelId: string;
  source: 'live' | 'cached';
  /** In-vocabulary suggestions only; optional per key; unknown omitted. For parent review. */
  descriptors: Partial<Record<DescriptorKey, string>>;
  /** Everything the model returned that was not an allowed key or not in the vocabulary. */
  dropped: DroppedDescriptor[];
  /** Inert text read from the image — shown to the parent, never followed, never mapped. */
  textInImage: string[];
};

const KEY_BY_VOCAB_KIND = new Map<string, DescriptorKey>(
  DESCRIPTOR_KEYS.map((k) => [DESCRIPTOR_VOCAB_KIND[k], k] as const),
);

function normaliseKey(raw: string): DescriptorKey | undefined {
  if ((DESCRIPTOR_KEYS as readonly string[]).includes(raw)) return raw as DescriptorKey;
  return KEY_BY_VOCAB_KIND.get(raw);
}

/**
 * Turn a vision result into a vocabulary-constrained proposal for parent review. Fails
 * closed: with no vocabulary for a kind, every value of that kind is dropped. Never mutates,
 * never sends, never follows in-image text.
 *
 * `vocabularyByKind` is the set of values THIS child's own OrbitVocabulary call returned,
 * keyed by kind (same shape `validatePrepareOrbitAlert` consumes).
 */
export async function proposePhotoDescriptors(input: {
  image: VisionImage;
  childId: string;
  vocabularyByKind: ReadonlyMap<string, ReadonlySet<string>>;
  vision: VisionClient;
  signal?: AbortSignal;
}): Promise<PhotoDescriptorProposal> {
  const result = await input.vision.describe({
    image: input.image,
    childId: input.childId,
    signal: input.signal,
  });

  const descriptors: Partial<Record<DescriptorKey, string>> = {};
  const dropped: DroppedDescriptor[] = [];

  for (const raw of result.descriptors) {
    const key = normaliseKey(raw.key);
    if (!key) {
      dropped.push({ key: raw.key, value: raw.value, reason: 'UNKNOWN_KEY' });
      continue;
    }
    const allowed = input.vocabularyByKind.get(DESCRIPTOR_VOCAB_KIND[key]);
    if (!allowed || !allowed.has(raw.value)) {
      dropped.push({ key: raw.key, value: raw.value, reason: 'NOT_IN_VOCABULARY' });
      continue;
    }
    // First in-vocabulary value per key wins; never overwrite with a later guess.
    if (descriptors[key] === undefined) descriptors[key] = raw.value;
  }

  return {
    modelId: result.modelId,
    source: result.source,
    descriptors,
    dropped,
    // Text in the image is data for the parent, never an instruction and never a descriptor.
    textInImage: (result.textInImage ?? []).slice(),
  };
}
