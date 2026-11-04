import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { VoiceProvider, useVoiceBinding, useVoiceControllerOptional } from './VoiceProvider'
import type { VoiceDeps } from './useRosinaVoice'

it('the shared controller delivers the full validated proposal packet to its active conversation binding', async () => {
  const onReply = vi.fn(), proposal = { id: 'proposal-only', childId: 'p_nora' }
  let voice: ReturnType<typeof useVoiceControllerOptional>
  function Conversation() { useVoiceBinding({ onReply }); voice = useVoiceControllerOptional(); return null }
  let finish: (clip: Blob) => void = () => {}
  const response = { reply: 'Ready for review.', actions: [], calendarProposal: proposal }
  const deps: Partial<VoiceDeps> = {
    stream: true,
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream,
    createRecorder: (_s, done) => { finish = done; return { state: 'recording', start() {}, stop() { finish(new Blob(['clip'])) } } },
    createMeter: () => ({ level: () => 0.5, stop() {} }),
    createStreamPlayer: async () => ({ push() {}, stop() {}, finish: async () => {} }),
    request: (async () => new Response(JSON.stringify({ type: 'final', data: response }) + '\n' + JSON.stringify({ type: 'done', timings: {} }) + '\n')) as typeof fetch,
  }
  render(<VoiceProvider getAccessToken={() => 'test-only'} deps={deps}><Conversation /></VoiceProvider>)
  await act(async () => { await voice!.start() })
  await act(async () => { voice!.stop() })
  await waitFor(() => expect(onReply).toHaveBeenCalledTimes(1))
  expect(onReply.mock.calls[0][2]).toEqual(response)
})
