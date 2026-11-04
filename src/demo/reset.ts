/**
 * resetDemo — restore the DEMO state only.
 *
 * Deliberately NOT `db:reset`: that is the operator path and touches baseline tables wholesale.
 * This restores exactly the additive fixture set plus the Cast v2 seed, inside ONE transaction under
 * an advisory lock, so a failure can never leave a partially restored demo. Non-sandbox rows and
 * audit history are never touched: every delete is scoped to `sandbox = true` or to fixture ids.
 */
import pg from 'pg';
import { createSeed, createShowcaseCalendar } from '../fixtures';
import { randomUUID } from 'node:crypto';
import { createSimulatedCoordination } from '../fixtures-simulated';
import { createSimulatedCalendar } from '../fixtures-simulated';
import { createSimulatedOrbit } from '../fixtures-simulated';
import { createSimulatedCheckIn } from '../fixtures-simulated';
import { createSimulatedCareFacts } from '../fixtures-simulated';
import { createSimulatedPrivate } from '../fixtures-simulated';
import { createCastV2 } from '../fixtures-cast-v2';
import { createFridgeSeed } from '../fixtures-fridge';
import { createDemoHistory } from '../fixtures-demo-history';
import { dropPersonaSessionCache } from './persona-sessions';
import { purgeFamilyArtifacts, reconcileAbandonedFamilies, type FamilyRow } from './family';


function client() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL is not set');
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

type Row = Record<string, unknown>;

function fixtures(): Record<string, Row[]> {
  const sim = createSimulatedCoordination();
  const cal = createSimulatedCalendar();
  const priv = createSimulatedPrivate();
  const orbit = createSimulatedOrbit();
  const checkin = createSimulatedCheckIn();
  const facts = createSimulatedCareFacts();
  // The 30-day demo pickup-coordination history (0084, staged, v1 PROPOSED —
  // docs/contracts/demo-history.md). Deterministic: createDemoHistory() computes every date from
  // a single fixed anchor, never Date.now(), so this is the exact same ~20 stories on every call.
  const hist = createDemoHistory();
  return {
    coordination_jobs: [...sim.coordination_jobs, ...hist.coordination_jobs] as unknown as Row[],
    attempts: [...sim.attempts, ...hist.attempts] as unknown as Row[],
    candidate_evaluations: hist.candidate_evaluations,
    confirmations: hist.confirmations,
    voice_notes: hist.voice_notes,
    holidays: cal.holidays, routines: cal.routines, adult_availability: cal.adult_availability,
    holiday_arrangements: cal.holiday_arrangements, events: cal.events,
    households: priv.households, people: priv.people, children: priv.children,
    household_members: priv.household_members,
    household_policies: orbit.household_policies,
    expected_checkins: checkin.expected_checkins,
    care_facts: facts.care_facts,
    // Andre's Dad status chip (0076). Computed HERE, not hardcoded: `fixtures()` is called fresh
    // on every reset, so `expires_at` is always "reset time + 24h" rather than a timestamp that
    // would eventually read as expired. Delete-then-reinsert by its own `person_id` only (the
    // ID_TABLES step below) — any OTHER person's live-set status is never touched, preserving
    // unrelated and non-demo status rows exactly as this feature's write path leaves them.
    shared_statuses: [{
      person_id: 'p_dad',
      emoji: '🍼',
      text: 'Changing a diaper',
      eta_text: 'unknown',
      set_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }],
    // The two canonical seeded goals (src/fixtures.ts), byte-for-byte including the new period/
    // completed_at/sandbox columns (0083) — a demo edit (title changed, marked complete,
    // re-proposed, deleted outright) reverts to exactly this shape on reset. `sandbox: true` is
    // stated explicitly here, not left to the column default, so restore always reasserts it even
    // if a live write somehow cleared it.
    goals: [
      {
        id: 'goal_reading', child_id: 'p_nora', title: 'Reading level 3 by June',
        owner_id: 'p_mom', proposed_by_id: null, horizon: 'June 2027', status: 'APPROVED',
        period: null, completed_at: null, sandbox: true,
      },
      {
        id: 'goal_passing', child_id: 'p_nora', title: 'Left-foot passing this season',
        owner_id: null, proposed_by_id: 'p_marcus', horizon: '2026 season', status: 'PROPOSED',
        period: null, completed_at: null, sandbox: true,
      },
    ],
  };
}

/**
 * Rows reset must restore from the CANONICAL seed source, per table.
 *
 * `fixtures()` above is only the simulated/private set. Cast v2 is demo CONTENT, not test junk, and
 * several of its tables are sandbox-marked, so step 1 clears them and this set puts them back: the
 * Malik care facts, the 32 Cast routines, its people/households/children/memberships and its events.
 * Deletion stays exactly as scoped before (the `data` id lists above); these rows are upserted only,
 * so no FK-bearing Cast row is ever deleted and re-inserted.
 */
function castRowsByTable(): Record<string, Row[]> {
  const cv = createCastV2() as unknown as Record<string, Row[]>;
  const out: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(cv)) if (Array.isArray(rows)) out[table] = rows;
  Object.assign(out, createShowcaseCalendar());
  // Restore family Fridge rows after Cast has supplied every child and author.
  for (const [table, rows] of Object.entries(createFridgeSeed())) out[table] = [...(out[table] ?? []), ...rows];
  return out;
}

export type ResetReport = {
  restored: Record<string, number>;
  cleared: Record<string, number>;
  /** Demo decisions cleared (0050). Real decisions are never counted here, because none are cleared. */
  demoDecisionsCleared: number;
  /** Created (sandbox) families removed; they are not fixture rows. */
  createdFamiliesRemoved: number;
  /** Abandoned family accounts reconciled (0051): deleted with their rows and markers. */
  abandonedFamiliesReconciled: number;
  droppedSessionCache: true;
};

export type ResetDependencies = {
  client?: () => pg.Client;
  purge?: typeof purgeFamilyArtifacts;
  reconcile?: typeof reconcileAbandonedFamilies;
  runId?: string;
  schedule?: (task: () => Promise<void>) => void;
};
export function resetSnapshot() { return { fixtures: fixtures(), cast: castRowsByTable() }; }

/** Canonical content for the scoped showcase reset. No client-supplied rows. */
export function showcaseSnapshot() {
  const base=createSeed(), {fixtures,cast}=resetSnapshot();
  const snapshot: Record<string, Row[]> = {
    events: base.events.map(e=>({id:e.id,child_id:e.childId,title:e.title,start_at:e.start,end_at:e.end,location:e.location})),
    relationships: base.relationships.map(r=>({id:r.id,from_id:r.fromId,to_id:r.toId,type:r.type,status:r.status,created_at:r.createdAt,history:r.history})),
    care_plans: base.carePlans.map(c=>({child_id:c.childId,text:c.text})),
    grants: [...base.grants.map(g=>({id:g.id,actor_id:g.actorId,child_id:g.childId,scopes:g.scopes,valid_from:g.validFrom??null,valid_until:g.validUntil??null,granted_by:g.grantedBy})),
      // Canonical address grants introduced by migration 0057 are also part of the baseline.
      ...[['gr_addr_kendra_nora','p_mom'],['gr_addr_andre_nora','p_dad']].map(([id,actor_id])=>({id,actor_id,child_id:'p_nora',scopes:['address.read'],valid_from:null,valid_until:null,granted_by:'p_mom'}))],
  };
  for(const source of [fixtures,cast]) for(const [table,rows] of Object.entries(source)) snapshot[table]=[...(snapshot[table]??[]),...rows];
  return snapshot;
}

/** Slow external-account disposal is independent of the already-committed data restore. */
export async function resetDemo(actor = 'resetDemo', dependencies: ResetDependencies = {}): Promise<ResetReport & { runId: string; status: 'committed' }> {
  const before = Date.now();
  const data = resetSnapshot(), runId = dependencies.runId ?? randomUUID();
  const c = (dependencies.client ?? client)();
  await c.connect();
  let result: { restored: Record<string, number>; cleared: Record<string, number>; demoDecisionsCleared: number; createdFamiliesRemoved: number; familyRows: FamilyRow[]; cleanupBefore?: number };
  try {
    const response = actor === 'p_demo_guide'
      ? await c.query('select public.restore_showcase_snapshot($1,$2::uuid,$3::jsonb) as report',[actor,runId,JSON.stringify(showcaseSnapshot())])
      : await c.query('select public.restore_demo_snapshot($1,$2::uuid,$3::jsonb,$4::jsonb) as report', [actor,runId,JSON.stringify(data.fixtures),JSON.stringify(data.cast)]);
    result = response.rows[0]?.report;
    if (!result) throw new Error('RESET_RECEIPT_MISSING');
  } finally { await c.end(); }
  dropPersonaSessionCache();
  const cleanup = async () => {
    await (dependencies.purge ?? purgeFamilyArtifacts)(result.familyRows, { sweep: false });
    await (dependencies.reconcile ?? reconcileAbandonedFamilies)(Number(result.cleanupBefore ?? before) - 60_000);
  };
  if(actor !== 'p_demo_guide') (dependencies.schedule ?? (task => { setImmediate(() => { void task().catch(() => console.error('[demo-reset] background cleanup needs reconciliation')); }); }))(cleanup);
  return { runId,status:'committed',restored:result.restored,cleared:result.cleared,demoDecisionsCleared:result.demoDecisionsCleared,
    createdFamiliesRemoved:result.createdFamiliesRemoved,abandonedFamiliesReconciled:0,droppedSessionCache:true };
}

export async function committedResetRun(actor: string, runId: string): Promise<boolean> {
  const c = client(); await c.connect();
  try { return (await c.query('select 1 from public.demo_reset_runs where actor=$1 and run_id=$2::uuid',[actor,runId])).rowCount === 1; }
  finally { await c.end(); }
}
