/**
 * "Pin it to the fridge" — caller-scoped, READ-ONLY fridge awareness (Phase 2, STAGED/MOCKED).
 * Contract: docs/contracts/pin-to-fridge.md §read-awareness. Pure; no model/provider/stack call.
 *
 * Given the caller's OWN authorized reads (fridge notes, goals, care information — each already
 * RLS-scoped by the caller's bearer via MCP → router → subgraph), compose a grounded summary that:
 *   - identifies each source (fridge note / goal / care information) and uses stable source IDs;
 *   - DISTINGUISHES a successful-empty read from "unavailable to you" from "read failure/partial",
 *     and NEVER turns a refused/failed read into "there is nothing on the fridge";
 *   - for "this week" uses EXPLICIT dates only; undated notes, goals (whose `horizon` is free text,
 *     not a deadline) and standing care information are kept clearly SEPARATE;
 *   - EXCLUDES sample/decorative manifests from factual context;
 *   - treats note text as UNTRUSTED DATA — it is quoted/summarized, never parsed for instructions,
 *     and no embedded URL is followed (this module performs no I/O at all);
 *   - never invents an author or a timestamp (only fields actually supplied are shown).
 */

export type ReadResult<T> = { status: 'ok'; value: T } | { status: 'unavailable' } | { status: 'failed' };

// Aligned to #157's FridgeNote (feat/fridge-notes). A fridge note carries NO event date — only a
// `createdAt`, which is NOT a deadline and is never treated as one; so notes are standing unless a
// future field supplies an explicit date. `audience` is PARENTS_ONLY|SHARED (RLS already filtered the
// caller's view, so the composer just displays authorized notes — it never widens).
export type FridgeNote = {
  id: string;
  source: 'fridge_note' | 'school_report';
  text: string; // UNTRUSTED content
  audience?: 'PARENTS_ONLY' | 'SHARED';
  attachmentRef?: string | null;
  paperColor?: string;
  createdAt?: string | null; // a timestamp, NOT a deadline
  revision?: number | null;
  date?: string | null; // reserved: an explicit event date if a future field supplies one; else undated
  sample?: boolean; // true for sample/decorative manifests — EXCLUDED
};
export type FridgeGoal = { id: string; title: string; status: string; horizon?: string | null }; // horizon is FREE TEXT, never a date
export type FridgeCareFact = { id: string; key: string; value: string; confidence?: string };

export type FridgeReads = { notes: ReadResult<FridgeNote[]>; goals: ReadResult<FridgeGoal[]>; care: ReadResult<FridgeCareFact[]> };

export type SourceName = 'fridge note' | 'goal' | 'care information';
export type SourceState = 'items' | 'empty' | 'unavailable' | 'failed';
export type SourceItem = { id: string; label: string; date?: string | null };

export type SourceSummary = { source: SourceName; state: SourceState; items: SourceItem[] };

export type FridgeAwareness = {
  sources: SourceSummary[];
  /** present only when a week window is given: notes with an explicit in-window date, kept separate
   *  from undated / standing items. */
  thisWeek: { dated: SourceItem[]; standing: SourceItem[] } | null;
  text: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);

function summarize<T>(source: SourceName, read: ReadResult<T[]>, toItem: (t: T) => SourceItem | null): SourceSummary {
  if (read.status === 'unavailable') return { source, state: 'unavailable', items: [] };
  if (read.status === 'failed') return { source, state: 'failed', items: [] };
  const items = read.value.map(toItem).filter((x): x is SourceItem => x !== null);
  return { source, state: items.length ? 'items' : 'empty', items };
}

export function composeFridgeAwareness(reads: FridgeReads, opts?: { week?: { from: string; to: string } }): FridgeAwareness {
  const notes = summarize('fridge note', reads.notes, (n) =>
    n.sample ? null : { id: n.id, label: cut(n.text), date: typeof n.date === 'string' && DATE_RE.test(n.date) ? n.date : null },
  );
  const goals = summarize('goal', reads.goals, (g) => ({ id: g.id, label: `${cut(g.title, 80)} (${g.status})`, date: null })); // horizon is NOT a date
  const care = summarize('care information', reads.care, (c) => ({ id: c.id, label: `${c.key}: ${cut(c.value, 80)}${c.confidence ? ` (${c.confidence.toLowerCase()})` : ''}`, date: null }));
  const sources = [notes, goals, care];

  // "This week": explicit dates only. Undated notes, goals and care are standing — kept separate.
  let thisWeek: FridgeAwareness['thisWeek'] = null;
  if (opts?.week) {
    const { from, to } = opts.week;
    const dated: SourceItem[] = [];
    const standing: SourceItem[] = [];
    for (const i of notes.items) (i.date && i.date >= from && i.date <= to ? dated : standing).push(i);
    for (const i of [...goals.items, ...care.items]) standing.push(i); // standing by nature
    thisWeek = { dated, standing };
  }

  const line = (s: SourceSummary): string => {
    const name = s.source === 'care information' ? 'Care information' : s.source === 'goal' ? 'Goals' : 'Fridge notes';
    switch (s.state) {
      case 'items':
        return `${name}:\n${s.items.map((i) => `  • ${i.label}${i.date ? ` [${i.date}]` : ''} (${i.id})`).join('\n')}`;
      case 'empty':
        return `${name}: none recorded that you can see.`;
      case 'unavailable':
        return `${name}: not available to you.`;
      case 'failed':
        return `${name}: I couldn't read this just now — not the same as "nothing".`;
    }
  };

  return { sources, thisWeek, text: sources.map(line).join('\n\n') };
}
