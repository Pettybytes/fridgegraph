/**
 * MCP client for Muse.
 *
 * Speaks Streamable HTTP JSON-RPC directly, the same protocol ops/mcp-probe.mjs proves:
 * initialize -> notifications/initialized -> tools/list -> tools/call.
 *
 * Identity is the CALLER'S OWN bearer token, sent as the Authorization header. The Apollo MCP
 * Server forwards it (`forward_headers: [authorization]`) and every subgraph verifies it, so a
 * tool call is executed as the signed-in caller — never as a service, never as an invented
 * user. Muse holds no other credential and has no privileged path.
 */

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpToolError = {
  message: string;
  extensions?: { code?: string };
};

export type McpToolCall = {
  /** GraphQL `data` from the tool payload, or null when the call produced none. */
  data: unknown | null;
  errors: McpToolError[];
  isError: boolean;
  /** The raw JSON-RPC reply, for evidence. Never contains the token. */
  raw: unknown;
};

type RpcReply = { status: number; body: Record<string, unknown> };

export class McpToolClient {
  private sessionId: string | undefined;
  private id = 0;

  constructor(
    private readonly url: string,
    private readonly bearer: string,
  ) {
    if (!bearer) {
      throw new Error('MUSE_NO_CALLER_TOKEN: Muse must act as a signed-in caller, not anonymously');
    }
  }

  private async rpc(method: string, params: unknown, notify = false): Promise<RpcReply> {
    const payload = notify
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: ++this.id, method, params };

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${this.bearer}`,
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const returned = res.headers.get('mcp-session-id');
    if (returned) this.sessionId = returned;

    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    let body: Record<string, unknown>;
    if (contentType.includes('text/event-stream')) {
      const lines = text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      body = lines.length ? (JSON.parse(lines[lines.length - 1]) as Record<string, unknown>) : { raw: text };
    } else {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    }
    return { status: res.status, body };
  }

  /** Handshake. Introspection, search and execute are disabled on this server by config. */
  async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fridgegraph-muse', version: '0.1.0' },
    });
    await this.rpc('notifications/initialized', {}, true);
  }

  async listTools(): Promise<McpTool[]> {
    const reply = await this.rpc('tools/list', {});
    const result = (reply.body.result ?? {}) as { tools?: McpTool[] };
    return result.tools ?? [];
  }

  /**
   * One tool call, as the caller. A GraphQL error is returned, not thrown: UNAUTHORIZED here is
   * a real answer about who is asking, and the model must see it rather than be handed an empty
   * list that looks like "nobody is cleared".
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCall> {
    const reply = await this.rpc('tools/call', { name, arguments: args });

    if (reply.body.error) {
      const error = reply.body.error as { message?: string; code?: number };
      return {
        data: null,
        errors: [{ message: error.message ?? `MCP_ERROR_${error.code ?? 'UNKNOWN'}` }],
        isError: true,
        raw: reply.body,
      };
    }

    const result = (reply.body.result ?? {}) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };

    const text = (result.content ?? []).map((block) => block.text ?? '').join('\n');
    let parsed: { data?: unknown; errors?: unknown[] } | null = null;
    try {
      parsed = JSON.parse(text) as { data?: unknown; errors?: unknown[] };
    } catch {
      parsed = null;
    }

    const errors = ((parsed?.errors ?? []) as Array<Record<string, unknown>>).map((error) => ({
      message: String(error.message ?? 'ERROR'),
      extensions: (error.extensions as { code?: string } | undefined) ?? undefined,
    }));

    return {
      data: parsed?.data ?? null,
      errors,
      isError: Boolean(result.isError) || errors.length > 0,
      raw: reply.body,
    };
  }
}
