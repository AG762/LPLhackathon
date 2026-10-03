import { useEffect, useRef, useState } from 'react'
import { animate, motion } from 'motion/react'
import { BrandMark } from '../BrandMark'

// Opening sequence: the mark and a quick file count on black, then the black screen itself is
// shredded into strips that fall away to reveal the page. Click or press any key to skip.

export const INTRO_SECONDS = 2.5

const STRIPS = 14
const EASE_IN = [0.55, 0, 0.8, 0.2] as const
const EASE_OUT = [0.16, 1, 0.3, 1] as const

export default function Intro({ files, onDone }: { files: number; onDone: () => void }) {
  const [count, setCount] = useState(0)
  const [cutting, setCutting] = useState(false)
  // Read the latest count without restarting the sequence when /files arrives mid-intro.
  const target = useRef(files)
  useEffect(() => {
    target.current = files
  }, [files])

  useEffect(() => {
    const counter = animate(0, 1, {
      duration: 1.1,
      delay: 0.35,
      ease: EASE_OUT,
      onUpdate: (v) => setCount(Math.round(v * target.current)),
    })
    const cut = window.setTimeout(() => setCutting(true), 1500)
    const done = window.setTimeout(onDone, INTRO_SECONDS * 1000)
    const skip = () => onDone()
    window.addEventListener('keydown', skip)
    return () => {
      counter.stop()
      window.clearTimeout(cut)
      window.clearTimeout(done)
      window.removeEventListener('keydown', skip)
    }
  }, [onDone])

  return (
    <div className="intro" onClick={onDone} role="presentation">
      {Array.from({ length: STRIPS }, (_, i) => (
        <motion.span
          key={i}
          className="intro-strip"
          style={{ left: `${(i / STRIPS) * 100}%`, width: `calc(${100 / STRIPS}% + 1px)` }}
          initial={false}
          animate={cutting ? { y: '110%', rotate: (i % 2 ? 1 : -1) * (2 + (i % 4)) } : { y: 0, rotate: 0 }}
          transition={{ duration: 0.85, ease: EASE_IN, delay: cutting ? ((i * 7) % STRIPS) * 0.025 : 0 }}
        />
      ))}

      <motion.div
        className="intro-center"
        initial={{ opacity: 0, y: 12 }}
        animate={cutting ? { opacity: 0, y: -12 } : { opacity: 1, y: 0 }}
        transition={{ duration: cutting ? 0.25 : 0.6, ease: EASE_OUT }}
      >
        <div className="intro-brand">
          <BrandMark />
          ShredSafe
        </div>
        <div className="intro-count">
          <span className="num">{String(count).padStart(2, '0')}</span> files checked
        </div>
        <div className="intro-bar">
          <motion.span
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.1, delay: 0.35, ease: EASE_OUT }}
          />
        </div>
      </motion.div>
    </div>
  )
}
