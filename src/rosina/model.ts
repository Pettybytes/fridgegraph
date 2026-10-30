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
import { chat, type ChatResult, type ModelMessage, type ModelTool, type ProviderId, resolveProvider } from '../muse/providers';
import { validateActions, type CatalogAction } from './catalog';
import { ACTION_TOOLS, ACTION_TOOL_PREFIX, buildSystemPrompt } from './systemPrompt';

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export type RosinaTurnOptions = {
  message: string;
  currentRoute: string;
  history: HistoryMessage[];
  bearer: string;
  provider: ProviderId;
  mcpUrl: string;
  maxRounds?: number;
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
};

/** Defense in depth, independent of .apollo/mcp*.yaml: even if MCP ever exposed a mutation, this
 * service refuses to call anything by a name it does not already know is a read. */
const ALLOWED_MCP_TOOL_NAMES = new Set(['PickupCandidates']);

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

export async function runRosinaTurn(options: RosinaTurnOptions): Promise<RosinaTurnResult> {
  const config = resolveProvider(options.provider);
  const mcp = new McpToolClient(options.mcpUrl, options.bearer);
  await mcp.initialize();
  const mcpTools = await mcp.listTools();
  const tools: ModelTool[] = [...mcpToolDefinitions(mcpTools), ...ACTION_TOOLS];

  const started = Date.now();
  const messages: ModelMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...options.history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `${options.message}\n\n[currentRoute: ${options.currentRoute}]` },
  ];

  const maxRounds = options.maxRounds ?? 4;
  const toolCallEvidence: ToolCallEvidence[] = [];
  const proposedActions: unknown[] = [];
  const rounds: ChatResult[] = [];

  let finalContent = '';

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await chat(config, messages, tools, { maxTokens: 3000 });
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

    for (const call of result.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.args) as Record<string, unknown>;
      } catch {
        args = {};
      }

      if (call.name.startsWith(ACTION_TOOL_PREFIX)) {
        const id = call.name.slice(ACTION_TOOL_PREFIX.length);
        const validated = validateActions([{ id, args }]);
        if (validated.length) proposedActions.push(validated[0]);
        toolCallEvidence.push({ round, kind: 'action', name: id, argsPreview: args, isError: validated.length === 0, errorCodes: validated.length ? [] : ['INVALID_ACTION'] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(validated.length ? { ok: true } : { ok: false, error: 'invalid or unimplemented action' }) });
        continue;
      }

      if (!ALLOWED_MCP_TOOL_NAMES.has(call.name)) {
        toolCallEvidence.push({ round, kind: 'refused', name: call.name, argsPreview: args, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'TOOL_NOT_ALLOWED' }) });
        continue;
      }

      const callResult = await mcp.callTool(call.name, args).catch((error: unknown): McpToolCall => ({
        data: null,
        errors: [{ message: (error as Error).message }],
        isError: true,
        raw: null,
      }));
      const errorCodes = callResult.errors.map((e) => e.extensions?.code ?? e.message ?? 'ERROR').filter((c): c is string => Boolean(c));
      toolCallEvidence.push({ round, kind: 'mcp', name: call.name, argsPreview: args, isError: callResult.isError, errorCodes });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(callResult.isError ? { error: errorCodes, data: callResult.data } : callResult.data),
      });
    }

    if (round === maxRounds) {
      const closing = await chat(config, messages, undefined, { maxTokens: 3000 });
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

  return {
    reply: finalContent || "I couldn't check that just now.",
    actions: validateActions(proposedActions),
    provider: options.provider,
    model: config.model,
    rounds: rounds.length,
    toolCalls: toolCallEvidence.map((t) => ({ ...t, argsPreview: typeof t.argsPreview === 'object' ? JSON.parse(truncate(JSON.stringify(t.argsPreview))) : t.argsPreview })),
    usage,
    latencyMs: Date.now() - started,
  };
}
