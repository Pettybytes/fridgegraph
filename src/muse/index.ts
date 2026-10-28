/**
 * Muse — the village coordinator.
 *
 * Muse has no identity of its own. It runs AS the signed-in caller: the caller's JWT is the
 * only credential, it is passed to the MCP server, forwarded to the router, verified by the
 * subgraphs and finally resolved by Postgres RLS. Muse can therefore see exactly what the
 * caller can see — no more.
 *
 * Grounding contract: the answer may only contain people, reasons and contact details that
 * appeared in a tool result. Every tool call and every check is returned so evidence can show
 * the model did not invent anything.
 */
import { McpToolClient, type McpTool, type McpToolCall } from './mcp';
import { chat, type ChatResult, type ModelMessage, type ModelTool, type ProviderId, resolveProvider } from './providers';

export type MuseOptions = {
  question: string;
  childId: string;
  asOf?: string;
  /** The caller's raw bearer token. Required: Muse is never a service identity. */
  bearer: string;
  provider: ProviderId;
  mcpUrl: string;
  maxRounds?: number;
};

export type ToolCallLog = {
  round: number;
  name: string;
  arguments: Record<string, unknown>;
  isError: boolean;
  errorCodes: string[];
  candidateCount: number | null;
  latencyMs: number;
};

export type MuseResult = {
  answer: string;
  provider: ProviderId;
  model: string;
  toolCalls: ToolCallLog[];
  rounds: ChatResult[];
  totalLatencyMs: number;
  usage: { prompt: number; completion: number; total: number };
  grounding: GroundingReport;
  refusal: boolean;
};

export type GroundingReport = {
  /** Display names that the tool actually returned. */
  namesInToolResult: string[];
  /** Of those, the ones the answer mentions. */
  namesInAnswer: string[];
  /** Phone-like strings in the answer that the tool never returned. */
  unsupportedPhoneNumbers: string[];
  /** Capitalised name pairs in the answer that are not any returned person. */
  possibleInventedNames: string[];
  grounded: boolean;
};

const SYSTEM_PROMPT = `You are Muse, the coordinator for one family village.

Rules, all mandatory:
1. You MUST call the PickupCandidates tool before answering. You have no other source of truth.
2. Use ONLY people, reasons, contact details and availability that appear in the tool result.
   Never add a person, a phone number, a vehicle or a relationship that is not in the result.
3. If the tool returns no candidates or an error, say so plainly. Do not invent alternatives.
4. Rank the candidates and give a short reason for each rank, quoting the tool's own reason text.
5. Recommend one person to ask first and name the channel to reach them on.
6. Be brief. At most 8 short lines. No preamble.`;

function toolDefinitions(tools: McpTool[]): ModelTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

type CandidateShape = {
  person?: { displayName?: string; contactMethods?: Array<{ value?: string; channel?: string }> };
  reason?: string;
  availability?: string;
};

function candidatesFrom(data: unknown): CandidateShape[] {
  const list = (data as { pickupCandidates?: CandidateShape[] } | null)?.pickupCandidates;
  return Array.isArray(list) ? list : [];
}

function phoneLike(text: string): string[] {
  // Scanned per line: a character class containing \s will otherwise swallow the newline and
  // fuse a phone number with the next line's rank marker ("…0103" + "2." -> "…01032").
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const matches = line.match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
    for (const raw of matches) {
      const candidate = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) continue; // an ISO date is not a phone number
      const digits = candidate.replace(/[^\d+]/g, '');
      const count = digits.replace(/\D/g, '').length;
      if (count >= 10 && count <= 15) found.add(digits);
    }
  }
  return [...found];
}

export function assessGrounding(answer: string, toolData: unknown[]): GroundingReport {
  const candidates = toolData.flatMap((d) => candidatesFrom(d));
  const names = candidates.map((c) => c.person?.displayName).filter((n): n is string => Boolean(n));

  const contactValues = candidates.flatMap((c) => (c.person?.contactMethods ?? []).map((m) => m.value ?? ''));
  const allowedPhones = new Set(contactValues.flatMap((v) => phoneLike(v)));
  const answerPhones = phoneLike(answer);
  const unsupportedPhoneNumbers = answerPhones.filter((p) => !allowedPhones.has(p));

  const namesInAnswer = names.filter((n) => answer.toLowerCase().includes(n.toLowerCase()));

  // Any "First Last" pair in the answer that is not a returned person is a possible fabrication.
  const pairs = answer.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) ?? [];
  const known = new Set(names.map((n) => n.toLowerCase()));
  const stopWords = new Set(['pickup candidates', 'tool result', 'the tool', 'muse']);
  const possibleInventedNames = [
    ...new Set(pairs.filter((p) => !known.has(p.toLowerCase()) && !stopWords.has(p.toLowerCase()))),
  ];

  return {
    namesInToolResult: names,
    namesInAnswer,
    unsupportedPhoneNumbers,
    possibleInventedNames,
    grounded: unsupportedPhoneNumbers.length === 0 && namesInAnswer.length > 0,
  };
}

export async function runMuse(options: MuseOptions): Promise<MuseResult> {
  const config = resolveProvider(options.provider);
  const mcp = new McpToolClient(options.mcpUrl, options.bearer);

  await mcp.initialize();
  const tools = await mcp.listTools();
  const defs = toolDefinitions(tools);

  const started = Date.now();
  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${options.question}\n\nchildId=${options.childId}${options.asOf ? ` asOf=${options.asOf}` : ''}`,
    },
  ];

  const rounds: ChatResult[] = [];
  const toolCalls: ToolCallLog[] = [];
  const toolData: unknown[] = [];
  const maxRounds = options.maxRounds ?? 3;

  let finalAnswer = '';
  let refusal = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await chat(config, messages, defs);
    rounds.push(result);

    if (result.toolCalls.length === 0) {
      finalAnswer = result.content.trim();
      if (finalAnswer === '') refusal = true;
      break;
    }

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const call of result.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.args) as Record<string, unknown>;
      } catch {
        args = { _unparsed: call.args };
      }

      // The model may try to widen the call; the graph decides what it may see.
      const callStarted = Date.now();
      let callResult: McpToolCall;
      try {
        callResult = await mcp.callTool(call.name, args);
      } catch (error) {
        callResult = { data: null, errors: [{ message: (error as Error).message }], isError: true, raw: null };
      }
      const latencyMs = Date.now() - callStarted;

      toolData.push(callResult.data);
      const codes = callResult.errors.map((e) => e.extensions?.code ?? e.message ?? 'ERROR');
      const candidates = candidatesFrom(callResult.data);

      toolCalls.push({
        round,
        name: call.name,
        arguments: args,
        isError: callResult.isError,
        errorCodes: codes.filter((c): c is string => Boolean(c)),
        candidateCount: callResult.data ? candidates.length : null,
        latencyMs,
      });

      // The tool result is the model's only source of truth for the answer.
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(callResult.isError ? { error: codes, data: callResult.data } : callResult.data),
      });
    }

    if (round === maxRounds) {
      // Last round: force a grounded answer with no further tools.
      const closing = await chat(config, messages, undefined);
      rounds.push(closing);
      finalAnswer = closing.content.trim();
      if (finalAnswer === '') refusal = true;
    }
  }

  const grounding = assessGrounding(finalAnswer, toolData);
  const usage = rounds.reduce(
    (acc, r) => ({
      prompt: acc.prompt + (r.usage.prompt ?? 0),
      completion: acc.completion + (r.usage.completion ?? 0),
      total: acc.total + (r.usage.total ?? 0),
    }),
    { prompt: 0, completion: 0, total: 0 },
  );

  return {
    answer: finalAnswer,
    provider: options.provider,
    model: config.model,
    toolCalls,
    rounds,
    totalLatencyMs: Date.now() - started,
    usage,
    grounding,
    refusal,
  };
}
