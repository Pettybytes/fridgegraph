/**
 * The Rosina chat turn: one user message (+ history) in, one grounded reply + proposed actions
 * out. Built on the same provider/MCP plumbing as src/muse, generalized from a fixed one-question
 * harness to a free-form multi-turn conversation with a second, local-only kind of "tool" for
 * proposing catalog actions.
 *
 * Identity: the caller's own bearer token is the only credential used, forwarded to MCP exactly
 * as received. This module never signs in, never holds a service key, never invents a person.
 */
import { McpToolClient, type McpTool, type McpToolCall } from '../muse/mcp';
import { chat, type ChatResult, type ModelMessage, type ModelTool, type ProviderConfig, type ProviderId, resolveProvider } from '../muse/providers';
import { catalog, validateActions, type CatalogAction } from './catalog';
import { parseMyChildren, SCOPE, type ChildAccess } from './childAccess';
import { localizeTimestamps } from './localTime';
import { applyOutputGuard } from './outputGuard';
import { checkInStatusFrom, decideOrbitAction, injectOverdueFlag, isCheckInOverdue, validatePrepareOrbitAlert, vocabularyMapFrom, type OrbitAlertArgs } from './orbit';
import { ACTION_TOOLS, ACTION_TOOL_PREFIX, buildSystemPrompt } from './systemPrompt';
import { runCaregiverBriefing } from './briefingTool';

/** The local "caregiver briefing" tool: a composed, read-only answer built ONLY from what the
 * signed-in caller may read for one child and day (src/rosina/briefing*.ts). It is neither an MCP
 * tool (it composes several reads locally) nor a proposeAction_ card (it changes nothing), so it is
 * handled in its own branch below. Gated like any childId read: the id must be one of THIS caller's
 * own MyChildren children; per-scope gating (schedule vs careplan) happens inside the gatherer. */
const BRIEFING_TOOL_NAME = 'CaregiverBriefing';
const BRIEFING_TOOL: ModelTool = {
  type: 'function',
  function: {
    name: BRIEFING_TOOL_NAME,
    description:
      'Build a short briefing ("what do I need to know for today?" / "brief me for Nora\'s pickup") for ONE child on ONE date, from ONLY what YOU — the signed-in caregiver — are allowed to read. ' +
      'It reads as you and never borrows a parent\'s permissions, so it shows more for some callers and less for others. ' +
      'Call it with an exact childId from your own list in the system prompt and a YYYY-MM-DD date, then relay its briefing text to the user as your answer. It changes nothing.',
    parameters: {
      type: 'object',
      properties: { childId: { type: 'string' }, date: { type: 'string' } },
      required: ['childId', 'date'],
      additionalProperties: false,
    },
  },
};

/** The app handler (orbitDraft + orbitPreview + the confirm UI) this server build ships with.
 * Paired with the catalog's own `implemented` flag in `decideOrbitAction()` — neither alone is
 * enough; a metadata flip with no handler present still answers UNIMPLEMENTED. Flip this to
 * `false` only if this build is ever deployed without Codex's W-ORBIT handler. */
export const ORBIT_HANDLER_PRESENT = true;

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

/** The subset of McpToolClient this module actually calls — small enough to stub in a test
 * without a real network connection. */
export type McpClientLike = Pick<McpToolClient, 'initialize' | 'listTools' | 'callTool'>;

export type RosinaTurnOptions = {
  message: string;
  currentRoute: string;
  history: HistoryMessage[];
  bearer: string;
  /** The caller's own verified identity (src/auth/verify.ts) — used ONLY to resolve this
   * caller's own fresh child access via `MyChildren` (src/rosina/childAccess.ts). Never used to
   * act as anyone else. */
  personId: string;
  /** From the verified token's app_metadata.demo_guide claim — never guessed from personId. */
  isGuide: boolean;
  provider: ProviderId;
  mcpUrl: string;
  maxRounds?: number;
  /** Injectable for tests — never set in production. Defaults to the real provider call. */
  chatFn?: typeof chat;
  /** Scenario instant for time-of-day questions (overdue check-ins), set only under DEMO_CLOCK=1.
   *  Never used for authentication — token expiry always uses the real clock. */
  scenarioNow?: Date;
  /** Injectable for tests — never set in production. Defaults to a real McpToolClient. */
  mcpClientFactory?: (url: string, bearer: string) => McpClientLike;
  /** Injectable for tests — never set in production. Defaults to resolveProvider(options.provider),
   * which reads the META_ or BASETEN_ variables from the environment; a stubbed chatFn never
   * needs real credentials to run, so tests supply a fake config here instead of real env vars. */
  providerConfig?: ProviderConfig;
};

export type ToolCallEvidence = {
  round: number;
  kind: 'mcp' | 'action' | 'refused';
  name: string;
  argsPreview: unknown;
  isError: boolean;
  errorCodes: string[];
};

/**
 * The structured result of a successful `ProposeSchoolDayReport` call this turn, for the app to
 * build its own confirm UI from — NEVER parsed out of the model's own text, which is exactly what
 * `confirmSchoolDayReport`'s version check exists to refuse if the app got it wrong anyway.
 */
export type SchoolReportProposalResult = {
  id: string;
  version: number;
  childId: string;
  kind: string;
  text: string;
  createdAt: string;
  expiresAt: string;
};

/**
 * Same role as SchoolReportProposalResult, for `ProposeAddVillager` — the exact
 * person/relationship/scopes/window this turn's own tool call staged, for the app to build its
 * own confirm UI from. Never parsed out of the model's own text.
 */
export type AddVillagerProposalResult = {
  id: string;
  version: number;
  childId: string;
  personId: string;
  personDisplayName: string | null;
  relationshipType: string;
  scopes: string[];
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  expiresAt: string;
};

export type RosinaTurnResult = {
  reply: string;
  actions: CatalogAction[];
  /** The LATEST successful ProposeSchoolDayReport result this turn, or null if none was called
   * (or the output guard fired). A fresh proposal replaces an earlier one in the same turn, same
   * as the database row it mirrors. This is never present unless this exact turn's own tool call
   * produced it — never carried over from a prior turn, never invented. */
  schoolReportProposal: SchoolReportProposalResult | null;
  /** Same rule as schoolReportProposal, for ProposeAddVillager. */
  addVillagerProposal: AddVillagerProposalResult | null;
  provider: ProviderId;
  model: string;
  rounds: number;
  toolCalls: ToolCallEvidence[];
  usage: { prompt: number; completion: number; total: number };
  latencyMs: number;
  /** True if the output guard replaced the model's reply. Safe to log as a bare boolean — never
   * log which name triggered it (src/rosina/outputGuard.ts). */
  outputGuardTriggered: boolean;
};

/** Defensive parse of ProposeSchoolDayReport's own tool result shape — an unexpected shape
 * returns null rather than throwing, so a malformed response never fakes a structured proposal. */
function schoolReportProposalFrom(data: unknown): SchoolReportProposalResult | null {
  const row = (data as { proposeSchoolDayReport?: unknown })?.proposeSchoolDayReport;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const childId = (r.child as { id?: unknown } | undefined)?.id;
  if (
    typeof r.id !== 'string' || typeof r.version !== 'number' || typeof childId !== 'string' ||
    typeof r.kind !== 'string' || typeof r.text !== 'string' ||
    typeof r.createdAt !== 'string' || typeof r.expiresAt !== 'string'
  ) {
    return null;
  }
  return { id: r.id, version: r.version, childId, kind: r.kind, text: r.text, createdAt: r.createdAt, expiresAt: r.expiresAt };
}

/** Defensive parse of ProposeAddVillager's own tool result shape — same posture as
 * schoolReportProposalFrom: an unexpected shape returns null rather than throwing. */
function addVillagerProposalFrom(data: unknown): AddVillagerProposalResult | null {
  const row = (data as { proposeAddVillager?: unknown })?.proposeAddVillager;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const childId = (r.child as { id?: unknown } | undefined)?.id;
  const person = r.person as { id?: unknown; displayName?: unknown } | undefined;
  const personId = person?.id;
  if (
    typeof r.id !== 'string' || typeof r.version !== 'number' || typeof childId !== 'string' ||
    typeof personId !== 'string' || typeof r.relationshipType !== 'string' ||
    !Array.isArray(r.scopes) || !r.scopes.every((s) => typeof s === 'string') ||
    typeof r.createdAt !== 'string' || typeof r.expiresAt !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    version: r.version,
    childId,
    personId,
    personDisplayName: typeof person?.displayName === 'string' ? person.displayName : null,
    relationshipType: r.relationshipType,
    scopes: r.scopes as string[],
    validFrom: typeof r.validFrom === 'string' ? r.validFrom : null,
    validUntil: typeof r.validUntil === 'string' ? r.validUntil : null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/** Defense in depth, independent of .apollo/mcp*.yaml: even if MCP ever exposed a mutation, this
 * service refuses to call anything by a name it does not already know is safe. Grown one tool
 * at a time, each addition reviewed on its own (see docs/handoff/HANDOFF.md "Rosina tools
 * available" — a new read ships in the same PR as its own persona-boundary tests). `Attempts`
 * and `JobTimeline` added in TASK R-TOOLS-1 (evidence 40). `ChildEvents`, `EffectiveSchedule`
 * and `AdultAvailability` added in TASK R-TOOLS-2 (evidence 41). `CheckInStatus`, `OrbitStatus`
 * and `OrbitVocabulary` added in TASK R-ORBIT (evidence 42/43/44) — still no activate/draft/
 * preview tool exists or ever will; Orbit's mutations are never exposed here. `CareFacts` added
 * in TASK R-CARE (evidence 35 §14): read-only, no oracle (an unauthorized, nonexistent, and
 * genuinely-empty child all return the identical `[]`). `MyChildren` (TASK R-MYCHILDREN) is
 * deliberately NOT in this list: it is never offered to the model as a callable tool at all —
 * `runRosinaTurn` calls it itself, exactly once, at the start of every turn, so the model always
 * has fresh, correct access info already baked into its system prompt and never has to ask.
 *
 * `ProposeSchoolDayReport` (TASK: Rosina school-report tool) is the FIRST, and still only, mutation
 * in this set — a deliberate, narrow exception, not a reversal of "every other name here is a
 * read." It can only ever stage a draft in `school_report_proposals`; it structurally cannot write
 * `school_reports` (see `.apollo/mcp.local.yaml` and `supabase/migrations/0071_*.sql`).
 * `ConfirmSchoolDayReport` — the mutation that files the real, parent-visible report — is NOT in
 * this set and has no MCP operation file anywhere: Rosina cannot reach it no matter what the
 * model asks for, so a model tool call or generated text can never confirm itself.
 *
 * `ProposeAddVillager` (TASK: Add a Villager) is the SECOND such exception. It can only ever stage
 * a draft in `villager_proposals`; it structurally cannot write `relationships` or `grants` (see
 * `.apollo/mcp.local.yaml` and `supabase/migrations/0074_*.sql`). `ConfirmAddVillager` is NOT in
 * this set and has no MCP operation file either, for the same reason as `ConfirmSchoolDayReport`.
 */
const ALLOWED_MCP_TOOL_NAMES = new Set([
  'PickupCandidates',
  'Attempts',
  'JobTimeline',
  'ChildEvents',
  'EffectiveSchedule',
  'AdultAvailability',
  'CheckInStatus',
  'OrbitStatus',
  'OrbitVocabulary',
  'CareFacts',
  'ProposeSchoolDayReport',
  'ProposeAddVillager',
]);

/**
 * TASK R-TOOLS-2: "ID authorization is a code rule." For these tools, the id argument (child or
 * person) is checked against `permittedIds` BEFORE the tool is ever called — never trust a
 * browser route, message history, or a model-supplied argument. A permitted id is either one of
 * THIS TURN's own fresh `MyChildren` ids (TASK R-MYCHILDREN — replaced the old static roster),
 * the caller's own personId (always safe to ask about yourself), or an id an authorized tool
 * result already handed back THIS turn (e.g. EffectiveSchedule's parent, or a candidate from
 * Attempts/JobTimeline/PickupCandidates) — never an id invented from outside the conversation.
 */
const ID_ARG_BY_TOOL: Record<string, string> = {
  ChildEvents: 'childId',
  EffectiveSchedule: 'childId',
  AdultAvailability: 'personId',
  CheckInStatus: 'childId',
  OrbitStatus: 'childId',
  CareFacts: 'childId',
  ProposeSchoolDayReport: 'childId',
  // ProposeAddVillager is parent-only authority, checked inside propose_add_villager itself —
  // same posture as CheckInStatus/OrbitStatus below: MyChildren only proves the id is KNOWN to
  // this caller, never that they are its parent. No REQUIRED_SCOPE_BY_TOOL entry exists for it,
  // on purpose: "parent" is not one of the scope strings MyChildren ever reports.
  ProposeAddVillager: 'childId',
  // OrbitVocabulary takes no id argument — it is a public, versioned, closed-vocabulary read.
};

/**
 * TASK R-MYCHILDREN: beyond "is this id one you may ask about at all," these three childId-keyed
 * tools additionally require the EXACT scope `MyChildren` reported for that child this turn — a
 * `careplan.read`-only grant (e.g. Priya on Malik) may use `CareFacts` but never `ChildEvents` or
 * `EffectiveSchedule` for that same child. `CheckInStatus`/`OrbitStatus` have no corresponding
 * scope in the enum at all — MyChildren only proves the id is KNOWN; the backend's own parent-
 * only check (src/rosina/orbit.ts's `verifiedParentOf`) remains the real authority for those two,
 * exactly as before this task. `AdultAvailability` is keyed by personId, not a child, and is
 * untouched by scopes entirely.
 */
const REQUIRED_SCOPE_BY_TOOL: Record<string, string> = {
  ChildEvents: SCOPE.schedule,
  EffectiveSchedule: SCOPE.schedule,
  CareFacts: SCOPE.careplan,
  ProposeSchoolDayReport: SCOPE.schoolReport,
};

function mcpToolDefinitions(tools: McpTool[]): ModelTool[] {
  return tools
    .filter((tool) => ALLOWED_MCP_TOOL_NAMES.has(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
}

function truncate(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Collects every string value found under a key literally named `id`, anywhere in a tool
 * result — the generic "what ids did an authorized read just hand back" scan. Harmless if it
 * also picks up a job/attempt id: those are never checked against (only child/person-id
 * arguments are gated), so an extra id in the set cannot grant anything it shouldn't. */
function harvestIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) harvestIds(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' && typeof v === 'string') into.add(v);
      else harvestIds(v, into);
    }
  }
}

export async function runRosinaTurn(options: RosinaTurnOptions): Promise<RosinaTurnResult> {
  const config = options.providerConfig ?? resolveProvider(options.provider);
  const chatImpl = options.chatFn ?? chat;
  const mcp: McpClientLike = options.mcpClientFactory
    ? options.mcpClientFactory(options.mcpUrl, options.bearer)
    : new McpToolClient(options.mcpUrl, options.bearer);
  const started = Date.now();
  await mcp.initialize();

  // TASK R-MYCHILDREN: discovery happens HERE, once, fresh, before anything else — never a
  // static roster, never cached across requests. This is a service-initiated call, not a tool
  // the model chooses to make (or skip): every turn gets exactly one, unconditionally.
  const myChildrenResult = await mcp.callTool('MyChildren', {}).catch((error: unknown): McpToolCall => ({
    data: null,
    errors: [{ message: (error as Error).message }],
    isError: true,
    raw: null,
  }));
  const childList = myChildrenResult.isError ? null : parseMyChildren(myChildrenResult.data);
  if (childList === null) {
    // Discovery failed or came back in a shape this service doesn't recognize — fail the WHOLE
    // turn closed. Never fall back to a static roster; never let the model run with no ground
    // truth about who it may discuss.
    const errorCodes = myChildrenResult.errors.map((e) => e.extensions?.code ?? e.message ?? 'ERROR').filter((c): c is string => Boolean(c));
    return {
      reply: "I couldn't check that just now.",
      actions: [],
      schoolReportProposal: null,
      addVillagerProposal: null,
      provider: options.provider,
      model: config.model,
      rounds: 0,
      toolCalls: [{ round: 0, kind: 'mcp', name: 'MyChildren', argsPreview: {}, isError: true, errorCodes: errorCodes.length ? errorCodes : ['DISCOVERY_FAILED'] }],
      usage: { prompt: 0, completion: 0, total: 0 },
      latencyMs: Date.now() - started,
      outputGuardTriggered: false,
    };
  }
  const childAccessById = new Map(childList.map((c) => [c.id, c]));

  const mcpTools = await mcp.listTools();
  const tools: ModelTool[] = [...mcpToolDefinitions(mcpTools), BRIEFING_TOOL, ...ACTION_TOOLS];

  const messages: ModelMessage[] = [
    { role: 'system', content: buildSystemPrompt([...childAccessById.values()], options.isGuide, options.personId) },
    ...options.history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `${options.message}\n\n[currentRoute: ${options.currentRoute}]` },
  ];

  const maxRounds = options.maxRounds ?? 4;
  const toolCallEvidence: ToolCallEvidence[] = [{ round: 0, kind: 'mcp', name: 'MyChildren', argsPreview: {}, isError: false, errorCodes: [] }];
  const proposedActions: unknown[] = [];
  const rounds: ChatResult[] = [];
  // Every real MCP result's raw JSON this turn — the output guard's only "this name is grounded"
  // signal now that there is no static roster at all. A displayName MyChildren itself reported
  // (TASK R-MYCHILDREN; null on the currently-deployed contract — see childAccess.ts) is pushed
  // in below, exactly like any other tool result: a name is only ever safe to say if THIS turn's
  // own authorized read actually said it.
  const toolResultTexts: string[] = [];
  for (const child of childAccessById.values()) {
    if (child.displayName) toolResultTexts.push(child.displayName);
  }
  // Catalog presence never implies permission. The ONLY proof this service has that the caller
  // has real standing over a given child is a PickupCandidates call for that exact childId that
  // came back without error, in THIS turn. start-pickup — the one consequential, data-changing
  // action — requires that proof; every other proposeAction_* is navigation/explanation only and
  // carries no such requirement.
  const verifiedChildIds = new Set<string>();
  // ID authorization is a code rule, not a prompt suggestion: seeded with THIS turn's own fresh
  // MyChildren ids (TASK R-MYCHILDREN) and the caller's own personId (always safe to ask about
  // yourself), then grown as authorized tool results hand back ids this turn. Gates
  // ChildEvents/EffectiveSchedule/AdultAvailability/CheckInStatus/OrbitStatus/CareFacts's
  // child/person-id arguments — see ID_ARG_BY_TOOL. The Demo guide is the one documented
  // exception: her read access to sandbox rows is enforced entirely by the backend's own
  // `demo_guide_*` RLS policies (independent of MyChildren, which — verified live — reports
  // zero children for her; she holds no household membership or grant anywhere). Skipping the
  // pre-call gate for her is not a static child mapping: no id is ever assumed permitted, the
  // backend's own per-row, sandbox-only check is the real (and only) authority for what she can
  // see, exactly as CheckInStatus/OrbitStatus already rely on the backend's parent-only check
  // for everyone else.
  const permittedIds = new Set<string>([...childAccessById.keys(), options.personId]);
  // Orbit-specific gates (src/rosina/orbit.ts): CheckInStatus throws UNAUTHORIZED for anyone who
  // is not the child's parent, so a SUCCESSFUL call is proof of parent authority — never an
  // assumption. vocabularyByKind accumulates every value THIS turn's own OrbitVocabulary call(s)
  // actually returned; a descriptor value not in it is refused regardless of how plausible it
  // looks, so the model can never silently substitute a near match.
  const verifiedParentOf = new Set<string>();
  const vocabularyByKind = new Map<string, Set<string>>();
  // The latest successful ProposeSchoolDayReport result THIS turn — overwritten, never merged, if
  // the model proposes more than once (the database row it mirrors is also replaced, not added).
  let schoolReportProposal: SchoolReportProposalResult | null = null;
  let addVillagerProposal: AddVillagerProposalResult | null = null;

  let finalContent = '';

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await chatImpl(config, messages, tools, { maxTokens: 3000 });
    rounds.push(result);

    if (result.toolCalls.length === 0) {
      finalContent = result.content.trim();
      break;
    }

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })),
    });

    // Real MCP reads are processed before action-tool proposals in EVERY round, regardless of the
    // order the model emitted them in — otherwise whether a same-round start-pickup gets the
    // benefit of a same-round PickupCandidates call would depend on model call-ordering, which is
    // not something to trust. Tool-result messages may be appended in any order; only the
    // tool_call_id pairing matters.
    const parsedCalls = result.toolCalls.map((call) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.args) as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { call, args };
    });
    const mcpCalls = parsedCalls.filter(({ call }) => !call.name.startsWith(ACTION_TOOL_PREFIX));
    const actionCalls = parsedCalls.filter(({ call }) => call.name.startsWith(ACTION_TOOL_PREFIX));

    for (const { call, args } of mcpCalls) {
      if (call.name === BRIEFING_TOOL_NAME) {
        const childId = typeof args.childId === 'string' ? args.childId : '';
        const date = typeof args.date === 'string' ? args.date : '';
        const access = childAccessById.get(childId);
        // Gate: only a child THIS caller has standing with (their own MyChildren). An unknown id and
        // a malformed date are refused the same way for everyone — no existence oracle. Per-scope
        // gating (schedule vs careplan) and every read happen inside runCaregiverBriefing, as the
        // caller; the Demo guide is not special-cased here (she holds no MyChildren children).
        if (!access || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const code = access ? 'INVALID_DATE' : 'OUT_OF_SCOPE_ID';
          toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: [code] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: code }) });
          continue;
        }
        const briefing = await runCaregiverBriefing({ childId, date, callerId: options.personId, access, mcp }).catch(() => null);
        if (briefing) toolResultTexts.push(briefing.text);
        toolCallEvidence.push({ round, kind: 'mcp', name: call.name, argsPreview: args, isError: !briefing, errorCodes: briefing ? [] : ['BRIEFING_FAILED'] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(briefing ?? { error: 'BRIEFING_FAILED' }) });
        continue;
      }

      if (!ALLOWED_MCP_TOOL_NAMES.has(call.name)) {
        toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'TOOL_NOT_ALLOWED' }) });
        continue;
      }

      const idArgKey = ID_ARG_BY_TOOL[call.name];
      // The Demo guide's childId-keyed reads bypass the MyChildren-derived gate below — see the
      // long comment above `permittedIds` for why this is a backend-enforced exception, not a
      // static mapping. AdultAvailability (personId-keyed) is never part of this bypass.
      const isGuideChildBypass = options.isGuide && idArgKey === 'childId';
      if (idArgKey && !isGuideChildBypass) {
        const idValue = args[idArgKey];
        if (typeof idValue !== 'string' || !permittedIds.has(idValue)) {
          // Never executed: this is the pre-call gate, not a backend denial. No hint is given
          // either way about whether the id exists — the model gets the same refusal regardless.
          toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['OUT_OF_SCOPE_ID'] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'OUT_OF_SCOPE_ID' }) });
          continue;
        }
        // TASK R-MYCHILDREN: known is not enough for these three — the EXACT scope MyChildren
        // reported for this child must cover what the tool actually reads. A careplan.read-only
        // grant (e.g. Priya on Malik) may use CareFacts but never ChildEvents/EffectiveSchedule
        // for that same child, even though the id itself is perfectly well-known.
        const requiredScope = REQUIRED_SCOPE_BY_TOOL[call.name];
        if (requiredScope && !(childAccessById.get(idValue)?.scopes.has(requiredScope))) {
          toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['SCOPE_NOT_GRANTED'] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'SCOPE_NOT_GRANTED' }) });
          continue;
        }
      }

      const callResult = await mcp.callTool(call.name, args).catch((error: unknown): McpToolCall => ({
        data: null,
        errors: [{ message: (error as Error).message }],
        isError: true,
        raw: null,
      }));
      const errorCodes = callResult.errors.map((e) => e.extensions?.code ?? e.message ?? 'ERROR').filter((c): c is string => Boolean(c));
      if (call.name === 'PickupCandidates' && !callResult.isError && typeof args.childId === 'string') {
        verifiedChildIds.add(args.childId);
      }
      // Grow the permitted-id set from whatever an authorized call just handed back (a
      // candidate, a parent, a child) — never from the call's own arguments, so a rejected or
      // out-of-scope call (isError) contributes nothing.
      if (!callResult.isError) harvestIds(callResult.data, permittedIds);
      if (call.name === 'CheckInStatus' && !callResult.isError && typeof args.childId === 'string') {
        verifiedParentOf.add(args.childId);
      }
      if (call.name === 'OrbitVocabulary' && !callResult.isError) {
        for (const [kind, values] of vocabularyMapFrom(callResult.data)) {
          const existing = vocabularyByKind.get(kind) ?? new Set<string>();
          for (const v of values) existing.add(v);
          vocabularyByKind.set(kind, existing);
        }
      }
      if (call.name === 'ProposeSchoolDayReport' && !callResult.isError) {
        const parsed = schoolReportProposalFrom(callResult.data);
        if (parsed) schoolReportProposal = parsed;
      }
      if (call.name === 'ProposeAddVillager' && !callResult.isError) {
        const parsed = addVillagerProposalFrom(callResult.data);
        if (parsed) addVillagerProposal = parsed;
      }
      // "Overdue" is real-time arithmetic, not something to trust the model to compute from a
      // dueAt string — the server decides it here, against the real clock, before the result
      // ever reaches a message. Never derived from recorded=false alone (src/rosina/orbit.ts).
      let overdueFlag: boolean | null = null;
      if (call.name === 'CheckInStatus' && !callResult.isError) {
        const status = checkInStatusFrom(callResult.data);
        if (status) overdueFlag = isCheckInOverdue(status, options.scenarioNow ?? new Date());
      }
      // Deterministic, not a hope the model converts UTC correctly: any `at`/`closedAt` in a
      // JobTimeline/Attempts result is rewritten to the family's own local time before the
      // model ever sees it. A no-op for PickupCandidates, which has neither field.
      const localizedData = callResult.isError ? callResult.data : localizeTimestamps(callResult.data);
      const finalData = overdueFlag !== null ? injectOverdueFlag(localizedData, overdueFlag) : localizedData;
      if (!callResult.isError && finalData) toolResultTexts.push(JSON.stringify(finalData));
      toolCallEvidence.push({ round, kind: 'mcp', name: call.name, argsPreview: args, isError: callResult.isError, errorCodes });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(callResult.isError ? { error: errorCodes, data: finalData } : finalData),
      });
    }

    for (const { call, args } of actionCalls) {
      const id = call.name.slice(ACTION_TOOL_PREFIX.length);

      if (id === 'prepareOrbitAlert') {
        // Gate first — parent authority + vocabulary membership — and that gate is NEVER
        // overridden by the catalog flag or the handler-present flag below; only once it passes
        // does metadata get a say at all. See decideOrbitAction() in src/rosina/orbit.ts for why
        // the catalog's `implemented` flag and this server's own ORBIT_HANDLER_PRESENT must BOTH
        // agree before anything is ever proposed — a metadata flip alone can never enable it.
        const shapeArgs = catalog.prepareOrbitAlert.argsSchema.parse(args);
        const semantic = shapeArgs ? validatePrepareOrbitAlert(shapeArgs as OrbitAlertArgs, verifiedParentOf, vocabularyByKind) : null;
        const decision = decideOrbitAction({
          shapeOk: Boolean(shapeArgs),
          gate: semantic ? (semantic.ok ? 'OK' : semantic.reason) : 'OK',
          enabled: catalog.prepareOrbitAlert.implemented === true,
          handlerPresent: ORBIT_HANDLER_PRESENT,
        });
        if (decision.propose) {
          proposedActions.push({ id, args: shapeArgs as Record<string, unknown> });
          toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: false, errorCodes: [] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
          continue;
        }
        toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: true, errorCodes: [decision.errorCode] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'Orbit alerts are not available through this app yet.' }) });
        continue;
      }

      let validated = validateActions([{ id, args }]);
      let refusalReason: string | null = null;
      // Catalog presence never implies permission: start-pickup additionally requires a
      // same-turn, successful PickupCandidates call for this exact child (see verifiedChildIds
      // above) — the only live proof this service has of real standing over that child.
      if (validated.length && id === 'start-pickup') {
        const childId = (validated[0].args as { childId: string }).childId;
        if (!verifiedChildIds.has(childId)) {
          validated = [];
          refusalReason = 'no verified access to this child yet — call PickupCandidates for this exact childId first';
        }
      }
      if (validated.length) proposedActions.push(validated[0]);
      toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: validated.length === 0, errorCodes: validated.length ? [] : [refusalReason ? 'UNVERIFIED_CHILD' : 'INVALID_ACTION'] });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(validated.length ? { ok: true } : { ok: false, error: refusalReason ?? 'invalid or unimplemented action' }) });
    }

    if (round === maxRounds) {
      const closing = await chatImpl(config, messages, undefined, { maxTokens: 3000 });
      rounds.push(closing);
      finalContent = closing.content.trim();
    }
  }

  const usage = rounds.reduce(
    (acc, r) => ({
      prompt: acc.prompt + (r.usage.prompt ?? 0),
      completion: acc.completion + (r.usage.completion ?? 0),
      total: acc.total + (r.usage.total ?? 0),
    }),
    { prompt: 0, completion: 0, total: 0 },
  );

  const guarded = applyOutputGuard(finalContent || "I couldn't check that just now.", toolResultTexts.join('\n'));

  return {
    reply: guarded.reply,
    // Fail closed: if the output guard caught a boundary violation in the reply text, don't trust
    // this turn's actions either — drop them rather than offer a card alongside a corrected reply.
    actions: guarded.triggered ? [] : validateActions(proposedActions),
    schoolReportProposal: guarded.triggered ? null : schoolReportProposal,
    addVillagerProposal: guarded.triggered ? null : addVillagerProposal,
    provider: options.provider,
    model: config.model,
    rounds: rounds.length,
    toolCalls: toolCallEvidence.map((t) => ({ ...t, argsPreview: typeof t.argsPreview === 'object' ? JSON.parse(truncate(JSON.stringify(t.argsPreview))) : t.argsPreview })),
    usage,
    latencyMs: Date.now() - started,
    outputGuardTriggered: guarded.triggered,
  };
}
