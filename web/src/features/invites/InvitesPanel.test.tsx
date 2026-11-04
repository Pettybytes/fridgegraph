import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { InvitesPanel, InviteComposer, EXAMPLE_EVENT } from './InvitesPanel'
import { useSession } from '@/features/personas/Session'
import { useChildAccess } from '@/features/personas/childContext'

vi.mock('@/features/personas/Session', () => ({ useSession: vi.fn() }))
vi.mock('@/features/personas/childContext', () => ({ useChildAccess: vi.fn() }))

it('shows a refusal and no prepare button to a non-parent', () => {
  vi.mocked(useSession).mockReturnValue({ session: { generation: 1, persona: { personId: 'priya', parent: false, guardian: false }, scope: { childId: 'child-a' } } } as ReturnType<typeof useSession>)
  vi.mocked(useChildAccess).mockReturnValue({ selectedChildId: 'child-a', selectedChildName: 'Maya' } as ReturnType<typeof useChildAccess>)
  render(<InvitesPanel />)
  expect(screen.getByRole('region', { name: 'Invitations unavailable' })).toHaveTextContent('Only a parent or guardian')
  expect(screen.queryByRole('button', { name: /invitation/i })).not.toBeInTheDocument()
})

it('uses a primary image control and a finished sanitized public sample', () => {
  render(<InviteComposer childId="private-child" childFirstName="Private name" defaultHostName="Private host" mode="mock" createInvite={vi.fn()} />)
  const choose = screen.getByRole('button', { name: 'Choose image' })
  expect(choose.className).toBe(screen.getByRole('button', { name: 'Show sample invitation' }).className)
  const sample = screen.getByRole('complementary', { name: 'Example invitation' })
  expect(sample).toHaveTextContent('Fictional sample')
  expect(sample).toHaveTextContent('Hosted by Rowan')
  expect(sample).toHaveTextContent(EXAMPLE_EVENT.childFirstName)
  expect(sample).toHaveTextContent(EXAMPLE_EVENT.placeLabel!)
  expect(sample).not.toHaveTextContent(/Private name|Private host|1024 W|Nora|Kendra/)
  expect(screen.getByAltText(/Finished fictional birthday invitation for Lark/)).toHaveAttribute('src', '/invites/public-sample.webp')
})
