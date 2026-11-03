/**
 * FridgeGraph design-v2 Card family. Bound by docs/contracts/design.md and the
 * colour legend in docs/design.md. ONE family — every shape is a variant built on
 * <Card>, no forks. A card's TYPE drives its colour everywhere (accent bar, icon
 * node, corner glow, progress, tile) via the shared `data-fgc-type` attribute.
 *
 * Status is always carried by text + icon as well as colour (design.md §6): the
 * icon chip uses the type colour as its glyph, never a bare colour dot.
 */
import * as React from 'react'
import { cn } from 'cn'
import './cards.css'

export type CardType =
  | 'pickup' | 'school' | 'orbit' | 'safe' | 'care'
  | 'invite' | 'fridge' | 'rosina' | 'pending' | 'neutral'

type Elevation = 1 | 2 | 3

/* ── Base card ────────────────────────────────────────────────────────────── */
export interface CardProps extends React.ComponentProps<'div'> {
  type?: CardType
  elevation?: Elevation
  glass?: boolean
  interactive?: boolean
  glow?: boolean
  pad?: boolean
}
export function Card({ type, elevation = 1, glass, interactive, glow, pad = true, className, ...p }: CardProps) {
  return (
    <div
      className={cn('fgc', className)}
      data-fgc-type={type || undefined}
      data-elev={elevation}
      data-glass={glass || undefined}
      data-interactive={interactive || undefined}
      data-glow={glow || undefined}
      data-pad={pad ? 'true' : undefined}
      {...p}
    />
  )
}

/* ── Type icon node — colour + glyph encode the type (never a bare dot) ─────── */
export function TypeNode({ type, size, className, children, ...p }: Omit<React.ComponentProps<'span'>, 'color'> & { type: CardType; size?: 'sm' }) {
  return (
    <span className={cn('fgc-node', className)} data-fgc-type={type} data-size={size} {...p}>
      {children}
    </span>
  )
}

/* ── Type pill badge ────────────────────────────────────────────────────────── */
export function TypePill({ type = 'neutral', glass, className, children, ...p }: React.ComponentProps<'span'> & { type?: CardType; glass?: boolean }) {
  return (
    <span className={cn('fgc-pill', className)} data-fgc-type={type} data-glass={glass || undefined} {...p}>
      {children}
    </span>
  )
}

/* ── Progress bar — thin, glowing, type-coloured (0–100) ────────────────────── */
export function ProgressBar({ value, type = 'safe', label, className, ...p }: Omit<React.ComponentProps<'div'>, 'children'> & { value: number; type?: CardType; label?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('fgc-progress', className)} data-fgc-type={type} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label} {...p}>
      <span className="fgc-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ── Accent-bar row (ref-stacked-status) ────────────────────────────────────── */
export function AccentCard({ type, elevation = 1, glass, interactive, className, children, ...p }: Omit<CardProps, 'glow' | 'pad'> & { type: CardType }) {
  return (
    <Card type={type} elevation={elevation} glass={glass} interactive={interactive} pad={false} className={cn('fgc-accent', className)} {...p}>
      <span className="fgc-accent-bar" aria-hidden />
      <div className="fgc-accent-body">{children}</div>
    </Card>
  )
}

/* ── Status card (ref-upload-toasts): corner glow, node, body, actions ──────── */
export function StatusCard({ type, elevation = 2, glass, icon, title, onClose, actions, className, children, ...p }: Omit<CardProps, 'glow' | 'pad' | 'title'> & { type: CardType; icon?: React.ReactNode; title: React.ReactNode; onClose?: () => void; actions?: React.ReactNode }) {
  return (
    <Card type={type} elevation={elevation} glass={glass} pad={false} className={cn('fgc-status', className)} role="status" {...p}>
      {icon ? <TypeNode type={type}>{icon}</TypeNode> : <span />}
      <div className="fgc-status-body">
        <span className="fgc-status-title">{title}</span>
        {children ? <span className="fgc-status-text">{children}</span> : null}
        {actions ? <div className="fgc-status-actions">{actions}</div> : null}
      </div>
      {onClose ? (
        <button type="button" className="fg-iconbtn" aria-label="Dismiss" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      ) : <span />}
    </Card>
  )
}

/* ── Horizontal media card (ref-progress-cards): thumb, title, progress ─────── */
export function MediaCard({ type = 'neutral', elevation = 1, interactive, thumb, thumbAlt = '', title, meta, progress, className, ...p }: Omit<CardProps, 'glow' | 'pad'> & { type?: CardType; thumb?: string; thumbAlt?: string; title: React.ReactNode; meta?: React.ReactNode; progress?: number }) {
  return (
    <Card type={type} elevation={elevation} interactive={interactive} pad={false} className={cn('fgc-media', className)} {...p}>
      {thumb ? <img className="fgc-media-thumb" src={thumb} alt={thumbAlt} loading="lazy" decoding="async" /> : <span className="fgc-media-thumb" aria-hidden />}
      <div className="fgc-media-body">
        <span className="fgc-media-title">{title}</span>
        {typeof progress === 'number' ? <ProgressBar value={progress} type={type} /> : null}
        {meta ? <span className="fgc-media-meta">{meta}</span> : null}
      </div>
    </Card>
  )
}

/* ── Timeline row (ref-timeline): time | type node (+rail) | card ───────────── */
export function TimelineRow({ time, type, icon, last, className, children, ...p }: React.ComponentProps<'div'> & { time: React.ReactNode; type: CardType; icon?: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn('fgc-timeline', className)} data-last={last ? 'true' : undefined} {...p}>
      <span className="fgc-timeline-time">{time}</span>
      <span className="fgc-timeline-rail"><TypeNode type={type} size="sm">{icon}</TypeNode></span>
      <div className="fgc-timeline-card">{children}</div>
    </div>
  )
}

/* ── Photo card (ref-photo-months): image, huge title, pill badge, menu ─────── */
export function PhotoCard({ src, alt = '', title, badge, menu, className, ...p }: Omit<CardProps, 'glow' | 'pad' | 'type' | 'title'> & { src: string; alt?: string; title: React.ReactNode; badge?: React.ReactNode; menu?: React.ReactNode }) {
  return (
    <Card pad={false} className={cn('fgc-photo', className)} {...p}>
      <img className="fgc-photo-img" src={src} alt={alt} loading="lazy" decoding="async" />
      {badge ? <span className="fgc-photo-badge">{badge}</span> : null}
      {menu ? <span className="fgc-photo-menu">{menu}</span> : null}
      <h3 className="fgc-photo-title">{title}</h3>
    </Card>
  )
}

/* ── Metric / bento tile (ref-color-tiles): gradient per type, big number ───── */
export function MetricTile({ type, label, value, foot, className, children, ...p }: Omit<CardProps, 'glow' | 'pad'> & { type: CardType; label: React.ReactNode; value: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <Card type={type} pad={false} className={cn('fgc-tile', className)} {...p}>
      <span className="fgc-tile-label">{label}</span>
      <span className="fgc-tile-value">{value}</span>
      {foot ? <span className="fgc-tile-foot">{foot}</span> : null}
      {children}
    </Card>
  )
}
