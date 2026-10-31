/**
 * Rosina — the avatar slot. Follows Bryan's approved concept direction: a blue
 * metallic/enamel face, expressive violet eyes, side ear-discs with antenna orbs
 * (the orbit motif), a maid-inspired white scalloped cap, stainless-silver trim,
 * and a small R/rose emblem. Navy/periwinkle/violet/silver palette.
 *
 * This is an ORIGINAL vector rendition for the in-product slot; the concept board
 * in ~/Desktop/fridgegraph-refs stays external and never ships. No standalone
 * production Rosina artwork exists yet — when it does (its real tool recorded,
 * never mislabeled as Muse), pass it via `src` and the states below are preserved.
 *
 * States are REAL only: `ready`; `listening` only while a mic is actually
 * capturing; `thinking` only while a request is pending; `speaking` only while
 * real audio plays; `calm` during Orbit. The state is in the aria-label, so it
 * never rests on the halo colour alone. The gentle halo is the only motion and it
 * holds still under prefers-reduced-motion (handled globally).
 */
import { cn } from 'cn'
import './fg.css'

export type RosinaState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'calm'

const stateLabel: Record<RosinaState, string> = {
  ready: 'Rosina, ready', listening: 'Rosina, listening', thinking: 'Rosina, thinking',
  speaking: 'Rosina, speaking', calm: 'Rosina',
}

export function RosinaAvatar({ state = 'ready', size = 40, src, className }: { state?: RosinaState; size?: number; src?: string; className?: string }) {
  return (
    <span className={cn('fg-rosina', className)} data-state={state} role="img" aria-label={stateLabel[state]} style={{ ['--sz' as string]: `${size}px` }}>
      <span className="fg-rosina-halo" aria-hidden />
      {src ? (
        <img className="fg-rosina-art" src={src} alt="" />
      ) : (
        <svg className="fg-rosina-art" viewBox="0 0 64 64" fill="none" aria-hidden>
          {/* ear discs + antenna orbs */}
          <g stroke="var(--rosina-navy)" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="33" x2="5" y2="29" /><line x1="52" y1="33" x2="59" y2="29" />
          </g>
          <circle cx="4" cy="28" r="2.5" fill="var(--rosina-violet)" />
          <circle cx="60" cy="28" r="2.5" fill="var(--rosina-violet)" />
          <ellipse cx="13" cy="35" rx="5.5" ry="8.5" fill="var(--rosina-navy)" />
          <ellipse cx="51" cy="35" rx="5.5" ry="8.5" fill="var(--rosina-navy)" />
          {/* head — blue metallic enamel + sheen */}
          <rect x="15" y="18" width="34" height="35" rx="16.5" fill="var(--rosina-periwinkle)" />
          <rect x="15" y="18" width="34" height="35" rx="16.5" fill="url(#rosina-sheen)" fillOpacity="0.5" />
          {/* maid-inspired scalloped cap */}
          <g fill="#ffffff" stroke="var(--rosina-silver)" strokeWidth="0.8">
            <path d="M18 19c0-2.4 2-4 4.3-3.4C23.4 13.4 25.5 12.6 27.7 13.2 29 11.4 31.3 11 33.2 12c1.9-1 4.2-.6 5.5 1.2 2.2-.6 4.3.2 5.4 2.4C46.1 15 48 16.6 48 19c0 1.5-1.2 2.7-2.7 2.7H20.7C19.2 21.7 18 20.5 18 19Z" />
          </g>
          {/* face panel */}
          <rect x="20.5" y="26" width="23" height="21.5" rx="10.75" fill="var(--rosina-silver)" fillOpacity="0.32" />
          {/* brows + eyes + smile */}
          <path d="M24.5 31c1.4-1 3.3-1 4.8 0M34.7 31c1.5-1 3.4-1 4.8 0" stroke="var(--rosina-navy)" strokeWidth="1.5" strokeLinecap="round" />
          <ellipse cx="27" cy="35.2" rx="2.5" ry="3.3" fill="var(--rosina-violet)" />
          <ellipse cx="37" cy="35.2" rx="2.5" ry="3.3" fill="var(--rosina-violet)" />
          <path d="M28.5 42.4c2 1.7 5 1.7 7 0" stroke="var(--rosina-navy)" strokeWidth="1.7" strokeLinecap="round" />
          {/* R / rose emblem */}
          <circle cx="32" cy="55.5" r="5.3" fill="#ffffff" stroke="var(--rosina-silver)" strokeWidth="1" />
          <text x="32" y="58.2" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="var(--rosina-navy)" fontFamily="Geist Variable, sans-serif">R</text>
          <defs>
            <linearGradient id="rosina-sheen" x1="15" y1="18" x2="49" y2="53" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fff" stopOpacity="0.55" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      )}
    </span>
  )
}
