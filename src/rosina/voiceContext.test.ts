import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRosinaTurn, type McpClientLike, type RosinaTurnOptions } from './model';
import type { ModelMessage } from '../muse/providers';
import { SCOPED_REFUSAL } from './outputGuard';

const config = { id: 'meta' as const, label: 'test', baseUrl: 'http://unused', model: 'test', apiKey: 'unused' };
const children = [
  { child: { id: 'p_nora', person: { displayName: 'Nora Ellison' } }, scopes: ['schedule.read', 'pickup.request'] },
  { child: { id: 'p_leo', person: { displayName: 'Leo Ellison' } }, scopes: ['schedule.read'] },
];
function options(onMessages: (m: ModelMessage[]) => void): RosinaTurnOptions {
  const mcp: McpClientLike = {
    async initialize() {}, async listTools() { return []; },
    async callTool() { return { data: { myChildren: children }, errors: [], isError: false, raw: null }; },
  };
  return { message: 'What is on the calendar this week?', currentRoute: '#/ask-rosina', history: [],
    bearer: 'test-only', personId: 'p_mom', isGuide: false, provider: 'meta', mcpUrl: 'http://unused',
    providerConfig: config, mcpClientFactory: () => mcp,
    chatFn: async (_config, messages) => { onMessages(messages); return { content: 'Your calendar.', toolCalls: [], usage: {}, latencyMs: 1, messageKeys: [], usageKeys: [], rawSummary: { status: 200 } }; },
  };
}
test('selected child is explicit model context, without removing other authorized children', async () => {
  let messages: ModelMessage[] = [];
  await runRosinaTurn({ ...options(m => { messages = m; }), selectedChildId: 'p_nora' } as RosinaTurnOptions);
  const text = messages.map(m => m.content).join('\n');
  assert.match(text, /SELECTED CHILD[^]*p_nora/);
  assert.match(text, /explicit[^]*authorized child/i);
  assert.match(text, /p_leo/);
});
test('forged selected child fails before the model is invoked', async () => {
  let invoked = false;
  const result = await runRosinaTurn({ ...options(() => { invoked = true; }), selectedChildId: 'p_unshared' } as RosinaTurnOptions);
  assert.equal(result.reply, SCOPED_REFUSAL);
  assert.equal(invoked, false);
});
