/**
 * Unit tests for TASK R-CARE (CareFacts added to the Rosina allowlist, the CareFacts-only roster
 * supplement for a real multi-child grant, and the CONFIRMED/PROVISIONAL/empty prompt wording).
 * No network call. Run with:
 *   npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpTool, McpToolCall } from '../muse/mcp';
import type { ChatResult, ModelMessage, ModelTool, ProviderConfig } from '../muse/providers';
import { runRosinaTurn, type McpClientLike } from './model';
import { careOnlyChildren, scopedRoster } from './roster';
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

const CARE_TOOLS: McpTool[] = [{ name: 'CareFacts', description: 'read', inputSchema: {} }];

function stubMcp(byChild: Record<string, McpToolCall>): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return CARE_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const childId = String(args.childId ?? '');
      return byChild[childId] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

const NORA_FACTS: McpToolCall = {
  data: {
    careFacts: [
      { id: 'fx_cf_nora_snack', key: 'snack', value: 'Peanut-free snack only', source: { kind: 'PARENT_CONVERSATION', ref: 'Kendra, care conversation 2026-10-12' }, verifiedBy: { id: 'p_mom' }, verifiedAt: '2026-10-12T18:00:00Z', confidence: 'CONFIRMED' },
    ],
  },
  errors: [],
  isError: false,
  raw: null,
};

const MALIK_FACTS: McpToolCall = {
  data: {
    careFacts: [
      { id: 'fx_cf_malik_snack', key: 'snack', value: 'No peanut butter', source: { kind: 'PARENT_CONVERSATION', ref: 'Dwayne, care conversation 2026-10-20' }, verifiedBy: { id: 'p_dwayne' }, verifiedAt: '2026-10-20T17:00:00Z', confidence: 'CONFIRMED' },
    ],
  },
  errors: [],
  isError: false,
  raw: null,
};

const EMPTY_FACTS: McpToolCall = { data: { careFacts: [] }, errors: [], isError: false, raw: null };

// --- roster.ts#careOnlyChildren ---

test('careOnlyChildren: Priya has exactly one extra care-only child, Malik', () => {
  assert.deepEqual(careOnlyChildren('p_priya', false), [{ id: 'p_malik', name: 'Malik' }]);
});

test('careOnlyChildren: everyone else gets none, including the Demo guide (she already sees every sandbox child)', () => {
  assert.deepEqual(careOnlyChildren('p_mom', false), []);
  assert.deepEqual(careOnlyChildren('p_dana', false), []);
  assert.deepEqual(careOnlyChildren('p_priya', true), []);
});

// --- allowlist + pre-call id authorization ---

test('a known own-child CareFacts call reaches MCP (allowlisted, in roster)', async () => {
  const mcp = stubMcp({ p_nora: NORA_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_nora' })] }),
    chatResult({ content: "Nora's recorded snack rule: peanut-free, confirmed by Kendra." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1);
  assert.match(result.reply, /peanut-free/i);
});

test('an out-of-scope child id is refused BEFORE MCP is ever called (ID authorization is a code rule)', async () => {
  const mcp = stubMcp({});
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_emma' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 0, 'p_emma is not p_mom\'s own child and was never handed back by any tool this turn');
  assert.deepEqual(result.toolCalls[0], { round: 1, kind: 'refused', name: 'CareFacts', argsPreview: { childId: 'p_emma' }, isError: true, errorCodes: ['OUT_OF_SCOPE_ID'] });
});

test('Priya\'s care-only grant lets a CareFacts(p_malik) call actually reach MCP, even though Malik is not her documented child', async () => {
  const mcp = stubMcp({ p_malik: MALIK_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "Malik's recorded snack rule: no peanut butter, confirmed by Dwayne." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'p_malik is in Priya\'s care-only roster, so the pre-call gate lets it through');
  assert.match(result.reply, /no peanut butter/i);
  assert.equal(result.outputGuardTriggered, false, 'Malik is grounded via the care-only roster the guard was given, not flagged as a leak');
});

test('the SAME p_malik id is still refused pre-call for a caller with no care-only grant for him', async () => {
  const mcp = stubMcp({ p_malik: MALIK_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_mom', chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 0, 'Kendra has no care-only grant for Malik, unlike Priya');
  assert.deepEqual(result.toolCalls[0].errorCodes, ['OUT_OF_SCOPE_ID']);
});

test('an authorized-but-empty CareFacts result is answered plainly, no false claim', async () => {
  const mcp = stubMcp({ p_nora: EMPTY_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_nora' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, "I can't see a recorded rule for that.");
  assert.equal(result.outputGuardTriggered, false);
});

// --- output guard: Malik is grounded by the care-only roster union, not a leak ---

test('output guard: a reply naming Malik is NOT flagged for Priya (care-only roster), but WOULD be for someone with no such grant', async () => {
  const priyaMcp = stubMcp({ p_malik: MALIK_FACTS });
  const priyaChat = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "Malik's recorded snack rule is no peanut butter." }),
  ]);
  const priyaResult = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn: priyaChat, mcpClientFactory: () => priyaMcp });
  assert.equal(priyaResult.outputGuardTriggered, false);
  assert.match(priyaResult.reply, /Malik/);

  const danaMcp = stubMcp({});
  const danaChat = scriptedChat([chatResult({ content: 'Malik has a peanut allergy, I recall.' })]);
  const danaResult = await runRosinaTurn({ ...baseOptions, personId: 'p_dana', chatFn: danaChat, mcpClientFactory: () => danaMcp });
  assert.equal(danaResult.outputGuardTriggered, true, 'Dana has no care-only grant for Malik and no tool result mentioning him — naming him is a leak');
});

// --- system prompt wording ---

test('the system prompt states the exact CONFIRMED / PROVISIONAL / empty-result CareFacts wording', () => {
  const prompt = buildSystemPrompt(scopedRoster('p_mom', false), false, 'p_mom');
  assert.match(prompt, /CONFIRMED: say so plainly and cite who confirmed it/);
  assert.match(prompt, /PROVISIONAL: say plainly it is recorded but not yet confirmed/);
  assert.match(prompt, /I can't see a recorded rule for that/);
  assert.match(prompt, /Never "there is no rule"/);
});

test('the system prompt forbids inventing severity, medical conclusions or TV titles', () => {
  const prompt = buildSystemPrompt(scopedRoster('p_mom', false), false, 'p_mom');
  assert.match(prompt, /never invent an allergy's severity, a medical\s*\n?\s*conclusion, an approved TV show\/title/);
});

test('care is no longer in the NOT-connected list; school and directory still are', () => {
  const prompt = buildSystemPrompt(scopedRoster('p_mom', false), false, 'p_mom');
  assert.doesNotMatch(prompt, /no care-plan read exists yet/);
  assert.match(prompt, /School reports, messages from the school/);
  assert.match(prompt, /village-directory details/);
});

test('Priya\'s system prompt lists Malik as a care-only exception, framed narrowly', () => {
  const prompt = buildSystemPrompt(scopedRoster('p_priya', false), false, 'p_priya', careOnlyChildren('p_priya', false));
  assert.match(prompt, /FOR CARE QUESTIONS ONLY/);
  assert.match(prompt, /\bMalik\b/);
  assert.match(prompt, /NO other knowledge about them/);
});

test('a caller with no care-only grant gets no such paragraph at all', () => {
  const prompt = buildSystemPrompt(scopedRoster('p_mom', false), false, 'p_mom', careOnlyChildren('p_mom', false));
  assert.doesNotMatch(prompt, /FOR CARE QUESTIONS ONLY/);
});
