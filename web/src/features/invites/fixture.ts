import type { InviteCreator, InviteResponse } from './invite'

const FIXTURE_PROMPT_HASH = 'fixture:hand-authored-birthday-art-v1'
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
  return async (_input, signal) => {
    const base64 = await sampleArt(signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return {
      status: 'READY', clarification: null,
      event: { childFirstName, occasion: 'Birthday party', date: '2026-11-07', startTime: '14:00', endTime: '16:00', timezone: 'America/Detroit', placeLabel: 'Riverside Pavilion' },
      art: { mimeType: 'image/png', width: 1000, height: 1400, base64, quietArea: { x: 148, y: 516, w: 704, h: 704 } },
      provenance: { source: 'FIXTURE', model: null, cached: false, promptHash: FIXTURE_PROMPT_HASH },
    } satisfies InviteResponse
  }
}
