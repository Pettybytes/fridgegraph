import { describe, expect, it, vi } from 'vitest'
import { createServiceRosinaAdapter } from './adapter'
const input = { message: 'What can I do here?', currentRoute: '#/village', history: [{ role: 'user' as const, content: 'Earlier message' }] }
describe('Rosina service boundary', () => {
  it('posts only message, route and persona-scoped client history with the user bearer token', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ reply: 'Plain reply', actions: [] }), { status: 200 }))
    const service = createServiceRosinaAdapter(async () => 'fictional-test-session', request)
    expect(await service.send(input)).toEqual({ reply: 'Plain reply', actions: [] })
    const [path, options] = request.mock.calls[0]
    expect(path).toBe('/api/rosina')
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer fictional-test-session' })
    expect(JSON.parse(String(options?.body))).toEqual(input)
  })
  it('does not guess a live care-rule answer before v2 lands', async () => {
    const request = vi.fn<typeof fetch>()
    expect(await createServiceRosinaAdapter(async () => 'fictional-test-session', request).send({ ...input, message: 'Can Nora have a peanut-butter snack?' })).toEqual({ reply: "I can't confirm that yet", actions: [] })
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses a missing session and rejects malformed responses', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(createServiceRosinaAdapter(async () => null, request).send(input)).rejects.toThrow('UNAUTHENTICATED')
    expect(request).not.toHaveBeenCalled()
    const malformed = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ reply: '<b>Text</b>' }), { status: 200 }))
    await expect(createServiceRosinaAdapter(async () => 'fictional-test-session', malformed).send(input)).rejects.toThrow('Invalid Rosina response')
  })
})
