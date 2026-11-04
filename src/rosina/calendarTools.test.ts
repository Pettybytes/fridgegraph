/**
 * Unit tests for TASK R-TOOLS-2 (ChildEvents, EffectiveSchedule, AdultAvailability added to the
 * Rosina allowlist, plus the pre-call id-authorization gate). No network call. Run with:
 *   npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import type { ChildAccess } from './childAccess';
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
  { name: 'ChildEvents', description: 'read', inputSchema: {} },
  { name: 'EffectiveSchedule', description: 'read', inputSchema: {} },
  { name: 'AdultAvailability', description: 'read', inputSchema: {} },
  { name: 'SomeFutureMutation', description: 'not a read this service knows about', inputSchema: {} },
];

/** TASK R-MYCHILDREN: every runRosinaTurn call makes an eager MyChildren call first; `byCall`
 * answers it too, keyed `MyChildren:{}` like everything else. Kendra's full-scope Nora entry is
 * the default every test in this file implicitly assumes unless overridden. */
const MY_CHILDREN_NORA_FULL = { data: { myChildren: [{ child: { id: 'p_nora' }, scopes: ['schedule.read', 'careplan.read', 'school.read', 'contacts.read', 'transport.read', 'goals.read', 'pickup.verify', 'pickup.request'] }] }, errors: [], isError: false, raw: null };

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
      const key = `${name}:${JSON.stringify(args)}`;
      if (name === 'MyChildren') return (byCall[key] ?? MY_CHILDREN_NORA_FULL) as McpToolCall;
      return byCall[key] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

const EFFECTIVE_ARRANGEMENT: McpToolCall = { data: { effectiveScheduleFor: { parent: { id: 'p_dad', displayName: 'Andre Ellison' }, source: 'ARRANGEMENT', arrangementId: 'ha_nora_thanksgiving' } }, errors: [], isError: false, raw: null };
const AVAILABILITY_BUSY: McpToolCall = { data: { adultAvailability: [{ person: { id: 'p_mom', displayName: 'Kendra Ellison' }, start: '2026-11-25T14:00:00+00:00', end: '2026-11-25T22:00:00+00:00', state: 'BUSY' }] }, errors: [], isError: false, raw: null };
const EVENTS_EMPTY: McpToolCall = { data: { childEvents: [] }, errors: [], isError: false, raw: null };

test('the allowlist now has six tools and still rejects an unknown one without ever calling it', async () => {
  const mcp = stubMcp({ [`ChildEvents:${JSON.stringify({ childId: 'p_nora', from: '2026-11-01', to: '2026-11-30' })}`]: EVENTS_EMPTY });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'ChildEvents', { childId: 'p_nora', from: '2026-11-01', to: '2026-11-30' }), toolCall('c2', 'SomeFutureMutation', { childId: 'p_nora' })] }),
    chatResult({ content: 'No records are available to this view.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 2, 'MyChildren, then ChildEvents — SomeFutureMutation never reached the client');
  assert.equal(mcp.calls[1].name, 'ChildEvents');
  const refused = result.toolCalls.find((t) => t.name === 'SomeFutureMutation');
  assert.deepEqual(refused?.errorCodes, ['TOOL_NOT_ALLOWED']);
});

test('an out-of-scope personId is rejected BEFORE any tool call — no attempt ever reaches MCP', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    // Kendra's fresh MyChildren is Nora only; p_dad was never harvested this turn.
    chatResult({ toolCalls: [toolCall('c1', 'AdultAvailability', { personId: 'p_dad', from: '2026-11-25', to: '2026-11-25' })] }),
    chatResult({ content: 'I can only help with children shared with you.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  const refused = result.toolCalls.find((t) => t.kind === 'refused');
  assert.deepEqual(refused, { round: 1, kind: 'refused', name: 'AdultAvailability', argsPreview: { personId: 'p_dad', from: '2026-11-25', to: '2026-11-25' }, isError: true, errorCodes: ['OUT_OF_SCOPE_ID'] });
});

test('the caller may always ask about their OWN id without any prior discovery', async () => {
  const mcp = stubMcp({ [`AdultAvailability:${JSON.stringify({ personId: 'p_mom', from: '2026-11-25', to: '2026-11-25' })}`]: AVAILABILITY_BUSY });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'AdultAvailability', { personId: 'p_mom', from: '2026-11-25', to: '2026-11-25' })] }),
    chatResult({ content: 'You have recorded busy time on Nov 25.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 2, 'MyChildren, then AdultAvailability');
  assert.equal(result.reply, 'You have recorded busy time on Nov 25.');
});

test('an id harvested from an authorized EffectiveSchedule result is then permitted for AdultAvailability, same turn', async () => {
  const mcp = stubMcp({
    [`EffectiveSchedule:${JSON.stringify({ childId: 'p_nora', date: '2026-11-26' })}`]: EFFECTIVE_ARRANGEMENT,
    [`AdultAvailability:${JSON.stringify({ personId: 'p_dad', from: '2026-11-26', to: '2026-11-26' })}`]: { data: { adultAvailability: [] }, errors: [], isError: false, raw: null },
  });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'EffectiveSchedule', { childId: 'p_nora', date: '2026-11-26' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'AdultAvailability', { personId: 'p_dad', from: '2026-11-26', to: '2026-11-26' })] }),
    chatResult({ content: 'No records are available to this view.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 3, 'MyChildren, then EffectiveSchedule, then AdultAvailability (p_dad discovered via the first)');
  assert.equal(result.reply, 'No records are available to this view.');
});

test('a never-discovered id stays rejected across rounds until a tool actually hands it back', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'AdultAvailability', { personId: 'p_dad', from: '2026-11-25', to: '2026-11-25' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'AdultAvailability', { personId: 'p_dad', from: '2026-11-25', to: '2026-11-25' })] }),
    chatResult({ content: 'I can only help with children shared with you.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'only the eager MyChildren call — retrying the same unverified id never succeeds without a discovery step');
  assert.equal(result.toolCalls.filter((t) => t.errorCodes.includes('OUT_OF_SCOPE_ID')).length, 2);
});

test('an empty authorized answer names WHAT was checked; the banned empty-copy phrasing is forbidden (prompt wording, Bryan 2026-11-03)', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: null }], false, 'p_mom');
  assert.match(prompt, /say in\s+your own words WHAT you checked/);
  assert.match(prompt, /NEVER use the phrases "No records are available"/);
  assert.match(prompt, /I couldn't check that just now/);
});

test('the prompt states FREE/BUSY wording and forbids "can pick up"/"available to watch"', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: null }], false, 'p_mom');
  assert.match(prompt, /has free time recorded/);
  assert.match(prompt, /never say "is available to watch" or "can pick up/);
});

test('the prompt distinguishes PROPOSED (no effect) from APPROVED (changes the schedule)', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: null }], false, 'p_mom');
  assert.match(prompt, /PROPOSED[\s\S]{0,40}only a proposal/);
  assert.match(prompt, /only an.{0,10}APPROVED.{0,10}one does/);
});

test('output guard: Andre\'s name from a real EffectiveSchedule result is grounded, not a leak (TASK R-MYCHILDREN: the CHILD\'s own name is not — MyChildren reports no displayName today, so the reply below deliberately never says "Nora")', async () => {
  const mcp = stubMcp({ [`EffectiveSchedule:${JSON.stringify({ childId: 'p_nora', date: '2026-11-26' })}`]: EFFECTIVE_ARRANGEMENT });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'EffectiveSchedule', { childId: 'p_nora', date: '2026-11-26' })] }),
    chatResult({ content: 'Andre Ellison has the child on Thanksgiving, under an approved arrangement.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, false, 'Andre Ellison came from this turn\'s own EffectiveSchedule result');
  assert.match(result.reply, /Andre Ellison/);
});

test('output guard (TASK R-MYCHILDREN): saying the CALLER\'S OWN child\'s name with no grounding still trips the guard — MyChildren reports no name for her today', async () => {
  const mcp = stubMcp({ [`EffectiveSchedule:${JSON.stringify({ childId: 'p_nora', date: '2026-11-26' })}`]: EFFECTIVE_ARRANGEMENT });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'EffectiveSchedule', { childId: 'p_nora', date: '2026-11-26' })] }),
    chatResult({ content: 'Andre Ellison has Nora on Thanksgiving, under an approved arrangement.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, true, 'no static roster exists to pre-approve "Nora" any more, and no tool this turn supplied that name');
});

test('output guard: a MyChildren displayName (future-correct contract) grounds the child\'s own name', async () => {
  const mcp: McpClientLike & { calls: unknown[] } = {
    calls: [],
    async initialize() {},
    async listTools() {
      return ALL_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      if (name === 'MyChildren') return { data: { myChildren: [{ child: { id: 'p_nora', person: { displayName: 'Nora Ellison' } }, scopes: ['schedule.read'] }] }, errors: [], isError: false, raw: null };
      if (name === 'EffectiveSchedule' && args.childId === 'p_nora') return EFFECTIVE_ARRANGEMENT;
      return { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'EffectiveSchedule', { childId: 'p_nora', date: '2026-11-26' })] }),
    chatResult({ content: 'Andre Ellison has Nora Ellison on Thanksgiving, under an approved arrangement.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, false, 'MyChildren\'s own displayName this turn grounds "Nora Ellison"');
});
