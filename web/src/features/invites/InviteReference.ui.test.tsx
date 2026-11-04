import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { InviteComposer } from './InvitesPanel'
import type { InviteResponse } from './invite'

// A minimal response used only to let a prepare() resolve so we can inspect the request it sent;
// art:null means no card renders, which is fine for these upload-focused tests.
const NO_ART: InviteResponse = {
  status: 'READY',
  suggestion: null,
  event: { childFirstName: 'Nora', occasion: 'Birthday', date: null, startTime: null, endTime: null, timezone: 'America/Detroit', placeLabel: null, hostName: '', message: '' },
  art: null,
  provenance: { source: 'MUSE_IMAGE', model: null, cached: false, promptHash: '' },
}
const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'party.png', { type: 'image/png' })
const fileInputOf = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement

it('renders the optional reference control and the no-reference dropzone', () => {
  const { container } = render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="live" createInvite={vi.fn()} />)
  expect(screen.getByRole('group', { name: /Reference image/i })).toBeInTheDocument()
  expect(screen.getByText(/remixed to match your description/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Choose image' })).toBeInTheDocument()
  expect(fileInputOf(container).accept).toContain('image/png')
})

it('picking a file shows a preview and remove/replace; removing restores the dropzone', async () => {
  const { container } = render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="live" createInvite={vi.fn()} />)
  fireEvent.change(fileInputOf(container), { target: { files: [pngFile()] } })
  const preview = await screen.findByAltText(/Reference: party\.png/)
  expect(preview).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(screen.queryByAltText(/Reference: party\.png/)).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Choose image' })).toBeInTheDocument()
})

it('a non-image file is rejected client-side with no state change', async () => {
  const { container } = render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="live" createInvite={vi.fn()} />)
  fireEvent.change(fileInputOf(container), { target: { files: [new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })] } })
  expect(await screen.findByText(/Use a PNG, JPEG, or WebP/i)).toBeInTheDocument()
  expect(screen.queryByAltText(/Reference:/)).not.toBeInTheDocument()
})

it('the reference image is sent with the prepare request', async () => {
  let captured: { referenceImage?: { mimeType: string; dataBase64: string } } | null = null
  const createInvite = vi.fn(async (req: { childId: string; request: string; referenceImage?: { mimeType: string; dataBase64: string } }) => { captured = req; return NO_ART })
  const { container } = render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="live" createInvite={createInvite} />)
  fireEvent.change(fileInputOf(container), { target: { files: [pngFile()] } })
  await screen.findByAltText(/Reference: party\.png/)
  fireEvent.click(screen.getByRole('button', { name: /Prepare invitation/i }))
  await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1))
  const req = captured as { referenceImage?: { mimeType: string; dataBase64: string } } | null
  expect(req?.referenceImage?.mimeType).toBe('image/png')
  expect((req?.referenceImage?.dataBase64 ?? '').length).toBeGreaterThan(0)
})

it('in mock mode the control renders and honestly says the reference is ignored', async () => {
  const { container } = render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="mock" createInvite={vi.fn()} />)
  expect(screen.getByRole('group', { name: /Reference image/i })).toBeInTheDocument() // still renders with live off
  fireEvent.change(fileInputOf(container), { target: { files: [pngFile()] } })
  await screen.findByAltText(/Reference: party\.png/)
  expect(screen.getByText(/turn on live generation to remix/i)).toBeInTheDocument()
})

it('the reference is optional: Prepare is enabled without an image, and the control is labelled optional', () => {
  render(<InviteComposer childId="p_nora" childFirstName="Nora" mode="live" createInvite={vi.fn()} />)
  expect(screen.getByText(/optional/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Prepare invitation/i })).toBeEnabled()
})
