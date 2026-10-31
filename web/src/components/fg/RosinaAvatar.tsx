/**
 * Rosina — the avatar slot. Bound by docs/contracts/design.md §9.
 *
 * An ORIGINAL robot head in her palette (navy/periwinkle/violet/silver), taken
 * from Bryan's concept direction MINUS every Rosie-maid element (no cap, collar,
 * apron, uniform or "R" brooch). Head-focused so it stays legible at 32–48px and
 * carries no outfit at all. This monogram-free line/enamel art is the placeholder
 * until Muse Image production art exists; swapping that in is a one-prop change
 * (`src`) with the states preserved.
 *
 * States are REAL only: `ready`; `listening` only while a mic is actually
 * capturing; `thinking` only while a request is pending; `speaking` only while
 * real audio plays; `calm` during Orbit. The state is announced in the
 * aria-label, so it never depends on the halo colour alone. The halo's gentle
 * pulse is the only motion, and it is state indication — it holds still under
 * prefers-reduced-motion (handled globally) with the state still legible.
 */
import { cn } from 'cn'
import './fg.css'

export type RosinaState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'calm'

const stateLabel: Record<RosinaState, string> = {
  ready: 'Rosina, ready',
  listening: 'Rosina, listening',
  thinking: 'Rosina, thinking',
  speaking: 'Rosina, speaking',
  calm: 'Rosina',
}

export function RosinaAvatar({ state = 'ready', size = 40, src, className }: { state?: RosinaState; size?: number; src?: string; className?: string }) {
  return (
    <span
      className={cn('fg-rosina', className)}
      data-state={state}
      role="img"
      aria-label={stateLabel[state]}
      style={{ ['--sz' as string]: `${size}px` }}
    >
      <span className="fg-rosina-halo" aria-hidden />
      {src ? (
        <img className="fg-rosina-art" src={src} alt="" />
      ) : (
        <svg className="fg-rosina-art" viewBox="0 0 64 64" fill="none" aria-hidden>
          {/* ear discs + antenna orbs — the orbit/connection motif */}
          <g stroke="var(--rosina-navy)" strokeWidth="2">
            <line x1="12" y1="30" x2="5" y2="26" strokeLinecap="round" />
            <line x1="52" y1="30" x2="59" y2="26" strokeLinecap="round" />
          </g>
          <circle cx="4" cy="25" r="2.6" fill="var(--rosina-violet)" />
          <circle cx="60" cy="25" r="2.6" fill="var(--rosina-violet)" />
          <ellipse cx="13" cy="33" rx="6" ry="9" fill="var(--rosina-navy)" />
          <ellipse cx="51" cy="33" rx="6" ry="9" fill="var(--rosina-navy)" />
          {/* head — rounded enamel */}
          <rect x="15" y="16" width="34" height="36" rx="17" fill="var(--rosina-periwinkle)" />
          <rect x="15" y="16" width="34" height="36" rx="17" fill="url(#rosina-sheen)" fillOpacity="0.5" />
          {/* face panel */}
          <rect x="20" y="24" width="24" height="23" rx="11.5" fill="var(--rosina-silver)" fillOpacity="0.35" />
          {/* brows */}
          <path d="M24 29.5c1.5-1 3.5-1 5 0M35 29.5c1.5-1 3.5-1 5 0" stroke="var(--rosina-navy)" strokeWidth="1.6" strokeLinecap="round" />
          {/* eyes */}
          <ellipse className="fg-rosina-eye" cx="26.5" cy="34" rx="2.6" ry="3.4" fill="var(--rosina-violet)" />
          <ellipse className="fg-rosina-eye" cx="37.5" cy="34" rx="2.6" ry="3.4" fill="var(--rosina-violet)" />
          {/* calm smile */}
          <path d="M28 41.5c2 1.8 6 1.8 8 0" stroke="var(--rosina-navy)" strokeWidth="1.8" strokeLinecap="round" />
          <defs>
            <linearGradient id="rosina-sheen" x1="15" y1="16" x2="49" y2="52" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fff" stopOpacity="0.55" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      )}
    </span>
  )
}
