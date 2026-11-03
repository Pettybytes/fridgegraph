import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from './primitives'

describe('Composer (shared single-line)', () => {
  it('Enter sends the trimmed value once and clears the input', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} placeholder="Ask Rosina…" />)
    const input = screen.getByLabelText('Ask Rosina…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  hello  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(input.value).toBe('')
  })

  it('whitespace-only input never sends', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} placeholder="Ask Rosina…" />)
    const input = screen.getByLabelText('Ask Rosina…')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Enter + button in the same tick submits only once', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} placeholder="Ask Rosina…" sendLabel="Send" />)
    const input = screen.getByLabelText('Ask Rosina…')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter' })      // sends + clears + locks
    fireEvent.click(screen.getByRole('button', { name: 'Send' })) // same tick: blocked by the lock / empty
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('does not send on the composition-ending Enter (keyCode 229)', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} placeholder="Ask Rosina…" />)
    const input = screen.getByLabelText('Ask Rosina…')
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }) // IME commit
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })               // the real Enter after composition
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('a disabled composer never sends on Enter', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} placeholder="Ask Rosina…" disabled />)
    const input = screen.getByLabelText('Ask Rosina…')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps a visible Send button and an accessible keyboard hint', () => {
    render(<Composer onSend={vi.fn()} placeholder="Ask Rosina…" sendLabel="Send" />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.getByText(/Press Enter to send/)).toBeTruthy()
  })
})
