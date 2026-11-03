/** Real `InviteCreator` for POST /api/rosina/invite (docs/contracts/invites.md). Same pattern as
 * createServiceRosinaAdapter (src/features/rosina/adapter.ts): the caller's own bearer, forwarded
 * — Rosina holds no identity of its own. The endpoint decides fixture vs. live (INVITE_LIVE) and
 * labels the result accordingly (provenance.source); this creator does not choose that. */
import type { InviteCreator, InviteResponse } from './invite'

export function createLiveInvite(getAccessToken: () => string | null | undefined, request: typeof fetch = fetch): InviteCreator {
  return async (input, signal) => {
    const token = getAccessToken()
    if (!token) throw { status: 401, error: 'UNAUTHENTICATED' }
    const response = await request('/api/rosina/invite', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const b = (body ?? {}) as { error?: string; retryAfterMs?: number }
      throw { status: response.status, error: b.error, retryAfterMs: b.retryAfterMs }
    }
    if (!body || typeof body !== 'object' || !('status' in body) || !('event' in body) || !('provenance' in body)) {
      throw { status: 502, error: 'IMAGE_FAILED' }
    }
    return body as InviteResponse
  }
}
