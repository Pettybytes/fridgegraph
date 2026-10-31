/**
 * Server-side defense in depth, independent of the system prompt: before a reply leaves this
 * service, check it for the name of any demo child or adult that did NOT appear in one of this
 * turn's own authorized tool results. If one is found, the whole reply is replaced with a
 * generic scoped refusal — never trimmed, never partially redacted, since a partial edit could
 * still leave the surrounding sentence implying the name.
 *
 * TASK R-MYCHILDREN: there is no static roster of child names to allow-list against any more
 * (`src/rosina/roster.ts` is deleted) — `MyChildren` reports ids and scopes, not names (today's
 * deployed contract; see `childAccess.ts`). A child's name is therefore grounded by exactly the
 * same mechanism an adult's always was: it must appear in THIS turn's own real tool-result JSON
 * (model.ts pushes any `displayName` MyChildren itself reports into that same text). A name the
 * caller supplied in their OWN message is deliberately NOT treated as grounded here — that would
 * let a caller's own guess confirm or deny an out-of-scope child merely by naming them first,
 * exactly the leak rule 9 exists to prevent even when "the person asking already said a name
 * themselves."
 *
 * The name list used for scanning is built from `src/demo/personas.ts` and is used ONLY for this
 * local string check — it is never put into a prompt, a tool definition, or anything the model
 * sees.
 *
 * This is a safety net, not the primary control: `systemPrompt.ts` already tells the model to
 * use the fixed refusal instead of naming anyone out of scope. This guard exists because a model
 * can be wrong, and the earlier version of this file's own roster leak proved that a prompt
 * instruction alone is not enough.
 */
import { DEMO_PERSONAS } from '../demo/personas';

export const SCOPED_REFUSAL = 'I can only help with children shared with you.';

type NameEntry = { full: string; first: string | null };

function nameEntry(full: string): NameEntry {
  const trimmed = full.trim();
  const first = trimmed.split(/\s+/)[0];
  return { full: trimmed, first: /^[A-Z][a-zA-Z]{2,}$/.test(first) ? first : null };
}

/** Every name the demo cast could plausibly produce, built once at module load — a closed,
 * fixed list, never derived from a live request. */
const DEMO_NAME_UNIVERSE: NameEntry[] = (() => {
  const out: NameEntry[] = [];
  for (const persona of DEMO_PERSONAS) {
    out.push(nameEntry(persona.childName));
    // "Jax's family" (the picker label) is not a person's name; skip entries shaped like a label.
    if (persona.id !== 'demo-guide' && !persona.name.includes("'")) out.push(nameEntry(persona.name));
    // "Ray · Jax's dad": the real first name lives in `role`, not `name`, for this one entry.
    const roleName = persona.role.match(/^([A-Z][a-zA-Z]{2,})\s·/);
    if (roleName) out.push(nameEntry(roleName[1]));
  }
  return out;
})();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPresent(text: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text);
}

export type OutputGuardResult = {
  reply: string;
  /** True if the original reply was replaced. Safe to log; never log WHICH name triggered it. */
  triggered: boolean;
};

/**
 * `toolResultText` should be every tool result's raw JSON this turn, concatenated — a name that
 * genuinely came back from the caller's own authorized read is never a leak. This is now the
 * ONLY grounding source (TASK R-MYCHILDREN removed the static roster allow-list).
 */
export function applyOutputGuard(reply: string, toolResultText: string): OutputGuardResult {
  for (const entry of DEMO_NAME_UNIVERSE) {
    for (const candidate of entry.first ? [entry.full, entry.first] : [entry.full]) {
      if (!wordPresent(reply, candidate)) continue;
      if (toolResultText.includes(candidate)) continue;
      return { reply: SCOPED_REFUSAL, triggered: true };
    }
  }
  return { reply, triggered: false };
}
