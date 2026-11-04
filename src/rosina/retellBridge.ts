import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildActionProposal, deriveIdempotencyKey, type RosinaActionProposal } from './actionContract';

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
/** Raw action intent from the turn runner; the bridge turns it into the shared contract. */
export type BridgeActionInput = {
  intent: string;
  childId?: string;
  sourceFacts: string[];
  summary: string;
  args?: Record<string, unknown>;
  affectedPeople?: string[];
};
export type GatheredIntent = { description: string; sourceFacts: string[]; childId?: string; affectedPeople?: string[] };
export type TurnResult = { reply: string; actions: BridgeActionInput[]; intent?: GatheredIntent };
export type TurnRequest = { message: string; session: BridgeSession; callId: string; turn: number };
export type TurnRunner = (req: TurnRequest) => Promise<TurnResult>;

export type BridgeResponse = {
  status: number;
  body: {
    reply: string; actions: RosinaActionProposal[]; requiresConfirmation: boolean; executed: false; duplicate?: true;
    /** Which model produced what: the fast voice model may answer and gather intent; only Muse authors proposals. */
    attribution: { reply: 'retell-model'; proposal?: 'muse-sonnet' };
    proposalUnavailable?: true;
  };
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
  constructor(private deps: {
    secret: string; runTurn: TurnRunner;
    /** Muse Spark proposal writer. The fast voice model gathers intent; only this writes proposals. */
    writeProposal?: (input: { intent: GatheredIntent; session: BridgeSession; message: string }) => Promise<BridgeActionInput | null>;
  }) {}

  pendingReceipts(): number { return this.receipts.size; }

  async handle(raw: string, headers: Record<string, string>): Promise<BridgeResponse> {
    const refuse = (status: number, reply: string): BridgeResponse =>
      ({ status, body: { reply, actions: [], requiresConfirmation: false, executed: false, attribution: { reply: 'retell-model' } } });
    if (!signatureOk(this.deps.secret, headers, raw)) return refuse(401, 'Unsigned or stale request.');
    let p: Payload;
    try { p = JSON.parse(raw) as Payload; } catch { return refuse(400, 'Malformed request.'); }
    if (typeof p.callId !== 'string' || typeof p.turn !== 'number') return refuse(400, 'Missing call identity.');
    const key = `${p.callId}:${p.turn}`;
    if (p.event === 'call_ended') {
      for (const k of [...this.receipts.keys()]) if (k.startsWith(`${p.callId}:`)) this.receipts.delete(k);
      return { status: 200, body: { reply: '', actions: [], requiresConfirmation: false, executed: false, attribution: { reply: 'retell-model' } } };
    }
    const prior = this.receipts.get(key);
    if (prior) return { status: 200, body: { ...prior, duplicate: true } };
    const s = p.session;
    if (!s || typeof s.personId !== 'string' || typeof s.childId !== 'string' || !Array.isArray(s.childIds)) {
      return refuse(400, 'No bound FridgeGraph session. A phone number is not authorization.');
    }
    if (typeof p.message !== 'string' || !p.message.trim()) return refuse(400, 'Empty turn.');
    let result: TurnResult;
    try { result = await this.deps.runTurn({ message: p.message, session: s, callId: p.callId, turn: p.turn }); }
    catch { return refuse(502, 'Rosina is unavailable right now. Nothing was changed.'); }
    // Every voice action must satisfy the shared action contract; anything
    // ungrounded or outside the caller's authorized children is dropped here,
    // before it can be spoken of as a proposal.
    const actionInputs: BridgeActionInput[] = [...result.actions];
    let proposalUnavailable: true | undefined;
    if (result.intent && this.deps.writeProposal) {
      try {
        const written = await this.deps.writeProposal({ intent: result.intent, session: s, message: p.message });
        if (written) actionInputs.push(written);
      } catch { proposalUnavailable = true; }
    } else if (result.intent) { proposalUnavailable = true; }
    const actions: RosinaActionProposal[] = [];
    actionInputs.forEach((a, i) => {
      const built = buildActionProposal({
        channel: 'voice',
        actorPersonId: s.personId,
        authorizedChildIds: s.childIds,
        childId: a.childId ?? s.childId,
        intent: a.intent,
        sourceFacts: a.sourceFacts,
        proposedChange: { summary: a.summary, args: a.args },
        affectedPeople: a.affectedPeople ?? [],
        idempotencyKey: deriveIdempotencyKey([p.callId as string, p.turn as number, i, a.intent, a.summary]),
      });
      if (built.ok) actions.push(built.proposal);
    });
    const body: BridgeResponse['body'] = {
      reply: result.reply,
      actions,
      requiresConfirmation: actions.length > 0,
      executed: false,
      attribution: { reply: 'retell-model', ...(actions.length ? { proposal: 'muse-sonnet' as const } : {}) },
      ...(proposalUnavailable ? { proposalUnavailable } : {}),
    };
    this.receipts.set(key, body);
    return { status: 200, body };
  }
}
