import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { Shell } from './Shell'
import { DataProvider } from '@/lib/frontendData/provider'
import { createMockAdapter, demoScope } from '@/lib/frontendData/mockAdapter'
beforeEach(() => { window.location.hash = '' })
describe('app shell', () => {
  it('opens Mission Control by default with an honest demo label', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mission Control')
    expect(screen.getByText('Fictional demo')).toBeVisible()
  })
  it('supports direct links and an injectable Living Village slot', () => {
    window.location.hash = '#/village'
    render(<DataProvider adapter={createMockAdapter()} scope={demoScope}><Shell slots={{ village: <p>Village integration slot</p> }} /></DataProvider>)
    expect(screen.getByText('Village integration slot')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Living Village' })).toHaveAttribute('aria-current', 'page')
  })
  it('navigates on hash changes', () => {
    render(<App />)
    window.location.hash = '#/parent-chat'
    fireEvent(window, new HashChangeEvent('hashchange'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Parent chat')
  })
  it('provides recovery for an unknown route', () => {
    window.location.hash = '#/missing'
    render(<App />)
    expect(screen.getByRole('link', { name: 'Go to Mission Control' })).toBeVisible()
  })
})
