/**
 * Rosina — the canonical avatar.
 *
 * Source art: Bryan's approved production exception — the ONE concept board
 * "Rosina's stainless-silver robot concept board.png" (brought into the repo at
 * src/assets/rosina/rosina-board.png, downscaled, CONTENT UNCHANGED). This is the
 * documented exception to "no reference assets in the repo"; every other board and
 * screenshot stays external. The art was NOT drawn or regenerated here — we crop
 * the board's own tiles with a CSS viewport crop:
 *   - Ready tile      (orig 1536×1024: x854 y48 w320 h330) — the resting avatar
 *   - Thoughtful tile (x≈985 y≈470 w320 h330)             — shown only while a
 *                                                            request is really pending
 * Crop values are expressed as ratios of the image, so they hold at any downscale.
 *
 * States are REAL only: `ready`/`calm`/`listening`/`speaking` show Ready; `thinking`
 * shows Thoughtful and must be set only while a request is genuinely in flight. The
 * state is in the aria-label, never signalled by the halo colour alone. The gentle
 * halo is the only motion and holds still under prefers-reduced-motion (global).
 *
 * `src` overrides the board crop with a single supplied image (e.g. a future
 * standalone production render) — record its real tool, never mislabel as Muse.
 */
import { cn } from 'cn'
import boardArt from '../../assets/rosina/rosina-board.png'
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
      {src
        ? <img className="fg-rosina-art fg-rosina-art-img" src={src} alt="" />
        : <span className="fg-rosina-art" aria-hidden style={{ backgroundImage: `url(${boardArt})` }} />}
    </span>
  )
}
