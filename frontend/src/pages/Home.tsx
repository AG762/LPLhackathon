import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animate, motion, useInView, useReducedMotion, useScroll } from 'motion/react'
import { api, mode } from '../api/client'
import { BrandMark } from '../components/BrandMark'
import Shredder from '../components/Shredder'
import { pickItems, type ShredItem } from '../lib/shredItems'
import { isOnHold } from '../lib/format'
import { useFiles } from '../state/files'
import './home.css'

// Monthly price per advisor, in dollars. Left unset until the team agrees on a number.
const PRICE_PER_ADVISOR: number | null = null

const EASE = [0.16, 1, 0.3, 1] as const

const STEPS = [
  {
    title: 'Upload',
    text: 'Files go straight from the browser to storage over a one-time signed link. Each one gets a SHA-256 fingerprint on arrival.',
    aws: 'Amazon S3',
  },
  {
    title: 'Read',
    text: 'AI reads each file and names what it is: a trade confirmation, a statement, a scanned ID. A second scan finds SSNs and account numbers.',
    aws: 'Amazon Bedrock, Amazon Macie',
  },
  {
    title: 'Check rules and holds',
    text: "Your firm's retention rules set a keep-until date for each type. An active legal hold on the client, account, or branch overrides everything.",
    aws: 'AWS Lambda, DynamoDB',
  },
  {
    title: 'Quarantine',
    text: 'Approved files are moved, not deleted. They sit in a locked quarantine and can be restored with one click until the grace period ends.',
    aws: 'S3 Object Lock',
  },
  {
    title: 'Prove it',
    text: 'Every decision is written to a hash-chained log. Change one entry and the integrity check fails. Export a signed disposal certificate for the exam.',
    aws: 'DynamoDB, PDF certificate',
  },
]

export default function HomePage() {
  const { files, loaded, error } = useFiles()
  // Snapshot once, so the animation doesn't reshuffle every time /files is polled.
  const [items, setItems] = useState<ShredItem[] | null>(null)
  if (loaded && !items) setItems(pickItems(error ? [] : files))

  useEffect(() => {
    document.title = 'ShredSafe: defensible disposal for advisors'
    return () => {
      document.title = 'ShredSafe'
    }
  }, [])

  return (
    <div className="home">
      <header className="home-top">
        <Link className="home-brand" to="/">
          <BrandMark />
          ShredSafe
        </Link>
        <nav className="home-links" aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link className="home-btn home-btn-light home-btn-small" to="/dashboard">
            Open the portal
          </Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>Delete client files on schedule. Prove every one.</h1>
          <p className="home-lede">
            ShredSafe checks every file on a branch drive against your firm's retention rules and legal holds. It clears
            only what the rules allow, stops anything under a hold, and records each step in a log an examiner can verify.
          </p>
          <div className="home-ctas">
            <Link className="home-btn home-btn-light" to="/dashboard">
              Try it now
            </Link>
            <a className="home-btn home-btn-ghost" href="#how">
              See how it works
            </a>
          </div>
        </div>
        <div className="home-hero-machine">
          {items ? <Shredder items={items} /> : <div className="ss-placeholder" aria-hidden="true" />}
        </div>
      </section>

      <section className="home-problem" aria-labelledby="problem-title">
        <h2 id="problem-title">There are two ways to get records wrong</h2>
        <div className="home-problem-grid">
          <article>
            <h3>Delete too early</h3>
            <p>
              Trade confirmations, statements, and client correspondence must be kept for three to six years. A file
              tied to a legal hold can't be destroyed at all, however old it is. Getting this wrong is what examiners
              fine.
            </p>
            <p className="home-cite">SEC Rule 17a-4, FINRA Rule 4511</p>
          </article>
          <article>
            <h3>Keep too long</h3>
            <p>
              Amended Reg S-P requires written procedures for disposing of customer information and notice to
              customers after a breach. Every expired SSN scan left on a branch drive is one more record to report if
              that drive is ever exposed.
            </p>
            <p className="home-cite">Regulation S-P, as amended 2024</p>
          </article>
        </div>
        <p className="home-problem-close">
          Most branches keep everything because deleting feels like the riskier choice. ShredSafe makes deleting the
          documented, defensible choice.
        </p>
      </section>

      <HowItWorks />

      <Proof />

      <section className="home-price" id="pricing" aria-labelledby="price-title">
        <div>
          <h2 id="price-title">One price per advisor</h2>
          <p className="home-price-figure">
            {PRICE_PER_ADVISOR != null ? (
              <>
                <span className="num">${PRICE_PER_ADVISOR}</span> per advisor, per month
              </>
            ) : (
              'Pilot pricing on request'
            )}
          </p>
          <ul className="home-price-list">
            <li>Retention rules for every common advisor document type</li>
            <li>Legal holds by client, account, branch, or keyword</li>
            <li>Quarantine with one-click restore during the grace period</li>
            <li>Hash-chained audit log and PDF disposal certificate</li>
            <li>Deploys into your own AWS account</li>
          </ul>
        </div>
        <div className="home-price-cta">
          <p>Start with one branch. Upload a folder, see what ShredSafe would clear, and approve nothing until you're sure.</p>
          <Link className="home-btn home-btn-dark" to="/dashboard">
            Try it now
          </Link>
        </div>
      </section>

      <footer className="home-foot">
        <span className="home-foot-brand">
          <BrandMark />
          ShredSafe
        </span>
        <p>Built for the LPL Financial University Hackathon. The demo uses synthetic files only; no real client data.</p>
      </footer>
    </div>
  )
}

function HowItWorks() {
  const listRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: listRef, offset: ['start 75%', 'end 60%'] })

  return (
    <section className="home-how" id="how" aria-labelledby="how-title">
      <h2 id="how-title">From upload to certificate</h2>
      <p className="home-how-sub">The same five steps run for every file, whether it's one PDF or a whole branch drive.</p>
      <div className="home-steps-wrap" ref={listRef}>
        <span className="home-steps-rail" aria-hidden="true" />
        <motion.span className="home-steps-fill" style={{ scaleY: scrollYProgress }} aria-hidden="true" />
        <ol className="home-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="home-step-num num" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <p className="home-step-aws">{s.aws}</p>
            </div>
          </li>
        ))}
        </ol>
      </div>
    </section>
  )
}

function Proof() {
  const { files, loaded, error } = useFiles()
  const [chain, setChain] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    api
      .verifyAudit()
      .then((r) => alive && setChain(r.ok))
      .catch(() => alive && setChain(null))
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const decided = files.filter((f) => f.recommendation)
    return {
      checked: decided.length,
      cleared: decided.filter((f) => f.recommendation === 'DELETE' && !isOnHold(f)).length,
      held: files.filter(isOnHold).length,
      kept: decided.filter((f) => f.recommendation === 'RETAIN' && !isOnHold(f)).length,
    }
  }, [files])

  const source = mode === 'live' ? 'the live AWS stack' : 'the built-in demo data'
  const empty = loaded && (error || files.length === 0)

  return (
    <section className="home-proof" aria-labelledby="proof-title">
      <h2 id="proof-title">What it found in this demo</h2>
      <p className="home-proof-sub">
        {empty
          ? `No files from ${source} yet. Open the portal and upload a folder to fill this in.`
          : `Counted from ${source}, updated every few seconds.`}
      </p>
      {!empty && (
        <dl className="home-ledger">
          <div>
            <dt>Files checked</dt>
            <dd>
              <CountUp value={stats.checked} />
            </dd>
          </div>
          <div>
            <dt>Cleared to delete</dt>
            <dd>
              <CountUp value={stats.cleared} />
            </dd>
          </div>
          <div className="home-ledger-hold">
            <dt>Stopped by a legal hold</dt>
            <dd>
              <CountUp value={stats.held} />
            </dd>
          </div>
          <div>
            <dt>Kept as required records</dt>
            <dd>
              <CountUp value={stats.kept} />
            </dd>
          </div>
          <div>
            <dt>Audit log integrity</dt>
            <dd className={chain === false ? 'home-ledger-bad' : ''}>
              {chain == null ? 'Not checked' : chain ? 'Verified' : 'Failed'}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}

// Counts up from zero the first time it scrolls into view. The real number shows before and after.
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const played = useRef(false)
  const [shown, setShown] = useState<number | null>(null)

  useEffect(() => {
    if (!inView || played.current || reduce || value === 0) return
    const controls = animate(0, value, {
      duration: 1.1,
      ease: EASE,
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => {
        played.current = true
        setShown(null)
      },
    })
    return () => {
      controls.stop()
      setShown(null)
    }
  }, [inView, reduce, value])

  return (
    <span ref={ref} className="num">
      {(shown ?? value).toLocaleString()}
    </span>
  )
}
