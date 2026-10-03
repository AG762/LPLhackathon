import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Lenis from 'lenis'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { mode } from '../api/client'
import { BrandMark } from '../components/BrandMark'
import Shredder from '../components/Shredder'
import HeroScroll, { type HeroFile } from '../components/home/HeroScroll'
import FileRiver, { type RiverFile } from '../components/home/FileRiver'
import BigList from '../components/home/BigList'
import ChainDemo from '../components/home/ChainDemo'
import { Magnetic, Rise } from '../components/home/Motion'
import { pickItems, toItem, type ShredItem } from '../lib/shredItems'
import { fileName, isOnHold } from '../lib/format'
import { useFiles } from '../state/files'
import './home.css'

// Monthly price per advisor, in dollars. Left unset until the team agrees on a number.
const PRICE_PER_ADVISOR: number | null = null

const FALLBACK_CLEARED: HeroFile = { name: 'Fantasy_Football_Draft_2023.txt', kind: 'Personal', reason: 'Not a business record.' }
const FALLBACK_HELD: HeroFile = {
  name: '2019_Email_Whitaker_Rebalance.eml',
  kind: 'Client communication',
  client: 'Margaret Whitaker',
  reason: 'Legal hold on Margaret Whitaker.',
}

const FALLBACK_RIVER: RiverFile[] = [
  'Fantasy_Football_Draft_2023.txt', '2019_Email_Whitaker_Rebalance.eml', 'Trade_Confirm_NVDA_2025_04.txt',
  'W9_Scan_Chen_2017.png', 'Statement_Okafor_2017_03.txt', 'Newsletter_Spring_2019 (copy).txt',
  'Q3_Financial_Plan_Proposal_v1_draft.txt', 'Statement_Novak_2026_06.txt', 'Gym_Receipt_2024.txt',
  'Retirement_Income_Plan_Okafor_FINAL.txt', 'Funny_Cat_Meme.png', 'Email_Delgado_2025_11.eml',
].map((name, i) => ({ name, state: i % 5 === 1 || i % 5 === 4 ? 'held' : i % 3 === 0 ? 'cleared' : 'kept' }) as RiverFile)

const INTRO_KEY = 'shredsafe.introSeen'

function introSeen() {
  try {
    return sessionStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(INTRO_KEY, '1')
  } catch {
    // private mode: the opening just plays again next time
  }
}

function useSmoothScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.1 })
    return () => lenis.destroy()
  }, [enabled])
}

export default function HomePage() {
  const { files, loaded, error } = useFiles()
  const reduce = useReducedMotion() ?? false
  useSmoothScroll(!reduce)
  // The opening plays once per visit: coming back from the portal goes straight to the lit stage.
  const [intro] = useState(() => !reduce && !introSeen())
  const [ready, setReady] = useState(!intro)
  const introDone = useCallback(() => {
    markIntroSeen()
    setReady(true)
  }, [])

  useEffect(() => {
    document.title = 'ShredSafe: defensible disposal for advisors'
    document.documentElement.classList.add('hp-root')
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)
    return () => {
      document.title = 'ShredSafe'
      document.documentElement.classList.remove('hp-root')
      document.documentElement.style.background = ''
      if ('scrollRestoration' in history) history.scrollRestoration = 'auto'
    }
  }, [])

  // Snapshot once, so the animations don't reshuffle every time /files is polled.
  const [items, setItems] = useState<ShredItem[] | null>(null)
  if (loaded && !items) setItems(pickItems(error ? [] : files))

  const usable = loaded && !error && files.length > 0

  // Chosen once, when data first arrives; later polls shouldn't swap the files mid-scroll.
  const [hero, setHero] = useState<{ cleared: HeroFile; held: HeroFile } | null>(null)
  if (loaded && !hero) {
    const decided = usable ? files.map(toItem).filter((i): i is ShredItem => Boolean(i)) : []
    const c = decided.find((i) => i.outcome === 'shred' && i.kind === 'Personal') ?? decided.find((i) => i.outcome === 'shred')
    const h = decided.find((i) => i.outcome === 'hold' && i.client) ?? decided.find((i) => i.outcome === 'hold')
    setHero({
      cleared: c ? { name: c.name, kind: c.kind, client: c.client, reason: `${c.reason}.` } : FALLBACK_CLEARED,
      held: h ? { name: h.name, kind: h.kind, client: h.client, reason: `${h.reason}.` } : FALLBACK_HELD,
    })
  }

  const river = useMemo<RiverFile[]>(() => {
    if (!usable) return FALLBACK_RIVER
    return files.map((f) => ({
      name: fileName(f),
      state: isOnHold(f) ? 'held' : f.recommendation === 'DELETE' ? 'cleared' : 'kept',
    }))
  }, [files, usable])

  const counts = useMemo(() => {
    if (!usable) return { read: 42, cleared: 21, held: 6 }
    return {
      read: files.filter((f) => f.recommendation).length,
      cleared: files.filter((f) => f.recommendation === 'DELETE' && !isOnHold(f)).length,
      held: files.filter(isOnHold).length,
    }
  }, [files, usable])

  const source = usable && mode === 'live' ? 'your workspace' : 'the sample workspace'

  return (
    <div className={`hp ${ready ? 'is-ready' : ''}`}>
      <a className="hp-skip" href="#main">
        Skip to content
      </a>
      <header className="hp-nav">
        <Link className="hp-brand" to="/" aria-label="ShredSafe home">
          <BrandMark />
          ShredSafe
        </Link>
        <nav className="hp-links" aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#proof">Proof</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="hp-nav-end">
          <Link className="hp-signin" to="/signin">
            Sign in
          </Link>
          <Magnetic>
            <Link className="hp-pill hp-pill-nav" to="/dashboard">
              Try it now
            </Link>
          </Magnetic>
        </div>
      </header>

      <main id="main">
        {hero ? (
          <HeroScroll cleared={hero.cleared} held={hero.held} intro={intro} still={reduce} onIntroDone={introDone} />
        ) : (
          <div className="hs-wait" aria-hidden="true" />
        )}

        <FileRiver files={river} counts={counts} source={source} />

        <section className="hp-stakes" aria-labelledby="stakes-title">
          <h2 id="stakes-title" className="hp-h2">
            <Rise lines={['Two ways to get', 'records wrong.']} />
          </h2>
          <div className="hp-stakes-grid">
            <article>
              <h3 className="hp-stakes-label">Delete too early</h3>
              <p>
                Trade confirmations, statements and client letters must be kept for three to six years. A file tied to a
                legal hold can't be destroyed at all, however old it is.
              </p>
              <p className="hp-cite">SEC Rule 17a-4 and FINRA Rule 4511</p>
            </article>
            <article>
              <h3 className="hp-stakes-label">Keep too long</h3>
              <p>
                Amended Reg S-P requires written procedures for disposing of customer information. Every expired SSN scan
                on a branch drive is one more record to report if that drive is ever breached.
              </p>
              <p className="hp-cite">Regulation S-P, as amended in 2024</p>
            </article>
          </div>
        </section>

        <BigList />

        <section className="hp-live" aria-labelledby="live-title">
          <div className="hp-live-copy">
            <h2 id="live-title" className="hp-h2">
              <Rise lines={['Watch it sort', 'your files.']} />
            </h2>
            <p>
              These are the files in {source}, going through the same rules the portal uses. Nothing here deletes
              anything; in the portal, an advisor approves every deletion.
            </p>
            <Link className="hp-btn hp-btn-line" to="/queue">
              Open the review queue
            </Link>
          </div>
          <div className="hp-live-machine">{items && <Shredder items={items} />}</div>
        </section>

        <Paper reduce={reduce}>
          <div id="proof">
            <ChainDemo />
          </div>

          <section className="hp-close" id="pricing" aria-labelledby="close-title">
            <h2 id="close-title" className="hp-close-title">
              <Rise lines={['Let go of client files.', 'Keep the proof.']} />
            </h2>
            <div className="hp-close-grid">
              <div>
                <p className="hp-price">
                  {PRICE_PER_ADVISOR != null ? `$${PRICE_PER_ADVISOR} per advisor, per month` : 'Pilot pricing on request'}
                </p>
                <p className="hp-close-note">
                  Start with one branch. See what ShredSafe would clear, and approve nothing until you're sure.
                </p>
                <div className="hp-close-ctas">
                  <Magnetic strength={0.25}>
                    <Link className="hp-pill hp-pill-ink hp-pill-big" to="/signup">
                      Start a pilot
                    </Link>
                  </Magnetic>
                  <Link className="hp-close-alt" to="/dashboard">
                    Or try it with sample files
                  </Link>
                </div>
              </div>
              <ul className="hp-included" aria-label="Included">
                <li>Retention rules for every common advisor document</li>
                <li>Legal holds by client, account, branch or keyword</li>
                <li>Quarantine with one-click restore</li>
                <li>Hash-chained audit log and PDF certificate</li>
                <li>Runs in your own AWS account</li>
              </ul>
            </div>
          </section>

          <footer className="hp-foot">
            <span className="hp-brand">
              <BrandMark />
              ShredSafe
            </span>
            <p>Defensible disposal for financial advisors. Built on AWS.</p>
            <p>Every client name and file shown here is synthetic sample data.</p>
          </footer>
        </Paper>
      </main>
    </div>
  )
}

// The proof and the close sit on one light sheet that rises over the dark page, like a certificate
// coming out of the machine.
function Paper({ reduce, children }: { reduce: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 20%'] })
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1])
  const radius = useTransform(scrollYProgress, [0, 1], [48, 0])
  return (
    <motion.div ref={ref} className="hp-paper" style={reduce ? undefined : { scale, borderTopLeftRadius: radius, borderTopRightRadius: radius }}>
      {children}
    </motion.div>
  )
}
