/**
 * Caregiver Briefing — production wiring. Builds the gatherer's readers from the live MCP tools,
 * each called AS THE CALLER (the same bearer-forwarding McpToolClient the turn already holds), and
 * runs gather → compose. No new credential, no impersonation. Called by runRosinaTurn when the model
 * invokes the local `CaregiverBriefing` tool for a child the caller has standing with.
 *
 * GAP (recorded, not built here — backend is out of this lane): the caller's APPROVED-PICKUP role
 * is not reliably derivable from the reads currently exposed to Rosina — the job's `confirmation`
 * (its `candidate`) is not a Rosina tool, and the job stores only a coarse window + date, no clock
 * time. So `pickupRole` returns null in production and the role falls back to parenting time from
 * EffectiveSchedule; the approved-pickup path is fully built and tested for when a confirmation read
 * lands. Also a gap: school reports (`schoolReports`) are not a Rosina tool, so they are not in the
 * briefing yet.
 */
import type { McpToolClient } from '../muse/mcp';
import type { ChildAccess } from './childAccess';
import { composeBriefing, type Briefing, type BriefingCareNote, type BriefingEvent } from './briefing';
import { gatherBriefing, type BriefingReaders, type ReadResult } from './briefingGather';

const GEOMETRY_SCOPE = 'address.read';

type McpLike = Pick<McpToolClient, 'callTool'>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Build the five readers from live MCP tools. A tool error becomes `{ ok: false }` (denied); an
 *  authorized-but-empty read becomes `{ ok: true, value: [] }` — the gatherer only ever calls a
 *  read when the caller's scope permits it, so empty genuinely means "none recorded". */
export function buildMcpReaders(mcp: McpLike): BriefingReaders {
  return {
    async childEvents({ childId, date }): Promise<ReadResult<BriefingEvent[]>> {
      const r = await mcp.callTool('ChildEvents', { childId, from: date, to: date }).catch(() => ({ isError: true, data: null }));
      if (r.isError) return { ok: false };
      const rows = asArray((r.data as { childEvents?: unknown })?.childEvents);
      const value = rows.map((e) => {
        const o = e as Record<string, unknown>;
        return {
          title: String(o.title ?? ''),
          start: String(o.start ?? ''),
          end: String(o.end ?? ''),
          location: typeof o.location === 'string' ? o.location : null,
          status: String(o.status ?? 'confirmed'),
        };
      });
      return { ok: true, value };
    },

    async effectiveSchedule({ childId, date }) {
      const r = await mcp.callTool('EffectiveSchedule', { childId, date }).catch(() => ({ isError: true, data: null }));
      if (r.isError) return { ok: false };
      const es = (r.data as { effectiveScheduleFor?: { parent?: { id?: unknown } | null; source?: unknown } })?.effectiveScheduleFor;
      return { ok: true, value: { parentId: typeof es?.parent?.id === 'string' ? es.parent.id : null, source: String(es?.source ?? 'WEEKLY') } };
    },

    async careFacts({ childId }): Promise<ReadResult<BriefingCareNote[]>> {
      const r = await mcp.callTool('CareFacts', { childId }).catch(() => ({ isError: true, data: null }));
      if (r.isError) return { ok: false };
      const rows = asArray((r.data as { careFacts?: unknown })?.careFacts);
      const value = rows.map((f) => {
        const o = f as Record<string, unknown>;
        return { key: String(o.key ?? ''), value: String(o.value ?? ''), confidence: String(o.confidence ?? '') };
      });
      return { ok: true, value };
    },

    async checkIn({ childId }) {
      const r = await mcp.callTool('CheckInStatus', { childId }).catch(() => ({ isError: true, data: null }));
      if (r.isError) return { ok: false };
      const ci = (r.data as { checkInStatus?: { recorded?: unknown; label?: unknown } })?.checkInStatus;
      if (!ci) return { ok: false };
      return { ok: true, value: { recorded: Boolean(ci.recorded), label: String(ci.label ?? '') } };
    },

    // GAP: no confirmation read + no stored clock time → not derivable. Fall back to parenting time.
    async pickupRole() {
      return { ok: true, value: null };
    },
  };
}

export async function runCaregiverBriefing(opts: {
  childId: string;
  date: string;
  callerId: string;
  /** The caller's own fresh MyChildren access for this child, or undefined if not one of theirs. */
  access: ChildAccess | undefined;
  mcp: McpLike;
}): Promise<Briefing> {
  const scopes = opts.access?.scopes ?? new Set<string>();
  const ctx = await gatherBriefing({
    childId: opts.childId,
    date: opts.date,
    callerId: opts.callerId,
    access: {
      childName: opts.access?.displayName ?? null,
      scopes,
      hasGeometryAccess: scopes.has(GEOMETRY_SCOPE),
      isKnownChild: Boolean(opts.access),
    },
    readers: buildMcpReaders(opts.mcp),
  });
  return composeBriefing(ctx);
}
