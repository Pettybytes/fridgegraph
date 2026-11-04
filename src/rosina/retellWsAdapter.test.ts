import test from 'node:test';
import assert from 'node:assert/strict';
import { RetellBridge, type TurnRunner } from './retellBridge';
import {
  computeAcceptKey, createRetellWsHandler, encodeWsTextFrame, handleRetellWsUpgrade,
  retellCallIdFromUrl, sessionTokenFromUrl, WsFrameParser, type RetellWsSocket,
} from './retellWsAdapter';

const SECRET = 'test-only-bridge-secret';
const kendra = { personId: 'p_mom', childId: 'p_nora', childIds: ['p_nora', 'p_leo', 'p_max'], childName: 'Nora' };

class FakeSocket implements RetellWsSocket {
  sent: string[] = [];
  private messageCb: ((d: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  on(event: 'message' | 'close', cb: never) {
    if (event === 'message') this.messageCb = cb as (d: string) => void;
    else this.closeCb = cb as () => void;
  }
  receive(obj: unknown) { this.messageCb?.(JSON.stringify(obj)); }
  responses(): { response_id: number; content: string; content_complete: boolean }[] {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => m.response_type === 'response');
  }
  spoken(): string { return this.responses().map((r) => r.content).join(' '); }
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function makeBridge(runner?: TurnRunner) {
  const runTurn: TurnRunner = runner ?? (async (req) => {
    if (/malik/i.test(req.message)) {
      return { reply: 'Here is an option for Malik.', actions: [], intent: { description: 'Add an event for Malik', sourceFacts: ['invented'], childId: 'p_malik' } };
    }
    return { reply: 'fast model text', actions: [], intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'], affectedPeople: ['Nora Ellison'] } };
  });
  return new RetellBridge({ secret: SECRET, runTurn,
    writeProposal: async ({ intent }) => ({ intent: 'calendar.create', childId: intent.childId, sourceFacts: intent.sourceFacts, summary: intent.description, affectedPeople: intent.affectedPeople ?? [] }) });
}

function connect(bridge: RetellBridge, resolveSession: () => Promise<typeof kendra | null> | typeof kendra | null) {
  const socket = new FakeSocket();
  createRetellWsHandler({ bridge, secret: SECRET, resolveSession })(
    socket, { url: '/gate-b/llm/call-test?session=test-session-token', headers: {} });
  return socket;
}

test('websocket handshake math matches the RFC 6455 accept vector', () => {
  assert.equal(computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.equal(retellCallIdFromUrl('/gate-b/llm/call_abc123'), 'call_abc123');
  assert.equal(sessionTokenFromUrl('/gate-b/llm/call_abc123?session=tok123'), 'tok123');
});

test('frame parser reassembles a fragmented masked client message', () => {
  const messages: string[] = [];
  const parser = new WsFrameParser((t) => messages.push(t), () => {});
  const mask = Buffer.from([1, 2, 3, 4]);
  const frame = (fin: boolean, opcode: number, text: string) => {
    const p = Buffer.from(text);
    const masked = Buffer.from(p.map((b, i) => b ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | p.length]), mask, masked]);
  };
  parser.push(frame(false, 0x1, '{"interact'));
  parser.push(frame(true, 0x0, 'ion_type":"ping_pong"}'));
  assert.deepEqual(messages, ['{"interaction_type":"ping_pong"}']);
  const encoded = encodeWsTextFrame('hello');
  assert.equal(encoded[0], 0x81); assert.equal(encoded[1], 5); assert.equal(encoded.subarray(2).toString(), 'hello');
});

test('upgrade handler performs the 101 handshake and answers a framed turn end to end', async () => {
  const written: Buffer[] = [];
  const listeners = new Map<string, (arg: never) => void>();
  const rawSocket = {
    write: (b: Buffer) => { written.push(Buffer.from(b)); },
    on: (event: string, cb: (arg: never) => void) => { listeners.set(event, cb); },
    end: () => {}, destroy: () => {},
  };
  const handled = handleRetellWsUpgrade(
    { url: '/gate-b/llm/call_9?session=test-session-token', headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } },
    rawSocket, { bridge: makeBridge(), secret: SECRET, resolveSession: () => kendra });
  assert.equal(handled, true);
  assert.match(written[0].toString('utf8'), /101 Switching Protocols/);
  assert.match(written[0].toString('utf8'), /s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
  // One masked client text frame carrying a response_required turn.
  const payload = Buffer.from(JSON.stringify({ interaction_type: 'response_required', response_id: 3, transcript: [{ role: 'user', content: 'Add a pickup for Nora tomorrow' }] }));
  const mask = Buffer.from([9, 8, 7, 6]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  const head = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.concat([Buffer.from([0x81, 0x80 | 126]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(payload.length); return b; })()]);
  const frame = Buffer.concat([head, mask, masked]);
  listeners.get('data')!(frame as never);
  await tick();
  const frames = written.slice(1).map((b) => b.subarray(b[1] === 126 ? 4 : 2).toString('utf8'));
  assert.ok(frames.length >= 2);
  const spoken = frames.map((f) => JSON.parse(f).content as string).join(' ');
  assert.match(spoken, /Here's an option/);
  assert.doesNotMatch(spoken, /recorded|saved/i);
  // A non-gate-b upgrade path is not claimed.
  assert.equal(handleRetellWsUpgrade({ url: '/other', headers: {} }, rawSocket, { bridge: makeBridge(), secret: SECRET, resolveSession: () => kendra }), false);
});

test('handshake: call_details is answered with a config response', async () => {
  const socket = connect(makeBridge(), () => kendra);
  socket.receive({ interaction_type: 'call_details', call: { call_id: 'call_1' } });
  const first = JSON.parse(socket.sent[0]);
  assert.equal(first.response_type, 'config');
  assert.equal(first.config.auto_reconnect, true);
});

test('bound session: a spoken turn streams the grounded proposal and never claims a save', async () => {
  let runnerCalls = 0;
  const bridge = makeBridge(async (req) => { runnerCalls += 1;
    return { reply: 'fast model text', actions: [], intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'], affectedPeople: ['Nora Ellison'] } }; });
  const socket = connect(bridge, () => kendra);
  socket.receive({ interaction_type: 'call_details', call: { call_id: 'call_2' } });
  socket.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Please add a pickup for Nora tomorrow' }] });
  await tick();
  const spoken = socket.spoken();
  assert.equal(runnerCalls, 1);
  assert.match(spoken, /Let me check Nora's schedule/); // state 1 holding line, selected child
  assert.match(spoken, /Here's an option: Add 'Early dismissal pickup' tomorrow 12:30 PM/);
  assert.match(spoken, /Nothing has changed yet/);
  assert.doesNotMatch(spoken, /recorded|saved|booked/i); // no save claimed before the backend returns
  const last = socket.responses().at(-1)!;
  assert.equal(last.content_complete, true);
});

test('an unbound call is refused and the turn runner is never reached', async () => {
  let runnerCalls = 0;
  const bridge = makeBridge(async () => { runnerCalls += 1; return { reply: 'x', actions: [] }; });
  const socket = connect(bridge, () => null);
  socket.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Who picks Nora up today?' }] });
  await tick();
  assert.equal(runnerCalls, 0);
  assert.match(socket.spoken(), /can't verify this caller's session/i);
  assert.doesNotMatch(socket.spoken(), /Nora.*3:00|pickup today is/i);
});

test('a cross-family request is refused with no facts and no success language', async () => {
  const socket = connect(makeBridge(), () => kendra);
  socket.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Add an event for Malik tomorrow' }] });
  await tick();
  const spoken = socket.spoken();
  assert.match(spoken, /couldn't put that together, so nothing has changed/i);
  assert.doesNotMatch(spoken, /Here's an option|recorded|saved/i);
});

test('duplicate delivery of one response_id answers once from the bridge', async () => {
  let runnerCalls = 0;
  const bridge = makeBridge(async () => { runnerCalls += 1;
    return { reply: 'fast model text', actions: [], intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'] } }; });
  const socket = connect(bridge, () => kendra);
  const msg = { interaction_type: 'response_required', response_id: 7, transcript: [{ role: 'user', content: 'Add a pickup for Nora tomorrow' }] };
  socket.receive(msg);
  await tick();
  socket.receive(msg); // Retell redelivers the same response_required
  await tick();
  assert.equal(runnerCalls, 1, 'the bridge turn ran only once for a duplicated delivery');
});

test('interruption: a newer response_id cancels the in-flight response', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const bridge = makeBridge(async () => {
    calls += 1;
    if (calls === 1) await gate; // first turn hangs until the parent interrupts
    return { reply: 'fast model text', actions: [], intent: { description: "Add 'Early dismissal pickup' tomorrow 12:30 PM", sourceFacts: ['Nora has an early dismissal tomorrow at 12:30 PM'] } };
  });
  const socket = connect(bridge, () => kendra);
  socket.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Add a pickup for Nora tomorrow' }] });
  await tick();
  socket.receive({ interaction_type: 'response_required', response_id: 2, transcript: [{ role: 'user', content: 'Add a pickup for Nora tomorrow please' }] });
  await tick();
  release();
  await tick();
  const ids = socket.responses().map((r) => r.response_id);
  assert.ok(ids.length > 0 && ids.every((id) => id === 2), `only the interrupting turn is spoken, got ${ids}`);
});

test('reconnect: a fresh socket with the same bound session keeps serving turns', async () => {
  const bridge = makeBridge();
  const first = connect(bridge, () => kendra);
  first.receive({ interaction_type: 'call_details', call: { call_id: 'call_5' } });
  const cfg = first.sent.map((s) => JSON.parse(s)).find((m) => m.response_type === 'config');
  assert.equal(cfg.config.auto_reconnect, true);
  const second = connect(bridge, () => kendra);
  second.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Add a pickup for Nora tomorrow' }] });
  await tick();
  assert.match(second.spoken(), /Here's an option/);
});

test('unauthenticated socket: a wrong or missing ?key= is refused before the 101 handshake', () => {
  for (const url of ['/gate-b/llm/call_9?session=test-session-token', '/gate-b/llm/call_9?session=test-session-token&key=wrong']) {
    const written: Buffer[] = [];
    let destroyed = false;
    const rawSocket = {
      write: (b: Buffer) => { written.push(Buffer.from(b)); },
      on: () => {},
      end: () => {}, destroy: () => { destroyed = true; },
    };
    const handled = handleRetellWsUpgrade(
      { url, headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } },
      rawSocket, { bridge: makeBridge(), secret: SECRET, pathSecret: 'test-only-ws-secret', resolveSession: () => kendra });
    assert.equal(handled, true);
    assert.match(written[0].toString('utf8'), /401 Unauthorized/);
    assert.equal(destroyed, true);
  }
});

test('an expired binding is refused and the turn runner is never reached', async () => {
  let runnerCalls = 0;
  const bridge = makeBridge(async () => { runnerCalls += 1; return { reply: 'x', actions: [] }; });
  const socket = connect(bridge, () => null); // expired sessions resolve to null, same as unbound
  socket.receive({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Who picks Nora up today?' }] });
  await tick();
  assert.equal(runnerCalls, 0);
  assert.match(socket.spoken(), /can't verify this caller's session/i);
});
