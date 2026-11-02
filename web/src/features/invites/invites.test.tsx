import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InviteComposer } from './InvitesPanel'
import { inviteCredit, inviteError, type InviteCreator, type InviteEvent } from './invite'
import { invitationText } from './renderInvite'

const event: InviteEvent = { childFirstName: 'Maya', occasion: 'Birthday party', date: '2026-11-07', startTime: '14:00', endTime: '16:00', timezone: 'America/Detroit', placeLabel: 'Riverside Pavilion' }
const provenance = { source: 'FIXTURE' as const, model: null, cached: false, promptHash: 'fixture:test' }

describe('invitation contract and honest states', () => {
  it('keeps Detroit event date and time as source fields, and credits art by provenance', () => {
    expect(invitationText(event)).toEqual(['Maya', 'Birthday party', 'Saturday, November 7, 2026', '2:00 PM – 4:00 PM · Detroit time', 'Riverside Pavilion'])
    expect(inviteCredit(provenance)).toBe('Sample art')
    expect(inviteCredit({ source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: true, promptHash: 'x' })).toBe('Art generated with Muse Image')
    expect(inviteCredit({ source: 'MUSE_IMAGE', model: 'muse-image-1.0', cached: false, promptHash: 'x' })).toBe('Art generated with Muse Image')
  })
  it('describes refusal, rate limit, exhausted budget, and image failure without claiming art', () => {
    expect(inviteError({ status: 403, code: 'UNAUTHORIZED' })).toMatchObject({ state: 'refused' })
    expect(inviteError({ status: 429, code: 'RATE_LIMITED' })).toMatchObject({ state: 'failed' })
    expect(inviteError({ status: 429, code: 'BUDGET_EXHAUSTED' }).message).toContain('No invitation art was returned')
    expect(inviteError({ status: 502, code: 'IMAGE_FAILED' })).toMatchObject({ state: 'failed' })
  })
  it('shows the returned clarification question, never a made-up one', async () => {
    const createInvite: InviteCreator = vi.fn().mockResolvedValue({ status: 'NEEDS_CLARIFICATION', clarification: 'Which Saturday?', event, art: null, provenance })
    render(<InviteComposer childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(await screen.findByText(/Which Saturday\?/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument()
  })
  it('keeps a 403 refusal distinct from a failed image request', async () => {
    const createInvite: InviteCreator = async () => { throw { status: 403, code: 'UNAUTHORIZED' } }
    render(<InviteComposer childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(await screen.findByText(/Only a parent or guardian of this child/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument()
  })
  it('discards a late response when the persona or child remounts the composer', async () => {
    let resolve!: (value: Awaited<ReturnType<InviteCreator>>) => void
    const createInvite: InviteCreator = vi.fn(() => new Promise<Awaited<ReturnType<InviteCreator>>>(done => { resolve = done }))
    const view = render(<InviteComposer key="persona-a:child-a" childId="child-a" childFirstName="Maya" mode="live" createInvite={createInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare invitation' }))
    expect(screen.getByText(/Preparing invitation art/)).toBeVisible()
    view.rerender(<InviteComposer key="persona-b:child-b" childId="child-b" childFirstName="Leo" mode="live" createInvite={createInvite} />)
    expect((screen.getByLabelText('Your invitation request') as HTMLTextAreaElement).value).toContain('Leo')
    await act(async () => resolve({ status: 'NEEDS_CLARIFICATION', clarification: 'Private question for Maya', event, art: null, provenance }))
    expect(screen.queryByText(/Private question for Maya/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Invitation card ready' })).not.toBeInTheDocument()
  })
})
