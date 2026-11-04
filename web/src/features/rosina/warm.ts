import { useEffect } from 'react'

let lastWarmAtMs = 0

/** Cold-start warm-up (latency playbook 6): one authorized POST primes the caller's context and
 * lens caches, the tool list, and the model host's prompt-prefix cache. Fire-and-forget; the
 * server's per-session cooldown makes overlapping fires from several surfaces cost one warm. */
export function fireRosinaWarm(token: string): void {
  lastWarmAtMs = Date.now()
  try {
    void fetch('/api/rosina/warm', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
  } catch { /* no fetch in this environment: warming is best-effort everywhere */ }
}

export const WARM_STALE_MS = 30_000

/** The panel-open prefetch: warms only when the last warm has gone stale, so opening and closing
 * Ask Rosina right after page load costs nothing extra. */
export function fireRosinaWarmIfStale(token: string): void {
  if (Date.now() - lastWarmAtMs < WARM_STALE_MS) return
  fireRosinaWarm(token)
}

export const WARM_KEEP_ALIVE_MS = 60_000

/** Fires on sign-in and every ~60s while the tab is visible, so the lens cache (60s TTL) and the
 * model's prompt-prefix cache never go cold between questions. A hidden tab stops warming; coming
 * back fires immediately when the last warm has gone stale. */
export function useRosinaWarmKeepAlive(token: string | null | undefined, live: boolean): void {
  useEffect(() => {
    if (!live || !token) return
    fireRosinaWarm(token)
    const tick = window.setInterval(() => { if (!document.hidden) fireRosinaWarm(token) }, WARM_KEEP_ALIVE_MS)
    const onVisible = () => {
      if (document.hidden || Date.now() - lastWarmAtMs < WARM_KEEP_ALIVE_MS) return
      fireRosinaWarm(token)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(tick); document.removeEventListener('visibilitychange', onVisible) }
  }, [token, live])
}
