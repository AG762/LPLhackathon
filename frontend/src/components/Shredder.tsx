import { useEffect, useMemo, useState } from 'react'
import { motion, useAnimate, useInView, useReducedMotion } from 'motion/react'
import type { AnimationOptions, DOMKeyframesDefinition } from 'motion/react'
import { VERDICT, type ShredItem as Item } from '../lib/shredItems'

// The home page hero: files drop into a shredder one at a time and get the same decision the portal
// would give them. Cleared files are cut into strips; a file under legal hold is stopped at the slot;
// required records are stamped and set aside.

const STRIPS = 9
const EASE = [0.16, 1, 0.3, 1] as const

export default function Shredder({ items }: { items: Item[] }) {
  const reduce = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const inView = useInView(scope, { amount: 0.3 })
  const [paused, setPaused] = useState(false)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'reading' | 'decided'>('reading')
  const [shredding, setShredding] = useState(false)
  const [holdUp, setHoldUp] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [tally, setTally] = useState({ shred: 0, hold: 0, kept: 0 })

  const item = items[index % items.length]
  const running = !paused && inView && !reduce
  const strips = useMemo(() => Array.from({ length: STRIPS }, (_, i) => ({ i, turn: (i % 2 ? 1 : -1) * (3 + ((i * 7) % 6)) })), [])

  useEffect(() => {
    if (!running || !item) return
    let cancelled = false
    const live: { stop: () => void }[] = []
    const step = async (keyframes: DOMKeyframesDefinition, options: AnimationOptions) => {
      if (cancelled) throw new Error('cancelled')
      const controls = animate('.ss-card', keyframes, options)
      live.push(controls)
      await controls
      if (cancelled) throw new Error('cancelled')
    }
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => setTimeout(() => (cancelled ? reject(new Error('cancelled')) : resolve()), ms))

    const run = async () => {
      // Let motion finish mounting the new card first; its mount step would otherwise cancel our animation.
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await step({ y: [-190, 40], x: 0, rotate: [-2, 0], opacity: [0, 1] }, { duration: 0.7, ease: EASE })
      await wait(550)
      setPhase('decided')

      if (item.outcome === 'shred') {
        await step({ y: 70 }, { duration: 0.3, ease: EASE })
        setShredding(true)
        await step({ y: 250 }, { duration: 1.15, ease: 'linear' })
        setTally((t) => ({ ...t, shred: t.shred + 1 }))
        await wait(900)
      } else if (item.outcome === 'hold') {
        await step({ y: 70 }, { duration: 0.3, ease: EASE })
        setHoldUp(true)
        await wait(160)
        await step({ y: 6, rotate: -3 }, { duration: 0.45, ease: EASE })
        setTally((t) => ({ ...t, hold: t.hold + 1 }))
        await wait(900)
        await step({ x: 340, rotate: 6, opacity: 0 }, { duration: 0.55, ease: [0.5, 0, 0.75, 0] })
        setHoldUp(false)
      } else {
        setStamped(true)
        setTally((t) => ({ ...t, kept: t.kept + 1 }))
        await wait(1100)
        await step({ x: -340, rotate: -6, opacity: 0 }, { duration: 0.55, ease: [0.5, 0, 0.75, 0] })
      }
      const last = index === items.length - 1
      await wait(last ? 1800 : 250)
      // Reset in the same render that mounts the next card, so nothing re-renders mid-animation.
      setPhase('reading')
      setShredding(false)
      setHoldUp(false)
      setStamped(false)
      if (last) setTally({ shred: 0, hold: 0, kept: 0 })
      setIndex((i) => (i + 1) % items.length)
    }
    run().catch(() => {})
    return () => {
      cancelled = true
      live.forEach((c) => c.stop())
    }
  }, [running, index, item, items.length, animate])

  if (reduce) return <StaticShredder items={items} />

  const verdictClass = phase === 'decided' ? `ss-readout-${item.outcome}` : ''

  return (
    <figure className="ss" aria-label="Animation: files going through ShredSafe one at a time">
      <div className="ss-stage" ref={scope} aria-hidden="true">
        <div className="ss-feed">
          <motion.div className="ss-card" key={`${item.id}-${index}`} initial={{ y: -190, opacity: 0 }}>
            <div className="ss-card-name">{item.name}</div>
            <div className="ss-card-kind">{item.kind}</div>
            {item.client && <div className="ss-card-client">{item.client}</div>}
            <div className="ss-card-lines" />
            {stamped && item.stamp && (
              <motion.div
                className={`ss-stamp ss-stamp-${item.outcome}`}
                initial={{ scale: 1.7, opacity: 0, rotate: -14 }}
                animate={{ scale: 1, opacity: 1, rotate: -8 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                {item.stamp}
              </motion.div>
            )}
          </motion.div>
        </div>

        <motion.div
          className="ss-hold"
          initial={false}
          animate={{ scaleX: holdUp ? 1 : 0, opacity: holdUp ? 1 : 0 }}
          transition={{ duration: holdUp ? 0.16 : 0.3, ease: EASE }}
        >
          <span className="ss-hold-tri" />
          Legal hold
        </motion.div>

        <div className="ss-head">
          <div className="ss-slot" />
          <div className={`ss-readout ${verdictClass}`}>
            <span className={`ss-led ${phase === 'decided' ? `ss-led-${item.outcome}` : 'ss-led-reading'}`} />
            <span className="ss-readout-text">
              {phase === 'reading' ? 'Reading file, checking rules and holds' : `${VERDICT[item.outcome]}. ${item.reason}`}
            </span>
          </div>
        </div>

        <div className="ss-bin">
          {shredding &&
            strips.map(({ i, turn }) => (
              <motion.div
                key={`${index}-${i}`}
                className="ss-strip"
                style={{ left: 13 + i * (240 / STRIPS), width: 240 / STRIPS - 3 }}
                initial={{ y: -150 }}
                animate={{ y: [-150, 0, 230], rotate: [0, 0, turn], opacity: [1, 1, 0] }}
                transition={{ duration: 2.1, times: [0, 0.55, 1], ease: ['linear', 'easeIn'], delay: (i % 3) * 0.02 }}
              />
            ))}
        </div>
      </div>

      <figcaption className="ss-foot">
        <dl className="ss-tally">
          <div>
            <dt>Cleared to delete</dt>
            <dd className="num">{tally.shred}</dd>
          </div>
          <div className="ss-tally-hold">
            <dt>Stopped by a hold</dt>
            <dd className="num">{tally.hold}</dd>
          </div>
          <div>
            <dt>Kept or sent for review</dt>
            <dd className="num">{tally.kept}</dd>
          </div>
        </dl>
        <button type="button" className="ss-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? 'Play' : 'Pause'}
        </button>
      </figcaption>
    </figure>
  )
}

// Reduced motion: the same decisions as a still list.
function StaticShredder({ items }: { items: Item[] }) {
  return (
    <figure className="ss ss-static">
      <ul className="ss-static-list">
        {items.map((it) => (
          <li key={it.id}>
            <span className={`ss-led ss-led-${it.outcome}`} aria-hidden="true" />
            <span className="ss-static-name">{it.name}</span>
            <span className="ss-static-verdict">
              {VERDICT[it.outcome]}. {it.reason}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
