import type { InviteCreator, InviteResponse } from './invite'

// SHA-256 of the backend's art-only Birthday party prompt in PR #130.
const FIXTURE_PROMPT_HASH = 'e69fe61faeab3d95c1f963fe57da321cc371e6a42786a08cd274146e8177450f'
let artBase64: Promise<string> | null = null

async function sampleArt(signal?: AbortSignal): Promise<string> {
  if (!artBase64) artBase64 = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}invites/sample-art.png`, { signal })
    if (!response.ok) throw new Error('Sample art unavailable')
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  })().catch(error => { artBase64 = null; throw error })
  return artBase64
}

/** Fixed fictional sample. It does not interpret the parent's words or call an image model. */
export function createMockInvite(childFirstName: string): InviteCreator {
  return async (input, signal) => {
    const base64 = await sampleArt(signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const hadReference = !!input.referenceImage || input.revise === true
    return {
      status: 'READY', clarification: null, suggestion: null,
      // hostName/message stay blank here: the caller (InviteComposer) fills them with the real
      // signed-in parent's name and the app-owned default note, so fixture and live behave alike.
      event: { childFirstName, occasion: 'Birthday party', date: '2026-11-15', startTime: '14:00', endTime: '16:00', timezone: 'America/Detroit', placeLabel: 'Maple Hall', hostName: '', message: '' },
      art: { mimeType: 'image/png', width: 1024, height: 1024, base64, quietArea: { x: 96, y: 600, w: 832, h: 328 } },
      provenance: { source: 'FIXTURE', model: null, cached: false, promptHash: FIXTURE_PROMPT_HASH, outputFormat: 'png', edited: hadReference },
      // The sample can't remix an uploaded image; say so honestly rather than imply it did.
      reference: hadReference ? { requested: true, applied: false } : undefined,
    } satisfies InviteResponse
  }
}
