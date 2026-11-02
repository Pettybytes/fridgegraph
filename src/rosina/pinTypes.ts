/**
 * "Pin it to the fridge" shared types (Phase 2, STAGED/MOCKED). Contract: docs/contracts/pin-to-fridge.md.
 * No model/provider or stack calls live in this module — these are the shapes the mocked backend and
 * the web client agree on.
 */

export type PinKind = 'drawing' | 'permission_slip' | 'report_card' | 'appointment_card' | 'other';

export const PIN_KINDS: readonly PinKind[] = ['drawing', 'permission_slip', 'report_card', 'appointment_card', 'other'];

export type Confidence = 'high' | 'medium' | 'low';

export type Audience = 'PARENTS_ONLY' | 'FAMILY' | 'CAREGIVERS';

/** report_card and document images default to parents-only; drawings default to family. */
export const DEFAULT_AUDIENCE: Record<PinKind, Audience> = {
  drawing: 'FAMILY',
  permission_slip: 'PARENTS_ONLY',
  report_card: 'PARENTS_ONLY',
  appointment_card: 'PARENTS_ONLY',
  other: 'PARENTS_ONLY',
};

export const AUDIENCE_OPTIONS: readonly Audience[] = ['PARENTS_ONLY', 'FAMILY', 'CAREGIVERS'];

/** Classification keeps uncertainty VISIBLE — confidence is a hint, not calibrated proof. */
export type Classification = {
  kind: PinKind;
  confidence: Confidence;
  uncertain: boolean;
  alternatives: { kind: PinKind; confidence: Confidence }[];
};

/** Where a field came from — a verified verbatim quote (pasted/readable text) or a model
 *  transcription (image-read) with a page/image ref. Source-grounded, never invented. */
export type FieldSource =
  | { type: 'verified_quote'; quote: string }
  | { type: 'transcription'; text: string; ref: string };

export type TextField = { value: string; source: FieldSource };

/** Typed extracted fields. Per-kind usage is documented in the contract §3; unknown fields are null.
 *  Dates are resolved YYYY-MM-DD (America/Detroit) or null (which forces a clarification). */
export type PinExtracted = {
  title: TextField | null;
  caption: string | null; // the parent's own caption text (untrusted content)
  date: string | null; // appointment / report-card date
  startTime: string | null; // HH:MM
  place: TextField | null;
  term: TextField | null; // report card term
  event: TextField | null; // permission-slip event
  dueDate: string | null; // permission-slip due date
  signatureRequired: boolean; // permission slips
};

export type Suggestion = { kind: 'appointment' | 'todo' | 'signature'; text: string };
