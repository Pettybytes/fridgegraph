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
  mimeType: 'image/png' | 'image/jpeg'
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
}
export type InviteResponse = {
  status: 'READY' | 'NEEDS_CLARIFICATION'
  clarification: { question: string } | null
  event: InviteEvent
  art: InviteArt | null
  provenance: InviteProvenance
}
export type InviteCreator = (request: { childId: string; request: string }, signal?: AbortSignal) => Promise<InviteResponse>

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
  if (status === 400 || code === 'INVALID_REQUEST') return { state: 'failed', message: 'The invitation request is invalid. Check the event details and try again.' }
  if (status === 401 || code === 'UNAUTHENTICATED') return { state: 'refused', message: 'Your session ended. Choose a perspective again.' }
  if (status === 403 || code === 'UNAUTHORIZED') return { state: 'refused', message: 'Only a parent or guardian of this child can prepare an invitation. No art was generated.' }
  if (code === 'BUDGET_EXHAUSTED') return { state: 'failed', message: 'Image generation is unavailable because the demo budget is exhausted. No invitation art was returned.' }
  if (status === 429 || code === 'RATE_LIMITED') return { state: 'failed', message: 'Too many invitation requests right now. Try again later.' }
  if (status === 502 || code === 'IMAGE_FAILED') return { state: 'failed', message: 'Invitation art could not be generated. Try again later.' }
  return { state: 'failed', message: 'The invitation could not be prepared. Try again.' }
}

export function validArt(art: InviteArt): boolean {
  const { x, y, w, h } = art.quietArea
  return ['image/png', 'image/jpeg'].includes(art.mimeType) && Number.isInteger(art.width) && Number.isInteger(art.height) &&
    art.width > 0 && art.height > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) &&
    x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= art.width && y + h <= art.height && /^[A-Za-z0-9+/]+={0,2}$/.test(art.base64)
}
