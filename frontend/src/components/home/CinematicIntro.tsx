import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Cinema } from './CinemaScene'

// The opening shot (see CinemaScene.ts) with its words on top. Enter, scroll, a key, or waiting a few
// seconds sends the file into the shredder; the camera dives after it and the black shreds away.

const AUTO_EXIT_MS = 8000
const STRIPS = 14
const EASE_OUT = [0.16, 1, 0.3, 1] as const
const EASE_IN = [0.55, 0, 0.8, 0.2] as const

interface Props {
  fileName: string
  onDone: () => void
  onFallback: () => void
}

export default function CinematicIntro({ fileName, onDone, onFallback }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const cinema = useRef<Cinema | null>(null)
  const [phase, setPhase] = useState<'scene' | 'diving' | 'wipe'>('scene')

  const leave = useCallback(() => {
    if (!cinema.current) return onDone()
    setPhase((p) => (p === 'scene' ? 'diving' : p))
    cinema.current.exit(() => setPhase('wipe'))
  }, [onDone])

  useEffect(() => {
    let alive = true
    let resize = () => {}
    import('./CinemaScene')
      .then(({ createCinema }) => {
        if (!alive || !host.current) return
        try {
          cinema.current = createCinema(host.current, fileName)
        } catch {
          onFallback()
          return
        }
        cinema.current.play()
        resize = () => cinema.current?.resize()
        window.addEventListener('resize', resize)
      })
      .catch(onFallback)
    return () => {
      alive = false
      window.removeEventListener('resize', resize)
      cinema.current?.dispose()
      cinema.current = null
    }
    // The file name is only read once, when the scene is built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const auto = window.setTimeout(leave, AUTO_EXIT_MS)
    const onWheel = (e: WheelEvent) => e.deltaY > 0 && leave()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') leave()
    }
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY)
    const onTouchMove = (e: TouchEvent) => touchY - e.touches[0].clientY > 30 && leave()
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    const html = document.documentElement
    const before = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(auto)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      html.style.overflow = before
    }
  }, [leave])

  useEffect(() => {
    if (phase !== 'wipe') return
    cinema.current?.dispose()
    cinema.current = null
    const done = window.setTimeout(onDone, 1150)
    return () => window.clearTimeout(done)
  }, [phase, onDone])

  return (
    <div className="ci" aria-label="Opening animation" role="dialog" aria-modal="false">
      {phase !== 'wipe' && <div className="ci-canvas" ref={host} aria-hidden="true" />}

      {/* Fade up from black at the start; fade to black during the dive. */}
      <motion.div
        className="ci-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: phase === 'scene' ? 0 : 1 }}
        transition={phase === 'scene' ? { duration: 1.6, ease: 'easeOut' } : { duration: 0.9, delay: 0.2, ease: 'easeIn' }}
        aria-hidden="true"
      />

      {phase === 'wipe' &&
        Array.from({ length: STRIPS }, (_, i) => (
          <motion.span
            key={i}
            className="intro-strip"
            style={{ left: `${(i / STRIPS) * 100}%`, width: `calc(${100 / STRIPS}% + 1px)` }}
            initial={{ y: 0, rotate: 0 }}
            animate={{ y: '110%', rotate: (i % 2 ? 1 : -1) * (2 + (i % 4)) }}
            transition={{ duration: 0.85, ease: EASE_IN, delay: 0.1 + ((i * 7) % STRIPS) * 0.025 }}
          />
        ))}

      {phase === 'scene' && (
        <div className="ci-copy">
          <motion.p
            className="ci-kicker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 2.2, ease: EASE_OUT }}
          >
            ShredSafe
          </motion.p>
          <h1 className="ci-title">
            {['Every', 'file', 'has', 'a', 'fate.'].map((w, i) => (
              <Fragment key={i}>
                <span className="hs-word">
                  <motion.span
                    className="hs-word-in"
                    initial={{ y: '105%' }}
                    animate={{ y: '0%' }}
                    transition={{ duration: 1, delay: 2.5 + i * 0.08, ease: EASE_OUT }}
                  >
                    {w}
                  </motion.span>
                </span>{' '}
              </Fragment>
            ))}
          </h1>
          <motion.p
            className="ci-sub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 3.3 }}
          >
            Some are kept. Some are shredded. Every one is proven.
          </motion.p>
        </div>
      )}

      {phase === 'scene' && (
        <motion.div
          className="ci-actions"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 3.6, ease: EASE_OUT }}
        >
          <button type="button" className="hp-pill" onClick={leave}>
            Enter
          </button>
          <span className="ci-hint">or scroll</span>
        </motion.div>
      )}
    </div>
  )
}
