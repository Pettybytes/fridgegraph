/**
 * Provider-switchable model clients for Muse — one interface, two hosts.
 *
 *   meta     Meta Model API, direct. Closed weights (Muse Spark / Muse Wonder).
 *   baseten  Baseten, Meta's approved open-weights host. OpenAI-compatible.
 *
 * Both are reached with the caller-supplied base URL; nothing is proxied or routed through a
 * third party. Variable NAMES only live here — values come from the runtime environment and
 * are never printed, logged, or embedded in an error message.
 */

export type ProviderId = 'meta' | 'baseten';

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

/** Raised before any network call when the environment does not describe a usable provider. */
export class MuseConfigError extends Error {
  readonly provider: ProviderId;
  readonly missing: string[];
  constructor(provider: ProviderId, missing: string[]) {
    super(`MUSE_CONFIG_MISSING: provider "${provider}" requires ${missing.join(', ')}`);
    this.name = 'MuseConfigError';
    this.provider = provider;
    this.missing = missing;
  }
}

function required(names: string[]): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') values[name] = value.trim();
    else missing.push(name);
  }
  return { values, missing };
}

export function resolveProvider(id: ProviderId): ProviderConfig {
  if (id === 'meta') {
    const { values, missing } = required(['META_API_KEY', 'META_BASE_URL', 'META_MODEL_ID']);
    if (missing.length > 0) throw new MuseConfigError('meta', missing);
    return {
      id: 'meta',
      label: 'Meta Model API',
      baseUrl: values.META_BASE_URL,
      model: values.META_MODEL_ID,
      apiKey: values.META_API_KEY,
    };
  }

  const { values, missing } = required(['BASETEN_API_KEY', 'BASETEN_BASE_URL', 'BASETEN_MODEL_ID']);
  if (missing.length > 0) throw new MuseConfigError('baseten', missing);
  return {
    id: 'baseten',
    label: 'Baseten (Muse Spark Open)',
    // Baseten is OpenAI-compatible; the base URL already includes /v1.
    baseUrl: values.BASETEN_BASE_URL.replace(/\/$/, ''),
    model: values.BASETEN_MODEL_ID,
    apiKey: values.BASETEN_API_KEY,
  };
}

export type ModelTool = {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
};

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export type ToolCallRequest = { id: string; name: string; args: string };

export type ChatResult = {
  content: string;
  /** Always-on reasoning text, when the model emits it separately from the answer. */
  reasoning?: string;
  reasoningField?: string;
  toolCalls: ToolCallRequest[];
  usage: { prompt?: number; completion?: number; total?: number; reasoning?: number };
  latencyMs: number;
  finishReason?: string;
  /** Keys present on message — how this host shapes reasoning output. */
  messageKeys: string[];
  /** Keys present on usage. */
  usageKeys: string[];
  rawSummary: { status: number };
};

type RawMessage = {
  role?: string;
  content?: string | null;
  reasoning?: string;
  reasoning_content?: string;
  thinking?: string;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
};

const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'thinking'] as const;

export type ChatStreamOptions = {
  maxTokens?: number;
  timeoutMs?: number;
  /** Fires for ANSWER text deltas only. Reasoning deltas never reach it. */
  onDelta?: (text: string) => void;
  /** Fires once, on the first reasoning delta, so a caller can show a thinking state. */
  onReasoning?: () => void;
};

type StreamDelta = {
  content?: string | null;
  reasoning?: string;
  reasoning_content?: string;
  thinking?: string;
  tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
};

/**
 * Streaming variant of chat(): same request with stream:true, OpenAI-style SSE chunks.
 * Returns the SAME ChatResult shape as chat() once the stream ends, so callers can switch
 * between the two without touching the turn logic. Reasoning deltas are accumulated but never
 * forwarded through onDelta: the user-visible stream carries answer tokens only.
 */
export async function chatStream(
  config: ProviderConfig,
  messages: ModelMessage[],
  tools?: ModelTool[],
  options: ChatStreamOptions = {},
): Promise<ChatResult> {
  const url = `${config.baseUrl}/chat/completions`;
  const started = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0,
        max_tokens: options.maxTokens ?? 2000,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      // Error bodies are JSON, not SSE. Never echo them (they can quote auth material).
      const text = await res.text().catch(() => '');
      let detail = 'no error detail';
      try {
        const body = JSON.parse(text) as { error?: { message?: string; type?: string } };
        detail = body.error?.message ?? body.error?.type ?? detail;
      } catch { /* non-JSON error body stays unechoed */ }
      throw new Error(`MODEL_HTTP_${res.status}: ${String(detail).slice(0, 300)}`);
    }

    let content = '';
    let reasoning = '';
    let reasoningField: string | undefined;
    let reasoningSeen = false;
    let finishReason: string | undefined;
    const usage: Record<string, number | undefined> = {};
    const toolAccumulator = new Map<number, { id: string; name: string; args: string }>();
    const messageKeys = new Set<string>();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line; each data line carries one JSON chunk.
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) break;
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue; // a torn chunk never aborts the stream; the next data line resyncs
        }
        const chunkUsage = chunk.usage as Record<string, number | undefined> | undefined;
        if (chunkUsage) Object.assign(usage, chunkUsage);
        const choice = (chunk.choices as Array<{ delta?: StreamDelta; finish_reason?: string }> | undefined)?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta ?? {};
        for (const key of Object.keys(delta)) messageKeys.add(key);
        for (const field of REASONING_FIELDS) {
          const value = (delta as Record<string, unknown>)[field];
          if (typeof value === 'string' && value) {
            reasoning += value;
            reasoningField = reasoningField ?? field;
            if (!reasoningSeen) { reasoningSeen = true; options.onReasoning?.(); }
          }
        }
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          options.onDelta?.(delta.content);
        }
        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? 0;
          const existing = toolAccumulator.get(index) ?? { id: '', name: '', args: '' };
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name += call.function.name;
          if (call.function?.arguments) existing.args += call.function.arguments;
          toolAccumulator.set(index, existing);
        }
      }
    }

    const toolCalls: ToolCallRequest[] = [...toolAccumulator.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ id: call.id || `call_${index}`, name: call.name, args: call.args || '{}' }));

    return {
      content,
      reasoning: reasoning || undefined,
      reasoningField,
      toolCalls,
      usage: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
        reasoning: usage.reasoning_tokens,
      },
      latencyMs: Date.now() - started,
      finishReason,
      messageKeys: [...messageKeys],
      usageKeys: Object.keys(usage),
      rawSummary: { status: 200 },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function chat(
  config: ProviderConfig,
  messages: ModelMessage[],
  tools?: ModelTool[],
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<ChatResult> {
  const url = `${config.baseUrl}/chat/completions`;
  const started = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0,
        // Always-on reasoning consumes completion budget before the answer starts, so a small
        // cap truncates the answer mid-thought (finish_reason: "length"). 2000 leaves room for
        // the reasoning block plus a short grounded answer.
        max_tokens: options.maxTokens ?? 2000,
      }),
      signal: controller.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - started;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Never echo the body: a misconfigured endpoint could return an auth error containing a key.
    throw new Error(`MODEL_HTTP_${res.status}: response was not JSON`);
  }

  if (!res.ok) {
    const err = body.error as { message?: string; type?: string } | undefined;
    const detail = err?.message ?? err?.type ?? 'no error detail';
    throw new Error(`MODEL_HTTP_${res.status}: ${String(detail).slice(0, 300)}`);
  }

  const choices = body.choices as Array<{ message?: RawMessage; finish_reason?: string }> | undefined;
  const choice = choices?.[0];
  const message = choice?.message ?? {};
  const usage = (body.usage ?? {}) as Record<string, number | undefined>;

  const reasoningField = REASONING_FIELDS.find((f) => typeof message[f] === 'string' && message[f]);
  const reasoning = reasoningField ? message[reasoningField] : undefined;

  const toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function?.name ?? '',
    args: call.function?.arguments ?? '{}',
  }));

  return {
    content: typeof message.content === 'string' ? message.content : '',
    reasoning,
    reasoningField,
    toolCalls,
    usage: {
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
      total: usage.total_tokens,
      reasoning: usage.reasoning_tokens,
    },
    latencyMs,
    finishReason: choice?.finish_reason,
    messageKeys: Object.keys(message),
    usageKeys: Object.keys(usage),
    rawSummary: { status: res.status },
  };
}
