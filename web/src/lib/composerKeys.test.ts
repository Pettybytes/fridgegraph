import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { onEnterSubmit } from './composerKeys'

function keyEvent(over: Record<string, unknown> = {}): KeyboardEvent {
  return { key: 'Enter', shiftKey: false, repeat: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), ...over } as unknown as KeyboardEvent
}

describe('onEnterSubmit', () => {
  it('plain Enter sends and prevents the default', () => {
    const submit = vi.fn(); const e = keyEvent()
    onEnterSubmit(submit)(e)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Shift+Enter does NOT send and leaves the default (newline) intact', () => {
    const submit = vi.fn(); const e = keyEvent({ shiftKey: true })
    onEnterSubmit(submit)(e)
    expect(submit).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('does not send mid-IME-composition', () => {
    const submit = vi.fn()
    onEnterSubmit(submit)(keyEvent({ nativeEvent: { isComposing: true } }))
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not send on the composition-ending Enter (legacy keyCode 229)', () => {
    const submit = vi.fn()
    onEnterSubmit(submit)(keyEvent({ keyCode: 229 }))
    expect(submit).not.toHaveBeenCalled()
  })

  it('ignores auto-repeat', () => {
    const submit = vi.fn()
    onEnterSubmit(submit)(keyEvent({ repeat: true }))
    expect(submit).not.toHaveBeenCalled()
  })

  it('ignores non-Enter keys', () => {
    const submit = vi.fn()
    onEnterSubmit(submit)(keyEvent({ key: 'a', keyCode: 65 }))
    expect(submit).not.toHaveBeenCalled()
  })
})
