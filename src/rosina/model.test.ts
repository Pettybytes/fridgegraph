/**
 * Unit tests for src/rosina/model.ts. No network call — the model and MCP client are both
 * stubbed via runRosinaTurn's injectable chatFn/mcpClientFactory. Run with:
 *
 *   npm run test:rosina
 *
 * Regression coverage for the Priya capability-fabrication finding in
 * docs/evidence/35-rosina-service.md §6: catalog presence never implies permission. start-pickup
 * — the one consequential, data-changing action — additionally requires a same-turn, successful
 * PickupCandidates call for the EXACT child before the service will offer the card, regardless of
 * what the model asks for or claims in its own text.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import { runRosinaTurn, type McpClientLike } from './model';
import { buildSystemPrompt } from './systemPrompt';

const FAKE_CONFIG: ProviderConfig = { id: 'meta', label: 'fake', baseUrl: 'http://unused', model: 'fake-model', apiKey: 'unused' };

function chatResult(partial: Partial<ChatResult> & { toolCalls?: ChatResult['toolCalls'] }): ChatResult {
  return {
    content: '',
    toolCalls: [],
    usage: {},
    latencyMs: 1,
    messageKeys: [],
    usageKeys: [],
    rawSummary: { status: 200 },
    ...partial,
  };
}

/** Returns the next scripted result on each call; throws if the script runs out — a test bug,
 * not a production code path, so failing loudly is correct. */
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

const ONE_PICKUP_TOOL: McpTool[] = [{ name: 'PickupCandidates', description: 'read', inputSchema: {} }];

/** A stub MCP client whose callTool is scripted by exact (name, childId) -> result; initialize is
 * a no-op; listTools returns the fixed one-tool list this service allowlists. Records every call
 * so a test can assert the client was (or was not) actually invoked. */
function stubMcp(byChild: Record<string, McpToolCall>): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return ONE_PICKUP_TOOL;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const childId = String(args.childId ?? '');
      return byChild[childId] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const UNAUTHORIZED: McpToolCall = { data: null, errors: [{ message: 'UNAUTHORIZED', extensions: { code: 'UNAUTHORIZED' } }], isError: true, raw: null };
const CANDIDATES_OK: McpToolCall = { data: { pickupCandidates: [{ person: { id: 'p_gma', displayName: 'Loretta Brooks' }, reason: 'grandmother', authorization: 'AUTHORIZED', availability: 'UNKNOWN' }] }, errors: [], isError: false, raw: null };

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

test('an unauthorized persona (Priya case): start-pickup proposed with no PickupCandidates call at all is dropped', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't set that up yet — I don't have confirmed access to Nora." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'the action must be dropped even though start-pickup exists in the catalog');
  assert.equal(mcp.calls.length, 0, 'no MCP call was made — nothing to verify from, so nothing should be granted');
  const actionEvidence = result.toolCalls.find((t) => t.kind === 'action' && t.name === 'start-pickup');
  assert.ok(actionEvidence?.isError, 'the action attempt must be recorded as refused');
  assert.deepEqual(actionEvidence?.errorCodes, ['UNVERIFIED_CHILD']);
  assert.ok(!/arranged|booked|confirmed your pickup/i.test(result.reply), 'the reply must not claim the pickup was arranged');
});

test('an unauthorized persona who DOES call PickupCandidates first, but gets UNAUTHORIZED: start-pickup still dropped', async () => {
  const mcp = stubMcp({ p_nora: UNAUTHORIZED });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_nora' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't confirm who can pick up Nora, so I can't set up that request either." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'an UNAUTHORIZED PickupCandidates result must not count as verification');
  assert.equal(mcp.calls.length, 1);
  assert.ok(!/arranged|booked/i.test(result.reply));
});

test('a permitted persona (Kendra case): PickupCandidates succeeds, then start-pickup for the SAME child is kept', async () => {
  const mcp = stubMcp({ p_nora: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_nora' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: 'Ready for your review.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [{ id: 'start-pickup', args: { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' } }]);
  assert.equal(result.reply, 'Ready for your review.');
});

test('verification is order-independent WITHIN a round: start-pickup listed before PickupCandidates in the same batch still gets verified', async () => {
  const mcp = stubMcp({ p_nora: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({
      toolCalls: [
        toolCall('c1', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' }),
        toolCall('c2', 'PickupCandidates', { childId: 'p_nora' }),
      ],
    }),
    chatResult({ content: 'Ready for your review.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [{ id: 'start-pickup', args: { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' } }], 'real MCP reads are processed before action proposals regardless of emission order');
});

test('a permitted persona for a DIFFERENT child does not verify an unrelated child (no cross-child leakage of the grant)', async () => {
  const mcp = stubMcp({ p_jax: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_jax' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't set that up for Nora." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'verifying access to p_jax must never verify access to p_nora');
});

test('an unknown action id is dropped even if the model names it', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'proposeAction_delete-everything', {})] }),
    chatResult({ content: 'done' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.toolCalls[0].errorCodes, ['INVALID_ACTION']);
});

test('a non-allowlisted MCP tool name is refused without ever calling the MCP client', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'GrantAccess', { childId: 'p_nora', actorId: 'p_mom', scopes: ['pickup.request'] })] }),
    chatResult({ content: "I can't do that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 0, 'a mutation-shaped tool name must never reach the MCP client, regardless of what the model asks for');
  assert.deepEqual(result.toolCalls[0], { round: 1, kind: 'refused', name: 'GrantAccess', argsPreview: { childId: 'p_nora', actorId: 'p_mom', scopes: ['pickup.request'] }, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
});

test('the system prompt tells the model it cannot see the caller\'s role (the actual fix for the capability-fabrication finding)', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /NO tool that tells you the caller's own role/);
  assert.match(prompt, /Never assert what the signed-in person "can" do/);
});
