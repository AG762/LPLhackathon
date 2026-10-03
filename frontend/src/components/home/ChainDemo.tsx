import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../../api/client'
import { signInEnabled } from '../../auth/config'
import { useOptionalSession } from '../../auth/session'
import type { AuditEntry } from '../../types'
import { shortHash } from '../../lib/format'
import { Rise } from './Motion'

// A hands-on version of the audit log's integrity check. It runs in the browser on the latest real
// entries (or samples): change one entry and every link after it stops matching.

interface Block {
  seq: number
  action: string
  actor: string
  entryHash: string
  prevHash: string
}

const SAMPLE: Block[] = [
  { seq: 41, action: 'UPLOAD', actor: 'jordan.reyes', entryHash: '7c1e9a40b2', prevHash: '19ab03ce77' },
  { seq: 42, action: 'CLASSIFY', actor: 'system', entryHash: 'e04f6d1a93', prevHash: '7c1e9a40b2' },
  { seq: 43, action: 'APPROVE', actor: 'jordan.reyes', entryHash: '5a88c2f017', prevHash: 'e04f6d1a93' },
  { seq: 44, action: 'QUARANTINE', actor: 'system', entryHash: 'b3d90e6c41', prevHash: '5a88c2f017' },
  { seq: 45, action: 'PURGE', actor: 'system', entryHash: '0f2c7b9d58', prevHash: 'b3d90e6c41' },
]

const ALTERED_ACTION = 'REJECT'
const EASE = [0.16, 1, 0.3, 1] as const

// Not SHA-256: a quick stand-in so the changed hash is visibly different. The real check is server-side.
function fakeHash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0).toString(16) + 'a3f9c1').slice(0, 10)
}

function toBlock(e: AuditEntry): Block {
  return { seq: e.seq, action: e.action, actor: e.actor, entryHash: shortHash(e.entryHash), prevHash: shortHash(e.prevHash) }
}

export default function ChainDemo() {
  const [blocks, setBlocks] = useState<Block[]>(SAMPLE)
  const [real, setReal] = useState(false)
  const [tampered, setTampered] = useState(false)
  // With sign-in on, real entries only for a signed-in visitor (their own, per the API); the public home
  // page must not show other advisors' emails. Everyone else sees the samples.
  const auth = useOptionalSession()
  const mayLoad = !signInEnabled || auth?.session.status === 'signedIn'

  useEffect(() => {
    if (!mayLoad) return
    let alive = true
    api
      .audit()
      .then((entries) => {
        if (!alive || entries.length < 5) return
        // Show the run of five consecutive entries with the most varied actions (latest wins a tie).
        const sorted = [...entries].sort((a, b) => a.seq - b.seq)
        let best = sorted.slice(-5)
        let bestScore = new Set(best.map((e) => e.action)).size
        for (let i = sorted.length - 5; i >= 0; i--) {
          const run = sorted.slice(i, i + 5)
          const score = new Set(run.map((e) => e.action)).size
          if (score > bestScore) [best, bestScore] = [run, score]
        }
        // A run of one repeated action doesn't show what the chain records; keep the samples then.
        if (bestScore < 3) return
        setBlocks(best.map(toBlock))
        setReal(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mayLoad])

  const target = 2
  const shown = blocks.map((b, i) =>
    tampered && i === target ? { ...b, action: ALTERED_ACTION, entryHash: fakeHash(b.seq + ALTERED_ACTION + b.actor) } : b,
  )

  return (
    <section className="cd" aria-labelledby="chain-title">
      <div className="cd-head">
        <h2 id="chain-title" className="hp-h2">
          <Rise lines={['Try to rewrite history.']} />
        </h2>
        <p>
          Every entry stores the fingerprint of the one before it. Change one, and its fingerprint no longer matches the
          next link. {real ? 'These are the latest real entries from the audit log.' : 'Sample entries shown.'}
        </p>
      </div>

      <div className="cd-row" role="list">
        {shown.map((b, i) => {
          const broken = tampered && i > target
          const altered = tampered && i === target
          return (
            <div key={b.seq} className="cd-item" role="listitem">
              {i > 0 && <Link broken={tampered && i === target + 1} />}
              <motion.div
                className={`cd-block ${altered ? 'cd-altered' : ''} ${broken ? 'cd-unverified' : ''}`}
                animate={altered ? { x: [0, -6, 6, -3, 0] } : { x: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <div className="cd-seq num">#{b.seq}</div>
                <div className="cd-action">
                  {altered && <s className="cd-was">{blocks[i].action}</s>}
                  {b.action}
                </div>
                <div className="cd-actor">{b.actor}</div>
                <dl className="cd-hashes">
                  <div>
                    <dt>Hash</dt>
                    <dd className="num">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={b.entryHash}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                        >
                          {b.entryHash}
                        </motion.span>
                      </AnimatePresence>
                    </dd>
                  </div>
                  <div>
                    <dt>Previous</dt>
                    <dd className={`num ${tampered && i === target + 1 ? 'cd-mismatch' : ''}`}>{b.prevHash}</dd>
                  </div>
                </dl>
              </motion.div>
            </div>
          )
        })}
      </div>

      <div className="cd-foot">
        <p className={`cd-status ${tampered ? 'cd-status-bad' : 'cd-status-ok'}`} aria-live="polite">
          {tampered
            ? `Integrity check failed at entry #${blocks[target + 1]?.seq}. Its "previous" fingerprint no longer matches, so the disposal certificate is blocked.`
            : 'Integrity check passed. Every entry matches the one before it.'}
        </p>
        <button type="button" className="hp-btn hp-btn-dark" onClick={() => setTampered((t) => !t)}>
          {tampered ? 'Restore the original entry' : `Change entry #${blocks[target].seq} to ${ALTERED_ACTION}`}
        </button>
      </div>
    </section>
  )
}

function Link({ broken }: { broken: boolean }) {
  return (
    <span className={`cd-link ${broken ? 'cd-link-broken' : ''}`} aria-hidden="true">
      <motion.span className="cd-link-half" animate={{ rotate: broken ? -18 : 0, x: broken ? -3 : 0 }} transition={{ duration: 0.35, ease: EASE }} />
      <motion.span className="cd-link-half" animate={{ rotate: broken ? 18 : 0, x: broken ? 3 : 0 }} transition={{ duration: 0.35, ease: EASE }} />
    </span>
  )
}
