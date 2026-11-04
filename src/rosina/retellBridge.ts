import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Isolated Retell <-> Rosina bridge core (feat/rosina-retell).
 *
 * Design contract, deliberately vendor-thin until a Retell key/agent is reachable:
 * - Retell (browser voice on a cloned Coco Pink agent) owns conversation speed only.
 *   It never receives a database token or family graph.
 * - Each in-call tool request carries a short-lived FridgeGraph session binding
 *   (personId + the child in focus + the caller's authorized child ids), issued by
 *   the authenticated app session. A phone number, call id or transcript alone is
 *   NOT identity and is rejected.
 * - The bridge verifies an HMAC signature + timestamp window over the raw body,
 *   dedupes by (callId, turn) so Retell/Twilio redelivery cannot re-run the model
 *   or double-propose, and delegates reasoning to the existing Rosina turn runner.
 * - The bridge NEVER executes a write. It returns a structured proposal flagged
 *   requiresConfirmation; the existing app proposal -> confirm -> authorized
 *   mutation path (PR #266/#272) is the only writer.
 *
 * Wiring still required before any live use (see receipt): confirm Retell's actual
 * webhook/tool signature scheme against the cloned agent, bind the session token
 * issuer to the real session endpoint, and mount this behind the Rosina server.
 */

export type BridgeSession = { personId: string; childId: string; childIds: string[] };
export type BridgeAction = { id: string; args: Record<string, unknown> };
export type TurnResult = { reply: string; actions: BridgeAction[] };
export type TurnRequest = { message: string; session: BridgeSession; callId: string; turn: number };
export type TurnRunner = (req: TurnRequest) => Promise<TurnResult>;

export type BridgeResponse = {
  status: number;
  body: { reply: string; actions: BridgeAction[]; requiresConfirmation: boolean; executed: false; duplicate?: true };
};

const MAX_SKEW_MS = 5 * 60_000;

export function signPayload(secret: string, timestamp: number, raw: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
}

function signatureOk(secret: string, headers: Record<string, string>, raw: string): boolean {
  const ts = Number(headers['x-bridge-timestamp']);
  const sig = headers['x-bridge-signature'];
  if (!Number.isFinite(ts) || !sig) return false;
  if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = signPayload(secret, ts, raw);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

type Payload = {
  callId?: unknown; turn?: unknown; message?: unknown; event?: unknown;
  session?: BridgeSession;
};

export class RetellBridge {
  private receipts = new Map<string, BridgeResponse['body']>();
  constructor(private deps: { secret: string; runTurn: TurnRunner }) {}

  pendingReceipts(): number { return this.receipts.size; }

  async handle(raw: string, headers: Record<string, string>): Promise<BridgeResponse> {
    const refuse = (status: number, reply: string): BridgeResponse =>
      ({ status, body: { reply, actions: [], requiresConfirmation: false, executed: false } });
    if (!signatureOk(this.deps.secret, headers, raw)) return refuse(401, 'Unsigned or stale request.');
    let p: Payload;
    try { p = JSON.parse(raw) as Payload; } catch { return refuse(400, 'Malformed request.'); }
    if (typeof p.callId !== 'string' || typeof p.turn !== 'number') return refuse(400, 'Missing call identity.');
    const key = `${p.callId}:${p.turn}`;
    if (p.event === 'call_ended') {
      for (const k of [...this.receipts.keys()]) if (k.startsWith(`${p.callId}:`)) this.receipts.delete(k);
      return { status: 200, body: { reply: '', actions: [], requiresConfirmation: false, executed: false } };
    }
    const prior = this.receipts.get(key);
    if (prior) return { status: 200, body: { ...prior, duplicate: true } };
    const s = p.session;
    if (!s || typeof s.personId !== 'string' || typeof s.childId !== 'string' || !Array.isArray(s.childIds)) {
      return refuse(400, 'No bound FridgeGraph session. A phone number is not authorization.');
    }
    if (typeof p.message !== 'string' || !p.message.trim()) return refuse(400, 'Empty turn.');
    const result = await this.deps.runTurn({ message: p.message, session: s, callId: p.callId, turn: p.turn });
    const body: BridgeResponse['body'] = {
      reply: result.reply,
      actions: result.actions,
      requiresConfirmation: result.actions.length > 0,
      executed: false,
    };
    this.receipts.set(key, body);
    return { status: 200, body };
  }
}
