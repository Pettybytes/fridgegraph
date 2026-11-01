import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PhoneFrame } from './PhoneFrame'

it('states perspective, context and status in the frame label and caption', () => {
  render(<PhoneFrame label="Kendra" context="Nora's village" status="sample"><p>screen</p></PhoneFrame>)
  const group = screen.getByRole('group', { name: "Kendra · Nora's village — Sample" })
  expect(group).toBeTruthy()
  expect(screen.getByText('Kendra')).toBeTruthy()
  expect(screen.getByText("Nora's village")).toBeTruthy()
  expect(screen.getByText('Sample')).toBeTruthy()
})

it('bare (embed) mode drops the bezel and caption but keeps the screen', () => {
  const { container } = render(<PhoneFrame label="Kendra" status="live" bare><p>embedded</p></PhoneFrame>)
  expect(screen.getByText('embedded')).toBeTruthy()
  expect(container.querySelector('.fg-phone-caption')).toBeNull()
  expect(container.querySelector('.fg-phone-bare')).toBeTruthy()
})
