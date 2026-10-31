/**
 * Orbit-specific logic that belongs in code, not just in a prompt instruction.
 *
 * Two independent gates, both checked before a `prepareOrbitAlert` proposal is accepted:
 *
 *   1. PARENT AUTHORITY — proven by a same-turn, successful `CheckInStatus` call for this exact
 *      child. `CheckInStatus` itself throws UNAUTHORIZED for anyone who is not that child's
 *      parent (src/subgraphs/coordination.ts#checkInStatus: `if (level !== 'parent') throw
 *      ...UNAUTHORIZED`), so a call that succeeded is proof, not an assumption. Mirrors exactly
 *      the `verifiedChildIds`/start-pickup pattern already used for pickup requests.
 *   2. VOCABULARY MEMBERSHIP — every descriptor the model supplies must be a value this turn's
 *      own `OrbitVocabulary` call actually returned, for the matching kind. A value that was
 *      never confirmed this turn is refused, even if it happens to look plausible — "never
 *      guess, never substitute a near match silently, never pass free text" is enforced here,
 *      not just asked for in the prompt.
 *
 * `prepareOrbitAlert` is `implemented: false` in the shared catalog until Codex's app handler
 * (orbitDraft + orbitPreview + the confirm UI) exists, so none of this currently reaches a real
 * card regardless — this module exists so the gate is already correct, and already tested, for
 * when that flag flips.
 */

export const DESCRIPTOR_KEYS = ['wearColor', 'wearGarment', 'hair', 'carryColor', 'carryItem'] as const;
export type DescriptorKey = (typeof DESCRIPTOR_KEYS)[number];

/** Catalog field name -> the OrbitVocabulary `kind` string it must belong to. */
export const DESCRIPTOR_VOCAB_KIND: Record<DescriptorKey, string> = {
  wearColor: 'WEAR_COLOR',
  wearGarment: 'WEAR_GARMENT',
  hair: 'HAIR',
  carryColor: 'CARRY_COLOR',
  carryItem: 'CARRY_ITEM',
};

export type OrbitAlertArgs = {
  childId: string;
  wearColor?: string;
  wearGarment?: string;
  hair?: string;
  carryColor?: string;
  carryItem?: string;
};

export type OrbitValidationResult = { ok: true; args: OrbitAlertArgs } | { ok: false; reason: 'NOT_PARENT' | 'VALUE_NOT_IN_VOCABULARY' };

/**
 * `vocabularyByKind` maps a kind string (e.g. "WEAR_COLOR") to the set of values this turn's own
 * `OrbitVocabulary` call actually returned. An empty/missing map means no vocabulary was fetched
 * this turn at all, so any supplied descriptor fails closed.
 */
export function validatePrepareOrbitAlert(
  args: OrbitAlertArgs,
  verifiedParentOf: ReadonlySet<string>,
  vocabularyByKind: ReadonlyMap<string, ReadonlySet<string>>,
): OrbitValidationResult {
  if (!verifiedParentOf.has(args.childId)) return { ok: false, reason: 'NOT_PARENT' };

  for (const key of DESCRIPTOR_KEYS) {
    const value = args[key];
    if (value === undefined) continue;
    const kind = DESCRIPTOR_VOCAB_KIND[key];
    const allowed = vocabularyByKind.get(kind);
    if (!allowed || !allowed.has(value)) return { ok: false, reason: 'VALUE_NOT_IN_VOCABULARY' };
  }

  // Only the fields actually supplied and validated are carried forward — omit the rest, never
  // invent a value for an unspecified descriptor.
  const out: OrbitAlertArgs = { childId: args.childId };
  for (const key of DESCRIPTOR_KEYS) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return { ok: true, args: out };
}

/** Parses OrbitVocabulary's own tool result shape into a kind -> values map. Defensive against
 * an unexpected shape: returns an empty map rather than throwing, so a malformed response fails
 * closed (nothing becomes "verified") instead of crashing the turn. */
export function vocabularyMapFrom(data: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const list = (data as { orbitVocabulary?: unknown })?.orbitVocabulary;
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, value } = entry as { kind?: unknown; value?: unknown };
    if (typeof kind !== 'string' || typeof value !== 'string') continue;
    if (!out.has(kind)) out.set(kind, new Set());
    out.get(kind)!.add(value);
  }
  return out;
}

export type CheckInStatusShape = { recorded: boolean; dueAt: string | null };

/**
 * "A check-in is overdue ONLY when its due time has passed AND no check-in is recorded. Never
 * infer it from recorded=false alone." `now` is injectable for tests; production always uses the
 * real clock — there is no demo-clock override here, because `dueAt` is a real timestamp and
 * "has it passed" is a real-time question, not a day-granular one.
 */
export function isCheckInOverdue(status: CheckInStatusShape, now: Date = new Date()): boolean {
  if (status.recorded) return false;
  if (!status.dueAt) return false;
  const due = new Date(status.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

/** Parses CheckInStatus's own tool result shape, defensively. */
export function checkInStatusFrom(data: unknown): CheckInStatusShape | null {
  const row = (data as { checkInStatus?: unknown })?.checkInStatus;
  if (!row || typeof row !== 'object') return null;
  const { recorded, dueAt } = row as { recorded?: unknown; dueAt?: unknown };
  if (typeof recorded !== 'boolean') return null;
  return { recorded, dueAt: typeof dueAt === 'string' ? dueAt : null };
}

/**
 * Attaches a server-computed `overdue` boolean onto a CheckInStatus tool result before it ever
 * reaches the model — never trust the model to do this date arithmetic itself (same principle as
 * src/rosina/localTime.ts's timestamp rewriting). Defensive: returns `data` unchanged if it does
 * not look like a CheckInStatus result.
 */
export function injectOverdueFlag(data: unknown, overdue: boolean): unknown {
  const row = (data as { checkInStatus?: unknown })?.checkInStatus;
  if (!row || typeof row !== 'object') return data;
  return { ...(data as Record<string, unknown>), checkInStatus: { ...row, overdue } };
}
