/**
 * Slice 1 (Bryan 2026-11-03 latency order) tests: SSE parsing in chatStream, live TurnEvents
 * from runRosinaTurn, the short-TTL MyChildren/tool-list caches, and concurrent prestart of
 * gate-approved reads. No real model or MCP server — everything injectable is stubbed, and the
 * one real HTTP server below is an in-process fixture for the SSE wire format.
 *
 *   npm run test:rosina
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chatStream, type ChatResult, type ChatStreamOptions, type ModelMessage, type ModelTool, type ProviderConfig } from '../muse/providers';
import type { McpTool, McpToolCall } from '../muse/mcp';
import { runRosinaTurn, type McpClientLike, type TurnEvent } from './model';
import { createTtlCache, bearerKey } from './turnCache';
import type { ChildAccess } from './childAccess';

const FAKE_CONFIG: ProviderConfig = { id: 'meta', label: 'fake', baseUrl: 'http://unused', model: 'fake-model', apiKey: 'unused' };

function chatResult(partial: Partial<ChatResult>): ChatResult {
  return { content: '', toolCalls: [], usage: {}, latencyMs: 1, messageKeys: [], usageKeys: [], rawSummary: { status: 200 }, ...partial };
}

test('chatStream: parses SSE deltas, forwards answer tokens only, accumulates split tool calls', async () => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'Child', arguments: '{"chi' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'Events', arguments: 'ldId":"p_nora"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  ];
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const deltas: string[] = [];
    let reasoningStarts = 0;
    const result = await chatStream(
      { ...FAKE_CONFIG, baseUrl: `http://127.0.0.1:${port}` },
      [{ role: 'user', content: 'hi' }],
      undefined,
      { onDelta: (t) => deltas.push(t), onReasoning: () => { reasoningStarts += 1; } },
    );
    assert.deepEqual(deltas, ['Hel', 'lo'], 'reasoning deltas must never reach onDelta');
    assert.equal(reasoningStarts, 1);
    assert.equal(result.content, 'Hello');
    assert.equal(result.reasoning, 'thinking...');
    assert.deepEqual(result.toolCalls, [{ id: 'c1', name: 'ChildEvents', args: '{"childId":"p_nora"}' }]);
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.usage.prompt, 10);
  } finally {
    server.close();
  }
});

// ---- runRosinaTurn stubs ------------------------------------------------------------------

const MY_CHILDREN_OK: McpToolCall = { data: { myChildren: [{ child: { id: 'p_nora' }, scopes: ['pickup.request', 'schedule.read'] }] }, errors: [], isError: false, raw: null };
const TOOLS: McpTool[] = [
  { name: 'ChildEvents', description: 'read', inputSchema: {} },
  { name: 'EffectiveSchedule', description: 'read', inputSchema: {} },
];

type CountingMcp = McpClientLike & { calls: string[]; listToolsCalls: number };
function stubMcp(onRead?: (name: string) => Promise<void>): CountingMcp {
  const stub: CountingMcp = {
    calls: [],
    listToolsCalls: 0,
    async initialize() {},
    async listTools() { stub.listToolsCalls += 1; return TOOLS; },
    async callTool(name: string) {
      stub.calls.push(name);
      if (name === 'MyChildren') return MY_CHILDREN_OK;
      if (onRead) await onRead(name);
      return { data: { [name]: [] }, errors: [], isError: false, raw: null };
    },
  };
  return stub;
}

/** streamChatFn stub: per scripted round, emits the given deltas then resolves the result. */
function scriptedStream(script: Array<{ deltas?: string[]; result: ChatResult }>) {
  let i = 0;
  return async (_c: ProviderConfig, _m: ModelMessage[], _t: ModelTool[] | undefined, options: ChatStreamOptions = {}): Promise<ChatResult> => {
    if (i >= script.length) throw new Error('scriptedStream: script exhausted');
    const round = script[i++];
    for (const d of round.deltas ?? []) options.onDelta?.(d);
    return round.result;
  };
}

const baseOptions = { message: 'how is my night looking', currentRoute: '#/today', history: [], bearer: 'test-token-a', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

test('runRosinaTurn: streams tokens, emits a tool status, and replaces provisional text from a tool round', async () => {
  const mcp = stubMcp();
  const events: TurnEvent[] = [];
  const streamChatFn = scriptedStream([
    // Round 1: the model talks a little AND calls a tool — the provisional text must be replaced.
    { deltas: ['Let me check'], result: chatResult({ content: 'Let me check', toolCalls: [{ id: 'c1', name: 'ChildEvents', args: '{"childId":"p_nora"}' }] }) },
    // Round 2: the final streamed answer.
    { deltas: ['Your ', 'night ', 'is clear.'], result: chatResult({ content: 'Your night is clear.' }) },
  ]);
  const result = await runRosinaTurn({ ...baseOptions, streamChatFn, mcpClientFactory: () => mcp, onEvent: (e) => events.push(e) });
  assert.equal(result.reply, 'Your night is clear.');
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes('replace'), 'tool-round text must be replaced');
  assert.deepEqual(events.filter((e) => e.kind === 'token').map((e) => (e as { text: string }).text).join(''), 'Let me checkYour night is clear.');
  const status = events.find((e) => e.kind === 'status' && (e as { label: string }).label.includes('calendar'));
  assert.ok(status, 'a tool round must emit a caller-language status');
});

test('runRosinaTurn: MyChildren and tool-list caches skip the repeat round trips, keyed by exact bearer', async () => {
  const myChildrenCache = createTtlCache<ChildAccess[]>(60_000);
  const toolListCache = createTtlCache<McpTool[]>(60_000);
  const first = stubMcp();
  await runRosinaTurn({ ...baseOptions, chatFn: async () => chatResult({ content: 'hi' }), mcpClientFactory: () => first, myChildrenCache, toolListCache });
  assert.deepEqual(first.calls, ['MyChildren']);
  assert.equal(first.listToolsCalls, 1);

  const second = stubMcp();
  const result = await runRosinaTurn({ ...baseOptions, chatFn: async () => chatResult({ content: 'hi again' }), mcpClientFactory: () => second, myChildrenCache, toolListCache });
  assert.deepEqual(second.calls, [], 'cached context: no MyChildren round trip');
  assert.equal(second.listToolsCalls, 0, 'cached tool list: no listTools round trip');
  assert.deepEqual(result.toolCalls[0].argsPreview, { cached: true });

  const otherBearer = stubMcp();
  await runRosinaTurn({ ...baseOptions, bearer: 'test-token-b', chatFn: async () => chatResult({ content: 'hi' }), mcpClientFactory: () => otherBearer, myChildrenCache, toolListCache });
  assert.deepEqual(otherBearer.calls, ['MyChildren'], 'a different bearer never shares a cached roster');
  assert.notEqual(bearerKey('test-token-a'), bearerKey('test-token-b'));
});

test('runRosinaTurn: two gate-approved reads in one round run concurrently', async () => {
  // Each read resolves only after BOTH reads have started. Serial execution would deadlock;
  // the 2 s fallback turns that into a loud failure instead of a hung test run.
  let started = 0;
  let release: () => void = () => {};
  const bothStarted = new Promise<void>((resolve) => { release = resolve; });
  const mcp = stubMcp(async () => {
    started += 1;
    if (started >= 2) release();
    await Promise.race([bothStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('reads ran serially')), 2000))]);
  });
  const chatFn = (() => {
    let i = 0;
    return async () => {
      i += 1;
      if (i === 1) return chatResult({ toolCalls: [
        { id: 'c1', name: 'ChildEvents', args: '{"childId":"p_nora"}' },
        { id: 'c2', name: 'EffectiveSchedule', args: '{"childId":"p_nora"}' },
      ] });
      return chatResult({ content: 'done' });
    };
  })();
  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });
  assert.equal(result.reply, 'done');
  assert.deepEqual(mcp.calls, ['MyChildren', 'ChildEvents', 'EffectiveSchedule']);
});
