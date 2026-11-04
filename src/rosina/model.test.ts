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
 *
 * TASK R-MYCHILDREN: every `runRosinaTurn` call now makes an eager `MyChildren` call FIRST,
 * before the model ever runs — `stubMcp` below always answers it (default: one generic child),
 * and `result.toolCalls[0]` is always that call's own evidence row.
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

function myChildren(entries: Array<{ id: string; scopes: string[] }>): McpToolCall {
  return { data: { myChildren: entries.map((e) => ({ child: { id: e.id }, scopes: e.scopes })) }, errors: [], isError: false, raw: null };
}

const KENDRA_HAS_NORA = myChildren([{ id: 'p_nora', scopes: ['pickup.request', 'pickup.verify', 'schedule.read'] }]);
const RAY_HAS_JAX = myChildren([{ id: 'p_jax', scopes: ['pickup.request', 'pickup.verify', 'schedule.read'] }]);

/** A stub MCP client. `myChildrenResult` answers the eager MyChildren call every turn makes;
 * `byChild` answers every other childId-keyed call by exact childId. Records every call so a
 * test can assert the client was (or was not) actually invoked. */
function stubMcp(myChildrenResult: McpToolCall, byChild: Record<string, McpToolCall> = {}): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return ONE_PICKUP_TOOL;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'MyChildren') return myChildrenResult;
      const childId = String(args.childId ?? '');
      return byChild[childId] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const UNAUTHORIZED: McpToolCall = { data: null, errors: [{ message: 'UNAUTHORIZED', extensions: { code: 'UNAUTHORIZED' } }], isError: true, raw: null };
const CANDIDATES_OK: McpToolCall = { data: { pickupCandidates: [{ person: { id: 'p_gma', displayName: 'Loretta Brooks' }, reason: 'grandmother', authorization: 'AUTHORIZED', availability: 'UNKNOWN' }] }, errors: [], isError: false, raw: null };

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

test('Demo guide cannot stage mutations or offer a pickup review even after a successful sandbox read', async () => {
  const mcp = stubMcp(myChildren([]), { p_nora: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('read', 'PickupCandidates', { childId: 'p_nora' })] }),
    chatResult({ toolCalls: [toolCall('stage', 'ProposeAddVillager', { childId: 'p_nora' }), toolCall('propose', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-05', window: 'afternoon' })] }),
    chatResult({ content: 'I prepared your review card.' }),
  ]);
  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_demo_guide', isGuide: true, mcpClientFactory: () => mcp, chatFn });
  assert.equal(mcp.calls.some(c => c.name === 'ProposeAddVillager'), false);
  assert.deepEqual(result.actions, []);
  assert.equal(result.addVillagerProposal, null);
  assert.doesNotMatch(result.reply, /prepared your review card/);
  assert.match(result.reply, /cannot prepare or confirm changes/);
});

test('an unauthorized persona (Priya case): start-pickup proposed with no PickupCandidates call at all is dropped', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't set that up yet — I don't have confirmed access to Nora." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'the action must be dropped even though start-pickup exists in the catalog');
  assert.equal(mcp.calls.length, 1, 'only the eager MyChildren call — no PickupCandidates call to verify from');
  const actionEvidence = result.toolCalls.find((t) => t.kind === 'action' && t.name === 'start-pickup');
  assert.ok(actionEvidence?.isError, 'the action attempt must be recorded as refused');
  assert.deepEqual(actionEvidence?.errorCodes, ['UNVERIFIED_CHILD']);
  assert.ok(!/arranged|booked|confirmed your pickup/i.test(result.reply), 'the reply must not claim the pickup was arranged');
});

test('an unauthorized persona who DOES call PickupCandidates first, but gets UNAUTHORIZED: start-pickup still dropped', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: UNAUTHORIZED });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_nora' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't confirm who can pick up Nora, so I can't set up that request either." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'an UNAUTHORIZED PickupCandidates result must not count as verification');
  assert.equal(mcp.calls.length, 2, 'MyChildren plus the one PickupCandidates attempt');
  assert.ok(!/arranged|booked/i.test(result.reply));
});

test('a permitted persona (Kendra case): PickupCandidates succeeds, then start-pickup for the SAME child is kept', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: CANDIDATES_OK });
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
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: CANDIDATES_OK });
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
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_jax: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_jax' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_start-pickup', { childId: 'p_nora', date: '2026-11-02', window: 'afternoon' })] }),
    chatResult({ content: "I can't set that up for Nora." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'verifying access to p_jax must never verify access to p_nora');
});

test('an unknown action id is dropped even if the model names it', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'proposeAction_delete-everything', {})] }),
    chatResult({ content: 'done' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, []);
  const actionEvidence = result.toolCalls.find((t) => t.kind === 'action');
  assert.deepEqual(actionEvidence?.errorCodes, ['INVALID_ACTION']);
});

test('a non-allowlisted MCP tool name is refused without ever calling the MCP client', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'GrantAccess', { childId: 'p_nora', actorId: 'p_mom', scopes: ['pickup.request'] })] }),
    chatResult({ content: "I can't do that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'only the eager MyChildren call — GrantAccess never reaches the MCP client');
  const refused = result.toolCalls.find((t) => t.kind === 'refused');
  assert.deepEqual(refused, { round: 1, kind: 'refused', name: 'GrantAccess', argsPreview: { childId: 'p_nora', actorId: 'p_mom', scopes: ['pickup.request'] }, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });
});

test('the system prompt tells the model it cannot see the caller\'s role (the actual fix for the capability-fabrication finding)', () => {
  const children: ChildAccess[] = [{ id: 'p_nora', scopes: new Set(['schedule.read']), displayName: 'Nora Ellison' }];
  const prompt = buildSystemPrompt(children, false, 'p_mom');
  assert.match(prompt, /NO tool that tells you the caller's own role/);
  assert.match(prompt, /Never assert what the signed-in person "can" do/);
});

// --- TASK R-MYCHILDREN: discovery fails closed, never falls back to a static roster ---

test('MyChildren itself erroring fails the whole turn closed — the model never even runs', async () => {
  const mcp = stubMcp({ data: null, errors: [{ message: 'UPSTREAM_DOWN' }], isError: true, raw: null });
  const chatFn = scriptedChat([]); // never called

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, "I couldn't check that just now.");
  assert.deepEqual(result.actions, []);
  assert.equal(result.rounds, 0);
  assert.equal(mcp.calls.length, 1, 'only the failed MyChildren attempt — nothing else was ever tried');
});

test('a malformed MyChildren shape (not even a list) also fails closed, distinct from a genuinely empty roster', async () => {
  const mcp = stubMcp({ data: { somethingElse: true }, errors: [], isError: false, raw: null });
  const chatFn = scriptedChat([]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, "I couldn't check that just now.");
});

test('a genuinely empty MyChildren array is NOT a failure — the turn proceeds with zero known children (Oscar/no-oracle case)', async () => {
  const mcp = stubMcp(myChildren([]));
  const chatFn = scriptedChat([chatResult({ content: 'I can only help with children shared with you.' })]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_oscar', chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, 'I can only help with children shared with you.');
  assert.equal(result.rounds, 1);
});

// --- TASK R-MYCHILDREN: per-child scope gating ---

test('a careplan.read-only child allows CareFacts but refuses ChildEvents for that same child', async () => {
  const mcp = stubMcp(myChildren([{ id: 'p_malik', scopes: ['careplan.read'] }]), {
    p_malik: { data: { careFacts: [{ id: 'f1', key: 'snack', value: 'peanut-free', source: { kind: 'PARENT_CONVERSATION', ref: 'Dwayne, 2026-10-20' }, verifiedBy: { id: 'p_dwayne' }, verifiedAt: '2026-10-20T17:00:00Z', confidence: 'CONFIRMED' }] }, errors: [], isError: false, raw: null },
  });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'ChildEvents', { childId: 'p_malik', from: '2026-01-01', to: '2026-12-31' })] }),
    chatResult({ content: 'done' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn, mcpClientFactory: () => mcp });

  const careEvidence = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.equal(careEvidence?.isError, false, 'careplan.read covers CareFacts');
  const eventsEvidence = result.toolCalls.find((t) => t.name === 'ChildEvents');
  assert.deepEqual(eventsEvidence, { round: 2, kind: 'refused', name: 'ChildEvents', argsPreview: { childId: 'p_malik', from: '2026-01-01', to: '2026-12-31' }, isError: true, errorCodes: ['SCOPE_NOT_GRANTED'] });
  assert.equal(mcp.calls.filter((c) => c.name === 'ChildEvents').length, 0, 'the scope gate refused it before MCP was ever called for that tool');
});

test('a child entirely absent from MyChildren is refused pre-call, same as before (OUT_OF_SCOPE_ID)', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_emma' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'only the eager MyChildren call — CareFacts(p_emma) never reached MCP');
  const refused = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.deepEqual(refused?.errorCodes, ['OUT_OF_SCOPE_ID']);
});

// --- TASK R-MYCHILDREN: the Demo guide's childId reads bypass the MyChildren gate (backend-enforced) ---

test('the Demo guide may attempt a childId-keyed read even though her own MyChildren is empty', async () => {
  const mcp = stubMcp(myChildren([]), {
    p_malik: { data: { careFacts: [] }, errors: [], isError: false, raw: null },
  });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_demo_guide', isGuide: true, chatFn, mcpClientFactory: () => mcp });

  const careEvidence = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.equal(careEvidence?.isError, false, 'the guide bypass let the call reach MCP; the backend itself decided the (empty) answer');
});

test('a non-guide caller with the SAME empty MyChildren gets no such bypass', async () => {
  const mcp = stubMcp(myChildren([]), {
    p_malik: { data: { careFacts: [] }, errors: [], isError: false, raw: null },
  });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_oscar', isGuide: false, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'MyChildren only — CareFacts never reached MCP for a non-guide with no known children');
  const refused = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.deepEqual(refused?.errorCodes, ['OUT_OF_SCOPE_ID']);
});

// --- TASK R-LEAK (still enforced): the output guard catches a leak even if the model says it anyway ---

test('output guard: a stubbed reply naming Jax to Kendra is replaced with the scoped refusal', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ content: 'Which child do you mean? I only know Nora and Jax by name.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_mom', isGuide: false, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, 'I can only help with children shared with you.');
  assert.equal(result.outputGuardTriggered, true);
  assert.deepEqual(result.actions, [], 'actions are dropped too once the guard fires, fail closed');
});

test('output guard (TASK R-MYCHILDREN, stricter now): naming "Jax" with NO grounding trips the guard even for Jax\'s own family — MyChildren today reports no name at all', async () => {
  const mcp = stubMcp(RAY_HAS_JAX);
  const chatFn = scriptedChat([
    chatResult({ content: "Jax's pickup records show four authorized people." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_ray', isGuide: false, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, true, 'no static roster exists any more to pre-approve "Jax" — only a genuinely grounded name does');
});

test('output guard: a displayName MyChildren itself reports (future-correct contract) DOES ground the name', async () => {
  // Simulate the richer future response shape directly — childAccess.ts already parses
  // `person.displayName` when present; today's deployed contract just never supplies it.
  const richMcp: McpClientLike & { calls: unknown[] } = {
    calls: [],
    async initialize() {},
    async listTools() {
      return ONE_PICKUP_TOOL;
    },
    async callTool(name: string) {
      if (name === 'MyChildren') return { data: { myChildren: [{ child: { id: 'p_jax', person: { displayName: 'Jax Coleman' } }, scopes: ['pickup.request'] }] }, errors: [], isError: false, raw: null };
      return { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
  const chatFn = scriptedChat([chatResult({ content: "Jax's pickup records show four authorized people." })]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_ray', isGuide: false, chatFn, mcpClientFactory: () => richMcp });

  assert.equal(result.outputGuardTriggered, false, 'MyChildren\'s own displayName this turn grounds the name — no leak');
});

test('output guard: a name grounded in this turn\'s own tool result is not a leak', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: CANDIDATES_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'PickupCandidates', { childId: 'p_nora' })] }),
    chatResult({ content: 'Loretta Brooks may be asked to pick up a child today.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_mom', isGuide: false, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, false, 'Loretta Brooks came from this turn\'s own PickupCandidates result');
  assert.match(result.reply, /Loretta Brooks/);
});
