import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSamBox, createFixtureSegmenter, createSamSegmenter, buildPinSegmenter, type PinSegmentation } from './pinSegment';
import type { ProviderConfig } from '../muse/providers';

const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };
const provider = { baseUrl: 'https://api.meta.ai/v1', apiKey: 'test-key', model: 'sam-3.1' } as ProviderConfig;
// One SAM record for a still: frame 0, box in pixels of a 1000x800 frame, with confidence.
const SAM_LINE = '<0f>1<|box;x1=140;y1=88;x2=860;y2=712;w=1000;h=800;c=0.95|><|mask;x=0;y=0;c=0.95;data=20,20,!payload|>';
const responsesBody = (text: string, model = 'sam-3.1') => ({ model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const okFetch = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

test('parseSamBox reads box fields by key and normalizes nothing (pixels in)', () => {
  const box = parseSamBox(SAM_LINE);
  assert.deepEqual(box, { x1: 140, y1: 88, x2: 860, y2: 712, w: 1000, h: 800, c: 0.95 });
});

test('parseSamBox picks the highest-confidence match and skips malformed boxes', () => {
  const two = '<0f>1<|box;x1=0;y1=0;x2=10;y2=10;w=100;h=100;c=0.30|><|mask;x=0;y=0;data=2,2,!p|>,2<|box;x1=5;y1=5;x2=90;y2=90;w=100;h=100;c=0.80|><|mask;x=0;y=0;data=2,2,!p|>';
  assert.equal(parseSamBox(two)?.c, 0.8);
  // x2<=x1 is malformed and ignored.
  assert.equal(parseSamBox('<0f>1<|box;x1=50;y1=0;x2=10;y2=80;w=100;h=100|><|mask;x=0;y=0;data=2,2,!p|>'), null);
});

test('parseSamBox reads a box with no confidence field (include_confidence off)', () => {
  const box = parseSamBox('<0f>1<|box;x1=10;y1=20;x2=30;y2=60;w=100;h=100|><|mask;x=0;y=0;data=2,2,!p|>');
  assert.deepEqual(box, { x1: 10, y1: 20, x2: 30, y2: 60, w: 100, h: 100, c: null });
});

test('fixture: a document gets a crop + straighten; a plain photo skips SAM', async () => {
  const seg = createFixtureSegmenter();
  const doc = await seg({ image: img, concept: 'permission slip', isDocument: true });
  assert.equal(doc.applied, true);
  if (doc.applied) { assert.equal(doc.source, 'FIXTURE'); assert.ok(doc.rotationDeg !== 0); assert.ok(doc.crop.width > 0 && doc.crop.width <= 1); }
  const photo = await seg({ image: img, concept: 'sheet of paper', isDocument: false });
  assert.equal(photo.applied, false);
  if (!photo.applied) assert.equal(photo.reason, 'plain photo');
});

test('live SAM: a box becomes a normalized crop with confidence + model provenance', async () => {
  const seg = createSamSegmenter({ provider, fetchFn: okFetch(responsesBody(SAM_LINE, 'sam-3.1-2026')) });
  const out = await seg({ image: img, concept: 'permission slip', isDocument: true });
  assert.equal(out.applied, true);
  if (out.applied) {
    assert.equal(out.source, 'SAM_3_1');
    assert.equal(out.model, 'sam-3.1-2026');
    assert.equal(out.confidence, 0.95);
    assert.equal(out.rotationDeg, 0); // never fabricated from an axis-aligned box
    assert.ok(Math.abs(out.crop.x - 0.14) < 1e-9 && Math.abs(out.crop.width - 0.72) < 1e-9);
  }
});

test('live SAM: a plain photo never calls the model', async () => {
  let called = false;
  const seg = createSamSegmenter({ provider, fetchFn: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch });
  const out = await seg({ image: img, concept: 'sheet of paper', isDocument: false });
  assert.equal(called, false);
  assert.equal(out.applied, false);
});

test('live SAM: HTTP error, transport failure and no-paper all fall back to uncropped (never throw)', async () => {
  const httpErr = createSamSegmenter({ provider, fetchFn: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch });
  const a = await httpErr({ image: img, concept: 'x', isDocument: true });
  assert.equal(a.applied, false); if (!a.applied) assert.match(a.reason, /sam http 503/);

  const threw = createSamSegmenter({ provider, fetchFn: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
  const b = await threw({ image: img, concept: 'x', isDocument: true });
  assert.equal(b.applied, false); if (!b.applied) assert.equal(b.reason, 'sam unavailable');

  const empty = createSamSegmenter({ provider, fetchFn: okFetch(responsesBody('<0f>')) });
  const c = await empty({ image: img, concept: 'x', isDocument: true });
  assert.equal(c.applied, false); if (!c.applied) assert.equal(c.reason, 'no paper found');
});

test('buildPinSegmenter: fixture unless PIN_LIVE=1', async () => {
  const offline = buildPinSegmenter({ env: {} as NodeJS.ProcessEnv });
  const o = await offline({ image: img, concept: 'permission slip', isDocument: true });
  assert.equal(o.applied && o.source, 'FIXTURE');

  // resolveProvider reads process.env (like buildPinExtractor), so exercise the live switch there.
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { PIN_LIVE: '1', ROSINA_PROVIDER: 'meta', META_API_KEY: 'k', META_BASE_URL: 'https://api.meta.ai/v1', META_MODEL_ID: 'sam-3.1' });
    const live = buildPinSegmenter({ fetchFn: okFetch(responsesBody(SAM_LINE)) });
    const l: PinSegmentation = await live({ image: img, concept: 'permission slip', isDocument: true });
    assert.equal(l.applied && l.source, 'SAM_3_1');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
