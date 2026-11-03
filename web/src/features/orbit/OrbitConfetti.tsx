import {useEffect, useState} from 'react'

const palette = ['#65efb2', '#f4db9d', '#fbfff7', '#49c8ba']
const shapes = ['ribbon', 'circle', 'heart', 'star'] as const

/**
 * One bounded, decorative release after an observed FOUND_SAFE close.
 *
 * The flight is CSS keyframes with per-particle custom properties, not a JS tween: a keyframe
 * animation on a fixed number of transform/opacity values is cheaper than 72 concurrent JS tweens
 * and it is the only animation system this component uses. (The previous Motion version wrote
 * transform STRINGS as keyframes; Motion 14 applied only the last string, so every particle sat at
 * opacity 0 and the confetti never visibly played.)
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
      const wave = Math.floor(index / (count / 3))
      const halo = index < Math.ceil(count / 4)
      const side = index % 2 ? 1 : -1
      const seed = (index * 47) % 101 / 100
      // A particle released at an edge must travel INWARD. `side` decides which edge it starts on
      // (side<0 → 4%, side>0 → 96%), so the offset has the opposite sign; with `side *` they flew
      // outward and off-screen on the first frame, leaving only the centre halo visible.
      const dx = halo ? (seed - .5) * 300 : -side * (160 + seed * 460)
      const height = halo ? 170 + seed * 180 : 220 + seed * 280
      const start = halo ? '50%' : side < 0 ? '4%' : '96%'
      const shape = shapes[index % shapes.length]
      const style = {
        left: start,
        top: halo ? '40%' : '52%',
        backgroundColor: palette[index % palette.length],
        // Custom properties drive the single keyframe animation below.
        '--dx': `${dx.toFixed(1)}px`,
        '--rise': `${(-height).toFixed(1)}px`,
        '--fall': `${(height * .38).toFixed(1)}px`,
        '--rot': `${side * 540}deg`,
        animationDelay: `${(halo ? index * .013 : .1 + wave * .16 + (index % 7) * .025).toFixed(3)}s`,
      } as React.CSSProperties
      return <span key={index} className={`orbit-particle orbit-particle-${shape}`} style={style} />
    })}
  </div>
}
