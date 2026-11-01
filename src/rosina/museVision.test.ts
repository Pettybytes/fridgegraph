/**
 * The vision suggestions were incomplete (evidence 64: only wearColor/carryColor/carryItem; no
 * wearGarment or hair, with ZERO values dropped). The request previously gave the model the five
 * KEYS but not each kind's allowed VALUES, and did not explicitly ask it to consider every kind.
 * The parse and the vocabulary mapping are correct; this change is to the request only — it now
 * supplies each kind's allowed values and asks the model to consider all five kinds (omitting any
 * it cannot see). Whether that improves the live output is for Bentley to measure; unknowns stay
 * permitted. These tests pin the request (all five kinds + their values) and the response parsing.
 * Run with: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMuseVisionClient, MUSE_VISION_MODEL } from './museVision';

const vocab = new Map<string, ReadonlySet<string>>([
  ['WEAR_COLOR', new Set(['yellow', 'red'])],
  ['WEAR_GARMENT', new Set(['raincoat', 'hoodie'])],
  ['HAIR', new Set(['braids', 'short'])],
  ['CARRY_COLOR', new Set(['green'])],
  ['CARRY_ITEM', new Set(['backpack'])],
]);
const image = { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' };

test('the vision request lists all five kinds AND each kind’s allowed values', async () => {
  let sentBody: unknown = null;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sentBody = JSON.parse(String(init.body));
    return { ok: true, json: async () => ({ model: MUSE_VISION_MODEL, choices: [{ message: { content: '{"descriptors":[],"textInImage":[]}' } }] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const client = createMuseVisionClient({ apiKey: 'k', baseUrl: 'https://api.meta.ai/v1', fetchFn });
  await client.describe({ image, childId: 'c', vocabularyByKind: vocab });

  const body = sentBody as { messages: { role: string; content: string | { type: string; text?: string }[] }[] };
  const system = String(body.messages[0].content);
  const userText = (body.messages[1].content as { type: string; text?: string }[]).find((p) => p.type === 'text')?.text ?? '';

  assert.match(system, /CONSIDER ALL FIVE/);
  for (const key of ['wearColor', 'wearGarment', 'hair', 'carryColor', 'carryItem']) assert.ok(userText.includes(key), `missing kind ${key}`);
  // the actual allowed values are in the prompt, so the model can pick in-vocabulary ones
  for (const value of ['yellow', 'red', 'raincoat', 'hoodie', 'braids', 'short', 'green', 'backpack']) assert.ok(userText.includes(value), `missing value ${value}`);
});

test('a kind the model omits stays omitted (unknown via the existing contract, never forced)', async () => {
  // The model returns wearGarment + hair (now in-vocabulary) but no carryItem — it is not invented.
  const fetchFn = (async () => ({ ok: true, json: async () => ({ model: MUSE_VISION_MODEL, choices: [{ message: { content: JSON.stringify({ descriptors: [{ key: 'wearGarment', value: 'Raincoat' }, { key: 'hair', value: 'braids' }], textInImage: ['keep out'] }) } }] }) }) as unknown as Response) as unknown as typeof fetch;
  const client = createMuseVisionClient({ apiKey: 'k', baseUrl: 'https://api.meta.ai/v1', fetchFn });
  const res = await client.describe({ image, childId: 'c', vocabularyByKind: vocab });
  assert.deepEqual(res.descriptors, [{ key: 'wearGarment', value: 'raincoat' }, { key: 'hair', value: 'braids' }]); // lowercased, no carryItem invented
  assert.deepEqual(res.textInImage, ['keep out']); // image text preserved as data
  assert.equal(res.source, 'live');
});
