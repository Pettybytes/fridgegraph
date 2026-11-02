import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '@/App'

it('puts the existing conversation inside the Ask Rosina page with no second opener or thread', async () => {
  window.location.hash = '#/ask-rosina'
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  await screen.findByText('Signed in as Kendra')
  const main = screen.getByRole('main')
  const panel = await within(main).findByRole('region', { name: 'Ask Rosina' })
  expect(within(panel).getByRole('log', { name: 'Rosina conversation' })).toBeInTheDocument()
  expect(screen.getAllByRole('log', { name: 'Rosina conversation' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Open Ask Rosina' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Ask Rosina$/ })).not.toBeInTheDocument()
  fireEvent.click(within(panel).getByRole('button', { name: 'Close Ask Rosina' }))
  await waitFor(() => expect(window.location.hash).toBe('#/today'))
})
