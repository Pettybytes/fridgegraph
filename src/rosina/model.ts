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
import { chat, chatStream, type ChatResult, type ModelMessage, type ModelTool, type ProviderConfig, type ProviderId, resolveProvider } from '../muse/providers';
import {calendarProposal} from './calendarActions';
import { catalog, validateActions, type CatalogAction } from './catalog';
import { parseMyChildren, SCOPE, type ChildAccess } from './childAccess';
import { bearerKey, type TtlCache } from './turnCache';
import { buildFamilyLens, type FamilyLens } from './lens';
import { localizeTimestamps, detroitToday, resolveVillagerValidFrom } from './localTime';
import { applyOutputGuard, createStreamGuard, sanitizeReplyText } from './outputGuard';
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
  /** Live progress for streaming transports. Token events carry ANSWER deltas only (reasoning
   * never streams); a `replace` event tells the client to discard provisional text because the
   * round turned out to be a tool round. The returned result stays authoritative either way. */
  onEvent?: (event: TurnEvent) => void;
  /** Injectable for tests; defaults to the real streaming provider call when onEvent is set. */
  streamChatFn?: typeof chatStream;
  /** 2026-11-03 latency order: optional short-TTL caches (src/rosina/turnCache.ts). The
   * MyChildren cache is keyed by a hash of the EXACT bearer and only delays the prompt's view
   * of a scope change by its TTL; every real read still runs as the caller against RLS. */
  myChildrenCache?: TtlCache<ChildAccess[]>;
  toolListCache?: TtlCache<McpTool[]>;
  /** FAMILY LENS (playbook 3/7): the router GraphQL URL to batch-read the caller's own records
   * into the prompt, so routine turns need zero tool calls. Unset = lens off, tools only. */
  graphqlUrl?: string;
  lensCache?: TtlCache<FamilyLens>;
  /** How long a cold turn waits for the lens before proceeding without it (default 700ms); the
   * build keeps running and caches for the next turn either way. */
  lensWaitMs?: number;
  /** Injectable for tests. */
  lensRequest?: typeof fetch;
  /** Operator latency knobs merged into every model request body (e.g. a reasoning-effort
   * setting). Unsupported knobs degrade gracefully: a 400 retries once without them. */
  modelParams?: Record<string, unknown>;
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

/** Live progress events for streaming transports. The final RosinaTurnResult stays authoritative:
 * a client renders token text as provisional and swaps in the returned reply at the end. */
export type TurnEvent =
  | { kind: 'status'; label: string }
  | { kind: 'token'; text: string }
  | { kind: 'replace' }
  // A server-validated action proposal, streamed the moment it validates so the client can show
  // the confirmation card a full model round before the closing reply text lands. Provisional
  // like token text: the final result's actions stay authoritative (a tripped output guard drops
  // them and the final `replace` clears what was streamed).
  | { kind: 'action'; action: { id: string; args: Record<string, unknown> } };

/** What Rosina is doing, in the caller's language, shown while a tool round runs. */
const TOOL_STATUS_LABELS: Record<string, string> = {
  MyChildren: 'Checking what is shared with you',
  ChildEvents: 'Reading the calendar',
  EffectiveSchedule: 'Checking the care schedule',
  AdultAvailability: 'Checking recorded availability',
  CareFacts: 'Reading care information',
  CheckInStatus: 'Checking the latest check-in',
  OrbitStatus: 'Checking Orbit',
  OrbitVocabulary: 'Checking Orbit',
  PickupCandidates: 'Reviewing pickup options',
  JobTimeline: 'Reading the pickup record',
  Attempts: 'Reading outreach records',
  FridgeNotes: 'Reading the fridge',
  Goals: 'Reading goals',
  CaregiverBriefing: 'Composing the day briefing',
  ProposeSchoolDayReport: 'Preparing the report for your review',
  ProposeAddVillager: 'Preparing the villager proposal for your review',
};

function statusLabelFor(names: string[]): string {
  const labels = [...new Set(names.map((n) => TOOL_STATUS_LABELS[n] ?? 'Looking that up'))];
  return labels.slice(0, 2).join(' and ');
}

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
  /** Time-to-useful-answer: ms from turn start to the FIRST validated answer chunk released to
   * the stream (null on the non-streaming path or when nothing was released). */
  firstAnswerMs: number | null;
  /** Per-stage latency (playbook 4): lens build wait, summed model time, summed tool time. */
  stages: { lensMs: number; modelMs: number; toolsMs: number };
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
  'Goals',
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
  Goals: 'childId',
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
  Goals: SCOPE.goals,
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

/** Built in exactly one place so the warm-up request and the real turn can never drift apart by
 * a byte — the model host's prompt-prefix cache only matches identical prefixes. */
function lensSystemMessage(lens: FamilyLens): ModelMessage {
  return {
    role: 'system',
    content: `FAMILY LENS, a fresh authorized snapshot of THIS caller's own records (read with their access moments ago; names in it are grounded):\n${lens.text}\nWhen the lens carries the answer, reply from it IMMEDIATELY with zero tool calls; do not call a tool to re-check or confirm what the lens already shows (it was read moments ago with the same access as your tools). Call a tool only for a record the lens does not carry at all, or when the person explicitly asks for something newer than this snapshot.`,
  };
}

export type WarmOptions = Pick<RosinaTurnOptions,
  'bearer' | 'personId' | 'isGuide' | 'provider' | 'mcpUrl' | 'chatFn' | 'myChildrenCache' |
  'toolListCache' | 'graphqlUrl' | 'lensCache' | 'lensRequest' | 'modelParams' |
  'mcpClientFactory' | 'providerConfig'>;

export type WarmResult = {
  ok: boolean;
  primed: { children: boolean; tools: boolean; lens: boolean; model: boolean };
  modelMs: number;
};

/** Everything a COLD first turn would otherwise pay, paid ahead of it (playbook 6): this
 * caller's MyChildren and lens caches, the shared tool-list cache, and one tiny real completion
 * whose prompt prefix (stable system message, lens message, tool definitions) is byte-identical
 * to a real turn's — priming the model host's TLS session and its automatic prompt-prefix cache.
 * Read-only as the caller; the completion's output is discarded unread; never throws. */
export async function warmRosinaTurn(options: WarmOptions): Promise<WarmResult> {
  const primed = { children: false, tools: false, lens: false, model: false };
  let modelMs = 0;
  try {
    const config = options.providerConfig ?? resolveProvider(options.provider);
    const chatImpl = options.chatFn ?? chat;
    const mcp: McpClientLike = options.mcpClientFactory
      ? options.mcpClientFactory(options.mcpUrl, options.bearer)
      : new McpToolClient(options.mcpUrl, options.bearer);
    await mcp.initialize();

    const cacheKey = options.myChildrenCache ? bearerKey(options.bearer) : null;
    let childList = cacheKey ? options.myChildrenCache!.get(cacheKey) : null;
    if (!childList) {
      const result = await mcp.callTool('MyChildren', {});
      childList = result.isError ? null : parseMyChildren(result.data);
      if (childList && cacheKey) options.myChildrenCache!.set(cacheKey, childList);
    }
    if (childList === null) return { ok: false, primed, modelMs };
    primed.children = true;
    const childAccessById = new Map(childList.map((c) => [c.id, c]));

    const cachedTools = options.toolListCache?.get(options.mcpUrl) ?? null;
    const mcpTools = cachedTools ?? await mcp.listTools();
    if (!cachedTools && mcpTools.length > 0) options.toolListCache?.set(options.mcpUrl, mcpTools);
    primed.tools = mcpTools.length > 0;

    let lens: FamilyLens | null = null;
    if (options.graphqlUrl && childList.length > 0) {
      const lensKey = bearerKey(options.bearer);
      lens = options.lensCache?.get(lensKey) ?? null;
      if (!lens) {
        // No 700ms race here: warm-up runs in the background, so the full build is affordable
        // and the NEXT real turn reads the cache instead of paying it.
        lens = await buildFamilyLens(options.graphqlUrl, options.bearer, childList, options.lensRequest);
        if (lens) options.lensCache?.set(lensKey, lens);
      }
    }
    primed.lens = Boolean(lens);

    const tools: ModelTool[] = [...mcpToolDefinitions(mcpTools), BRIEFING_TOOL, ...ACTION_TOOLS];
    const messages: ModelMessage[] = [
      { role: 'system', content: buildSystemPrompt([...childAccessById.values()], options.isGuide, options.personId, detroitToday()) },
      ...(lens ? [lensSystemMessage(lens)] : []),
      { role: 'user', content: 'Connection warm-up. Reply with the single word: ready' },
    ];
    const modelStart = Date.now();
    await chatImpl(config, messages, tools, { maxTokens: 16, timeoutMs: 20_000, extraBody: options.modelParams });
    modelMs = Date.now() - modelStart;
    primed.model = true;
    return { ok: true, primed, modelMs };
  } catch {
    return { ok: false, primed, modelMs };
  }
}

export async function runRosinaTurn(options: RosinaTurnOptions): Promise<RosinaTurnResult> {
  const config = options.providerConfig ?? resolveProvider(options.provider);
  const chatImpl = options.chatFn ?? chat;
  const onEvent = options.onEvent;
  // Streaming is used ONLY when the caller asked for events. A stubbed chatFn without a stubbed
  // streamChatFn keeps tests on the non-streaming path they were written against.
  const streamImpl = onEvent ? (options.streamChatFn ?? (options.chatFn ? null : chatStream)) : null;
  // Pre-stream validation (release gate): grounded text grows as tool rounds complete; the gate
  // reads it live. firstAnswerAt is the time-to-useful-answer mark: the first VALIDATED chunk
  // released to the wire, not the first byte.
  let groundedText: () => string = () => '';
  let firstAnswerAt: number | null = null;
  const runChat = async (msgs: ModelMessage[], tls: ModelTool[] | undefined, maxTokens: number): Promise<ChatResult> => {
    if (!streamImpl) return chatImpl(config, msgs, tls, { maxTokens, extraBody: options.modelParams });
    const gate = createStreamGuard(groundedText);
    let releasedTokens = false;
    const release = (text: string | null) => {
      if (!text) return;
      releasedTokens = true;
      if (firstAnswerAt === null) firstAnswerAt = Date.now();
      onEvent?.({ kind: 'token', text });
    };
    const result = await streamImpl(config, msgs, tls, {
      maxTokens,
      extraBody: options.modelParams,
      onDelta: (text) => release(gate.push(text)),
      onReasoning: () => onEvent?.({ kind: 'status', label: 'Thinking it through' }),
    });
    release(gate.flush());
    // Released text that is not the answer (a tool round that also talked, or a tripped gate):
    // tell the client to clear it. The final reply stays authoritative either way.
    if (releasedTokens && (result.toolCalls.length > 0 || gate.tripped)) onEvent?.({ kind: 'replace' });
    return result;
  };
  const mcp: McpClientLike = options.mcpClientFactory
    ? options.mcpClientFactory(options.mcpUrl, options.bearer)
    : new McpToolClient(options.mcpUrl, options.bearer);
  const started = Date.now();
  await mcp.initialize();

  // TASK R-MYCHILDREN: discovery happens HERE, once, before anything else, never a static
  // roster. 2026-11-03 latency amendment (Bryan): the result MAY be served from a short-TTL
  // cache keyed by a hash of this exact bearer (src/rosina/turnCache.ts). That only delays the
  // prompt's view of a grant change by the TTL; every real read below still runs as the caller
  // against RLS, so access enforcement is unchanged. Failures are never cached.
  const cacheKey = options.myChildrenCache ? bearerKey(options.bearer) : null;
  const cachedChildren = cacheKey ? options.myChildrenCache!.get(cacheKey) : null;
  const myChildrenResult: McpToolCall = cachedChildren
    ? { data: null, errors: [], isError: false, raw: null }
    : await mcp.callTool('MyChildren', {}).catch((error: unknown): McpToolCall => ({
      data: null,
      errors: [{ message: (error as Error).message }],
      isError: true,
      raw: null,
    }));
  const childList = cachedChildren ?? (myChildrenResult.isError ? null : parseMyChildren(myChildrenResult.data));
  if (childList !== null && !cachedChildren && cacheKey) options.myChildrenCache!.set(cacheKey, childList);
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
      firstAnswerMs: null,
      stages: { lensMs: 0, modelMs: 0, toolsMs: 0 },
      outputGuardTriggered: false,
    };
  }
  const calendar = await calendarProposal({message:options.message,history:options.history,children:childList,bearer:options.bearer,graphqlUrl:options.graphqlUrl??'',request:options.lensRequest});
  if(calendar) return {...calendar,schoolReportProposal:null,addVillagerProposal:null,provider:options.provider,model:config.model,rounds:0,toolCalls:[],usage:{prompt:0,completion:0,total:0},latencyMs:Date.now()-started,firstAnswerMs:Date.now()-started,stages:{lensMs:0,modelMs:0,toolsMs:0},outputGuardTriggered:false};
  const childAccessById = new Map(childList.map((c) => [c.id, c]));

  // Tool DEFINITIONS are identical for every caller (authorization happens per call, below),
  // so the list is cacheable by MCP URL without touching any auth boundary.
  const cachedTools = options.toolListCache?.get(options.mcpUrl) ?? null;
  const mcpTools = cachedTools ?? await mcp.listTools();
  if (!cachedTools && mcpTools.length > 0) options.toolListCache?.set(options.mcpUrl, mcpTools);
  const tools: ModelTool[] = [...mcpToolDefinitions(mcpTools), BRIEFING_TOOL, ...ACTION_TOOLS];

  // FAMILY LENS (playbook 3/7): served from the per-bearer cache when fresh; a cold build races a
  // short wait so it can never hold the first token hostage (the build keeps running in the
  // background and caches for the next turn). Grounded below like any other authorized read.
  const freshCalendar=/\b(calendar|schedule|tomorrow)\b/i.test(options.message);
  let lens: FamilyLens | null = null;
  let lensMs = 0;
  if (options.graphqlUrl && childList.length > 0) {
    const lensKey = bearerKey(options.bearer);
    lens = freshCalendar ? null : options.lensCache?.get(lensKey) ?? null;
    if (!lens) {
      const lensStart = Date.now();
      const pending = buildFamilyLens(options.graphqlUrl, options.bearer, childList, options.lensRequest);
      void pending.then((built) => { if (built) options.lensCache?.set(lensKey, built); }).catch(() => {});
      lens = freshCalendar ? await pending : await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), options.lensWaitMs ?? 700)),
      ]);
      lensMs = Date.now() - lensStart;
    }
  }

  const today = detroitToday();
  const messages: ModelMessage[] = [
    // The family's REAL current Detroit date — authorization/calendar days use the real clock, never
    // the demo scenario instant (which is only for time-of-day questions and is labelled separately).
    { role: 'system', content: buildSystemPrompt([...childAccessById.values()], options.isGuide, options.personId, today) },
    // The lens rides in its OWN system message AFTER the stable prompt, so the long instruction
    // prefix stays byte-identical across turns (provider prompt caching, playbook 7).
    ...(lens ? [lensSystemMessage(lens)] : []),
    ...options.history.map((h) => ({ role: h.role, content: h.content })),
    // Date rides at the END of the user turn (playbook 1) so the cacheable prefix never changes
    // mid-day and relative dates resolve against the real clock without a clarifying question.
    { role: 'user', content: `${options.message}\n\n[currentRoute: ${options.currentRoute}] [today: ${today}, America/Detroit]` },
  ];

  const maxRounds = options.maxRounds ?? 4;
  const toolCallEvidence: ToolCallEvidence[] = [{ round: 0, kind: 'mcp', name: 'MyChildren', argsPreview: cachedChildren ? { cached: true } : {}, isError: false, errorCodes: [] }];
  const proposedActions: unknown[] = [];
  const rounds: ChatResult[] = [];
  let toolsMs = 0;
  // Every real MCP result's raw JSON this turn — the output guard's only "this name is grounded"
  // signal now that there is no static roster at all. A displayName MyChildren itself reported
  // (TASK R-MYCHILDREN; null on the currently-deployed contract — see childAccess.ts) is pushed
  // in below, exactly like any other tool result: a name is only ever safe to say if THIS turn's
  // own authorized read actually said it.
  const toolResultTexts: string[] = [];
  for (const child of childAccessById.values()) {
    if (child.displayName) toolResultTexts.push(child.displayName);
  }
  groundedText = () => toolResultTexts.join('\n');
  if (lens) toolResultTexts.push(lens.text);
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
    const result = await runChat(messages, tools, 3000);
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

    if (mcpCalls.length > 0) onEvent?.({ kind: 'status', label: statusLabelFor(mcpCalls.map(({ call }) => call.name)) });
    const toolPhaseStart = Date.now();

    // 2026-11-03 latency amendment: when EVERY read in this round already passes its gate against
    // the current state, start the network calls concurrently and let the (unchanged) serial
    // bookkeeping below await the prestarted promises in order. The gates are monotonic within a
    // round (permittedIds only grows), so a prestart-approved call can never be refused inline.
    // Mutations are never prestarted: ProposeAddVillager's args are rewritten at execution time,
    // and a mutation round falls back to the exact serial path this loop always had.
    const prestartable = ({ call, args }: { call: { name: string }; args: Record<string, unknown> }): boolean => {
      if (call.name === 'ProposeAddVillager' || call.name === 'ProposeSchoolDayReport') return false;
      if (call.name === BRIEFING_TOOL_NAME) {
        const childId = typeof args.childId === 'string' ? args.childId : '';
        const date = typeof args.date === 'string' ? args.date : '';
        return Boolean(childAccessById.get(childId)) && /^\d{4}-\d{2}-\d{2}$/.test(date);
      }
      if (!ALLOWED_MCP_TOOL_NAMES.has(call.name)) return false;
      const idArgKey = ID_ARG_BY_TOOL[call.name];
      const isGuideChildBypass = options.isGuide && idArgKey === 'childId';
      if (idArgKey && !isGuideChildBypass) {
        const idValue = args[idArgKey];
        if (typeof idValue !== 'string' || !permittedIds.has(idValue)) return false;
        const requiredScope = REQUIRED_SCOPE_BY_TOOL[call.name];
        if (requiredScope && !(childAccessById.get(idValue)?.scopes.has(requiredScope))) return false;
      }
      return true;
    };
    const prestartedMcp = new Map<string, Promise<McpToolCall>>();
    const prestartedBriefing = new Map<string, Promise<Awaited<ReturnType<typeof runCaregiverBriefing>> | null>>();
    if (mcpCalls.length > 1 && mcpCalls.every(prestartable)) {
      for (const { call, args } of mcpCalls) {
        if (call.name === BRIEFING_TOOL_NAME) {
          const childId = String(args.childId);
          const access = childAccessById.get(childId)!;
          prestartedBriefing.set(call.id, runCaregiverBriefing({ childId, date: String(args.date), callerId: options.personId, access, mcp }).catch(() => null));
        } else {
          prestartedMcp.set(call.id, mcp.callTool(call.name, args).catch((error: unknown): McpToolCall => ({
            data: null,
            errors: [{ message: (error as Error).message }],
            isError: true,
            raw: null,
          })));
        }
      }
    }

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
        const briefing = await (prestartedBriefing.get(call.id) ?? runCaregiverBriefing({ childId, date, callerId: options.personId, access, mcp }).catch(() => null));
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

      // Add-a-Villager start date is resolved DETERMINISTICALLY here, before the proposal is staged,
      // so the stored (and reviewed) validFrom is bound to the model's args and is never left to the
      // backend's UTC `current_date` default. No/malformed/past date → Detroit today; a today-or-
      // future date the parent asked for is preserved. Real clock (not the demo scenario instant).
      if (call.name === 'ProposeAddVillager') {
        args.validFrom = resolveVillagerValidFrom(typeof args.validFrom === 'string' ? args.validFrom : null);
      }

      const callResult = await (prestartedMcp.get(call.id) ?? mcp.callTool(call.name, args).catch((error: unknown): McpToolCall => ({
        data: null,
        errors: [{ message: (error as Error).message }],
        isError: true,
        raw: null,
      })));
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
          onEvent?.({ kind: 'action', action: { id, args: shapeArgs as Record<string, unknown> } });
          toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: false, errorCodes: [] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
          continue;
        }
        toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: true, errorCodes: [decision.errorCode] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'Orbit alerts are not available through this app yet.' }) });
        continue;
      }

      // Calendar cards are issued only by the permission-checked proposal path above.
      let validated = id === 'calendar-change' ? [] : validateActions([{ id, args }]);
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
      if (validated.length) {
        proposedActions.push(validated[0]);
        onEvent?.({ kind: 'action', action: validated[0] as { id: string; args: Record<string, unknown> } });
      }
      toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: validated.length === 0, errorCodes: validated.length ? [] : [refusalReason ? 'UNVERIFIED_CHILD' : 'INVALID_ACTION'] });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(validated.length ? { ok: true } : { ok: false, error: refusalReason ?? 'invalid or unimplemented action' }) });
    }

    toolsMs += Date.now() - toolPhaseStart;

    if (round === maxRounds) {
      const closing = await runChat(messages, undefined, 3000);
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
  // Streamed tokens are provisional; when the guard rewrote the reply the client must not keep them.
  if (guarded.triggered) onEvent?.({ kind: 'replace' });

  return {
    reply: sanitizeReplyText(guarded.reply),
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
    firstAnswerMs: firstAnswerAt === null ? null : firstAnswerAt - started,
    stages: { lensMs, modelMs: rounds.reduce((sum, r) => sum + r.latencyMs, 0), toolsMs },
    outputGuardTriggered: guarded.triggered,
  };
}
