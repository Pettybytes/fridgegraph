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
import { decideOrbitAction } from './orbit';

/** The app handler (orbitDraft + orbitPreview + confirm UI) ships with this server code. Until it is
 *  present, the catalog flag cannot enable the action — that pairing is what the tests pin. */
export const ORBIT_HANDLER_PRESENT = true;
import { localizeTimestamps } from './localTime';
import { applyOutputGuard } from './outputGuard';
import { checkInStatusFrom, injectOverdueFlag, isCheckInOverdue, validatePrepareOrbitAlert, vocabularyMapFrom, type OrbitAlertArgs } from './orbit';
import { careOnlyChildren, scopedRoster } from './roster';
import { ACTION_TOOLS, ACTION_TOOL_PREFIX, buildSystemPrompt } from './systemPrompt';

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

/** The subset of McpToolClient this module actually calls — small enough to stub in a test
 * without a real network connection. */
export type McpClientLike = Pick<McpToolClient, 'initialize' | 'listTools' | 'callTool'>;

export type RosinaTurnOptions = {
  message: string;
  currentRoute: string;
  history: HistoryMessage[];
  bearer: string;
  /** The caller's own verified identity (src/auth/verify.ts) — used ONLY to look up this
   * caller's own scoped roster (src/rosina/roster.ts). Never used to act as anyone else. */
  personId: string;
  /** From the verified token's app_metadata.demo_guide claim — never guessed from personId. */
  isGuide: boolean;
  provider: ProviderId;
  mcpUrl: string;
  maxRounds?: number;
  /** Injectable for tests — never set in production. Defaults to the real provider call. */
  chatFn?: typeof chat;
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

export type RosinaTurnResult = {
  reply: string;
  actions: CatalogAction[];
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

/** Defense in depth, independent of .apollo/mcp*.yaml: even if MCP ever exposed a mutation, this
 * service refuses to call anything by a name it does not already know is a read. Grown one tool
 * at a time, each addition reviewed on its own (see docs/handoff/HANDOFF.md "Rosina tools
 * available" — a new read ships in the same PR as its own persona-boundary tests). `Attempts`
 * and `JobTimeline` added in TASK R-TOOLS-1 (evidence 40). `ChildEvents`, `EffectiveSchedule`
 * and `AdultAvailability` added in TASK R-TOOLS-2 (evidence 41). `CheckInStatus`, `OrbitStatus`
 * and `OrbitVocabulary` added in TASK R-ORBIT (evidence 42/43/44) — still no activate/draft/
 * preview tool exists or ever will; Orbit's mutations are never exposed here. `CareFacts` added
 * in TASK R-CARE (evidence 35 §14): read-only, no oracle (an unauthorized, nonexistent, and
 * genuinely-empty child all return the identical `[]`). */
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
]);

/**
 * TASK R-TOOLS-2: "ID authorization is a code rule." For these three tools, the id argument
 * (child or person) is checked against `permittedIds` BEFORE the tool is ever called — never
 * trust a browser route, message history, or a model-supplied argument. A permitted id is either
 * the caller's own child/self (seeded from R-LEAK's roster), or an id an authorized tool result
 * already handed back THIS turn (e.g. EffectiveSchedule's parent, or a candidate from
 * Attempts/JobTimeline/PickupCandidates) — never an id invented from outside the conversation.
 */
const ID_ARG_BY_TOOL: Record<string, string> = {
  ChildEvents: 'childId',
  EffectiveSchedule: 'childId',
  AdultAvailability: 'personId',
  CheckInStatus: 'childId',
  OrbitStatus: 'childId',
  CareFacts: 'childId',
  // OrbitVocabulary takes no id argument — it is a public, versioned, closed-vocabulary read.
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
  await mcp.initialize();
  const mcpTools = await mcp.listTools();
  const tools: ModelTool[] = [...mcpToolDefinitions(mcpTools), ...ACTION_TOOLS];

  const roster = scopedRoster(options.personId, options.isGuide);
  // TASK R-CARE: a narrow, CareFacts-only supplement to the roster above — see
  // src/rosina/roster.ts#careOnlyChildren. Never used by any other tool.
  const careRoster = careOnlyChildren(options.personId, options.isGuide);

  const started = Date.now();
  const messages: ModelMessage[] = [
    { role: 'system', content: buildSystemPrompt(roster, options.isGuide, options.personId, careRoster) },
    ...options.history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `${options.message}\n\n[currentRoute: ${options.currentRoute}]` },
  ];

  const maxRounds = options.maxRounds ?? 4;
  const toolCallEvidence: ToolCallEvidence[] = [];
  const proposedActions: unknown[] = [];
  const rounds: ChatResult[] = [];
  // Every real MCP result's raw JSON this turn — the output guard's only "this name is grounded"
  // signal besides the caller's own roster. Never sent to the model a second time; it already has
  // these in `messages` as tool-role content.
  const toolResultTexts: string[] = [];
  // Catalog presence never implies permission. The ONLY proof this service has that the caller
  // has real standing over a given child is a PickupCandidates call for that exact childId that
  // came back without error, in THIS turn. start-pickup — the one consequential, data-changing
  // action — requires that proof; every other proposeAction_* is navigation/explanation only and
  // carries no such requirement.
  const verifiedChildIds = new Set<string>();
  // ID authorization is a code rule, not a prompt suggestion: seeded with the caller's own
  // scoped child(ren) and their own personId (always safe to ask about yourself), then grown as
  // authorized tool results hand back ids this turn. Gates ChildEvents/EffectiveSchedule/
  // AdultAvailability's child/person-id arguments — see ID_ARG_BY_TOOL.
  const permittedIds = new Set<string>([...roster.map((c) => c.id), ...careRoster.map((c) => c.id), options.personId]);
  // Orbit-specific gates (src/rosina/orbit.ts): CheckInStatus throws UNAUTHORIZED for anyone who
  // is not the child's parent, so a SUCCESSFUL call is proof of parent authority — never an
  // assumption. vocabularyByKind accumulates every value THIS turn's own OrbitVocabulary call(s)
  // actually returned; a descriptor value not in it is refused regardless of how plausible it
  // looks, so the model can never silently substitute a near match.
  const verifiedParentOf = new Set<string>();
  const vocabularyByKind = new Map<string, Set<string>>();

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
      if (!ALLOWED_MCP_TOOL_NAMES.has(call.name)) {
        toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'TOOL_NOT_ALLOWED' }) });
        continue;
      }

      const idArgKey = ID_ARG_BY_TOOL[call.name];
      if (idArgKey) {
        const idValue = args[idArgKey];
        if (typeof idValue !== 'string' || !permittedIds.has(idValue)) {
          // Never executed: this is the pre-call gate, not a backend denial. No hint is given
          // either way about whether the id exists — the model gets the same refusal regardless.
          toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['OUT_OF_SCOPE_ID'] });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'OUT_OF_SCOPE_ID' }) });
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
      // "Overdue" is real-time arithmetic, not something to trust the model to compute from a
      // dueAt string — the server decides it here, against the real clock, before the result
      // ever reaches a message. Never derived from recorded=false alone (src/rosina/orbit.ts).
      let overdueFlag: boolean | null = null;
      if (call.name === 'CheckInStatus' && !callResult.isError) {
        const status = checkInStatusFrom(callResult.data);
        if (status) overdueFlag = isCheckInOverdue(status);
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
        // Gate first, then the catalog flag, then the app handler — see decideOrbitAction().
        // Metadata alone never enables the action: with the handler absent the flag is ignored.
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

  const guarded = applyOutputGuard(finalContent || "I couldn't check that just now.", [...roster, ...careRoster], toolResultTexts.join('\n'));

  return {
    reply: guarded.reply,
    // Fail closed: if the output guard caught a boundary violation in the reply text, don't trust
    // this turn's actions either — drop them rather than offer a card alongside a corrected reply.
    actions: guarded.triggered ? [] : validateActions(proposedActions),
    provider: options.provider,
    model: config.model,
    rounds: rounds.length,
    toolCalls: toolCallEvidence.map((t) => ({ ...t, argsPreview: typeof t.argsPreview === 'object' ? JSON.parse(truncate(JSON.stringify(t.argsPreview))) : t.argsPreview })),
    usage,
    latencyMs: Date.now() - started,
    outputGuardTriggered: guarded.triggered,
  };
}
