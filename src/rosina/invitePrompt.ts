/**
 * The ART-ONLY image prompt. The image model receives theme (derived from the occasion), illustration
 * style and composition with a quiet area reserved for the app's text — and NOTHING else. The child's
 * name, the date, the venue and the times are NEVER part of the prompt: `buildArtPrompt` takes only
 * the occasion and maps it to a FIXED theme string (it never interpolates the raw occasion text), so
 * no field can leak. `assertNoPii` is a belt-and-suspenders guard that throws if that ever changes.
 */
import { createHash } from 'node:crypto';
import { styleHintToFragment, type ReferenceStyleHint } from './inviteReference';

const STYLE = 'soft, friendly, hand-drawn flat illustration with a gentle pastel palette';
const CONSTRAINTS = [
  'fictional and illustrated only',
  'no people, no faces, no photorealistic humans',
  'no text, letters, numbers, or words anywhere in the image',
  'no logos, brands, trademarks, or known characters',
].join('; ');

/** occasion → a safe set of art motifs. Returns a FIXED string per theme; never echoes the input. */
function themeFor(occasion: string): string {
  const o = occasion.toLowerCase();
  if (/dino|dinosaur|jurassic/.test(o)) return 'friendly cartoon dinosaurs, ferns, and party bunting';
  if (/space|astronaut|rocket|planet|star/.test(o)) return 'rockets, planets, and twinkling stars';
  if (/princess|fairy|unicorn/.test(o)) return 'castles, sparkles, rainbows, and flowers';
  if (/pirate|ship|treasure/.test(o)) return 'treasure maps, little ships, and gentle waves';
  if (/animal|zoo|safari|jungle/.test(o)) return 'cheerful jungle leaves and cartoon animals';
  if (/birthday/.test(o)) return 'balloons, confetti, and a decorated cake';
  return 'balloons, confetti, and festive shapes';
}

export function buildArtPrompt(occasion: string, styleHint?: ReferenceStyleHint | null): string {
  const theme = themeFor(occasion);
  return (
    `An illustrated party-invitation background. Theme: ${theme}. ` +
    `Style: ${STYLE}. ` +
    `Composition: decorative motifs around the edges with a large, calm, empty area in the lower ` +
    `center reserved for text that the app adds separately — keep that area uncluttered. ` +
    `Constraints: ${CONSTRAINTS}.` +
    // Optional, bounded style inspiration from an uploaded reference (fixed-vocabulary words only —
    // never user text), so the no-echo / no-PII guarantees above still hold.
    styleHintToFragment(styleHint)
  );
}

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Hard guarantee: the art prompt must never contain the child's name, the date, the venue, or the
 * times. Built from the occasion alone (fixed theme strings), it never does. Matching is on WORD
 * BOUNDARIES, not substrings, so a name that is a prefix of a theme word — "Star" vs "twinkling
 * stars", "Fern" vs "ferns" — is NOT a false match. A match is therefore impossible in practice; if
 * one ever occurs (a name that is exactly a theme word), the caller refuses cleanly and refunds the
 * budget rather than crashing (see inviteEndpoint.ts). Throws `INVITE_PROMPT_PII_LEAK`.
 */
export function assertNoPii(
  prompt: string,
  pii: { childFirstName?: string | null; date?: string | null; placeLabel?: string | null; startTime?: string | null; endTime?: string | null },
): void {
  const needles = [pii.childFirstName, pii.date, pii.placeLabel, pii.startTime, pii.endTime]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 1);
  for (const n of needles) {
    if (new RegExp(`\\b${escapeRegExp(n.trim())}\\b`, 'i').test(prompt)) throw new Error('INVITE_PROMPT_PII_LEAK');
  }
}
