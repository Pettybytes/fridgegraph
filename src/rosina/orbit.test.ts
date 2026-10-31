/**
 * Unit tests for TASK R-ORBIT: Rosina's side of Orbit (notice -> suggest -> gather ->
 * preparation card; never activate). No network call — src/rosina/orbit.ts's gates are pure
 * functions, and the model/MCP client are both stubbed via runRosinaTurn's injectable
 * chatFn/mcpClientFactory, exactly as in model.test.ts. Run with:
 *
 *   npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import { catalog } from './catalog';
import { runRosinaTurn, type McpClientLike } from './model';
import {
  checkInStatusFrom,
  DESCRIPTOR_KEYS,
  injectOverdueFlag,
  isCheckInOverdue,
  validatePrepareOrbitAlert,
  vocabularyMapFrom,
} from './orbit';
import { ACTION_TOOLS, buildSystemPrompt } from './systemPrompt';

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

/** Like scriptedChat, but also records every `messages` array it was called with, so a test can
 * inspect exactly what the model was shown (e.g. the tool-result content for a prior round). */
function recordingChat(script: ChatResult[]): { fn: (config: ProviderConfig, messages: ModelMessage[], tools?: ModelTool[], options?: unknown) => Promise<ChatResult>; seenMessages: ModelMessage[][] } {
  let i = 0;
  const seenMessages: ModelMessage[][] = [];
  const fn = async (_config: ProviderConfig, messages: ModelMessage[]) => {
    seenMessages.push(messages.map((m) => ({ ...m })));
    if (i >= script.length) throw new Error(`recordingChat: no more scripted turns (asked for turn ${i + 1}, script has ${script.length})`);
    return script[i++];
  };
  return { fn, seenMessages };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ChatResult['toolCalls'][number] {
  return { id, name, args: JSON.stringify(args) };
}

const ORBIT_TOOLS: McpTool[] = [
  { name: 'CheckInStatus', description: 'read', inputSchema: {} },
  { name: 'OrbitStatus', description: 'read', inputSchema: {} },
  { name: 'OrbitVocabulary', description: 'read', inputSchema: {} },
];

/** A stub MCP client whose callTool is scripted by exact tool name -> result; records every call
 * so a test can assert the client was (or was not) actually invoked, and with what args. */
function stubOrbitMcp(byTool: Partial<Record<string, McpToolCall>>): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return ORBIT_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return byTool[name] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

const VOCAB_OK: McpToolCall = {
  data: {
    orbitVocabulary: [
      { kind: 'WEAR_COLOR', value: 'YELLOW' },
      { kind: 'WEAR_GARMENT', value: 'RAINCOAT' },
      { kind: 'CARRY_COLOR', value: 'PURPLE' },
      { kind: 'CARRY_ITEM', value: 'BACKPACK' },
      { kind: 'HAIR', value: 'BROWN_PONYTAIL' },
    ],
  },
  errors: [],
  isError: false,
  raw: null,
};

function checkInOk(overrides: Partial<{ recorded: boolean; dueAt: string; guidance: string }> = {}): McpToolCall {
  return {
    data: { checkInStatus: { recorded: false, dueAt: '2020-01-01T16:00:00Z', guidance: 'If this is an emergency, call 911.', ...overrides } },
    errors: [],
    isError: false,
    raw: null,
  };
}

// --- Overdue logic (src/rosina/orbit.ts#isCheckInOverdue) ---

test('overdue: due time passed and not recorded is overdue', () => {
  assert.equal(isCheckInOverdue({ recorded: false, dueAt: '2026-01-01T16:00:00Z' }, new Date('2026-01-01T17:00:00Z')), true);
});

test('overdue: due time in the future is never overdue, even unrecorded', () => {
  assert.equal(isCheckInOverdue({ recorded: false, dueAt: '2026-01-01T16:00:00Z' }, new Date('2026-01-01T15:00:00Z')), false);
});

test('overdue: a recorded check-in is never overdue, even past its due time', () => {
  assert.equal(isCheckInOverdue({ recorded: true, dueAt: '2026-01-01T16:00:00Z' }, new Date('2026-01-01T17:00:00Z')), false);
});

test('overdue: never inferred from recorded=false alone — no dueAt at all means not overdue', () => {
  assert.equal(isCheckInOverdue({ recorded: false, dueAt: null }, new Date('2099-01-01T00:00:00Z')), false);
});

test('checkInStatusFrom/injectOverdueFlag parse and attach defensively', () => {
  const parsed = checkInStatusFrom({ checkInStatus: { recorded: false, dueAt: '2020-01-01T16:00:00Z' } });
  assert.deepEqual(parsed, { recorded: false, dueAt: '2020-01-01T16:00:00Z' });
  assert.equal(checkInStatusFrom({ somethingElse: true }), null);
  const injected = injectOverdueFlag({ checkInStatus: { recorded: false, dueAt: '2020-01-01T16:00:00Z' } }, true) as { checkInStatus: { overdue: boolean } };
  assert.equal(injected.checkInStatus.overdue, true);
  assert.deepEqual(injectOverdueFlag({ somethingElse: true }, true), { somethingElse: true }, 'unrelated shapes pass through unchanged');
});

// --- Vocabulary mapping (gather) ---

test('vocabularyMapFrom parses a real OrbitVocabulary result into kind -> values', () => {
  const map = vocabularyMapFrom(VOCAB_OK.data);
  assert.deepEqual([...map.get('WEAR_COLOR')!], ['YELLOW']);
  assert.deepEqual([...map.get('CARRY_ITEM')!], ['BACKPACK']);
  assert.equal(vocabularyMapFrom({ nothing: true }).size, 0, 'a malformed shape fails closed to an empty map, never a throw');
});

test('validatePrepareOrbitAlert accepts a "yellow raincoat, purple backpack" mapping once every value is vocabulary-confirmed', () => {
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const parents = new Set(['p_nora']);
  const result = validatePrepareOrbitAlert({ childId: 'p_nora', wearColor: 'YELLOW', wearGarment: 'RAINCOAT', carryColor: 'PURPLE', carryItem: 'BACKPACK' }, parents, vocab);
  assert.deepEqual(result, { ok: true, args: { childId: 'p_nora', wearColor: 'YELLOW', wearGarment: 'RAINCOAT', carryColor: 'PURPLE', carryItem: 'BACKPACK' } });
});

test('validatePrepareOrbitAlert refuses an unknown/unmapped color value (never guessed, never substituted)', () => {
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const parents = new Set(['p_nora']);
  const result = validatePrepareOrbitAlert({ childId: 'p_nora', wearColor: 'MAUVE' }, parents, vocab);
  assert.deepEqual(result, { ok: false, reason: 'VALUE_NOT_IN_VOCABULARY' });
});

test('validatePrepareOrbitAlert refuses a wrong-kind value (a real vocabulary value used under the wrong descriptor key)', () => {
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const parents = new Set(['p_nora']);
  // 'RAINCOAT' is a real WEAR_GARMENT value, never confirmed as a WEAR_COLOR — must still refuse.
  const result = validatePrepareOrbitAlert({ childId: 'p_nora', wearColor: 'RAINCOAT' }, parents, vocab);
  assert.deepEqual(result, { ok: false, reason: 'VALUE_NOT_IN_VOCABULARY' });
});

test('validatePrepareOrbitAlert never invents unsupplied fields — only what was actually passed comes back', () => {
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const parents = new Set(['p_nora']);
  const result = validatePrepareOrbitAlert({ childId: 'p_nora', wearColor: 'YELLOW' }, parents, vocab);
  assert.deepEqual(result, { ok: true, args: { childId: 'p_nora', wearColor: 'YELLOW' } });
});

test('validatePrepareOrbitAlert refuses a caller with no verified parent authority for this child', () => {
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const result = validatePrepareOrbitAlert({ childId: 'p_nora', wearColor: 'YELLOW' }, new Set(), vocab);
  assert.deepEqual(result, { ok: false, reason: 'NOT_PARENT' });
});

test('a place (or any other unlisted key) never even reaches the catalog shape check — no location field exists to accept it', () => {
  const withPlace = catalog.prepareOrbitAlert.argsSchema.parse({ childId: 'p_nora', location: 'near Lincoln School' });
  assert.equal(withPlace, null, '"near Lincoln School" has nowhere to go in the shape at all');
  const withAnotherPlace = catalog.prepareOrbitAlert.argsSchema.parse({ childId: 'p_nora', wearColor: "by Hartwell's" });
  // The catalog only checks SHAPE (a short non-empty string) — vocabulary membership is the
  // separate, dynamic check proven above; a place-like string passed AS a descriptor is shape-
  // valid here but still refused by validatePrepareOrbitAlert for not being a confirmed value.
  assert.notEqual(withAnotherPlace, null);
  const vocab = vocabularyMapFrom(VOCAB_OK.data);
  const result = validatePrepareOrbitAlert(withAnotherPlace as { childId: string; wearColor?: string }, new Set(['p_nora']), vocab);
  assert.deepEqual(result, { ok: false, reason: 'VALUE_NOT_IN_VOCABULARY' });
});

test('orbit.ts DESCRIPTOR_KEYS matches the catalog\'s own accepted descriptor keys (no drift between the two gates)', () => {
  for (const key of DESCRIPTOR_KEYS) {
    const probe = catalog.prepareOrbitAlert.argsSchema.parse({ childId: 'p_nora', [key]: 'x' });
    assert.notEqual(probe, null, `catalog must accept descriptor key "${key}"`);
  }
});

// --- Card shape / no-activate-path / integration through runRosinaTurn ---

test('card: a valid, fully-verified prepareOrbitAlert is gated correctly but never included — UNIMPLEMENTED until Codex\'s app handler exists', async () => {
  const mcp = stubOrbitMcp({ CheckInStatus: checkInOk({ recorded: true }), OrbitVocabulary: VOCAB_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CheckInStatus', { childId: 'p_nora' }), toolCall('c2', 'OrbitVocabulary', {})] }),
    chatResult({ toolCalls: [toolCall('c3', 'proposeAction_prepareOrbitAlert', { childId: 'p_nora', wearColor: 'YELLOW', wearGarment: 'RAINCOAT' })] }),
    chatResult({ content: 'Here is a card to prepare an Orbit alert.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.deepEqual(result.actions, [], 'never returned as a real action — the catalog marks it implemented: false');
  const evidence = result.toolCalls.find((t) => t.kind === 'action' && t.name === 'prepareOrbitAlert');
  assert.deepEqual(evidence?.errorCodes, ['UNIMPLEMENTED'], 'the gate itself passed cleanly; only the implemented flag blocks it');
});

test('card: refused for a child the caller has no verified parent authority over this turn', async () => {
  const mcp = stubOrbitMcp({ OrbitVocabulary: VOCAB_OK });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'OrbitVocabulary', {})] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_prepareOrbitAlert', { childId: 'p_nora', wearColor: 'YELLOW' })] }),
    chatResult({ content: 'card' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  const evidence = result.toolCalls.find((t) => t.kind === 'action' && t.name === 'prepareOrbitAlert');
  assert.deepEqual(evidence?.errorCodes, ['NOT_PARENT'], 'no same-turn successful CheckInStatus call for this exact child ever happened');
});

test('card: refused for a descriptor value never confirmed by this turn\'s OrbitVocabulary call', async () => {
  const mcp = stubOrbitMcp({ CheckInStatus: checkInOk({ recorded: true }) });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CheckInStatus', { childId: 'p_nora' })] }),
    chatResult({ toolCalls: [toolCall('c2', 'proposeAction_prepareOrbitAlert', { childId: 'p_nora', wearColor: 'YELLOW' })] }),
    chatResult({ content: 'card' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  const evidence = result.toolCalls.find((t) => t.kind === 'action' && t.name === 'prepareOrbitAlert');
  assert.deepEqual(evidence?.errorCodes, ['VALUE_NOT_IN_VOCABULARY'], 'OrbitVocabulary was never called this turn, so nothing is confirmed');
});

test('no activate path exists: an activate-shaped tool name is refused like any other disallowed MCP tool, and nothing in the catalog or action tools can activate anything', async () => {
  const mcp = stubOrbitMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'OrbitActivateAlert', { childId: 'p_nora' })] }),
    chatResult({ content: "I can't do that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 0, 'an activate-shaped tool name must never reach the MCP client');
  assert.deepEqual(result.toolCalls[0], { round: 1, kind: 'refused', name: 'OrbitActivateAlert', argsPreview: { childId: 'p_nora' }, isError: true, errorCodes: ['TOOL_NOT_ALLOWED'] });

  for (const id of Object.keys(catalog)) assert.doesNotMatch(id, /activate/i, `catalog id "${id}" must not be an activate action`);
  for (const tool of ACTION_TOOLS) assert.doesNotMatch(tool.function.name, /activate/i, `action tool "${tool.function.name}" must not activate anything`);
});

test('911 guidance surfaces to the model exactly as the tool returned it, alongside a server-computed overdue flag', async () => {
  const mcp = stubOrbitMcp({ CheckInStatus: checkInOk({ dueAt: '2020-01-01T16:00:00Z', guidance: 'If this is an emergency, call 911.' }) });
  const { fn: chatFn, seenMessages } = recordingChat([
    chatResult({ toolCalls: [toolCall('c1', 'CheckInStatus', { childId: 'p_nora' })] }),
    chatResult({ content: "Nora's 4:00 check-in hasn't been recorded. If this is an emergency, call 911." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  const secondRoundMessages = seenMessages[1];
  const toolMessage = secondRoundMessages.find((m) => m.role === 'tool');
  assert.ok(toolMessage, 'the CheckInStatus tool result must have been appended before round 2');
  const content = JSON.parse(toolMessage!.content as string);
  assert.equal(content.checkInStatus.overdue, true, 'overdue is computed server-side, never left for the model to infer');
  assert.match(content.checkInStatus.guidance, /911/);
  assert.match(result.reply, /911/);
});

test('a routine question triggers no Orbit tool call at all — nothing forces Orbit from code', async () => {
  const mcp = stubOrbitMcp({});
  const chatFn = scriptedChat([chatResult({ content: 'Nothing is on the calendar for today.' })]);

  const result = await runRosinaTurn({ ...baseOptions, message: "what's on Nora's calendar today?", chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 0, 'answering a routine question never requires or triggers an Orbit tool call by itself');
  assert.deepEqual(result.toolCalls, []);
});

test('the system prompt explicitly instructs that a routine question is not itself a reason to bring up Orbit', () => {
  const prompt = buildSystemPrompt([{ id: 'p_nora', name: 'Nora Ellison' }], false, 'p_mom');
  assert.match(prompt, /NOT itself a reason to bring up Orbit/);
  assert.match(prompt, /I can help notify your approved village/);
  assert.match(prompt, /never infer it from/);
});
