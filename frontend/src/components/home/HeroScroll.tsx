import { Fragment, lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'

// three.js is only needed here, so it loads in its own chunk after the page is up.
const ShredField = lazy(() => import('./ShredField'))

// The opening: a pinned stage that scroll drives. One file is cleared and shredded, the next belongs to
// a client under legal hold and is stopped at the slot. The headline changes with each beat.

export interface HeroFile {
  name: string
  kind: string
  client?: string
  reason: string
}

interface Props {
  cleared: HeroFile
  held: HeroFile
  // Seconds to wait before the opening headline rises in (after the intro); 0 shows it at once.
  enterDelay: number
}

const BEATS = [
  { at: [0, 0.13], title: 'Advisors keep every file.', sub: 'Statements, drafts, scanned IDs, old emails. Years of them, on every branch drive.' },
  { at: [0.17, 0.42], title: 'Most of it should already be gone.', sub: 'Past its retention date, it is only breach exposure and storage cost.' },
  { at: [0.48, 0.7], title: 'Some of it must never go.', sub: 'A file tied to a legal hold has to survive, however old it looks.' },
  { at: [0.76, 1], title: 'ShredSafe knows the difference.', sub: '' },
] as const

const STRIPS = 10

export default function HeroScroll({ cleared, held, enterDelay }: Props) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [beat, setBeat] = useState(0)
  const reduce = useReducedMotion()

  useMotionValueEvent(p, 'change', (v) => {
    const next = v < 0.15 ? 0 : v < 0.45 ? 1 : v < 0.73 ? 2 : 3
    setBeat((b) => (b === next ? b : next))
  })

  // File A: drops into the slot (slot line sits at 330px in the stage).
  const aY = useTransform(p, [0, 0.1, 0.4], [40, 40, 340])
  // File B: arrives, is stopped by the barrier, and is pushed back.
  const bY = useTransform(p, [0.44, 0.54, 0.6, 0.66], [-560, 40, 66, -6])
  const bRotate = useTransform(p, [0.6, 0.66], [0, -4])
  const barrier = useTransform(p, [0.585, 0.605], [0, 1])
  const cue = useTransform(p, [0, 0.04], [1, 0])

  const readout = [
    { tone: 'reading', text: `Reading ${cleared.name}` },
    { tone: 'shred', text: `Cleared to delete. ${cleared.reason}` },
    { tone: 'hold', text: `Stopped. ${held.reason}` },
    { tone: 'done', text: 'Two files checked. One cleared, one kept for the hold.' },
  ][beat]

  return (
    <section className="hs" ref={ref} aria-label="ShredSafe in four steps">
      <div className="hs-pin">
        <Suspense fallback={null}>
          <ShredField progress={p} still={Boolean(reduce)} />
        </Suspense>
        <div className="hs-copy">
          {BEATS.map((b, i) => (
            <Beat key={b.title} p={p} at={b.at} first={i === 0} last={i === BEATS.length - 1}>
              {i === 0 && enterDelay > 0 ? (
                <>
                  <h1 className="hs-title">
                    <RiseWords text={b.title} delay={enterDelay} />
                  </h1>
                  <motion.p
                    className="hs-sub"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: enterDelay + 0.45, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {b.sub}
                  </motion.p>
                </>
              ) : (
                <>
                  <h1 className="hs-title">{b.title}</h1>
                  {b.sub && <p className="hs-sub">{b.sub}</p>}
                </>
              )}
              {i === BEATS.length - 1 && (
                <>
                  <p className="hs-sub">
                    It reads every file, applies your firm's retention rules and legal holds, clears only what the rules
                    allow, and proves each step in a log an examiner can check.
                  </p>
                  <div className="hs-ctas">
                    <Link className="hp-btn hp-btn-light" to="/dashboard">
                      Try it now
                    </Link>
                    <a className="hp-btn hp-btn-line" href="#how">
                      How it works
                    </a>
                  </div>
                </>
              )}
            </Beat>
          ))}
        </div>

        <div className="hs-stage" aria-hidden="true">
          <div className="hs-light" />
          <div className="hs-feed">
            <motion.div className="hs-doc" style={{ y: aY }}>
              <Doc file={cleared} />
            </motion.div>
            <motion.div className="hs-doc" style={{ y: bY, rotate: bRotate }}>
              <Doc file={held} />
            </motion.div>
          </div>
          <motion.div className="hs-barrier" style={{ scaleX: barrier, opacity: barrier }}>
            <span className="hs-tri" />
            Legal hold
          </motion.div>
          <div className="hs-machine">
            <div className="hs-slot" />
            <div className={`hs-readout hs-readout-${readout.tone}`}>
              <span className="hs-led" />
              <span>{readout.text}</span>
            </div>
          </div>
          <div className="hs-bin">
            {Array.from({ length: STRIPS }, (_, i) => (
              <Strip key={i} p={p} i={i} />
            ))}
          </div>
        </div>

        <motion.div className="hs-cue" style={{ opacity: cue }} aria-hidden="true">
          Scroll
          <span className="hs-cue-line" />
        </motion.div>
      </div>
    </section>
  )
}

function Beat({
  p,
  at,
  first,
  last,
  children,
}: {
  p: MotionValue<number>
  at: readonly [number, number]
  first: boolean
  last: boolean
  children: React.ReactNode
}) {
  const [start, end] = at
  const opacity = useTransform(
    p,
    first ? [0, end, end + 0.03] : last ? [start - 0.03, start] : [start - 0.03, start, end, end + 0.03],
    first ? [1, 1, 0] : last ? [0, 1] : [0, 1, 1, 0],
  )
  const y = useTransform(
    p,
    first ? [end, end + 0.03] : [start - 0.03, start],
    first ? [0, -24] : [24, 0],
  )
  const pointerEvents = useTransform(opacity, (o) => (o > 0.5 ? 'auto' : 'none'))
  return (
    <motion.div className="hs-beat" style={{ opacity, y, pointerEvents }}>
      {children}
    </motion.div>
  )
}

// Each word rises out of its own mask, one after another.
function RiseWords({ text, delay }: { text: string; delay: number }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={i}>
          <span className="hs-word">
            <motion.span
              className="hs-word-in"
              initial={{ y: '105%' }}
              animate={{ y: '0%' }}
              transition={{ duration: 0.9, delay: delay + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
            >
              {word}
            </motion.span>
          </span>{' '}
        </Fragment>
      ))}
    </>
  )
}

function Doc({ file }: { file: HeroFile }) {
  return (
    <div className="hs-paper">
      <div className="hs-paper-name">{file.name}</div>
      <div className="hs-paper-kind">{file.kind}</div>
      {file.client && <div className="hs-paper-kind">{file.client}</div>}
      <div className="hs-paper-lines" />
      <div className="hs-paper-lines hs-paper-lines-short" />
    </div>
  )
}

// One strip of the shredded file: comes out of the slot as the file goes in, then drops and fades.
function Strip({ p, i }: { p: MotionValue<number>; i: number }) {
  const turn = (i % 2 ? 1 : -1) * (2 + ((i * 5) % 7))
  const lag = (i % 4) * 0.008
  const y = useTransform(p, [0.13, 0.4, 0.5 + lag], [-270, 0, 240])
  const rotate = useTransform(p, [0.4, 0.5 + lag], [0, turn])
  const opacity = useTransform(p, [0.12, 0.13, 0.44, 0.5 + lag], [0, 1, 1, 0])
  return <motion.div className="hs-strip" style={{ y, rotate, opacity, left: 10 + i * 22 }} />
}
