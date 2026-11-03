import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InviteComposer } from './InvitesPanel'
import { DEFAULT_INVITE_MESSAGE, inviteCredit, inviteError, withInviteDefaults, type InviteCreator, type InviteEvent } from './invite'
import { drawInvitation, invitationText } from './renderInvite'

const event: InviteEvent = { childFirstName: 'Nora', occasion: 'Birthday party', date: '2026-11-15', startTime: '14:00', endTime: '16:00', timezone: 'America/Detroit', placeLabel: 'Maple Hall', hostName: '', message: '' }
const provenance = { source: 'FIXTURE' as const, model: null, cached: false, promptHash: 'fixture:test' }

describe('invitation contract and honest states', () => {
  it('keeps Detroit event date and time as source fields, and credits art by provenance', () => {
    expect(invitationText(event)).toEqual(['Nora', 'Birthday party', 'Sunday, November 15, 2026', '2:00 PM – 4:00 PM · Detroit time', 'Maple Hall'])
    expect(inviteCredit(provenance)).toBe('Sample art — not generated')
    expect(inviteCredit({ source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: true, promptHash: 'x' })).toBe('Art generated with Muse Image')
    expect(inviteCredit({ source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: false, promptHash: 'x' })).toBe('Art generated with Muse Image')
  })
  it.each([
    [provenance, 'Sample art — not generated'],
    [{ source: 'MUSE_IMAGE' as const, model: 'muse-image-1.0' as const, cached: true, promptHash: 'model:test' }, 'Art generated with Muse Image'],
  ])('draws the %s provenance credit into the invitation pixels', (source, expected) => {
    const fillText = vi.fn()
    const ctx = {
      drawImage: vi.fn(), getImageData: () => ({ data: [251, 250, 246, 255] }),
      measureText: (text: string) => ({ width: text.length * 10 }), fillText,
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D
    const canvas = { width: 1024, height: 1024, getContext: () => ctx } as unknown as HTMLCanvasElement
    const image = { naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    drawInvitation(canvas, image, art, event, source)
    expect(fillText).toHaveBeenCalledWith(expected, 512, expect.any(Number))
  })
  it('adds the host and the personal message to the card when they are filled in', () => {
    const filled: InviteEvent = { ...event, hostName: 'Kendra', message: 'Please join us to celebrate!' }
    expect(invitationText(filled)).toEqual([
      'Hosted by Kendra', 'Nora', 'Birthday party', 'Sunday, November 15, 2026',
      '2:00 PM – 4:00 PM · Detroit time', 'Maple Hall', 'Please join us to celebrate!',
    ])
  })
  it('drops the host and message lines when they are blank, keeping the five core lines', () => {
    expect(invitationText({ ...event, hostName: '   ', message: '' })).toHaveLength(5)
    expect(invitationText(event)[0]).toBe('Nora')
  })
  it('fills a blank host and message from the app, and never overwrites a value the family set', () => {
    expect(withInviteDefaults(event, 'Kendra')).toMatchObject({ hostName: 'Kendra', message: DEFAULT_INVITE_MESSAGE })
    const own: InviteEvent = { ...event, hostName: 'Loretta', message: 'Bring a swimsuit.' }
    expect(withInviteDefaults(own, 'Kendra')).toMatchObject({ hostName: 'Loretta', message: 'Bring a swimsuit.' })
  })
  it('shows the invitation as readable text beside the art, including host and message', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    const createInvite: InviteCreator = vi.fn().mockResolvedValue({ status: 'READY', clarification: null, event, art, provenance })
    render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} defaultHostName="Kendra" />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    const readout = await screen.findByLabelText('Invitation text')
    expect(readout).toHaveTextContent('Hosted by Kendra')
    expect(readout).toHaveTextContent('Nora')
    expect(readout).toHaveTextContent('Birthday party')
    expect(readout).toHaveTextContent('Sunday, November 15, 2026')
    expect(readout).toHaveTextContent('Maple Hall')
    expect(readout).toHaveTextContent('Please join us to celebrate!')
  })
  it('says plainly that a FIXTURE card in live mode is not a new generation', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    const createInvite: InviteCreator = vi.fn().mockResolvedValue({ status: 'READY', clarification: null, event, art, provenance })
    render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(await screen.findByText(/Live art generation is switched off here/)).toBeVisible()
    expect(screen.queryByText(/Art generated with Muse Image for this request/)).not.toBeInTheDocument()
  })
  it('credits real Muse art, and says when it came from the cache instead of a new call', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    for (const cached of [false, true]) {
      const createInvite: InviteCreator = vi.fn().mockResolvedValue({
        status: 'READY', clarification: null, event, art,
        provenance: { source: 'MUSE_IMAGE' as const, model: 'muse-image-1.0' as const, cached, promptHash: 'muse:test' },
      })
      const view = render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} />)
      fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
      expect(await screen.findByText(cached ? /served from the prompt cache/ : /Art generated with Muse Image for this request/)).toBeVisible()
      view.unmount()
    }
  })
  it('describes refusal, rate limit, exhausted budget, and image failure without claiming art', () => {
    expect(inviteError({ status: 403, code: 'UNAUTHORIZED' })).toMatchObject({ state: 'refused' })
    expect(inviteError({ status: 429, code: 'RATE_LIMITED' })).toMatchObject({ state: 'failed' })
    expect(inviteError({ status: 429, code: 'BUDGET_EXHAUSTED' }).message).toContain('No invitation art was returned')
    expect(inviteError({ status: 502, code: 'IMAGE_FAILED' })).toMatchObject({ state: 'failed' })
    expect(inviteError({ status: 400, error: 'INVALID_REQUEST' })).toMatchObject({ state: 'failed' })
  })
  it('shows a non-blocking suggestion on a ready card, and never blocks the download on missing details', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    const createInvite: InviteCreator = vi.fn().mockResolvedValue({ status: 'READY', suggestion: 'Add a date below to finish the invitation.', event: { ...event, date: null }, art, provenance })
    render(<InviteComposer childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    // The art is ready even though the schedule is incomplete; the suggestion is advisory, not a gate.
    expect(await screen.findByRole('region', { name: 'Invitation card ready' })).toBeVisible()
    expect(screen.getByText('Add a date below to finish the invitation.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument()
  })
  it('keeps a 403 refusal distinct from a failed image request', async () => {
    const createInvite: InviteCreator = async () => { throw { status: 403, code: 'UNAUTHORIZED' } }
    render(<InviteComposer childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(await screen.findByText(/Only a parent or guardian of this child/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument()
  })
  it('discards a late response when the persona or child remounts the composer', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    let resolve!: (value: Awaited<ReturnType<InviteCreator>>) => void
    const createInvite: InviteCreator = vi.fn(() => new Promise<Awaited<ReturnType<InviteCreator>>>(done => { resolve = done }))
    const view = render(<InviteComposer key="persona-a:child-a" childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(screen.getByText(/Preparing invitation art/)).toBeVisible()
    view.rerender(<InviteComposer key="persona-b:child-b" childId="child-b" childFirstName="Leo" mode="live" createInvite={createInvite} />)
    expect((screen.getByLabelText('Your invitation request') as HTMLTextAreaElement).value).toContain('Leo')
    await act(async () => resolve({ status: 'READY', event, art, provenance }))
    expect(screen.queryByRole('region', { name: 'Invitation card ready' })).not.toBeInTheDocument()
  })
  it('preserves the last successful design while regenerating, and on a failed regeneration', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    let resolveSecond!: (v: Awaited<ReturnType<InviteCreator>>) => void
    const createInvite: InviteCreator = vi.fn()
      .mockResolvedValueOnce({ status: 'READY', clarification: null, event, art, provenance })
      .mockImplementationOnce(() => new Promise(done => { resolveSecond = done }))
    render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(await screen.findByRole('region', { name: 'Invitation card ready' })).toBeVisible()

    // Regenerate — the existing card must stay visible while the new request is in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Prepare a new invitation' }))
    expect(screen.getByRole('region', { name: 'Invitation card ready' })).toBeVisible()
    expect(screen.getByText(/Your current card stays ready below/)).toBeVisible()

    // The regeneration returns no art — the OLD card must still be there, not blanked.
    await act(async () => resolveSecond({ status: 'READY', event, art: null, provenance }))
    expect(screen.getByRole('region', { name: 'Invitation card ready' })).toBeVisible()
    expect(screen.getByText(/returned no art/)).toBeVisible()
  })
  it('revises the current design by sending the prior art back as the reference with revise:true', async () => {
    const art = { mimeType: 'image/png' as const, width: 1024, height: 1024, base64: 'YWJj', quietArea: { x: 96, y: 600, w: 832, h: 328 } }
    const calls: Array<{ referenceImage?: { mimeType: string; dataBase64: string }; revise?: boolean }> = []
    const createInvite: InviteCreator = vi.fn(async req => {
      calls.push(req)
      return { status: 'READY' as const, event, art, provenance: { source: 'MUSE_IMAGE' as const, model: 'muse-image-1.0' as const, cached: false, promptHash: 'muse:test', edited: !!req.referenceImage } }
    })
    render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    await screen.findByRole('region', { name: 'Invitation card ready' })
    fireEvent.click(screen.getByRole('button', { name: 'Revise this design' }))
    await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(2))
    expect(calls[0].revise).toBe(false) // the first prepare is a fresh generation, not a revision
    expect(calls[0].referenceImage).toBeUndefined()
    expect(calls[1].revise).toBe(true) // the revision sends the current art back to preserve it
    expect(calls[1].referenceImage?.dataBase64).toBe('YWJj')
    expect(calls[1].referenceImage?.mimeType).toBe('image/png')
  })
  it('offers an explicit Retry after a failure, which actually re-runs the request — never automatically', async () => {
    const createInvite: InviteCreator = vi.fn().mockRejectedValue({ status: 502, code: 'IMAGE_FAILED' })
    render(<InviteComposer childId="child-a" childFirstName="Nora" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    await screen.findByRole('button', { name: 'Retry' })
    expect(createInvite).toHaveBeenCalledTimes(1) // no automatic retry loop
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await act(async () => {})
    expect(createInvite).toHaveBeenCalledTimes(2) // the explicit click DID retry
  })
  it('never offers Retry for a 403 refusal — that boundary will not change on its own', async () => {
    const createInvite: InviteCreator = async () => { throw { status: 403, code: 'UNAUTHORIZED' } }
    render(<InviteComposer childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    await screen.findByText(/Only a parent or guardian of this child/)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
