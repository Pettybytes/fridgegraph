/**
 * Pure helpers for the browser-voice routes, extracted so they can be unit-tested without the server's
 * DB/secret bootstrap. Behavior is unchanged from the inline versions.
 */

/**
 * Bounded conversation history the client sends alongside the audio. For an audio turn it rides in the
 * base64 `X-Rosina-History` header (the body is the audio); for a text turn it is in the JSON body.
 * Validated the same way the Rosina service validates text-turn history: ≤ 40 messages, role
 * normalized to user|assistant, content a non-empty string clamped to 4000 chars.
 */
export function parseHistory(value) {
  let arr = value
  if (typeof value === 'string') {
    try { arr = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  const out = []
  for (const m of arr.slice(-40)) {
    if (!m || typeof m !== 'object') continue
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const content = typeof m.content === 'string' ? m.content.slice(0, 4000) : ''
    if (content) out.push({ role, content })
  }
  return out
}
