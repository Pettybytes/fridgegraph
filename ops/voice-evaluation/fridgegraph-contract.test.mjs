/** Actual FridgeGraph handler -> Python evaluator, with provider boundaries stubbed. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createBrowserVoiceRoutes } from '../voice-browser.mjs';
import { validateActions } from '../../src/rosina/catalog.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(directory, 'test_cases/fridgegraph_capture.json'), 'utf8'));

function evaluate(capture) {
  const dir = mkdtempSync(join(tmpdir(), 'fridgegraph-voice-eval-'));
  try {
    const path = join(dir, 'capture.json');
    writeFileSync(path, JSON.stringify(capture));
    return spawnSync(process.env.PYTHON ?? 'python3', [join(directory, 'fridgegraph_capture.py'), '--capture', path], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('fixture actions pass the real FridgeGraph action catalog', () => {
  for (const item of fixture.cases) {
    assert.deepEqual(validateActions(item.expected_actions), item.expected_actions);
  }
});

test('actual voice route timings flow into the evaluator without becoming playback proof', async () => {
  let elapsed = 0;
  const actions = fixture.cases[1].expected_actions;
  const routes = createBrowserVoiceRoutes({
    verify: async () => ({ ok: true, personId: 'p_mom' }),
    allow: () => true,
    now: () => elapsed,
    transcribe: async () => { elapsed += 200; return { ok: true, transcript: 'Open the calendar for Thursday.' }; },
    rosinaTurn: async () => { elapsed += 600; return { ok: true, reply: 'Here is Thursday.', actions }; },
    speak: async () => { elapsed += 400; return { ok: true, audio: Buffer.from('test-only'), mimeType: 'audio/mpeg' }; },
  });
  const req = Readable.from([Buffer.from('test-only audio')]);
  req.headers = { 'content-type': 'audio/webm', authorization: 'Bearer test-only' };
  req.url = '/voice/turn';
  req.method = 'POST';
  const res = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.dispatch(req, res);
  assert.equal(res.status, 200);
  const observed = JSON.parse(res.body);
  const capture = { ...fixture, cases: [{ ...fixture.cases[1], observation: observed, limits_ms: { server_total_ms: 1500 } }] };
  const result = evaluate(capture);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.named_latency.server_total_ms.p95_ms, 1200);
  assert.equal(report.named_latency.asr_ms.p95_ms, 200);
  assert.equal(report.named_latency.rosina_ms.p95_ms, 600);
  assert.equal(report.named_latency.tts_ms.p95_ms, 400);
  assert.equal(report.named_latency.decision_to_playback_ms, undefined);
  assert.equal(report.response_latency.count, 0);
  assert.equal(report.interruption_stop.count, 0);

  capture.cases[0].limits_ms.decision_to_playback_ms = 3000;
  const missingPlayback = evaluate(capture);
  assert.equal(missingPlayback.status, 1, missingPlayback.stderr);
  const failed = JSON.parse(missingPlayback.stdout);
  assert.equal(failed.results.measurements[0].checks.decision_to_playback_ms, false);
});
