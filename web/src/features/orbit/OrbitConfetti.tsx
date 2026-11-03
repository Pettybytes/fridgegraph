import {useEffect, useState} from 'react'
import {motion} from 'motion/react'

const palette = ['#65efb2', '#f4db9d', '#fbfff7', '#49c8ba']
const shapes = ['ribbon', 'circle', 'heart', 'star'] as const

/** One bounded, decorative release after an observed FOUND_SAFE close. */
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
      const dx = halo ? (seed - .5) * 300 : side * (160 + seed * 460)
      const height = halo ? 170 + seed * 180 : 220 + seed * 280
      const start = halo ? '50%' : side < 0 ? '4%' : '96%'
      const shape = shapes[index % shapes.length]
      return <motion.span key={index} className={`orbit-particle orbit-particle-${shape}`}
        style={{left: start, top: halo ? '40%' : '52%', backgroundColor: palette[index % palette.length]}}
        initial={{opacity: 0, transform: 'translate3d(0,0,0) rotate(0deg) rotateX(0deg)'}}
        animate={{opacity: [0, 1, 1, 0], transform: [
          'translate3d(0,0,0) rotate(0deg) rotateX(0deg)',
          `translate3d(${dx * .35}px,${-height}px,0) rotate(${side * 120}deg) rotateX(90deg)`,
          `translate3d(${dx * .72}px,${-height * .36}px,0) rotate(${side * 310}deg) rotateX(220deg)`,
          `translate3d(${dx}px,${height * .38}px,0) rotate(${side * 540}deg) rotateX(360deg)`,
        ]}}
        transition={{duration: 2.5, delay: halo ? index * .013 : .1 + wave * .16 + (index % 7) * .025, times: [0, .34, .65, 1], ease: 'easeInOut'}} />
    })}
  </div>
}
