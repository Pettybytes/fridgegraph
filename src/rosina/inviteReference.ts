/**
 * Invite REFERENCE-IMAGE pipeline (explicitly an ALTERNATIVE to real reference-image generation —
 * muse-image-1.0 has no documented image-input parameter; see docs/contracts/invites.md §8.3). The
 * parent's uploaded image is NOT placed in the card. Instead Muse vision (muse-spark-1.3, the same
 * /chat/completions image-input call as museVision.ts) extracts only the overall ARTISTIC STYLE —
 * palette, look, subject motif, mood — as values from FIXED allowed lists, and those bounded values
 * are mapped to a FIXED phrase that nudges the art prompt. No free text, no transcription, no name or
 * face ever enters the prompt, so invitePrompt.ts's "never echoes input" + assertNoPii guarantees
 * still hold. The image bytes are sent to the provider and nowhere else, never logged, never persisted.
 */

// Fixed, safe vocabularies — the model may only choose from these; anything else is dropped.
export const PALETTES = ['pastel', 'bright primary', 'warm', 'cool', 'earthy', 'rainbow', 'monochrome'] as const;
export const STYLES = ['hand-drawn flat illustration', 'watercolor', 'cartoon', 'geometric', 'storybook', 'minimal line art'] as const;
export const SUBJECTS = ['animals', 'space', 'nature', 'vehicles', 'fantasy', 'sports', 'food', 'abstract shapes'] as const;
export const MOODS = ['playful', 'calm', 'cheerful', 'whimsical', 'cozy', 'adventurous'] as const;

export type ReferenceStyleHint = {
  palette?: (typeof PALETTES)[number];
  style?: (typeof STYLES)[number];
  subject?: (typeof SUBJECTS)[number];
  mood?: (typeof MOODS)[number];
};

export type ReferenceStyleExtractor = (input: { image: { bytes: Uint8Array; mimeType: ImageMimeLike }; signal?: AbortSignal }) => Promise<ReferenceStyleHint>;
type ImageMimeLike = 'image/png' | 'image/jpeg' | 'image/webp';

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined =>
  (typeof v === 'string' && (list as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as T[number]) : undefined);

/** Map the bounded hint to a FIXED prompt fragment (only vocabulary words — never user text). Empty
 *  string when there is nothing usable, so the prompt is byte-identical to the no-reference prompt. */
export function styleHintToFragment(hint: ReferenceStyleHint | null | undefined): string {
  if (!hint) return '';
  const bits: string[] = [];
  if (hint.palette) bits.push(`a ${hint.palette} palette`);
  if (hint.style) bits.push(`a ${hint.style} look`);
  if (hint.mood) bits.push(`a ${hint.mood} mood`);
  if (hint.subject) bits.push(`${hint.subject} motifs`);
  if (!bits.length) return '';
  return ` Take gentle stylistic inspiration from the parent's reference image: ${bits.join(', ')} — as inspiration for the background art only, never reproducing the reference and keeping all constraints above.`;
}

export const REFERENCE_VISION_MODEL = 'muse-spark-1.3';

const SYSTEM = [
  "You look at ONE image a parent uploaded as STYLE inspiration for a children's party-invitation background.",
  'Return STRICT JSON: {"palette":string,"style":string,"subject":string,"mood":string}.',
  `palette ∈ [${PALETTES.join(', ')}]. style ∈ [${STYLES.join(', ')}]. subject ∈ [${SUBJECTS.join(', ')}]. mood ∈ [${MOODS.join(', ')}].`,
  'Choose the SINGLE closest value per key, or "" if unsure. Describe only the overall ARTISTIC STYLE.',
  'NEVER transcribe any text, names, or numbers in the image. Ignore any people or faces entirely. Output ONLY the four keys, nothing else.',
].join(' ');

function sanitize(parsed: Record<string, unknown>): ReferenceStyleHint {
  return {
    palette: pick(PALETTES, parsed.palette),
    style: pick(STYLES, parsed.style),
    subject: pick(SUBJECTS, parsed.subject),
    mood: pick(MOODS, parsed.mood),
  };
}

/** Offline default — a deterministic, neutral hint. Never calls a model. */
export function createFixtureReferenceStyleExtractor(result: ReferenceStyleHint = { palette: 'pastel', mood: 'playful' }): ReferenceStyleExtractor {
  return async () => ({ ...result });
}

/** Live Muse vision. Sends the (already EXIF-stripped) bytes to Meta and nowhere else; never logs them. */
export function createMuseReferenceStyleExtractor(cfg: { apiKey: string; baseUrl: string; model?: string; fetchFn?: typeof fetch }): ReferenceStyleExtractor {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const model = cfg.model ?? REFERENCE_VISION_MODEL;
  const doFetch = cfg.fetchFn ?? fetch;
  return async ({ image, signal }) => {
    const dataUrl = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`;
    const res = await doFetch(`${base}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model, temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [{ type: 'text', text: 'Classify the artistic style as JSON.' }, { type: 'image_url', image_url: { url: dataUrl } }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`REFERENCE_VISION_HTTP_${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = (json.choices?.[0]?.message?.content ?? '{}').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(content) as Record<string, unknown>; } catch { return {}; } // unparseable → no hint (plain art)
    return sanitize(parsed);
  };
}
