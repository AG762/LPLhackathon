import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'
import { Rise } from './Motion'

// What happens to every file, as one big list. Each line lights up as it reaches the middle of the screen.

const LINES = [
  { big: 'Read by AI', small: 'Amazon Bedrock names each document: trade confirmation, statement, scanned ID.' },
  { big: 'Scanned for SSNs', small: 'Amazon Macie counts Social Security and account numbers, so the riskiest files go first.' },
  { big: 'Matched to a rule', small: 'SEC 17a-4, FINRA 4511 and Reg S-P set a keep-until date for each type.' },
  { big: 'Stopped by holds', small: 'A hold on a client, account, branch or keyword overrides every rule.' },
  { big: 'Quarantined', small: 'Approved files move, not vanish. S3 Object Lock keeps them restorable during the grace period.' },
  { big: 'Hash-chained', small: 'Every action is chained to the one before it. Edit one entry and the check fails.' },
]

export default function BigList() {
  return (
    <section className="bl" id="how" aria-labelledby="how-title">
      <h2 id="how-title" className="hp-h2">
        <Rise lines={['What happens to', 'every file.']} />
      </h2>
      <ol className="bl-list">
        {LINES.map((l, i) => (
          <Line key={l.big} n={i + 1} big={l.big} small={l.small} />
        ))}
      </ol>
    </section>
  )
}

function Line({ n, big, small }: { n: number; big: string; small: string }) {
  const ref = useRef<HTMLLIElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 90%', 'start 50%'] })
  const opacity = useTransform(scrollYProgress, [0, 1], [0.18, 1])
  const x = useTransform(scrollYProgress, [0, 1], [-28, 0])
  return (
    <motion.li ref={ref} className="bl-line" style={{ opacity }}>
      <p className="bl-small">
        <span className="bl-n num">{n}</span>
        {small}
      </p>
      <motion.p className="bl-big" style={{ x }}>
        {big}
      </motion.p>
    </motion.li>
  )
}
