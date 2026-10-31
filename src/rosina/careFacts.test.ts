/**
 * Unit tests for TASK R-CARE (CareFacts added to the Rosina allowlist, the CONFIRMED/
 * PROVISIONAL/empty prompt wording) plus its TASK R-MYCHILDREN follow-up: the old,
 * CareFacts-only `careOnlyChildren` roster supplement is gone — Priya's real grant on Malik is
 * now expressed purely as a `careplan.read`-scoped entry MyChildren reports fresh each turn (see
 * `src/rosina/model.test.ts` for the generic per-child scope-gating tests this file no longer
 * duplicates). No network call. Run with:
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

const CARE_TOOLS: McpTool[] = [{ name: 'CareFacts', description: 'read', inputSchema: {} }];

function myChildren(entries: Array<{ id: string; scopes: string[] }>): McpToolCall {
  return { data: { myChildren: entries.map((e) => ({ child: { id: e.id }, scopes: e.scopes })) }, errors: [], isError: false, raw: null };
}

/** `myChildrenResult` answers the eager MyChildren call every turn makes; `byChild` answers
 * CareFacts by exact childId. */
function stubMcp(myChildrenResult: McpToolCall, byChild: Record<string, McpToolCall> = {}): McpClientLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async initialize() {},
    async listTools() {
      return CARE_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'MyChildren') return myChildrenResult;
      const childId = String(args.childId ?? '');
      return byChild[childId] ?? { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
}

const baseOptions = { message: 'test', currentRoute: '#/mission-control', history: [], bearer: 'unused-test-token', personId: 'p_mom', isGuide: false, provider: 'meta' as const, mcpUrl: 'http://unused/mcp', providerConfig: FAKE_CONFIG };

const KENDRA_HAS_NORA = myChildren([{ id: 'p_nora', scopes: ['schedule.read', 'careplan.read', 'pickup.request', 'pickup.verify'] }]);
const PRIYA_HAS_MALIK_AND_NORA = myChildren([{ id: 'p_malik', scopes: ['careplan.read'] }, { id: 'p_nora', scopes: ['careplan.read', 'schedule.read'] }]);

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

// --- allowlist + pre-call id/scope authorization (TASK R-MYCHILDREN) ---

test('a known own-child CareFacts call reaches MCP (careplan.read reported by MyChildren)', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: NORA_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_nora' })] }),
    chatResult({ content: 'The recorded snack rule is peanut-free, confirmed by Kendra.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 2, 'MyChildren, then CareFacts');
  assert.match(result.reply, /peanut-free/i);
});

test('an out-of-scope child id is refused BEFORE MCP is ever called (ID authorization is a code rule)', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA);
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_emma' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'only MyChildren — p_emma is not p_mom\'s and was never handed back by any tool this turn');
  const refused = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.deepEqual(refused, { round: 1, kind: 'refused', name: 'CareFacts', argsPreview: { childId: 'p_emma' }, isError: true, errorCodes: ['OUT_OF_SCOPE_ID'] });
});

test('Priya\'s real careplan.read grant on Malik (reported fresh by MyChildren) lets CareFacts(p_malik) reach MCP, even though he is not her documented child', async () => {
  const mcp = stubMcp(PRIYA_HAS_MALIK_AND_NORA, { p_malik: MALIK_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: 'The recorded snack rule: no peanut butter, confirmed by Dwayne.' }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 2, 'MyChildren, then CareFacts');
  assert.match(result.reply, /no peanut butter/i);
  assert.equal(result.outputGuardTriggered, false, 'Malik is grounded via this turn\'s own CareFacts result text, not flagged as a leak');
});

test('the SAME p_malik id is refused pre-call for a caller MyChildren reports no grant for', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_malik: MALIK_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_mom', chatFn, mcpClientFactory: () => mcp });

  assert.equal(mcp.calls.length, 1, 'Kendra\'s own fresh MyChildren has no entry for Malik, unlike Priya\'s');
  const refused = result.toolCalls.find((t) => t.name === 'CareFacts');
  assert.deepEqual(refused?.errorCodes, ['OUT_OF_SCOPE_ID']);
});

test('an authorized-but-empty CareFacts result is answered plainly, no false claim', async () => {
  const mcp = stubMcp(KENDRA_HAS_NORA, { p_nora: EMPTY_FACTS });
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_nora' })] }),
    chatResult({ content: "I can't see a recorded rule for that." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.reply, "I can't see a recorded rule for that.");
  assert.equal(result.outputGuardTriggered, false);
});

// --- output guard: CareFacts never returns the CHILD's own name (only the verifier's), so
// "Malik" is ungrounded for EVERYONE unless MyChildren itself supplies a displayName — even for
// Priya, who genuinely has the grant and whose call genuinely succeeds. ---

test('output guard: "Malik" is flagged even for Priya\'s own successful CareFacts(p_malik) call — the tool result never names the child, only the verifier', async () => {
  const priyaMcp = stubMcp(PRIYA_HAS_MALIK_AND_NORA, { p_malik: MALIK_FACTS });
  const priyaChat = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "Malik's recorded snack rule is no peanut butter." }),
  ]);
  const priyaResult = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn: priyaChat, mcpClientFactory: () => priyaMcp });
  assert.equal(priyaResult.outputGuardTriggered, true, 'the real call succeeded, but nothing this turn ever supplied the string "Malik"');

  const danaMcp = stubMcp(myChildren([{ id: 'p_jax', scopes: ['schedule.read', 'careplan.read'] }]));
  const danaChat = scriptedChat([chatResult({ content: 'Malik has a peanut allergy, I recall.' })]);
  const danaResult = await runRosinaTurn({ ...baseOptions, personId: 'p_dana', chatFn: danaChat, mcpClientFactory: () => danaMcp });
  assert.equal(danaResult.outputGuardTriggered, true, 'Dana never called CareFacts for Malik this turn either — same outcome, same reason');
});

test('output guard: a MyChildren displayName (future-correct contract) grounds "Malik" where the CareFacts result alone cannot', async () => {
  const mcp: McpClientLike & { calls: unknown[] } = {
    calls: [],
    async initialize() {},
    async listTools() {
      return CARE_TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      if (name === 'MyChildren') return { data: { myChildren: [{ child: { id: 'p_malik', person: { displayName: 'Malik Ferris' } }, scopes: ['careplan.read'] }] }, errors: [], isError: false, raw: null };
      if (name === 'CareFacts' && args.childId === 'p_malik') return MALIK_FACTS;
      return { data: null, errors: [{ message: 'NO_SUCH_FIXTURE' }], isError: true, raw: null };
    },
  };
  const chatFn = scriptedChat([
    chatResult({ toolCalls: [toolCall('c1', 'CareFacts', { childId: 'p_malik' })] }),
    chatResult({ content: "Malik Ferris's recorded snack rule is no peanut butter." }),
  ]);

  const result = await runRosinaTurn({ ...baseOptions, personId: 'p_priya', chatFn, mcpClientFactory: () => mcp });

  assert.equal(result.outputGuardTriggered, false, 'MyChildren\'s own displayName this turn grounds "Malik Ferris"');
});

// --- system prompt wording ---

test('the system prompt states the exact CONFIRMED / PROVISIONAL / empty-result CareFacts wording', () => {
  const children: ChildAccess[] = [{ id: 'p_nora', scopes: new Set(['careplan.read']), displayName: null }];
  const prompt = buildSystemPrompt(children, false, 'p_mom');
  assert.match(prompt, /CONFIRMED: say so plainly and cite who confirmed it/);
  assert.match(prompt, /PROVISIONAL: say plainly it is recorded but not yet confirmed/);
  assert.match(prompt, /I can't see a recorded rule for that/);
  assert.match(prompt, /Never "there is no rule"/);
});

test('the system prompt forbids inventing severity, medical conclusions or TV titles', () => {
  const children: ChildAccess[] = [{ id: 'p_nora', scopes: new Set(['careplan.read']), displayName: null }];
  const prompt = buildSystemPrompt(children, false, 'p_mom');
  assert.match(prompt, /never invent an allergy's severity, a medical\s*\n?\s*conclusion, an approved TV show\/title/);
});

test('care is no longer in the NOT-connected list; school and directory still are', () => {
  const children: ChildAccess[] = [{ id: 'p_nora', scopes: new Set(['careplan.read']), displayName: null }];
  const prompt = buildSystemPrompt(children, false, 'p_mom');
  assert.doesNotMatch(prompt, /no care-plan read exists yet/);
  assert.match(prompt, /School reports, messages from the school/);
  assert.match(prompt, /village-directory details/);
});

test('a careplan.read-only entry is shown with its own narrow scope, not the full set', () => {
  const children: ChildAccess[] = [
    { id: 'p_malik', scopes: new Set(['careplan.read']), displayName: null },
    { id: 'p_nora', scopes: new Set(['careplan.read', 'schedule.read']), displayName: null },
  ];
  const prompt = buildSystemPrompt(children, false, 'p_priya');
  assert.match(prompt, /p_malik.*scopes = careplan\.read(?!,)/);
  assert.match(prompt, /never infer a broader scope from a narrower one/);
});
