import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '@/App'
it('groups the six existing people without inventing households or portraits', () => {
  window.location.hash = ''
  render(<App />)
  const nora = screen.getByRole('region', { name: "Nora's village" })
  const jax = screen.getByRole('region', { name: "Jax's family" })
  expect(within(nora).getAllByRole('button')).toHaveLength(4)
  expect(within(jax).getAllByRole('button')).toHaveLength(2)
  expect(within(nora).getByRole('button', { name: /Priya/ })).toBeVisible()
  expect(within(jax).queryByRole('button', { name: /Priya/ })).not.toBeInTheDocument()
})
it('keeps care information private for a persona without that grant', async () => {
  window.location.hash = '#/care-information'
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /Loretta/ }))
  expect(await screen.findByText('Care information hasn’t been shared with you')).toBeVisible()
  expect(screen.queryByText(/Peanut allergy/)).not.toBeInTheDocument()
})
