/** Web client for "Pin it to the fridge" (backend: src/rosina/pinEndpoint.ts). Same shape as the
 * notice/invite live adapters: the caller's own bearer is forwarded on every request; Rosina holds no
 * identity of its own. The browser never sees a VisionClient or a server credential — it only sends
 * the (file-chosen) image and renders the server's typed proposal for the parent to confirm.
 *
 *   GET  /api/rosina/pin/readiness             -> { ready, reasons }   (unauthenticated capability probe)
 *   POST /api/rosina/pin/upload  {childId,mimeType,dataBase64} -> { assetId, mimeType }
 *   POST /api/rosina/pin         {childId,assetId,caption?,audience?,document?,concept?} -> proposal
 *   POST /api/rosina/pin/confirm {claims,signature,reviewed} -> { status:'PINNED', created, pin }
 *
 * The SAM crop in `segmentation` is render-only; it is NOT part of the signed claims. Editing the
 * caption or audience means re-preparing (a new signed proposal), never patching a signed one.
 */
export type PinAudience = 'PARENTS_ONLY' | 'SHARED'
export type PinConfidence = 'high' | 'medium' | 'low'
export type PinKind = 'drawing' | 'permission_slip' | 'report_card' | 'appointment_card' | 'other'
export type PinCrop = { x: number; y: number; width: number; height: number }
export type PinSegmentation =
  | { applied: true; source: 'SAM_3_1' | 'FIXTURE'; concept: string; crop: PinCrop; rotationDeg: number; confidence: number | null }
  | { applied: false; source: string; reason: string }
export type PinTextField = { value: string; source: { type: 'verified_quote'; quote: string } | { type: 'transcription'; text: string; ref: string } }
export type PinExtracted = {
  title: PinTextField | null; caption: string | null; date: string | null; startTime: string | null;
  place: PinTextField | null; term: PinTextField | null; event: PinTextField | null; dueDate: string | null; signatureRequired: boolean
}
export type PinClassification = { kind: PinKind; confidence: PinConfidence; uncertain: boolean; alternatives: { kind: PinKind; confidence: PinConfidence }[] }
export type PinProposal = { proposalId: string; version: number; expiresAt: string; claims: Record<string, unknown>; signature: string }
export type PinPrepareResult = {
  status: 'READY' | 'NEEDS_CLARIFICATION'
  clarification: { question: string } | null
  classification: PinClassification
  extracted: PinExtracted
  audience: { selected: PinAudience; options: readonly PinAudience[] }
  suggestions: { kind: 'appointment' | 'todo' | 'signature'; text: string }[]
  segmentation: PinSegmentation
  asset: { assetId: string; mimeType: string }
  proposal: PinProposal | null
}
export type PinnedResult = { status: 'PINNED'; created: boolean; pin: { id: string; childId: string; assetId: string; kind: string; audience: PinAudience; caption: string | null; extracted: PinExtracted | null } }

export type PinErrorCode =
  | 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'INVALID_REQUEST' | 'UNSUPPORTED_MEDIA_TYPE' | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_PROPOSAL' | 'PROPOSAL_EXPIRED' | 'ASSET_CHANGED' | 'CAPTION_REQUIRED' | 'PERSIST_FAILED' | 'NETWORK' | 'UNAVAILABLE'
export class PinError extends Error {
  code: PinErrorCode
  constructor(code: PinErrorCode) { super(code); this.name = 'PinError'; this.code = code }
}

const KNOWN = new Set<PinErrorCode>(['UNAUTHENTICATED', 'UNAUTHORIZED', 'INVALID_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE', 'INVALID_PROPOSAL', 'PROPOSAL_EXPIRED', 'ASSET_CHANGED', 'CAPTION_REQUIRED', 'PERSIST_FAILED'])

export const PIN_MESSAGE: Record<PinErrorCode, string> = {
  UNAUTHENTICATED: 'Your perspective needs a fresh session. Choose a perspective again.',
  UNAUTHORIZED: 'Only a parent or guardian of this child can pin to their fridge.',
  INVALID_REQUEST: 'That didn’t look like a photo I can read. Try another image.',
  UNSUPPORTED_MEDIA_TYPE: 'That file type isn’t supported. Use a PNG, JPEG or WebP photo.',
  PAYLOAD_TOO_LARGE: 'That image is too large. Try one under 10 MB.',
  INVALID_PROPOSAL: 'This review changed. Review the photo again before pinning.',
  PROPOSAL_EXPIRED: 'This review timed out. Review the photo again.',
  ASSET_CHANGED: 'This image is no longer available. Upload it again.',
  CAPTION_REQUIRED: 'Add a short caption so this has a label on the fridge.',
  PERSIST_FAILED: 'Couldn’t pin that just now. Try again.',
  NETWORK: 'Couldn’t connect just now. Try again.',
  UNAVAILABLE: 'Pinning isn’t available in this view just now.',
}

type Bearer = () => string | null | undefined
type Send = typeof fetch
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read the raw bytes of a chosen file as base64 (no data: prefix). */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export type PinIntakeClient = {
  readiness(signal?: AbortSignal): Promise<{ ready: boolean; reasons: string[] }>
  upload(input: { childId: string; file: File }, signal: AbortSignal): Promise<{ assetId: string; mimeType: string }>
  prepare(input: { childId: string; assetId: string; caption?: string; audience?: PinAudience; document?: boolean; concept?: string }, signal: AbortSignal): Promise<PinPrepareResult>
  confirm(input: { proposal: PinProposal; caption: string | null; extracted: PinExtracted }, signal: AbortSignal): Promise<PinnedResult>
}

export function createPinIntakeClient(getAccessToken: Bearer, send: Send = fetch): PinIntakeClient {
  async function post(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    const token = getAccessToken()
    if (!token) throw new PinError('UNAUTHENTICATED')
    let res: Response
    try { res = await send(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal, cache: 'no-store' }) }
    catch (e) { if (signal.aborted) throw e; throw new PinError('NETWORK') }
    let payload: unknown
    try { payload = await res.json() } catch { throw new PinError(res.ok ? 'UNAVAILABLE' : 'NETWORK') }
    if (!res.ok) {
      const code = obj(payload) && typeof payload.error === 'string' && KNOWN.has(payload.error as PinErrorCode) ? (payload.error as PinErrorCode) : 'UNAVAILABLE'
      throw new PinError(code)
    }
    return payload
  }
  return {
    async readiness(signal) {
      try {
        const res = await send('/api/rosina/pin/readiness', { signal, cache: 'no-store' })
        const body = (await res.json().catch(() => null)) as { ready?: unknown; reasons?: unknown } | null
        if (!res.ok || !body || typeof body.ready !== 'boolean') return { ready: false, reasons: ['unavailable'] }
        return { ready: body.ready, reasons: Array.isArray(body.reasons) ? body.reasons.map(String) : [] }
      } catch { return { ready: false, reasons: ['unavailable'] } }
    },
    async upload({ childId, file }, signal) {
      const dataBase64 = await fileToBase64(file)
      const body = await post('/api/rosina/pin/upload', { childId, mimeType: file.type, dataBase64 }, signal)
      if (!obj(body) || typeof body.assetId !== 'string') throw new PinError('UNAVAILABLE')
      return { assetId: body.assetId, mimeType: typeof body.mimeType === 'string' ? body.mimeType : file.type }
    },
    async prepare({ childId, assetId, caption, audience, document, concept }, signal) {
      const body = await post('/api/rosina/pin', { childId, assetId, caption, audience, document, concept }, signal)
      if (!obj(body) || (body.status !== 'READY' && body.status !== 'NEEDS_CLARIFICATION')) throw new PinError('UNAVAILABLE')
      return body as unknown as PinPrepareResult
    },
    async confirm({ proposal, caption, extracted }, signal) {
      const body = await post('/api/rosina/pin/confirm', { claims: proposal.claims, signature: proposal.signature, reviewed: { caption, extracted } }, signal)
      if (!obj(body) || body.status !== 'PINNED' || !obj(body.pin)) throw new PinError('UNAVAILABLE')
      return body as unknown as PinnedResult
    },
  }
}

export function pinErrorMessage(e: unknown): string {
  return e instanceof PinError ? PIN_MESSAGE[e.code] : PIN_MESSAGE.UNAVAILABLE
}

/** Fetch the fictional Lincoln Elementary permission-slip "phone photo" as a File, so a parent can
 *  run the real pipeline on a known document and see SAM 3.1 crop the paper off the counter. The
 *  image is a static demo asset in /public; it is fed through the same upload path as any photo. */
export const SAMPLE_SLIP_PATH = '/fridge/samples/lincoln-permission-slip-photo.png'
export async function sampleSlipFile(request: Send = fetch): Promise<File> {
  const res = await request(SAMPLE_SLIP_PATH, { cache: 'no-store' })
  if (!res.ok) throw new PinError('UNAVAILABLE')
  const blob = await res.blob()
  return new File([blob], 'lincoln-permission-slip-photo.png', { type: 'image/png' })
}
