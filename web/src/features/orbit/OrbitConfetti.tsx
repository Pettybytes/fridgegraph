import {useEffect, useState} from 'react'

// Festive but restrained: whites and warm accents that read against the green payoff, not green-on-green.
const palette = ['#fbfff7', '#f4db9d', '#ff9fb0', '#b9c4ff', '#ffd27a']
const shapes = ['ribbon', 'circle', 'heart', 'star'] as const

/**
 * One bounded, decorative release after an observed FOUND_SAFE close.
 *
 * The flight is CSS keyframes with per-particle custom properties, not a JS tween: a keyframe
 * animation on a fixed set of transform/opacity values is cheaper than dozens of concurrent JS
 * tweens and it is the only animation system this component uses. Each particle springs OUTWARD
 * from the check mark (origin near 50%/40%) on a fast ease-out, then gravity carries it down and
 * fades it out between 1.6 and 2.4 s. (A prior Motion version wrote transform STRINGS as keyframes;
 * Motion 14 applied only the last string, so every particle sat at opacity 0 and never played.)
 */
export function OrbitConfetti() {
  const [visible, setVisible] = useState(() => !document.hidden)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 600)
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    const resize = () => setNarrow(window.innerWidth < 600)
    document.addEventListener('visibilitychange', change)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('visibilitychange', change); window.removeEventListener('resize', resize) }
  }, [])
  if (!visible) return null
  const count = narrow ? 36 : 72
  return <div className="orbit-confetti" aria-hidden="true" data-particles={count}>
    {Array.from({length: count}, (_, index) => {
      const side = index % 2 ? 1 : -1
      const seed = (index * 47) % 101 / 100
      const seed2 = (index * 79) % 97 / 97
      // Radial burst from the check: an angle around the full circle, a small upward bias so the
      // spray reads as a celebration rising off the mark, then gravity (--fy) pulls each shape down.
      const angle = (index / count) * Math.PI * 2 + (seed - .5) * .6
      const dist = 120 + seed * 300
      const bx = Math.cos(angle) * dist
      const by = Math.sin(angle) * dist * .8 - 40
      const fall = 300 + seed2 * 280
      const shape = shapes[index % shapes.length]
      const style = {
        left: '50%',
        top: '40%',
        backgroundColor: palette[index % palette.length],
        // Custom properties drive the single keyframe animation below.
        '--bx': `${bx.toFixed(1)}px`,
        '--by': `${by.toFixed(1)}px`,
        '--fx': `${(bx * .92 + (seed2 - .5) * 60).toFixed(1)}px`,
        '--fy': `${(by + fall).toFixed(1)}px`,
        '--rot': `${(side * (360 + seed * 540)).toFixed(0)}deg`,
        animationDuration: `${(1.6 + seed2 * .8).toFixed(2)}s`,
        animationDelay: `${((index % 6) * .015 + seed * .05).toFixed(3)}s`,
      } as React.CSSProperties
      return <span key={index} className={`orbit-particle orbit-particle-${shape}`} style={style} />
    })}
  </div>
}
