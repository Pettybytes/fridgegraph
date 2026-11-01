/**
 * Caregiver Briefing wired into the Rosina turn: when the model calls the local `CaregiverBriefing`
 * tool, the service gathers ONLY the caller's authorized reads (as the caller) and composes the
 * briefing. These tests drive the real runRosinaTurn with a scripted model + stubbed MCP and assert
 * the trust boundary at the WIRING level: Loretta reads schedule + care; Priya (care only) never
 * triggers a schedule read; an unknown child is refused before any read. No network.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import { runRosinaTurn, type McpClientLike } from './model';

const FAKE_CONFIG: ProviderConfig = { id: 'meta', label: 'fake', baseUrl: 'http://unused', model: 'fake-model', apiKey: 'unused' };

function chatResult(partial: Partial<ChatResult>): ChatResult {
  return { content: '', toolCalls: [], usage: {}, latencyMs: 1, messageKeys: [], usageKeys: [], rawSummary: { status: 200 }, ...partial };
}
function scriptedChat(script: ChatResult[]) {
  let i = 0;
  return async () => { if (i >= script.length) return chatResult({ content: 'done' }); return script[i++]; };
}
function toolCall(id: string, name: string, args: Record<string, unknown>): ChatResult['toolCalls'][number] {
  return { id, name, args: JSON.stringify(args) };
}

const TOOLS: McpTool[] = [
  { name: 'ChildEvents', description: 'r', inputSchema: {} },
  { name: 'CareFacts', description: 'r', inputSchema: {} },
  { name: 'EffectiveSchedule', description: 'r', inputSchema: {} },
  { name: 'CheckInStatus', description: 'r', inputSchema: {} },
];

function myChildren(entries: Array<{ id: string; scopes: string[] }>): McpToolCall {
  return { data: { myChildren: entries.map((e) => ({ child: { id: e.id }, scopes: e.scopes })) }, errors: [], isError: false, raw: null };
}
const ok = (data: unknown): McpToolCall => ({ data, errors: [], isError: false, raw: null });
const denied = (): McpToolCall => ({ data: null, errors: [{ message: 'UNAUTHORIZED' }], isError: true, raw: null });

function stubMcp(myChildrenResult: McpToolCall, answers: Record<string, McpToolCall>): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() { return TOOLS; },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'MyChildren') return myChildrenResult;
      return answers[name] ?? denied();
    },
  };
}

const EVENTS = ok({ childEvents: [{ id: 'e1', title: 'School', start: '2026-10-26T08:15:00', end: '2026-10-26T15:00:00', location: 'Lincoln Elementary', status: 'confirmed', child: { id: 'p_nora' } }] });
const CARE = ok({ careFacts: [{ id: 'cf1', key: 'Allergy', value: 'peanuts', source: { kind: 'PARENT_CONVERSATION', ref: 'x' }, verifiedBy: { id: 'p_mom' }, verifiedAt: '2026-10-12T00:00:00Z', confidence: 'CONFIRMED' }] });
const EFFECTIVE = ok({ effectiveScheduleFor: { parent: { id: 'p_kendra', displayName: 'Kendra' }, source: 'WEEKLY', arrangementId: null } });

function options(personId: string, mcp: McpClientLike) {
  return {
    message: 'What do I need to know for today?', currentRoute: '#/ask-rosina', history: [], bearer: 'T',
    personId, isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG,
    chatFn: scriptedChat([
      chatResult({ toolCalls: [toolCall('t1', 'CaregiverBriefing', { childId: 'p_nora', date: '2026-10-26' })] }),
      chatResult({ content: "Here's your briefing." }),
    ]),
    mcpClientFactory: () => mcp,
  };
}

test('Loretta (schedule + care) → the briefing reads schedule AND care, as the caller', async () => {
  const mcp = stubMcp(
    myChildren([{ id: 'p_nora', scopes: ['schedule.read', 'careplan.read'] }]),
    { ChildEvents: EVENTS, CareFacts: CARE, EffectiveSchedule: EFFECTIVE, CheckInStatus: denied() },
  );
  const res = await runRosinaTurn(options('p_loretta', mcp));
  const ev = res.toolCalls.find((t) => t.name === 'CaregiverBriefing');
  assert.ok(ev && !ev.isError, 'briefing ran without error');
  const names = mcp.calls.map((c) => c.name);
  assert.ok(names.includes('ChildEvents'), 'schedule read issued');
  assert.ok(names.includes('CareFacts'), 'care read issued');
  // every read was for p_nora
  for (const c of mcp.calls.filter((c) => c.name !== 'MyChildren')) assert.equal(c.args.childId, 'p_nora');
});

test('Priya (care only) → NO schedule read is ever issued', async () => {
  const mcp = stubMcp(
    myChildren([{ id: 'p_nora', scopes: ['careplan.read'] }]),
    { CareFacts: CARE, CheckInStatus: denied() },
  );
  const res = await runRosinaTurn(options('p_priya', mcp));
  const ev = res.toolCalls.find((t) => t.name === 'CaregiverBriefing');
  assert.ok(ev && !ev.isError);
  const names = mcp.calls.map((c) => c.name);
  assert.equal(names.includes('ChildEvents'), false, 'no schedule read without schedule.read');
  assert.ok(names.includes('CareFacts'));
});

test('an unknown child is refused before any read is issued', async () => {
  const mcp = stubMcp(
    myChildren([{ id: 'p_nora', scopes: ['schedule.read'] }]),
    { ChildEvents: EVENTS },
  );
  const opts = options('p_stranger', mcp);
  opts.chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('t1', 'CaregiverBriefing', { childId: 'p_jax', date: '2026-10-26' })] }),
    chatResult({ content: 'ok' }),
  ]);
  const res = await runRosinaTurn(opts);
  const ev = res.toolCalls.find((t) => t.name === 'CaregiverBriefing');
  assert.ok(ev && ev.isError, 'refused');
  assert.deepEqual(ev!.errorCodes, ['OUT_OF_SCOPE_ID']);
  assert.equal(mcp.calls.some((c) => c.args.childId === 'p_jax'), false, 'no read for an unknown child');
});
