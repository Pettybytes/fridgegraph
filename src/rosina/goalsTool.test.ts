/**
 * Goals read tool — gating (MOCKED/offline; scripted model + stubbed MCP, no network). Proves the new
 * fridge-awareness read is wired into the SAME child-ID + scope gates as every other read, and that a
 * consequential mutation name is refused by the allowlist (no Confirm* or requestPickup in the model's
 * tool lane). With no model calls this is a structural gating proof, not an LLM-behavior claim.
 * Run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ProviderConfig } from '../muse/providers';
import { runRosinaTurn, type McpClientLike } from './model';

const FAKE_CONFIG: ProviderConfig = { id: 'meta', label: 'fake', baseUrl: 'http://unused', model: 'fake-model', apiKey: 'unused' };
function chatResult(partial: Partial<ChatResult>): ChatResult {
  return { content: '', toolCalls: [], usage: {}, latencyMs: 1, messageKeys: [], usageKeys: [], rawSummary: { status: 200 }, ...partial };
}
function scriptedChat(script: ChatResult[]) {
  let i = 0;
  return async () => (i < script.length ? script[i++] : chatResult({ content: 'done' }));
}
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args: JSON.stringify(args) });

const TOOLS: McpTool[] = [{ name: 'Goals', description: 'r', inputSchema: {} }, { name: 'CareFacts', description: 'r', inputSchema: {} }];
const myChildren = (entries: Array<{ id: string; scopes: string[] }>): McpToolCall => ({ data: { myChildren: entries.map((e) => ({ child: { id: e.id }, scopes: e.scopes })) }, errors: [], isError: false, raw: null });
const ok = (data: unknown): McpToolCall => ({ data, errors: [], isError: false, raw: null });

function stubMcp(mc: McpToolCall, answers: Record<string, McpToolCall>): McpClientLike & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    async initialize() {},
    async listTools() { return TOOLS; },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'MyChildren') return mc;
      return answers[name] ?? { data: null, errors: [{ message: 'NO_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const base = { message: 'what goals are on the fridge', currentRoute: '#/ask-rosina', history: [], bearer: 'T', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

test('Goals is gated by child-ID + goals.read; a consequential mutation name is refused', async () => {
  // p_nora: has goals.read → allowed. p_malik: careplan.read only → SCOPE_NOT_GRANTED.
  const mcp = stubMcp(myChildren([{ id: 'p_nora', scopes: ['goals.read', 'schedule.read'] }, { id: 'p_malik', scopes: ['careplan.read'] }]),
    { Goals: ok({ goals: [{ id: 'g1', title: 'Read nightly', status: 'active', horizon: 'this year', child: { id: 'p_nora' } }] }) });
  const res = await runRosinaTurn({
    ...base, personId: 'p_mom',
    chatFn: scriptedChat([
      chatResult({ toolCalls: [
        toolCall('t1', 'Goals', { childId: 'p_nora' }),
        toolCall('t2', 'Goals', { childId: 'p_malik' }),
        toolCall('t3', 'confirmAddVillager', { proposalId: 'x', version: 1 }), // consequential — must be refused
      ] }),
      chatResult({ content: 'ok' }),
    ]),
    mcpClientFactory: () => mcp,
  });
  const ev = (name: string, childId?: string) => res.toolCalls.find((t) => t.name === name && (childId === undefined || (t.argsPreview as { childId?: string }).childId === childId));
  assert.equal(ev('Goals', 'p_nora')!.isError, false, 'Goals allowed for a goals.read child');
  assert.deepEqual(ev('Goals', 'p_malik')!.errorCodes, ['SCOPE_NOT_GRANTED']);
  assert.deepEqual(ev('confirmAddVillager')!.errorCodes, ['TOOL_NOT_ALLOWED']);
  // the backend was called with Goals ONLY for the authorized child, never for p_malik or the mutation
  assert.ok(mcp.calls.some((c) => c.name === 'Goals' && c.args.childId === 'p_nora'));
  assert.equal(mcp.calls.some((c) => c.name === 'Goals' && c.args.childId === 'p_malik'), false);
  assert.equal(mcp.calls.some((c) => c.name === 'confirmAddVillager'), false);
});

test('Goals for a child not in MyChildren is refused OUT_OF_SCOPE_ID (no read issued)', async () => {
  const mcp = stubMcp(myChildren([{ id: 'p_nora', scopes: ['goals.read'] }]), { Goals: ok({ goals: [] }) });
  const res = await runRosinaTurn({
    ...base, personId: 'p_stranger',
    chatFn: scriptedChat([chatResult({ toolCalls: [toolCall('t1', 'Goals', { childId: 'p_jax' })] }), chatResult({ content: 'ok' })]),
    mcpClientFactory: () => mcp,
  });
  assert.deepEqual(res.toolCalls.find((t) => t.name === 'Goals')!.errorCodes, ['OUT_OF_SCOPE_ID']);
  assert.equal(mcp.calls.some((c) => c.name === 'Goals'), false);
});
