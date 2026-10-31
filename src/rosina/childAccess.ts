/**
 * TASK R-MYCHILDREN: replaces `src/rosina/roster.ts` (deleted) entirely. The ONLY source of
 * "which children can this caller ask about, and with what scopes" is now the MCP tool
 * `MyChildren`, called fresh by `runRosinaTurn` at the start of EVERY request — never cached,
 * never a static table, never a fallback if the call fails (see model.ts: discovery failure
 * fails the whole turn closed).
 *
 * Contract (`ops/MyChildren.graphql`, `src/subgraphs/access.ts#myChildren`): each row is
 * `{ child: { id }, scopes: [...] }` — parent/guardian membership grants the FULL scope set;
 * a `grants` row grants ONLY the scopes it names, date-window filtered; scopes are never unioned
 * across children. The query selects `child { id person { displayName } }` so a name is
 * available WHEN the backend's federation resolves one — as of this task the live alt-stack's
 * deployed MyChildren does not yet select `person`, so `displayName` is `null` in practice; this
 * file (and `ops/MyChildren.graphql`) are written for the completed contract, flagged as a
 * Bentley follow-up in the evidence/handoff, and already correct for the moment that lands.
 *
 * A name that DOES come back is used exactly as MyChildren reported it — never invented, never
 * looked up in any other table. No static id->name table exists anywhere in this module, on
 * purpose: that would just relocate the same staleness risk `scopedRoster` had.
 */

export const SCOPE = {
  schedule: 'schedule.read',
  careplan: 'careplan.read',
  school: 'school.read',
  contacts: 'contacts.read',
  transport: 'transport.read',
  goals: 'goals.read',
  pickupVerify: 'pickup.verify',
  pickupRequest: 'pickup.request',
} as const;

export type ChildAccess = {
  id: string;
  scopes: ReadonlySet<string>;
  /** Only ever non-null if THIS turn's own MyChildren result supplied one. */
  displayName: string | null;
};

/**
 * Parses MyChildren's own tool result shape, defensively. Returns `null` for a shape that is
 * not even a list — the caller must treat that as a discovery FAILURE (fail closed), never as
 * "zero children." An empty array `[]` is a valid, different outcome (a real caller with no
 * children or grants at all — e.g. Oscar) and is returned as `[]`, not `null`.
 */
export function parseMyChildren(data: unknown): ChildAccess[] | null {
  const list = (data as { myChildren?: unknown })?.myChildren;
  if (!Array.isArray(list)) return null;
  const out: ChildAccess[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { child, scopes } = entry as { child?: unknown; scopes?: unknown };
    const id = (child as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string' || !Array.isArray(scopes)) continue;
    const displayNameRaw = (child as { person?: { displayName?: unknown } } | undefined)?.person?.displayName;
    out.push({
      id,
      scopes: new Set(scopes.filter((s): s is string => typeof s === 'string')),
      displayName: typeof displayNameRaw === 'string' ? displayNameRaw : null,
    });
  }
  return out;
}
