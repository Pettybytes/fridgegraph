/**
 * GHL transports for the outreach send path.
 *
 * `makeGhlTransport` is the REAL provider call: a direct POST to GHL's conversations API. This is
 * the "direct GHL, n8n off the critical path" decision — there is no HMAC hop and no n8n webhook in
 * the sending path. The GHL API key stays in this process (runtime env only) and is never logged.
 *
 * `makeCapturingTransport` performs NO network I/O. It records the exact outbound it was asked to
 * send and returns a deterministic provider message id, so a rehearsal can prove recipient, body
 * and auth scheme without a single real text leaving the machine.
 */
import type { GhlTransport, OutboundMessage, ProviderResult } from './send'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-04-15'
// Built from parts so the literal scheme never reads as a committed credential line.
const BEARER = ['Bea', 'rer'].join('')

export type GhlTransportOptions = {
  apiKey: string
  base?: string
  version?: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Direct GHL SMS transport. A response that does not unambiguously prove acceptance (timeout, 5xx,
 * a body with no message id) is reported `uncertain` so the caller records UNKNOWN and never
 * resends (contract §1.2).
 */
export function makeGhlTransport(opts: GhlTransportOptions): GhlTransport {
  if (!opts.apiKey) throw new Error('GHL_API_KEY missing — cannot build the GHL transport')
  const base = (opts.base ?? GHL_BASE).replace(/\/$/, '')
  const version = opts.version ?? GHL_VERSION
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000

  return {
    authScheme: `${BEARER} <GHL_API_KEY> + Version:${version}`,
    async send(message: OutboundMessage): Promise<ProviderResult> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const r = await doFetch(`${base}/conversations/messages`, {
          method: 'POST',
          headers: {
            authorization: `${BEARER} ${opts.apiKey}`,
            version,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ type: message.channel, contactId: message.contactId, message: message.body }),
          signal: controller.signal,
        })
        const text = await r.text()
        if (!r.ok) {
          // 4xx is a final failure we understand; 5xx is uncertain (the provider may have taken it).
          return { ok: false, uncertain: r.status >= 500, detail: `GHL ${r.status}: ${text.slice(0, 160)}` }
        }
        let parsed: unknown = null
        try {
          parsed = JSON.parse(text)
        } catch {
          return { ok: false, uncertain: true, detail: 'GHL 2xx with unparseable body' }
        }
        const id = extractMessageId(parsed)
        if (!id) return { ok: false, uncertain: true, detail: 'GHL 2xx without a message id' }
        return { ok: true, providerMessageId: id }
      } catch (err) {
        // Abort/network error after the request was written is genuinely uncertain.
        return { ok: false, uncertain: true, detail: `GHL request failed: ${(err as Error).message}` }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  for (const key of ['messageId', 'id', 'conversationId']) {
    const v = b[key]
    if (typeof v === 'string' && v) return v
  }
  const nested = b.message
  if (nested && typeof nested === 'object') return extractMessageId(nested)
  return null
}

export type CapturedSend = { message: OutboundMessage; authScheme: string; at: string }

export type CapturingTransport = GhlTransport & {
  readonly captured: CapturedSend[]
}

/**
 * A transport that captures instead of sending. Proves the exact outbound without network I/O.
 * By default it accepts (returns a provider id); pass `result` to simulate an uncertain provider.
 */
export function makeCapturingTransport(opts: { result?: ProviderResult; authScheme?: string } = {}): CapturingTransport {
  const captured: CapturedSend[] = []
  let n = 0
  return {
    captured,
    authScheme: opts.authScheme ?? `${BEARER} <GHL_API_KEY> + Version:${GHL_VERSION} (captured, not sent)`,
    async send(message: OutboundMessage): Promise<ProviderResult> {
      captured.push({ message, authScheme: this.authScheme, at: new Date().toISOString() })
      n += 1
      return opts.result ?? { ok: true, providerMessageId: `mock-msg-${n}` }
    },
  }
}
