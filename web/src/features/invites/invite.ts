/**
 * UI contract for POST /api/rosina/invite. The endpoint is not enabled by this feature.
 *
 * `hostName` and `message` are app-owned fields, never extracted or returned by the backend
 * (the backend contract only covers childFirstName/occasion/date/time/placeLabel). They exist
 * so the card can show who is hosting and a personal note; the app fills sensible defaults and
 * the family can edit them. The model never sees or generates these strings.
 */
export type InviteEvent = {
  childFirstName: string
  occasion: string
  date: string | null
  startTime: string | null
  endTime: string | null
  timezone: 'America/Detroit'
  placeLabel: string | null
  hostName: string
  message: string
}

/** App-owned default note shown on the card until a family edits it. Never model-generated. */
export const DEFAULT_INVITE_MESSAGE = 'Please join us to celebrate!'

/**
 * Fills the app-owned hostName/message fields when a source (fixture or live backend) left them
 * blank, without ever overwriting a value the family already set. Idempotent.
 */
export function withInviteDefaults(event: InviteEvent, defaultHostName: string): InviteEvent {
  return {
    ...event,
    hostName: event.hostName || defaultHostName || '',
    message: event.message || DEFAULT_INVITE_MESSAGE,
  }
}
export type InviteArt = {
  // The provider's REAL output format (verified from the returned bytes, not assumed) — Muse Image
  // defaults to WebP, so the card must accept it as well as PNG/JPEG. The downloaded card is always
  // re-encoded to PNG by the canvas regardless of the source format.
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  base64: string
  quietArea: { x: number; y: number; w: number; h: number }
}
export type InviteProvenance = {
  source: 'MUSE_IMAGE' | 'FIXTURE'
  model: 'muse-image-1.0' | null
  cached: boolean
  promptHash: string
  /** The actual output format the provider returned (verified, never assumed). */
  outputFormat?: string
  /** Whether a reference image drove the result — an /images/edits remix or a revision. */
  edited?: boolean
}
export type InviteResponse = {
  status: 'READY'
  /** Kept for back-compat with earlier callers/fixtures; the pipeline no longer blocks on it. */
  clarification?: { question: string } | null
  event: InviteEvent
  art: InviteArt | null
  provenance: InviteProvenance
  /** Non-blocking nudge naming the editable event fields the family still needs to add (never
   *  invented, never required to make the art). */
  suggestion?: string | null
  /** Present when the request carried a reference image: whether it was requested and whether the
   *  actual image guided the result (false in fixture mode, which can't remix). */
  reference?: { requested: boolean; applied: boolean }
}

/** Optional reference image a parent uploads to REMIX: the actual image is transformed to match the
 *  request (image-to-image via Muse Image /images/edits), or sent back as the prior result for a
 *  revision. Held in memory, sent with the request, discarded server-side after generation. */
export type InviteReferenceImage = { mimeType: string; dataBase64: string }
export const REFERENCE_MAX_BYTES = 5 * 1024 * 1024
export const REFERENCE_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Read a picked/dropped file into the request shape with a first-pass client guard (the server
 *  re-validates authoritatively: sniffs the real type, re-checks size + dimensions, strips EXIF). */
export async function readReferenceFile(file: File): Promise<{ ok: true; image: InviteReferenceImage; previewUrl: string } | { ok: false; error: string }> {
  if (!(REFERENCE_ACCEPT as readonly string[]).includes(file.type)) return { ok: false, error: 'Use a PNG, JPEG, or WebP image.' }
  if (file.size > REFERENCE_MAX_BYTES) return { ok: false, error: 'That image is larger than 5 MB. Choose a smaller one.' }
  if (file.size === 0) return { ok: false, error: 'That file is empty.' }
  let dataUrl: string
  try {
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(file)
    })
  } catch { return { ok: false, error: 'That image could not be read. Try another.' } }
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return { ok: false, error: 'That image could not be read. Try another.' }
  return { ok: true, image: { mimeType: file.type, dataBase64: dataUrl.slice(comma + 1) }, previewUrl: dataUrl }
}

export type InviteCreator = (request: { childId: string; request: string; referenceImage?: InviteReferenceImage; revise?: boolean }, signal?: AbortSignal) => Promise<InviteResponse>

/** Plainly says whether this card is a real generation or a placeholder — never ambiguous.
 * Burned into the exported PNG footer AND shown in the UI, so the distinction survives a
 * download, a screenshot, or someone reading only the image. */
export function inviteCredit(provenance: InviteProvenance): string {
  return provenance.source === 'MUSE_IMAGE' ? 'Art generated with Muse Image' : 'Sample art — not generated'
}

export function inviteError(error: unknown): { state: 'refused' | 'failed'; message: string } {
  const value = error as { status?: number; code?: string; error?: string; retryAfterMs?: number; errors?: { extensions?: { code?: string; retryAfterMs?: number } }[] } | null
  const code = value?.code ?? value?.error ?? value?.errors?.[0]?.extensions?.code
  const status = value?.status
  if (status === 413 || code === 'PAYLOAD_TOO_LARGE') return { state: 'failed', message: 'That reference image is too large (5 MB max). Choose a smaller one and try again.' }
  if (status === 415 || code === 'UNSUPPORTED_MEDIA_TYPE') return { state: 'failed', message: 'That reference image type is not supported. Use a PNG, JPEG, or WebP.' }
  if (status === 400 || code === 'INVALID_REQUEST') return { state: 'failed', message: 'The invitation request is invalid. Check your request and try again.' }
  if (status === 401 || code === 'UNAUTHENTICATED') return { state: 'refused', message: 'Your session ended. Choose a perspective again.' }
  if (status === 403 || code === 'UNAUTHORIZED') return { state: 'refused', message: 'Only a parent or guardian of this child can prepare an invitation. No art was generated.' }
  if (code === 'BUDGET_EXHAUSTED') return { state: 'failed', message: 'Image generation is unavailable because the demo budget is exhausted. No invitation art was returned.' }
  if (status === 429 || code === 'RATE_LIMITED') return { state: 'failed', message: 'Too many invitation requests right now. Try again later.' }
  if (status === 502 || code === 'IMAGE_FAILED') return { state: 'failed', message: 'Invitation art could not be generated. Try again later.' }
  return { state: 'failed', message: 'The invitation could not be prepared. Try again.' }
}

export function validArt(art: InviteArt): boolean {
  const { x, y, w, h } = art.quietArea
  return ['image/png', 'image/jpeg', 'image/webp'].includes(art.mimeType) && Number.isInteger(art.width) && Number.isInteger(art.height) &&
    art.width > 0 && art.height > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) &&
    x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= art.width && y + h <= art.height && /^[A-Za-z0-9+/]+={0,2}$/.test(art.base64)
}
