import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const moduleLoad = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/features/village', () => {
  moduleLoad.count += 1
  return { LivingVillage: () => <p>Village module rendered</p> }
})
import App from '@/App'
it('keeps the village module deferred until its route is selected', async () => {
  window.location.hash = ''
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /Kendra/ }))
  await screen.findByText('Signed in as Kendra')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Today')
  expect(moduleLoad.count).toBe(0)
  window.location.hash = '#/village'
  fireEvent(window, new HashChangeEvent('hashchange'))
  expect(screen.getByRole('status', { name: 'Loading shared records' })).toHaveAttribute('role', 'status')
  expect(await screen.findByText('Village module rendered')).toBeVisible()
  expect(moduleLoad.count).toBe(1)
  window.location.hash = '#/mission-control'
  fireEvent(window, new HashChangeEvent('hashchange'))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mission Control')
  window.location.hash = '#/village'
  fireEvent(window, new HashChangeEvent('hashchange'))
  expect(await screen.findByText('Village module rendered')).toBeVisible()
  expect(moduleLoad.count).toBe(1)
})
