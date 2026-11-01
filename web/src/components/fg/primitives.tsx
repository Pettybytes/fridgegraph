/**
 * FridgeGraph UI primitives. Bound by docs/contracts/design.md.
 * Composes the existing shadcn Button where a full button is needed; adds the
 * surfaces, chips, avatar, feedback and inputs the product's own identity needs.
 * Status is always carried by an icon + text, never colour alone.
 */
import * as React from 'react'
import { cn } from 'cn'
import { portraitFor } from './portraits'
import './fg.css'

/* ── Icons — one consistent 1.5px-stroke family, sized by currentColor ──── */
type IconProps = React.SVGProps<SVGSVGElement>
const svg = (path: React.ReactNode) => (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>{path}</svg>
)
export const Icon = {
  check: svg(<path d="M20 6 9 17l-5-5" />),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  sparkle: svg(<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.4 2.4m6.6 6.6 2.4 2.4m0-11.4-2.4 2.4m-6.6 6.6-2.4 2.4" />),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  alert: svg(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>),
  send: svg(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />),
  pin: svg(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  calendar: svg(<><rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2.5v4m8-4v4" /></>),
  users: svg(<><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7.5" r="3.5" /><path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75" /></>),
  chevron: svg(<path d="m9 6 6 6-6 6" />),
  doc: svg(<><path d="M14 3v5h5" /><path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5Z" /></>),
}

/* ── Surface / card ───────────────────────────────────────────────────── */
export function Surface({ elevated, pad = true, nested, className, ...p }: React.ComponentProps<'div'> & { elevated?: boolean; pad?: boolean; nested?: boolean }) {
  return <div className={cn(nested ? 'fg-nested' : 'fg-surface', className)} data-elevated={elevated || undefined} data-pad={!nested && pad ? 'true' : undefined} {...p} />
}

/* ── Status chip ──────────────────────────────────────────────────────── */
export type ChipTone = 'neutral' | 'brand' | 'onway' | 'withme' | 'simulated' | 'real' | 'attention'
const chipIcon: Partial<Record<ChipTone, React.ComponentType<IconProps>>> = {
  onway: Icon.clock, withme: Icon.check, simulated: Icon.info, real: Icon.check, attention: Icon.alert, brand: Icon.sparkle,
}
export function StatusChip({ tone = 'neutral', icon = true, children, className, ...p }: React.ComponentProps<'span'> & { tone?: ChipTone; icon?: boolean }) {
  const I = chipIcon[tone]
  return <span className={cn('fg-chip', className)} data-tone={tone} {...p}>{icon && I ? <I /> : null}{children}</span>
}

/* ── Source chip — grounded provenance for a specific answer ───────────── */
export function SourceChip({ children, className, ...p }: React.ComponentProps<'span'>) {
  return <span className={cn('fg-source', className)} {...p}><Icon.doc /><span>{children}</span></span>
}

/* ── Avatar (monogram until Muse Image art; swap is one prop) ──────────── */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
export function Avatar({ name, kind = 'adult', size = 40, src, personId, className, ...p }: Omit<React.ComponentProps<'span'>, 'children'> & { name: string; kind?: 'child' | 'adult'; size?: number; src?: string; personId?: string | null }) {
  const art = src ?? portraitFor({ personId, name })
  return (
    <span className={cn('fg-avatar', className)} data-kind={kind} data-art={art ? 'true' : undefined} style={{ ['--sz' as string]: `${size}px` }} aria-hidden {...p}>
      {art ? <img src={art} alt="" loading="lazy" decoding="async" /> : initials(name)}
    </span>
  )
}

/* ── Inline feedback ──────────────────────────────────────────────────── */
type FeedbackTone = 'info' | 'success' | 'warning' | 'error'
const feedbackIcon: Record<FeedbackTone, React.ComponentType<IconProps>> = { info: Icon.info, success: Icon.check, warning: Icon.alert, error: Icon.alert }
export function InlineFeedback({ tone = 'info', children, className, ...p }: React.ComponentProps<'div'> & { tone?: FeedbackTone }) {
  const I = feedbackIcon[tone]
  return <div className={cn('fg-feedback', className)} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'} {...p}><I /><div>{children}</div></div>
}

/* ── Field ────────────────────────────────────────────────────────────── */
export function Field({ label, error, id, className, ...p }: React.ComponentProps<'input'> & { label: string; error?: string }) {
  const autoId = React.useId()
  const fieldId = id ?? autoId
  return (
    <div className={cn('fg-field', className)}>
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fieldId}-err` : undefined} {...p} />
      {error ? <span id={`${fieldId}-err`} className="fg-field-error">{error}</span> : null}
    </div>
  )
}

/* ── Composer (text entry with a send affordance; no fake mic) ─────────── */
export function Composer({ onSend, placeholder = 'Ask Rosina…', disabled, sendLabel = 'Send', className }: { onSend?: (value: string) => void; placeholder?: string; disabled?: boolean; sendLabel?: string; className?: string }) {
  const [value, setValue] = React.useState('')
  const submit = () => { const v = value.trim(); if (v && onSend) { onSend(v); setValue('') } }
  return (
    <div className={cn('fg-composer', className)}>
      <input
        value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} disabled={disabled}
        aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
      />
      <IconButton label={sendLabel} variant="brand" disabled={disabled || value.trim() === ''} onClick={submit}><Icon.send /></IconButton>
    </div>
  )
}

/* ── Icon button (aria-label required) ────────────────────────────────── */
export function IconButton({ label, variant, className, children, ...p }: Omit<React.ComponentProps<'button'>, 'aria-label'> & { label: string; variant?: 'brand' }) {
  return <button type="button" className={cn('fg-iconbtn', className)} data-variant={variant} aria-label={label} title={label} {...p}>{children}</button>
}

/* ── Plain pressable (when a full shadcn Button isn't warranted) ───────── */
export function FgButton({ variant = 'primary', loading, disabledReason, disabled, children, className, ...p }: React.ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'quiet'; loading?: boolean; disabledReason?: string }) {
  const isDisabled = disabled || loading
  return (
    <button
      type="button" className={cn('fg-btn', className)} data-variant={variant} data-loading={loading || undefined}
      disabled={isDisabled} aria-disabled={isDisabled || undefined} aria-busy={loading || undefined}
      title={disabled && disabledReason ? disabledReason : undefined}
      {...p}
    >{children}</button>
  )
}
