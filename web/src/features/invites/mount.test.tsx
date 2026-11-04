import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '@/App'

async function enter(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Explore as ${name}` }))
  await screen.findByText(`Signed in as ${name}`)
  fireEvent.click(screen.getByRole('link', { name: 'Invitations' }))
  fireEvent(window, new HashChangeEvent('hashchange'))
}

it('mounts the fictional invitation composer only for a parent and clears it on perspective switch', async () => {
  window.location.hash = '#/'
  render(<App />)
  await enter('Kendra')
  const composer = await screen.findByRole('region', { name: 'Prepare invitation' })
  expect(composer).toHaveAttribute('data-mode', 'mock')
  expect(composer).toHaveTextContent('Sample preview')
  expect(composer).toHaveTextContent('no image model or invitation record is called')
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe the invitation art' }), { target: { value: 'Private draft for Nora' } })
  fireEvent.click(screen.getByRole('button', { name: 'Switch person', hidden: true }))
  expect(screen.queryByText('Private draft for Nora')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Explore as Priya' })).toBeEnabled())
  await enter('Priya')
  expect(await screen.findByRole('region', { name: 'Invitations unavailable' })).toHaveTextContent('Only a parent or guardian')
  expect(screen.queryByRole('button', { name: 'Show sample invitation' })).not.toBeInTheDocument()
})
