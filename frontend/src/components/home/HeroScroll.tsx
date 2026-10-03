import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import type { Stage } from './stage'

// The opening and the hero are one pinned stage (stage.ts). On a first visit the gate's light ignites in
// the dark and the camera pulls back while the headline rises; scrolling, a key or a click skips ahead.
// Scroll then tells the story: one file is cleared and shredded, the next is under a legal hold and is
// pushed back. Reduced motion (or no WebGL) gets a still frame of the end of the story instead.

export interface HeroFile {
  name: string
  kind: string
  client?: string
  reason: string
}

interface Props {
  cleared: HeroFile
  held: HeroFile
  intro: boolean // play the opening (first visit this session)
  still: boolean // reduced motion
  onIntroDone: () => void
}

const EASE = [0.16, 1, 0.3, 1] as const
// When the headline starts to rise during the opening, in seconds from the first frame.
const TITLE_AT = 1.35

const BEATS = [
  { at: [0, 0.1], title: 'Every file has a fate.', sub: 'Statements, drafts, scanned IDs, old emails. Years of them sit on every branch drive.' },
  { at: [0.15, 0.4], title: 'Most of it should already be gone.', sub: 'Past its retention date, a file is only breach exposure and storage cost.' },
  { at: [0.46, 0.7], title: 'Some of it must never go.', sub: 'A file tied to a legal hold has to survive, however old it looks.' },
  { at: [0.78, 1], title: 'ShredSafe knows the difference.', sub: '' },
] as const

export default function HeroScroll({ cleared, held, intro, still, onIntroDone }: Props) {
  const ref = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [three, setThree] = useState<'loading' | 'ok' | 'off'>('loading')
  const [titleUp, setTitleUp] = useState(!intro)
  const [beat, setBeat] = useState(0)
  const [onScreen, setOnScreen] = useState(true)
  const done = useRef(onIntroDone)
  useEffect(() => {
    done.current = onIntroDone
  }, [onIntroDone])

  const staticLayout = still || three === 'off'

  useEffect(() => {
    let alive = true
    let titleTimer = 0
    import('./stage')
      .then(({ createStage }) => {
        if (!alive || !host.current) return
        try {
          stage.current = createStage(
            host.current,
            { name: cleared.name, kind: cleared.kind, client: cleared.client },
            { name: held.name, kind: held.kind, client: held.client, stamp: 'Legal hold' },
            { intro, still, onIntroDone: () => done.current() },
          )
        } catch {
          setThree('off')
          done.current()
          return
        }
        setThree('ok')
        if (intro && !still) titleTimer = window.setTimeout(() => setTitleUp(true), TITLE_AT * 1000)
        else done.current()
      })
      .catch(() => {
        if (!alive) return
        setThree('off')
        done.current()
      })
    const onResize = () => stage.current?.resize()
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      window.clearTimeout(titleTimer)
      window.removeEventListener('resize', onResize)
      stage.current?.dispose()
      stage.current = null
    }
    // Built once per pair of files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleared.name, held.name, still])

  // Any intent to move on skips the rest of the opening.
  useEffect(() => {
    if (titleUp) return
    const skip = () => {
      stage.current?.skipIntro()
      setTitleUp(true)
    }
    const onKey = (e: KeyboardEvent) => e.key !== 'Tab' && e.key !== 'Shift' && skip()
    window.addEventListener('wheel', skip, { passive: true })
    window.addEventListener('touchmove', skip, { passive: true })
    window.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', skip)
      window.removeEventListener('touchmove', skip)
      window.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', onKey)
    }
  }, [titleUp])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Only draw while the stage is on screen.
  useEffect(() => {
    stage.current?.setActive(onScreen)
  }, [onScreen, three])

  useMotionValueEvent(p, 'change', (v) => {
    if (staticLayout) return
    stage.current?.setProgress(v)
    const next = v < 0.13 ? 0 : v < 0.43 ? 1 : v < 0.74 ? 2 : 3
    setBeat((b) => (b === next ? b : next))
  })

  const cue = useTransform(p, [0, 0.03], [1, 0])
  const shade = useTransform(p, [0.7, 0.8], [0, 1])

  const status = [
    { tone: 'idle', text: `Reading ${cleared.name}` },
    { tone: 'clear', text: `Cleared to delete. ${cleared.reason}` },
    { tone: 'hold', text: `Stopped. ${held.reason}` },
    { tone: 'done', text: 'Two files checked. One cleared, one kept for the hold.' },
  ][beat]

  if (staticLayout) {
    return (
      <section className="hs hs-still" ref={ref} aria-labelledby="hs-title">
        <div className="hs-pin">
          {three !== 'off' && <div className="hs-3d" ref={host} aria-hidden="true" />}
          {three === 'off' && <div className="hs-flat" aria-hidden="true" />}
          <div className="hs-shade hs-shade-left" aria-hidden="true" />
          <div className="hs-final">
            <h1 id="hs-title" className="hs-title">
              Every file has a fate.
            </h1>
            <p className="hs-sub">
              Most of it should already be gone. Some of it must never go. ShredSafe knows the difference: it reads
              every file, applies your firm's retention rules and legal holds, clears only what the rules allow, and
              proves each step in a log an examiner can check.
            </p>
            <Ctas />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="hs" ref={ref} aria-labelledby="hs-title">
      <div className="hs-pin">
        <div className="hs-3d" ref={host} aria-hidden="true" />
        <div className="hs-shade" aria-hidden="true" />
        <motion.div className="hs-shade hs-shade-left" style={{ opacity: shade }} aria-hidden="true" />

        {BEATS.map((b, i) =>
          i === BEATS.length - 1 ? (
            <Beat key={b.title} p={p} at={b.at} className="hs-final" last>
              <h2 className="hs-title">{b.title}</h2>
              <p className="hs-sub">
                It reads every file, applies your firm's retention rules and legal holds, clears only what the rules
                allow, and proves each step in a log an examiner can check.
              </p>
              <Ctas />
            </Beat>
          ) : (
            <Beat key={b.title} p={p} at={b.at} className="hs-beat" first={i === 0}>
              {i === 0 ? (
                <>
                  <h1 id="hs-title" className="hs-title">
                    <RiseWords text={b.title} go={titleUp} />
                  </h1>
                  <motion.p
                    className="hs-sub"
                    initial={false}
                    animate={titleUp ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 8, filter: 'blur(6px)' }}
                    transition={{ duration: 0.9, delay: titleUp ? 0.45 : 0, ease: EASE }}
                  >
                    {b.sub}
                  </motion.p>
                </>
              ) : (
                <>
                  <h2 className="hs-title">{b.title}</h2>
                  <p className="hs-sub">{b.sub}</p>
                </>
              )}
            </Beat>
          ),
        )}

        <motion.div
          className="hs-hud"
          initial={false}
          animate={{ opacity: titleUp ? 1 : 0 }}
          transition={{ duration: 0.8, delay: titleUp ? 0.9 : 0 }}
        >
          <p className={`hs-status hs-status-${status.tone}`} aria-live="off">
            <span className="hs-led" aria-hidden="true" />
            <span className="hs-status-text">{status.text}</span>
          </p>
          <ol className="hs-steps" aria-hidden="true">
            {BEATS.map((b, i) => (
              <li key={b.title} className={i === beat ? 'is-on' : i < beat ? 'is-past' : ''} />
            ))}
          </ol>
        </motion.div>

        <motion.div className="hs-cue" style={{ opacity: cue }} aria-hidden="true">
          <motion.span
            initial={false}
            animate={{ opacity: titleUp ? 1 : 0 }}
            transition={{ duration: 0.8, delay: titleUp ? 1.2 : 0 }}
            className="hs-cue-in"
          >
            Scroll
            <span className="hs-cue-line" />
          </motion.span>
        </motion.div>
      </div>
    </section>
  )
}

function Ctas() {
  return (
    <div className="hs-ctas">
      <Link className="hp-pill" to="/dashboard">
        Try it now
      </Link>
      <a className="hp-btn hp-btn-line" href="#how">
        How it works
      </a>
    </div>
  )
}

function Beat({
  p,
  at,
  first = false,
  last = false,
  className,
  children,
}: {
  p: MotionValue<number>
  at: readonly [number, number]
  first?: boolean
  last?: boolean
  className: string
  children: ReactNode
}) {
  const [start, end] = at
  const fade = 0.025
  const opacity = useTransform(
    p,
    first ? [0, end, end + fade] : last ? [start - fade, start] : [start - fade, start, end, end + fade],
    first ? [1, 1, 0] : last ? [0, 1] : [0, 1, 1, 0],
  )
  const y = useTransform(
    p,
    first ? [end, end + fade] : last ? [start - fade, start] : [start - fade, start, end, end + fade],
    first ? [0, -28] : last ? [28, 0] : [28, 0, 0, -28],
  )
  const blur = useTransform(
    p,
    first ? [end, end + fade] : last ? [start - fade, start] : [start - fade, start, end, end + fade],
    first ? ['blur(0px)', 'blur(8px)'] : last ? ['blur(8px)', 'blur(0px)'] : ['blur(8px)', 'blur(0px)', 'blur(0px)', 'blur(8px)'],
  )
  const visibility = useTransform(opacity, [0, 0.02], ['hidden', 'visible'])
  return (
    <motion.div className={className} style={{ opacity, y, filter: blur, visibility }}>
      {children}
    </motion.div>
  )
}

// Each word rises out of its own mask, one after another.
function RiseWords({ text, go }: { text: string; go: boolean }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={i}>
          <span className="hs-word">
            <motion.span
              className="hs-word-in"
              initial={false}
              animate={{ y: go ? '0%' : '108%' }}
              transition={{ duration: 1.1, delay: go ? i * 0.075 : 0, ease: EASE }}
            >
              {word}
            </motion.span>
          </span>{' '}
        </Fragment>
      ))}
    </>
  )
}
