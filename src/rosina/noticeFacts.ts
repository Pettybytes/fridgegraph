/**
 * Notice → Plan, step 2 (read it with Spark): turn a muse-spark-1.3 raw extraction into VALIDATED
 * structured facts. Contract: docs/contracts/notice-plan.md §3.
 *
 * The notice is DATA, never instructions — this module reads only structured fields and never acts
 * on free text. Two hard rules enforced here, not left to the model:
 *   1. For pasted text, every quoted source passage MUST be a verbatim (whitespace-flexible)
 *      substring of the submitted text. A quote that isn't present is DROPPED, never shown.
 *   2. For images/PDFs, a passage is labelled a model TRANSCRIPTION with a page/image ref — never a
 *      confident "exact" quote.
 * Unknown kinds, malformed times, and facts with an unverifiable text quote are dropped. A fact
 * dropped for a bad quote does not silently become actionless noise — see `dropped` in the result.
 */

export type NoticeKind = 'early_dismissal' | 'closure' | 'schedule_change' | 'field_trip';

const NOTICE_KINDS: ReadonlySet<string> = new Set<NoticeKind>([
  'early_dismissal',
  'closure',
  'schedule_change',
  'field_trip',
]);

export type ProcessingSource = 'text' | 'image' | 'pdf:rasterized';

export type FactSource =
  | { type: 'verified_quote'; quote: string; startOffset: number; endOffset: number }
  | { type: 'transcription'; text: string; ref: string };

export type NoticeTime = { label: string; time: string }; // time is 24h HH:MM

export type NoticeFact = {
  kind: NoticeKind;
  dates: string[]; // resolved YYYY-MM-DD
  times: NoticeTime[];
  appliesTo: string;
  source: FactSource;
};

/** The raw shape we accept back from the Spark extractor (see noticeExtractor.ts). */
export type RawFact = {
  kind?: unknown;
  dates?: unknown;
  times?: unknown;
  appliesTo?: unknown;
  quote?: unknown; // text path
  transcription?: unknown; // image/pdf path
  ref?: unknown; // image/pdf path, e.g. "image" | "pdf:p1"
};

export type RawExtraction = {
  facts?: unknown;
  clarification?: unknown; // a single question string, or null/absent
  modelId?: unknown;
};

export type ExtractionResult = {
  facts: NoticeFact[];
  modelId: string;
  processingSource: ProcessingSource;
  clarification: { question: string } | null;
  /** Facts the model proposed that were dropped, with why — surfaced, never hidden. */
  dropped: { reason: 'unverifiable_quote' | 'unknown_kind' | 'malformed'; quote?: string }[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Whitespace-flexible verbatim match. Returns the offsets of the match IN THE ORIGINAL text, or
 * null if the quote is not present. Matching ignores differences in runs of whitespace only (a
 * notice copied out of a PDF often has newlines where the model emitted spaces); it never allows
 * added, removed, or reordered words.
 */
export function findQuote(text: string, quote: string): { startOffset: number; endOffset: number } | null {
  const needle = collapseWs(quote);
  if (needle.length === 0) return null;
  // Fast path: exact substring in the original.
  const exact = text.indexOf(quote);
  if (quote === needle && exact >= 0) return { startOffset: exact, endOffset: exact + quote.length };
  // Whitespace-flexible: build a regex from the needle's tokens joined by \s+.
  const tokens = needle.split(' ').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(tokens.join('\\s+'));
  const m = re.exec(text);
  if (!m) return null;
  return { startOffset: m.index, endOffset: m.index + m[0].length };
}

function cleanDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((d): d is string => typeof d === 'string' && DATE_RE.test(d)))];
}

function cleanTimes(value: unknown): NoticeTime[] {
  if (!Array.isArray(value)) return [];
  const out: NoticeTime[] = [];
  for (const t of value) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    if (typeof o.time === 'string' && TIME_RE.test(o.time)) {
      out.push({ label: typeof o.label === 'string' ? o.label.slice(0, 60) : '', time: o.time });
    }
  }
  return out;
}

/**
 * Validate one raw fact against the submitted text (text path) or accept it as a transcription
 * (image/pdf path). Returns the validated fact, or a drop reason.
 */
function validateFact(
  raw: RawFact,
  processingSource: ProcessingSource,
  submittedText: string | null,
): { ok: true; fact: NoticeFact } | { ok: false; reason: ExtractionResult['dropped'][number]['reason']; quote?: string } {
  if (typeof raw.kind !== 'string' || !NOTICE_KINDS.has(raw.kind)) return { ok: false, reason: 'unknown_kind' };
  const kind = raw.kind as NoticeKind;
  const dates = cleanDates(raw.dates);
  const times = cleanTimes(raw.times);
  const appliesTo = typeof raw.appliesTo === 'string' ? raw.appliesTo.slice(0, 200) : '';

  if (processingSource === 'text') {
    if (submittedText === null || typeof raw.quote !== 'string') return { ok: false, reason: 'malformed' };
    const found = findQuote(submittedText, raw.quote);
    if (!found) return { ok: false, reason: 'unverifiable_quote', quote: raw.quote };
    return {
      ok: true,
      fact: { kind, dates, times, appliesTo, source: { type: 'verified_quote', quote: raw.quote, ...found } },
    };
  }

  // image / pdf: the passage is a transcription, labelled as such with a ref.
  const textPassage = typeof raw.transcription === 'string' ? raw.transcription : '';
  const ref = typeof raw.ref === 'string' && raw.ref.length > 0 ? raw.ref : processingSource === 'image' ? 'image' : 'pdf:p1';
  return { ok: true, fact: { kind, dates, times, appliesTo, source: { type: 'transcription', text: textPassage, ref } } };
}

/**
 * Validate a whole raw extraction. `submittedText` is the exact pasted text for the text path, or
 * null for image/pdf. The model id is reported from the raw extraction (the ACTUAL model), falling
 * back to the configured default only when the provider didn't echo one.
 */
export function validateExtraction(
  raw: RawExtraction,
  opts: { processingSource: ProcessingSource; submittedText: string | null; fallbackModelId: string },
): ExtractionResult {
  const facts: NoticeFact[] = [];
  const dropped: ExtractionResult['dropped'] = [];
  const rawFacts = Array.isArray(raw.facts) ? raw.facts.slice(0, 20) : [];
  for (const rf of rawFacts) {
    if (!rf || typeof rf !== 'object') {
      dropped.push({ reason: 'malformed' });
      continue;
    }
    const res = validateFact(rf as RawFact, opts.processingSource, opts.submittedText);
    if (res.ok) facts.push(res.fact);
    else dropped.push({ reason: res.reason, quote: res.quote });
  }

  const clarification =
    typeof raw.clarification === 'string' && raw.clarification.trim().length > 0
      ? { question: raw.clarification.trim().slice(0, 300) }
      : null;

  const modelId = typeof raw.modelId === 'string' && raw.modelId.length > 0 ? raw.modelId : opts.fallbackModelId;

  return { facts, modelId, processingSource: opts.processingSource, clarification, dropped };
}
