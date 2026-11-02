import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from '@/App'
import { createMockAuthAdapter } from './auth'
import { createLiveAuthAdapter } from './liveAuth'
import { readyBody } from './sessionTestFixtures'

it('keeps the sample label on mock care information', async () => {
  window.location.hash = '#/care-information'
  render(<App authAdapter={createMockAuthAdapter()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  expect(await screen.findByText('Sample data')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Care information' })).toHaveAttribute('data-source', 'mock')
})

it('renders only a recorded care-plan read in live mode, with no sample label', async () => {
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('health')) return Response.json({ personas: [] })
    if (String(url).endsWith('/login')) return Response.json(readyBody())
    const query = JSON.parse(String(options?.body ?? '{}')).query ?? ''
    if (query.includes('carePlan')) return Response.json({ data: { carePlan: { text: 'Recorded allergy guidance.' } } })
    return Response.json({ data: { myChildren: [] } })
  })
  vi.stubGlobal('fetch', request)
  window.location.hash = '#/care-information'
  render(<App authAdapter={createLiveAuthAdapter(request)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  const care = await screen.findByRole('region', { name: 'Care information' })
  expect(care).toHaveAttribute('data-source', 'live')
  expect(care).toHaveTextContent('Recorded allergy guidance.')
  expect(care).toHaveTextContent("Source: Nora's care plan")
  expect(screen.queryByText('Sample data')).not.toBeInTheDocument()
  vi.unstubAllGlobals()
})
