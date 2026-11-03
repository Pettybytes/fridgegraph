import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '@/App'

// The Ask Rosina panel/page textarea: Enter sends a non-empty message; Shift+Enter is a newline and
// never sends; whitespace-only never sends. (Composition/repeat/duplicate are unit-tested on the
// shared helper + Composer; this is the panel integration.)
async function openPanel() {
  window.location.hash = '#/ask-rosina'
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Explore as Kendra' }))
  await screen.findByText('Signed in as Kendra')
  const panel = await within(screen.getByRole('main')).findByRole('region', { name: 'Ask Rosina' })
  return within(panel).getByLabelText('Message Rosina') as HTMLTextAreaElement
}

it('Enter sends a non-empty message in the Ask Rosina panel', async () => {
  const textarea = await openPanel()
  fireEvent.change(textarea, { target: { value: 'what can I see here' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
  // The message is echoed into the thread as the parent's turn.
  expect(await screen.findByText('what can I see here')).toBeInTheDocument()
  expect(textarea.value).toBe('') // draft cleared on send
})

it('Shift+Enter does not send (newline), and whitespace-only does not send', async () => {
  const textarea = await openPanel()
  const messageCount = () => document.querySelectorAll('article.rosina-message').length
  fireEvent.change(textarea, { target: { value: 'first line' } })
  fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
  await new Promise((r) => setTimeout(r, 30))
  expect(messageCount()).toBe(0)            // Shift+Enter did not send a turn
  expect(textarea.value).toBe('first line') // draft preserved (no newline simulated by jsdom keydown)

  fireEvent.change(textarea, { target: { value: '   ' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
  await new Promise((r) => setTimeout(r, 30))
  expect(messageCount()).toBe(0)            // whitespace-only never sends
})
