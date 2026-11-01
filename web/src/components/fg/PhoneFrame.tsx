/**
 * PhoneFrame — our own drawn device frame. Bound by docs/contracts/design.md §8.
 * No Apple hardware artwork. Concentric corners from the shared radius tokens
 * (device 44 − 8px bezel = screen 36). The screen clips its content accurately
 * (overflow:hidden on a radius-matched box). All chrome is decorative and
 * non-interactive; the status-bar time is cosmetic and never feeds token logic.
 *
 * A persistent caption states whose perspective this is, the child context, and
 * whether the data is live / sample / simulated — labels the showcase must keep
 * visible. `bare` renders just the clipped screen (embed use) without the bezel.
 */
import { cn } from 'cn'
import './fg.css'

export type FrameStatus = 'live' | 'sample' | 'simulated'
const statusLabel: Record<FrameStatus, string> = { live: 'Live', sample: 'Sample', simulated: 'Simulated' }

export function PhoneFrame({
  label,
  context,
  status = 'sample',
  time = '9:41',
  bare = false,
  children,
  className,
}: {
  label: string
  context?: string
  status?: FrameStatus
  time?: string
  bare?: boolean
  children: React.ReactNode
  className?: string
}) {
  const screen = (
    <div className="fg-phone-screen">
      <div className="fg-phone-statusbar" aria-hidden>
        <span className="fg-phone-time">{time}</span>
        <span className="fg-phone-notch" />
        <span className="fg-phone-signal">
          <svg viewBox="0 0 24 12" aria-hidden><rect x="1" y="7" width="3" height="4" rx="1" /><rect x="6" y="5" width="3" height="6" rx="1" /><rect x="11" y="3" width="3" height="8" rx="1" /><rect x="16" y="2" width="5" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </span>
      </div>
      <div className="fg-phone-content">{children}</div>
    </div>
  )

  if (bare) return <div className={cn('fg-phone-bare', className)}>{screen}</div>

  return (
    <figure className={cn('fg-phone', className)} role="group" aria-label={`${label}${context ? ` · ${context}` : ''} — ${statusLabel[status]}`}>
      <div className="fg-phone-device">
        {screen}
        <span className="fg-phone-home" aria-hidden />
      </div>
      <figcaption className="fg-phone-caption">
        <span className="fg-phone-who">{label}</span>
        {context ? <span className="fg-phone-ctx">{context}</span> : null}
        <span className="fg-phone-status" data-status={status}>{statusLabel[status]}</span>
      </figcaption>
    </figure>
  )
}
