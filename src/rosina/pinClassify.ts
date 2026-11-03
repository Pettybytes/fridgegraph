/**
 * "Pin it to the fridge" — classify a (mocked) Muse extraction into a typed proposal with VISIBLE
 * uncertainty and source-grounded fields. Pure; no model/stack call. Contract: pin-to-fridge.md §2–4.
 *
 * Model confidence is never treated as calibrated proof: anything short of "high" is marked
 * `uncertain` and keeps its alternatives. Required-but-missing or ambiguous DATES force one
 * clarification, never an invented date. The parent's caption and any read text are DATA — class
 * -ification, audience and suggestions are derived from structured fields + fixed per-kind rules,
 * never from instructions hidden in the text.
 */
import {
  AUDIENCE_OPTIONS,
  DEFAULT_AUDIENCE,
  PIN_KINDS,
  type Audience,
  type Classification,
  type Confidence,
  type FieldSource,
  type PinExtracted,
  type PinKind,
  type Suggestion,
  type TextField,
} from './pinTypes';

export type RawPinExtraction = {
  kind?: unknown;
  confidence?: unknown;
  alternatives?: unknown;
  title?: unknown;
  caption?: unknown;
  date?: unknown;
  startTime?: unknown;
  place?: unknown;
  term?: unknown;
  event?: unknown;
  dueDate?: unknown;
  clarification?: unknown;
};

export type PinProposalBody = {
  status: 'READY' | 'NEEDS_CLARIFICATION';
  clarification: { question: string } | null;
  classification: Classification;
  extracted: PinExtracted;
  audience: { selected: Audience; options: readonly Audience[] };
  suggestions: Suggestion[];
};

const CONF = new Set<Confidence>(['high', 'medium', 'low']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function asKind(v: unknown): PinKind | null {
  return typeof v === 'string' && (PIN_KINDS as readonly string[]).includes(v) ? (v as PinKind) : null;
}
function asConfidence(v: unknown): Confidence {
  return typeof v === 'string' && CONF.has(v as Confidence) ? (v as Confidence) : 'low';
}
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whitespace-flexible verbatim check so a read field can be marked a verified quote of pasted text. */
function isVerbatim(text: string, value: string): boolean {
  const needle = value.replace(/\s+/g, ' ').trim();
  if (needle.length < 2) return false;
  const tokens = needle.split(' ').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(tokens.join('\\s+'), 'i').test(text);
}

function textField(value: unknown, submittedText: string | null): TextField | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const v = value.trim().slice(0, 200);
  const source: FieldSource =
    submittedText && isVerbatim(submittedText, v) ? { type: 'verified_quote', quote: v } : { type: 'transcription', text: v, ref: 'image' };
  return { value: v, source };
}

function cleanDate(v: unknown): string | null {
  return typeof v === 'string' && isRealDate(v.trim()) ? v.trim() : null;
}

export function classifyPin(raw: RawPinExtraction, opts: { today: string; submittedText?: string | null }): PinProposalBody {
  const submittedText = opts.submittedText ?? null;
  const kind = asKind(raw.kind) ?? 'other';
  const confidence = asConfidence(raw.confidence);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
    .map((a) => (a && typeof a === 'object' ? { kind: asKind((a as { kind?: unknown }).kind), confidence: asConfidence((a as { confidence?: unknown }).confidence) } : null))
    .filter((a): a is { kind: PinKind; confidence: Confidence } => a !== null && a.kind !== null)
    .slice(0, 4);
  const classification: Classification = { kind, confidence, uncertain: confidence !== 'high', alternatives };

  const extracted: PinExtracted = {
    title: textField(raw.title, submittedText),
    caption: typeof raw.caption === 'string' ? raw.caption.slice(0, 500) : null, // UNTRUSTED content — stored as data
    date: cleanDate(raw.date),
    startTime: typeof raw.startTime === 'string' && TIME_RE.test(raw.startTime.trim()) ? raw.startTime.trim() : null,
    place: textField(raw.place, submittedText),
    term: textField(raw.term, submittedText),
    event: textField(raw.event, submittedText),
    dueDate: cleanDate(raw.dueDate),
    signatureRequired: kind === 'permission_slip',
  };

  const audience = { selected: DEFAULT_AUDIENCE[kind], options: AUDIENCE_OPTIONS };

  // Clarification: the extractor's own ambiguous-date flag wins; otherwise a per-kind required date.
  const modelQ = typeof raw.clarification === 'string' && raw.clarification.trim() ? raw.clarification.trim().slice(0, 300) : '';
  const clarQuestion =
    modelQ ||
    (kind === 'appointment_card' && !extracted.date ? 'What date is the appointment? A specific calendar date works best.' : '');
  if (clarQuestion) {
    return { status: 'NEEDS_CLARIFICATION', clarification: { question: clarQuestion }, classification, extracted, audience, suggestions: [] };
  }

  // Suggestions — surfaced WITHOUT claiming any record was created.
  const suggestions: Suggestion[] = [];
  if (kind === 'appointment_card' && extracted.date) {
    suggestions.push({ kind: 'appointment', text: `Looks like an appointment on ${extracted.date}. Pinning does not book it — a calendar entry needs a separate, verified contract (not created).` });
  }
  if (kind === 'permission_slip') {
    suggestions.push({ kind: 'signature', text: 'This looks like a permission slip. Pinning does not sign or submit it.' });
    if (extracted.dueDate) suggestions.push({ kind: 'todo', text: `Return by ${extracted.dueDate}. Pinning does not create a to-do — that needs a separate, verified contract (not created).` });
  }

  return { status: 'READY', clarification: null, classification, extracted, audience, suggestions };
}
