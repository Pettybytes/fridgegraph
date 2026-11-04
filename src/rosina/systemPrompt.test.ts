/**
 * Guards the Orbit-preview wording. Now that #61 shipped the app's draft/preview/confirm
 * screen, Rosina must NOT say the action is unavailable, and must only promise she can
 * PREPARE a preview — a preview is "ready" only after the app's preview call returns.
 * Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt, ACTION_TOOLS, ACTION_TOOL_PREFIX } from './systemPrompt';

const prompt = buildSystemPrompt([{ id: 'child_1', scopes: new Set(), displayName: 'Nora' }], false, 'p_mom');
const prepareTool = ACTION_TOOLS.find((t) => t.function.name === `${ACTION_TOOL_PREFIX}prepareOrbitAlert`);
const toolText = prepareTool?.function.description ?? '';

test('the Orbit-preview wording no longer claims the action is unavailable in the live app', () => {
  assert.ok(!/not (yet )?available in the live app/i.test(prompt), 'system prompt still says unavailable');
  assert.ok(!/not (yet )?available in the live app/i.test(toolText), 'tool description still says unavailable');
  assert.ok(!/say plainly it isn.t yet/i.test(prompt), 'system prompt still tells Rosina to say it isn’t live');
});

test('Rosina may say she can PREPARE, and only that a preview is READY after it returns', () => {
  assert.match(prompt, /PREPARE a preview/);
  assert.match(prompt, /READY after the app's preview has actually returned/);
  assert.match(toolText, /PREPARE a preview/);
  assert.match(toolText, /READY once the app has actually returned it/);
});

test('"who is picking up" leads with the schedule, never with "no one is confirmed"', () => {
  assert.match(prompt, /answered by the effective schedule FIRST/);
  assert.match(prompt, /Never open with "no one is confirmed" when the schedule names/);
  assert.match(prompt, /coordination request is a secondary note/i);
});
