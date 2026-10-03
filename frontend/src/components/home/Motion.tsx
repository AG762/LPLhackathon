import { Fragment, useRef, type ReactNode } from 'react'
import { motion, useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react'

const EASE = [0.16, 1, 0.3, 1] as const

// Heading lines rise out of masks, word by word, the first time they scroll into view.
// The heading as a whole is watched: the words themselves start clipped, so they never "enter" view.
export function Rise({ lines }: { lines: string[] }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  if (reduce) return <>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</>
  let n = 0
  return (
    <span ref={ref} className="rise">
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {line.split(' ').map((word, wi) => {
            const order = n++
            return (
              <Fragment key={wi}>
                <span className="rise-word">
                  <motion.span
                    className="rise-in"
                    initial={{ y: '105%' }}
                    animate={{ y: inView ? '0%' : '105%' }}
                    transition={{ duration: 0.85, delay: order * 0.045, ease: EASE }}
                  >
                    {word}
                  </motion.span>
                </span>{' '}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </span>
  )
}

// Leans toward the pointer while hovered, then springs back.
export function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 })
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 })

  if (reduce) return <>{children}</>

  return (
    <motion.span
      ref={ref}
      className="magnetic"
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect()
        x.set((e.clientX - (r.left + r.width / 2)) * strength)
        y.set((e.clientY - (r.top + r.height / 2)) * strength)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.span>
  )
}
