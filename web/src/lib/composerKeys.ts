/**
 * Shared Enter-to-send key handling for Rosina's composers (the panel/page textarea and the Today
 * input). One behavior everywhere:
 *   - Enter sends a non-empty message;
 *   - Shift+Enter inserts a newline where multiline input is supported;
 *   - IME composition is respected — a keystroke during composition, and the composition-ENDING Enter
 *     (which browsers report as `isComposing` / legacy keyCode 229), never submits;
 *   - auto-repeat (holding Enter) never submits twice.
 * The caller's `submit` is responsible for its own in-flight / empty / dup guards.
 */
import type { KeyboardEvent } from 'react'

export function onEnterSubmit(submit: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    // Shift+Enter is never a send: a multiline field inserts a newline (default, so we don't
    // preventDefault); a single-line field simply does nothing.
    if (e.shiftKey) return
    // IME: mid-composition or the Enter that commits a candidate must not send.
    if (e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) return
    if (e.repeat) return // key auto-repeat
    e.preventDefault()
    submit()
  }
}

/** Accessible hint shown near a composer. Kept in one place so the copy matches everywhere. */
export const COMPOSER_HINT_MULTILINE = 'Press Enter to send, Shift+Enter for a new line.'
export const COMPOSER_HINT_SINGLE = 'Press Enter to send.'
