import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { Shell } from './Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { createMockAdapter, demoScope } from '@/lib/frontendData/mockAdapter'
beforeEach(() => { window.location.hash = '' })
describe('app shell', () => {
  it('opens the persona picker before private Mission Control data', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The village it takes to raise')
    fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
    expect(screen.queryByText('Fictional demo')).not.toBeInTheDocument()
  })
  it('supports direct links and an injectable Living Village slot', () => {
    window.location.hash = '#/village'
    render(<DataProvider adapter={createMockAdapter()} scope={demoScope}><Shell slots={{ village: <p>Village integration slot</p> }} /></DataProvider>)
    expect(screen.getByText('Village integration slot')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Living Village' })).toHaveAttribute('aria-current', 'page')
  })
  it('navigates on hash changes', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
    await screen.findByText('Signed in as Kendra')
    window.location.hash = '#/parent-chat'
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask Rosina')
  })
  it('provides recovery for an unknown route', async () => {
    window.location.hash = '#/missing'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
    await screen.findByText('Signed in as Kendra')
    expect(screen.getByRole('link', { name: 'Go to Mission Control' })).toBeVisible()
  })
  it('shows the Demo replay tab only when showDemoReplay is set', () => {
    render(<DataProvider adapter={createMockAdapter()} scope={demoScope}><Shell showDemoReplay slots={{ 'demo-replay': <p>Demo replay slot</p> }} /></DataProvider>)
    expect(screen.getByRole('link', { name: 'Demo replay' })).toBeVisible()
  })
  it('hides the Demo replay tab and route without showDemoReplay', () => {
    window.location.hash = '#/demo-replay'
    render(<DataProvider adapter={createMockAdapter()} scope={demoScope}><Shell slots={{ 'demo-replay': <p>Demo replay slot</p> }} /></DataProvider>)
    expect(screen.queryByRole('link', { name: 'Demo replay' })).not.toBeInTheDocument()
    expect(screen.queryByText('Demo replay slot')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Mission Control' })).toBeVisible()
  })
})
