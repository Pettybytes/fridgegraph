/**
 * Gate B - Retell custom-LLM WebSocket adapter.
 *
 * Retell's custom-LLM engine requires a WebSocket speaking its protocol
 * (call_details / update_only / response_required / response chunks). The
 * Gate B bridge (ops/gate-b-bridge.mjs) exposed only HTTP routes, so a call
 * pointed at it died with error_llm_websocket_open. This adapter is the
 * missing ingress: it terminates Retell's websocket, resolves the bound
 * FridgeGraph session for the call, forwards each spoken turn to
 * RetellBridge.handle, and streams the reply back as Retell response chunks.
 *
 * Boundaries kept:
 * - Authorization comes only from the bound session token carried in the
 *   websocket URL (?session=<token from POST /gate-b/bind>). The token is a
 *   secret: it is resolved in memory, never logged, never stored.
 * - Proposals still enter only through RetellBridge's trusted Muse writer;
 *   this layer never builds, confirms or executes an action (executed:false).
 * - Spoken content is the bridge's canonical one-assistant line. If a bridge
 *   body ever claimed execution, the spoken line is replaced with the
 *   state-4 refusal instead of repeating a save that did not happen.
 */
import { createHash } from 'node:crypto';
import { RetellBridge, signPayload, type BridgeSession } from './retellBridge';

export type RetellWsSocket = {
  send(data: string): void;
  on(event: 'message', listener: (data: string) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
};

export type RetellWsInfo = {
  /** Full request URL (path + query) of the websocket upgrade. */
  url: string;
  headers: Record<string, string>;
};

export type RetellWsDeps = {
  bridge: RetellBridge;
  /** Bridge HMAC secret, supplied from the process env at runtime only. */
  secret: string;
  /** Resolve the bound session for this call; null refuses the call. */
  resolveSession: (info: {
    callId: string | null;
    sessionToken: string | null;
    url: string;
    headers: Record<string, string>;
  }) => Promise<BridgeSession | null> | BridgeSession | null;
};

const UNBOUND_LINE = "I can't verify this caller's session, so I can't help with family information.";
const REMINDER_LINE = "I'm still here. How can I help today?";

/** Retell appends /{call_id} to llm_websocket_url; the path is /gate-b/llm/{call_id}. */
export function retellCallIdFromUrl(url: string): string | null {
  const path = url.split('?')[0];
  const m = path.match(/\/gate-b\/llm\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionTokenFromUrl(url: string): string | null {
  const q = url.split('?')[1];
  if (!q) return null;
  return new URLSearchParams(q).get('session');
}

function sentenceChunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function createRetellWsHandler(deps: RetellWsDeps) {
  return function handleRetellWsConnection(socket: RetellWsSocket, info: RetellWsInfo): void {
    let callId = retellCallIdFromUrl(info.url);
    let session: BridgeSession | null | undefined; // undefined = not resolved yet
    let turn = 0;
    const answered = new Map<number, string[]>();

    async function resolve(): Promise<BridgeSession | null> {
      if (session !== undefined) return session;
      session = await deps.resolveSession({
        callId,
        sessionToken: sessionTokenFromUrl(info.url),
        url: info.url,
        headers: info.headers,
      });
      return session;
    }

    function sendChunks(responseId: number, chunks: string[]): void {
      chunks.forEach((content, i) => {
        socket.send(JSON.stringify({
          response_type: 'response',
          response_id: responseId,
          content,
          content_complete: i === chunks.length - 1,
        }));
      });
    }

    async function answer(responseId: number, message: string): Promise<void> {
      const bound = await resolve();
      if (!bound) {
        sendChunks(responseId, [UNBOUND_LINE]);
        return;
      }
      turn += 1;
      const raw = JSON.stringify({ callId: callId ?? 'unknown-call', turn, message, session: bound });
      const ts = Date.now();
      const out = await deps.bridge.handle(raw, {
        'x-bridge-timestamp': String(ts),
        'x-bridge-signature': signPayload(deps.secret, ts, raw),
      });
      const body = out.body;
      // Never speak a save the backend has not returned: the bridge never
      // executes, and if a future body claimed otherwise we refuse the line.
      const reply = body.executed ? "I couldn't put that together, so nothing has changed." : body.reply;
      const chunks = [
        ...(body.holdingLine && body.actions.length ? sentenceChunks(body.holdingLine) : []),
        ...sentenceChunks(reply),
      ];
      answered.set(responseId, chunks);
      sendChunks(responseId, chunks);
    }

    socket.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data) as Record<string, unknown>; } catch { return; }
      const type = msg.interaction_type;
      if (type === 'call_details') {
        const call = msg.call as { call_id?: string } | undefined;
        if (call?.call_id) callId = call.call_id;
        socket.send(JSON.stringify({ response_type: 'config', config: { auto_reconnect: true, call_details: false } }));
        return;
      }
      if (type === 'ping_pong') {
        socket.send(JSON.stringify({ response_type: 'ping_pong', timestamp: msg.timestamp }));
        return;
      }
      if (type === 'update_only') return;
      if (type === 'response_required' || type === 'reminder_required') {
        const responseId = typeof msg.response_id === 'number' ? msg.response_id : 0;
        if (answered.has(responseId)) { sendChunks(responseId, answered.get(responseId)!); return; }
        const transcript = Array.isArray(msg.transcript) ? msg.transcript as { role?: string; content?: string }[] : [];
        const lastUser = [...transcript].reverse().find((t) => t.role === 'user')?.content?.trim() ?? '';
        if (type === 'reminder_required' || !lastUser) { sendChunks(responseId, [REMINDER_LINE]); return; }
        void answer(responseId, lastUser).catch(() => sendChunks(responseId, ["I couldn't put that together, so nothing has changed."]));
      }
    });
    socket.on('close', () => { answered.clear(); });
  };
}

/* ------------------------------------------------------------------ */
/* Minimal RFC 6455 framing (no new dependency; the repo has no `ws`). */
/* ------------------------------------------------------------------ */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function computeAcceptKey(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

export function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  if (len < 126) return Buffer.concat([Buffer.from([0x81, len]), payload]);
  if (len < 65536) {
    const head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2);
    return Buffer.concat([head, payload]);
  }
  const head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([head, payload]);
}

export type WsControlFrame = { opcode: number; payload: Buffer };

/** Incremental parser for client frames: reassembles fragmented text
 *  messages and surfaces control frames (ping/close) to the caller. */
export class WsFrameParser {
  private buf: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  constructor(
    private onMessage: (text: string) => void,
    private onControl: (frame: WsControlFrame) => void,
  ) {}

  push(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = (this.buf[0] & 0x80) !== 0;
      const opcode = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); offset = 10; }
      if (len > 4_000_000) throw new Error('WS_FRAME_TOO_LARGE');
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < offset + maskLen + len) return;
      let payload = this.buf.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = this.buf.subarray(offset, offset + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      } else payload = Buffer.from(payload);
      this.buf = this.buf.subarray(offset + maskLen + len);
      if (opcode >= 0x8) { this.onControl({ opcode, payload }); continue; }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          if (opcode !== 0x2 || full) this.onMessage(full);
        }
      }
    }
  }
}

type RawSocket = {
  write(data: Buffer): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  end(): unknown;
  destroy(): unknown;
};

/** Terminate an HTTP upgrade request as a Retell custom-LLM websocket. */
export function handleRetellWsUpgrade(
  req: { url?: string; headers: Record<string, string | string[] | undefined> },
  rawSocket: RawSocket,
  deps: RetellWsDeps,
): boolean {
  const url = req.url ?? '';
  if (!url.split('?')[0].startsWith('/gate-b/llm')) return false;
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || !key) { rawSocket.destroy(); return true; }
  rawSocket.write(Buffer.from(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n\r\n`, 'utf8'));
  const listeners: Record<string, ((arg: never) => void)[]> = { message: [], close: [] };
  const parser = new WsFrameParser(
    (text) => listeners.message.forEach((f) => f(text as never)),
    ({ opcode, payload }) => {
      if (opcode === 0x9) { // ping -> pong
        const head = Buffer.from([0x8a, payload.length]);
        rawSocket.write(Buffer.concat([head, payload]));
      } else if (opcode === 0x8) { // close
        rawSocket.write(Buffer.from([0x88, 0x00]));
        rawSocket.end();
        listeners.close.forEach((f) => f(undefined as never));
      }
    },
  );
  rawSocket.on('data', (chunk: never) => { try { parser.push(chunk as Buffer); } catch { rawSocket.destroy(); } });
  rawSocket.on('close', () => listeners.close.forEach((f) => f(undefined as never)));
  rawSocket.on('error', () => listeners.close.forEach((f) => f(undefined as never)));
  const socket: RetellWsSocket = {
    send: (data) => { rawSocket.write(encodeWsTextFrame(data)); },
    on: (event, listener) => { listeners[event].push(listener as (arg: never) => void); },
  };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
  createRetellWsHandler(deps)(socket, { url, headers });
  return true;
}
