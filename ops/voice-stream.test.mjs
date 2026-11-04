import assert from 'node:assert/strict';
import { test } from 'node:test';
const module = await import('./voice-stream.mjs').catch(() => null);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve }; };
const audio = new Uint8Array([1, 2, 3, 4]);
const input = { audio: Buffer.from('clip'), contentType: 'audio/webm', history: [], bearer: 'test-only', signal: new AbortController().signal };

test('no provisional audio escapes before the authoritative final guard, then audio streams before later speech completes', async () => {
  assert.ok(module?.voiceTurnEvents, 'streaming voice transport is not implemented');
  const finalGate = deferred(), laterAudio = deferred();
  const events = [], requested = [];
  const work = (async () => {
    for await (const event of module.voiceTurnEvents(input, {
      transcribe: async () => ({ transcript: 'Question' }),
      rosinaStream: async function* () { yield { event: 'token', data: { text: 'A grounded answer. ' } }; await finalGate.promise; yield { event: 'final', data: { reply: 'A grounded answer. More detail.', actions: [] } }; },
      synthesize: async function* (text) { requested.push(text); if (text === 'More detail.') await laterAudio.promise; yield audio; },
    })) events.push(event);
  })();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(requested, ['A grounded answer.']);
  assert.equal(events.some(e => e.type === 'audio'), false);
  finalGate.resolve(); await new Promise(r => setTimeout(r, 20));
  assert.ok(events.some(e => e.type === 'audio'), 'first phrase plays before the later phrase completes');
  laterAudio.resolve(); await work;
  assert.equal(events.filter(e => e.type === 'audio').length, 2);
});

test('a late output-guard replacement discards every speculative byte', async () => {
  assert.ok(module?.voiceTurnEvents, 'streaming voice transport is not implemented');
  const events = [];
  for await (const event of module.voiceTurnEvents(input, {
    transcribe: async () => ({ transcript: 'Question' }),
    rosinaStream: async function* () { yield { event: 'token', data: { text: 'The untrusted answer. ' } }; yield { event: 'replace', data: {} }; yield { event: 'final', data: { reply: 'I can only help with children shared with you.', actions: [] } }; },
    synthesize: async function* (text) { yield new TextEncoder().encode(text); },
  })) events.push(event);
  const spoken = events.filter(e => e.type === 'audio').map(e => Buffer.from(e.audioBase64, 'base64').toString()).join('');
  assert.equal(spoken, 'I can only help with children shared with you.');
  assert.ok(!spoken.includes('untrusted'));
});

test('provider repetitions are preserved and final proposal fields survive voice transport unchanged', async () => {
  assert.ok(module?.voiceTurnEvents, 'streaming voice transport is not implemented');
  const proposal = { id: 'proposal-only', childId: 'p_nora', version: 2 };
  const events = [];
  for await (const event of module.voiceTurnEvents(input, {
    transcribe: async () => ({ transcript: 'No no, keep it at seven.' }),
    rosinaStream: async function* () { yield { event: 'final', data: { reply: 'Ready for review.', actions: [], calendarProposal: proposal } }; },
    synthesize: async function* () { yield audio; },
  })) events.push(event);
  assert.equal(events.find(e => e.type === 'transcript').text, 'No no, keep it at seven.');
  assert.deepEqual(events.find(e => e.type === 'final').data.calendarProposal, proposal);
});
