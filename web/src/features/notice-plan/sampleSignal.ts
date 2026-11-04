// A tiny, latched signal bus between the Today judge card (Card 1) and the real Notice
// composer. The card's one trigger asks the composer to stage the authorized Nora sample and
// run the SAME review path a judge would click by hand; the composer reports back the server's
// recorded pickup job. No parallel action path, no secret ever crosses here — a job id is a
// non-secret record identifier, and nothing authorizes anything.

export const NOTICE_SAMPLE_EVENT = 'fg:notice-open-sample'
export const NOTICE_CONFIRMED_EVENT = 'fg:notice-confirmed'

export type NoticeConfirmedDetail = { childId: string; jobId: string; status: string; mode: 'mock' | 'live' }

// A request can arrive a frame before the composer mounts (e.g. Rosina was dismissed). Latch the
// most recent request briefly so a composer mounting right after still picks it up exactly once.
let pendingAt = 0
const LATCH_MS = 3000

/** Card 1 trigger: ask the mounted (or about-to-mount) composer to stage the sample + review. */
export function requestNoticeSample() {
  pendingAt = Date.now()
  window.dispatchEvent(new Event(NOTICE_SAMPLE_EVENT))
}

/** Composer side: run `handler` for a pending or future sample request. Returns an unsubscribe. */
export function onNoticeSampleRequest(handler: () => void): () => void {
  if (pendingAt && Date.now() - pendingAt < LATCH_MS) { pendingAt = 0; handler() }
  const listener = () => { pendingAt = 0; handler() }
  window.addEventListener(NOTICE_SAMPLE_EVENT, listener)
  return () => window.removeEventListener(NOTICE_SAMPLE_EVENT, listener)
}

/** Composer side: report the server's recorded pickup job after a confirmed notice. */
export function announceNoticeConfirmed(detail: NoticeConfirmedDetail) {
  window.dispatchEvent(new CustomEvent<NoticeConfirmedDetail>(NOTICE_CONFIRMED_EVENT, { detail }))
}

/** Card side: subscribe to confirmed-notice reports. Returns an unsubscribe. */
export function onNoticeConfirmed(handler: (detail: NoticeConfirmedDetail) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const row = detail as Record<string, unknown>
    if (typeof row.childId !== 'string' || !row.childId || typeof row.jobId !== 'string' || !row.jobId ||
        (row.mode !== 'mock' && row.mode !== 'live')) return
    handler({ childId: row.childId, jobId: row.jobId, status: typeof row.status === 'string' ? row.status : '', mode: row.mode })
  }
  window.addEventListener(NOTICE_CONFIRMED_EVENT, listener)
  return () => window.removeEventListener(NOTICE_CONFIRMED_EVENT, listener)
}
