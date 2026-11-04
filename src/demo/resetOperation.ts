import { DEMO_PERSONAS, type DemoPersona } from './personas';
import type { GuardIdentity } from './guards';
export function resetPersona(identity: GuardIdentity) {
  return identity.ok && identity.demo ? DEMO_PERSONAS.find(p => p.personId === identity.personId && (identity.demoGuide ? p.id === 'demo-guide' && p.personId === 'p_demo_guide' : p.parent || p.guardian)) : undefined;
}
import type { MintedSession } from './session';
import { publicPersonaSession } from './persona-sessions';

type Operation = { actor: string; status: 'running' | 'committed' | 'failed' | 'unknown'; at: number };
type Dependencies = {
  restore(actor: string, runId: string): Promise<unknown>;
  committed(actor: string, runId: string): Promise<boolean>;
  session(persona: DemoPersona): Promise<{ session: MintedSession }>;
  sessionTimeoutMs?: number;
};
export const validResetRunId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Tracks HTTP ambiguity; the committed receipt is durable in the restore transaction itself. */
export function createResetOperations(deps: Dependencies) {
  const runs = new Map<string, Operation>();
  const reply = async (persona: DemoPersona, runId: string, status: Operation['status'], timeoutMs = deps.sessionTimeoutMs ?? 1200) => {
    if (status !== 'committed') return { runId, status };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Auth service latency cannot convert a proven commit into RESET_FAILED or block the UI forever.
    const session = await Promise.race([
      deps.session(persona).then(r => publicPersonaSession(r.session)).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    return { ok: true, runId, status, personaId: persona.id, session };
  };
  const status = async (persona: DemoPersona, runId: string) => {
    const memory = runs.get(runId);
    if (memory && memory.actor !== persona.personId) return { runId, status: 'unknown' as const };
    if (memory?.status === 'running') return { runId, status: 'running' as const };
    if (memory?.status === 'committed') return reply(persona,runId,'committed');
    const committed = await deps.committed(persona.personId, runId);
    return reply(persona, runId, committed ? 'committed' : memory?.status ?? 'unknown');
  };
  const start = async (persona: DemoPersona, runId: string) => {
    if (runs.has(runId)) return status(persona, runId);
    for (const [id, run] of runs) if (Date.now() - run.at > 10 * 60_000 && run.status !== 'running') runs.delete(id);
    if (runs.size >= 512) throw new Error('RESET_CAPACITY');
    const began = Date.now();
    runs.set(runId, { actor: persona.personId, status: 'running', at: Date.now() });
    try {
      await deps.restore(persona.personId, runId);
      runs.get(runId)!.status = 'committed';
      return reply(persona, runId, 'committed', Math.min(deps.sessionTimeoutMs ?? 1200, Math.max(0,1700-(Date.now()-began))));
    } catch (error) {
      // SQLSTATE errors abort the atomic statement. Network loss alone does NOT prove rollback.
      const code = (error as { code?: string }).code ?? '';
      const rollback = /^(22|23|42)[0-9A-Z]{3}$/.test(code) || ['P0001','40001','40P01','55P03','57014'].includes(code);
      runs.get(runId)!.status = rollback ? 'failed' : 'unknown';
      try { return await status(persona, runId); }
      catch { return { runId, status: 'unknown' as const }; }
    }
  };
  return { start, status };
}
