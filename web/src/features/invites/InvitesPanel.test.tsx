import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { InvitesPanel } from './InvitesPanel'
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
