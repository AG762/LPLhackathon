import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'

// Two columns of real file names drifting past in opposite directions as the page scrolls.
// Cleared files are struck through, held files are marked, and the live counts sit in the middle.

export interface RiverFile {
  name: string
  state: 'cleared' | 'held' | 'kept'
}

interface Props {
  files: RiverFile[]
  counts: { read: number; cleared: number; held: number }
  source: string
}

export default function FileRiver({ files, counts, source }: Props) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const up = useTransform(scrollYProgress, [0, 1], ['8%', '-38%'])
  const down = useTransform(scrollYProgress, [0, 1], ['-38%', '8%'])

  // Repeat the list so both columns are always full, whatever the dataset size.
  const pool = files.length ? files : []
  const fill = (offset: number) =>
    Array.from({ length: 22 }, (_, i) => pool[(i * 2 + offset) % Math.max(pool.length, 1)]).filter(Boolean)

  return (
    <section className="hr" ref={ref} aria-labelledby="river-title">
      <div className="hr-cols" aria-hidden="true">
        <motion.ul className="hr-col" style={{ y: up }}>
          {fill(0).map((f, i) => (
            <li key={i} className={`hr-name hr-${f.state}`}>
              {f.name}
            </li>
          ))}
        </motion.ul>
        <motion.ul className="hr-col hr-col-right" style={{ y: down }}>
          {fill(1).map((f, i) => (
            <li key={i} className={`hr-name hr-${f.state}`}>
              {f.name}
            </li>
          ))}
        </motion.ul>
      </div>

      <div className="hr-center">
        <h2 id="river-title" className="hr-title">
          <span className="num">{counts.read}</span> files read.
          <br />
          <span className="num">{counts.cleared}</span> can go today.
          <br />
          <span className="num">{counts.held}</span> never will.
        </h2>
        <p className="hr-note">
          Counted from {source}. <span className="hr-key hr-key-cleared">Struck through</span> means cleared to delete;{' '}
          <span className="hr-key hr-key-held">marked</span> means a legal hold stopped it.
        </p>
      </div>
    </section>
  )
}
