import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '@/App'
import { createMockAuthAdapter } from '@/features/personas/auth'
import { createPersonaDataAdapter } from '@/features/personas/personaData'
it('switches Kendra to Rosa without old calendar records or details surviving', async () => {
  window.location.hash = '#/calendar?day=2026-10-28&childId=p_nora'
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Birthday invitation/ }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Nora Ellison')
  // Switch through the app's persistent control; private portal content must also unmount.
  fireEvent.click(screen.getByRole('button', { name: 'Switch person', hidden: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Nora Ellison')).not.toBeInTheDocument()
  await screen.findByRole('button', { name: /Rosa Castellano/ })
  fireEvent.click(screen.getByRole('button', { name: /Rosa Castellano/ }))
  expect(await screen.findByRole('button', { name: /Autumn music recital/ })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Family Calendar', level: 1 })).toBeVisible()
  expect(screen.queryByText(/Birthday invitation|Nora Ellison|Jax Coleman/)).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Scheduled with Rosa & Tomás' })).toHaveLength(7))
})
it('models Rosa as a guardian, not a fake parent, and avoids legacy Jax fallback for new families', async () => {
  const auth = createMockAuthAdapter()
  const rosa = await auth.signInAsPersona('rosa')
  expect(rosa.persona.parent).toBe(false)
  expect(rosa.persona.guardian).toBe(true)
  const dwayne = await auth.signInAsPersona('dwayne')
  const legacyAdapter = createPersonaDataAdapter({ ...dwayne, generation: 1 })
  await expect(legacyAdapter.readVillage(dwayne.scope)).rejects.toThrow('UNAVAILABLE')
})
