/**
 * Unit tests for TASK R-TOOLS-1 (Attempts + JobTimeline added to the Rosina allowlist).
 * No network call — model and MCP client are both stubbed. Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import type { ChildAccess } from './childAccess';
import { localizeTimestamps, toFamilyLocalTime } from './localTime';
import { runRosinaTurn, type McpClientLike } from './model';
import { buildSystemPrompt } from './systemPrompt';

const FAKE_CONFIG: ProviderConfig = { id: 'meta', label: 'fake', baseUrl: 'http://unused', model: 'fake-model', apiKey: 'unused' };

function chatResult(partial: Partial<ChatResult> & { toolCalls?: ChatResult['toolCalls'] }): ChatResult {
  return { content: '', toolCalls: [], usage: {}, latencyMs: 1, messageKeys: [], usageKeys: [], rawSummary: { status: 200 }, ...partial };
}

function scriptedChat(script: ChatResult[]): (config: ProviderConfig, messages: ModelMessage[], tools?: ModelTool[], options?: unknown) => Promise<ChatResult> {
  let i = 0;
  return async () => {
    if (i >= script.length) throw new Error(`scriptedChat: no more scripted turns (asked for turn ${i + 1}, script has ${script.length})`);
    return script[i++];
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ChatResult['toolCalls'][number] {
  return { id, name, args: JSON.stringify(args) };
}

const ALL_TOOLS: McpTool[] = [
  { name: 'PickupCandidates', description: 'read', inputSchema: {} },
  { name: 'Attempts', description: 'read', inputSchema: {} },
  { name: 'JobTimeline', description: 'read', inputSchema: {} },
  { name: 'SomeFutureMutation', description: 'not a read this service knows about', inputSchema: {} },
];

/** TASK R-MYCHILDREN: every runRosinaTurn call makes an eager MyChildren call first; none of
 * PickupCandidates/Attempts/JobTimeline are childId-gated at all, so its exact content barely
 * matters here — it just has to succeed. */
const MY_CHILDREN_NORA: McpToolCall = { data: { myChildren: [{ child: { id: 'p_nora' }, scopes: ['schedule.read'] }] }, errors: [], isError: false, raw: null };

/** Keyed by exact (name, JSON.stringify(args)) so a test can script distinct results for, e.g.,
 * Attempts() with no args vs Attempts({jobId}). */
function stubMcp(byCall: Record<string, McpToolCall>): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return ALL_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'MyChildren') return MY_CHILDREN_NORA;
      const key = `${name}:${JSON.stringify(args)}`;
      return byCall[key] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

const EMPTY_RESULT: McpToolCall = { data: { attempts: [] }, errors: [], isError: false, raw: null };
const JOB_ATTEMPTS: McpToolCall = {
  data: {
    attempts: [
      { id: 'att_1', channel: 'SMS', at: '2026-10-16T19:30:00Z', destinationMode: 'TEST_RESPONDER', closedAt: '2026-10-16T19:45:00Z', closedReason: 'ACCEPTED', job: { id: 'job_nora_oct16', status: 'awaiting_approval', version: 3 }, candidate: { id: 'p_gma', displayName: 'Loretta Brooks' } },
      { id: 'att_2', channel: 'SMS', at: '2026-10-16T19:00:00Z', destinationMode: 'TEST_RESPONDER', closedAt: '2026-10-16T19:10:00Z', closedReason: 'DECLINED', job: { id: 'job_nora_oct16', status: 'awaiting_approval', version: 3 }, candidate: { id: 'p_tasha', displayName: 'Tasha Ellison' } },
    ],
  },
  errors: [],
  isError: false,
  raw: null,
};

test('the allowlist accepts PickupCandidates, Attempts and JobTimeline, and rejects an unknown tool without ever calling it', async () => {
  const mcp = stubMcp({ [`Attempts:${JSON.stringify({})}`]: EMPTY_RESULT });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'Attempts', {}), toolCall('c2', 'SomeFutureMutation', { jobId: 'job_nora_oct16' })] }),
    chatResult({ content: "I can't see that pickup." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 2, 'MyChildren, then Attempts — SomeFutureMutation never reached the client');
  assert.equal(mcp.calls[1].name, 'Attempts');
  const refused = result.toolCalls.find((t) => t.kind === 'refused');
  assert.deepEqual(refused, { round: 1, kind: 'refused', name: 'SomeFutureMutation', argsPreview: { jobId: 'job_nora_oct16' }, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
});

test('an empty Attempts/JobTimeline result never implies "nothing happened" in the prompt text', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: null }] as ChildAccess[], false, 'p_mom');
  assert.match(prompt, /I can't see that pickup/);
  assert.match(prompt, /Never read \[\] as "nothing\s+happened/);
});

test('the system prompt tells the model times already arrive in the family\'s own local time', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: null }] as ChildAccess[], false, 'p_mom');
  assert.match(prompt, /America\/Detroit/);
  assert.match(prompt, /ALREADY converted/);
});

test('output guard: an empty Attempts result for a hidden job, with the model correctly naming no one, passes through', async () => {
  const mcp = stubMcp({ [`Attempts:${JSON.stringify({ jobId: 'job_other_family' })}`]: EMPTY_RESULT });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'Attempts', { jobId: 'job_other_family' })] }),
    chatResult({ content: "I can't see that pickup." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, "I can't see that pickup.");
  assert.equal(result.outputGuardTriggered, false);
});

test('output guard: if the model volunteers a foreign child\'s name alongside an empty job result anyway, it is still caught', async () => {
  const mcp = stubMcp({ [`Attempts:${JSON.stringify({ jobId: 'job_other_family' })}`]: EMPTY_RESULT });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'Attempts', { jobId: 'job_other_family' })] }),
    chatResult({ content: "I can't see that pickup — it looks like it might belong to Jax's family." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, 'I can only help with children shared with you.');
  assert.equal(result.outputGuardTriggered, true);
});

test('output guard: candidate displayNames from a real Attempts result are grounded, not a leak', async () => {
  const mcp = stubMcp({ [`Attempts:${JSON.stringify({})}`]: JOB_ATTEMPTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'Attempts', {})] }),
    chatResult({ content: 'For job_nora_oct16: Loretta Brooks accepted; Tasha Ellison declined. Status: awaiting approval.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, false, 'Loretta Brooks and Tasha Ellison both came from this turn\'s own Attempts result for Kendra\'s own child\'s job');
  assert.match(result.reply, /Loretta Brooks/);
  assert.match(result.reply, /Tasha Ellison/);
});

test('localizeTimestamps rewrites at/closedAt to America/Detroit local time and leaves other fields untouched', () => {
  const localized = localizeTimestamps(JOB_ATTEMPTS.data) as { attempts: Array<Record<string, unknown>> };
  const first = localized.attempts[0];
  assert.equal(first.id, 'att_1', 'non-timestamp fields are untouched');
  assert.equal(first.channel, 'SMS');
  assert.notEqual(first.at, '2026-10-16T19:30:00Z', 'the raw UTC string must not reach the model');
  assert.match(String(first.at), /\d{1,2}:\d{2}\s*(AM|PM)/, 'rewritten to a human local-time string');
  assert.notEqual(first.closedAt, '2026-10-16T19:45:00Z');
});

test('toFamilyLocalTime is a no-op on a non-ISO string and on non-string values', () => {
  assert.equal(toFamilyLocalTime('not a date'), 'not a date');
  assert.equal(toFamilyLocalTime(null), null);
  assert.equal(toFamilyLocalTime(42), 42);
});
