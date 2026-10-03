import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { api, ApiError } from '../api/client'
import { Chip, Sign } from '../components/Sign'
import { useFiles } from '../state/files'
import { useToast } from '../state/toast'
import type { FileRecord, FileStatus, ScanState } from '../types'
import { canApprove, docTypeLabel, fileName, formatBytes, formatDate, isOnHold, sortByPriority } from '../lib/format'
import './queue.css'

type Filter = FileStatus | 'ALL'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'PENDING', label: 'To review' },
  { value: 'QUARANTINED', label: 'Grace period' },
  { value: 'LOCKED', label: 'Locked' },
  { value: 'REJECTED', label: 'Kept' },
  { value: 'PURGED', label: 'Purged' },
  { value: 'ALL', label: 'All files' },
]

const SCAN_POLL_MS = 2000

// Serious tool: springs settle without overshoot.
const REORDER = { type: 'spring', bounce: 0, visualDuration: 0.45 } as const
const EASE_OUT = [0.16, 1, 0.3, 1] as const

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export default function QueuePage() {
  const { files, loaded, error, refresh, upsert } = useFiles()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('PENDING')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [scanState, setScanState] = useState<ScanState>('IDLE')
  // A scan that finished while nobody was watching (Macie jobs take minutes, so the demo pre-runs one).
  // Holds the job's start time: only files uploaded before it were scanned.
  const [finishedScanStartedAt, setFinishedScanStartedAt] = useState<string | null>(null)
  // After a scan re-sorts the queue, each row that moved up (got riskier) keeps a marker until the advisor has looked at it.
  const [moved, setMoved] = useState<Map<string, number>>(new Map())
  const orderBeforeScan = useRef<Map<string, number> | null>(null)
  const scanTimer = useRef<number | null>(null)
  const visibleRef = useRef<FileRecord[]>([])
  // Files seen on a previous render. Only files that arrive after that (uploads streaming in) get the arrival flash.
  const knownIds = useRef<Set<string> | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: files.length }
    for (const f of files) c[f.status] = (c[f.status] ?? 0) + 1
    return c
  }, [files])

  const visible = useMemo(() => {
    const list = filter === 'ALL' ? files : files.filter((f) => f.status === filter)
    return list.some((f) => f.priority) ? sortByPriority(list) : list
  }, [files, filter])

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  const isFresh = (id: string) => knownIds.current != null && !knownIds.current.has(id)
  useEffect(() => {
    if (!loaded) return
    knownIds.current = new Set(files.map((f) => f.fileId))
  }, [files, loaded])

  const pending = files.filter((f) => f.status === 'PENDING')
  const deletable = useMemo(() => visible.filter(canApprove), [visible])
  const heldCount = pending.filter(isOnHold).length
  const reviewCount = pending.filter((f) => f.recommendation === 'REVIEW').length
  const highCount = pending.filter((f) => canApprove(f) && f.priority === 'HIGH').length
  const scanned = files.some((f) => f.priority)
  // Offer the finished scan only if it started after the newest upload; an older scan never saw these
  // files (the backend skips them on ingest), so applying it would score nothing.
  const newestUpload = files.reduce((max, f) => (f.uploadedAt > max ? f.uploadedAt : max), '')
  const scanReady =
    !scanned &&
    files.length > 0 &&
    finishedScanStartedAt != null &&
    Date.parse(finishedScanStartedAt) >= Date.parse(newestUpload)

  // Drop selections that are no longer approvable (approved elsewhere, filtered out, re-classified).
  useEffect(() => {
    setSelected((prev) => {
      const ok = new Set(deletable.map((f) => f.fileId))
      const next = new Set([...prev].filter((id) => ok.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [deletable])

  // Once the post-scan list renders, compare each row's position with where it sat before the scan.
  useEffect(() => {
    const before = orderBeforeScan.current
    if (!before || !visible.some((f) => f.priority)) return
    orderBeforeScan.current = null
    const next = new Map<string, number>()
    visible.forEach((f, i) => {
      const was = before.get(f.fileId)
      if (was != null && was > i) next.set(f.fileId, was - i)
    })
    setMoved(next)
  }, [visible])

  useEffect(() => {
    api
      .scanStatus()
      .then((s) => {
        setScanState(s.state === 'RUNNING' ? 'RUNNING' : 'IDLE')
        setFinishedScanStartedAt(s.state === 'COMPLETE' ? (s.startedAt ?? null) : null)
      })
      .catch(() => {})
    return () => {
      if (scanTimer.current) window.clearTimeout(scanTimer.current)
    }
  }, [])

  useEffect(() => {
    if (scanState !== 'RUNNING') return
    const poll = async () => {
      try {
        const s = await api.scanStatus()
        if (s.state === 'COMPLETE') {
          await applyScan()
          return
        }
        if (s.state === 'FAILED') {
          setScanState('FAILED')
          toast("The sensitive-data scan didn't finish. Start it again.", 'error')
          return
        }
        scanTimer.current = window.setTimeout(poll, SCAN_POLL_MS)
      } catch (e) {
        setScanState('FAILED')
        toast(errorMessage(e), 'error')
      }
    }
    scanTimer.current = window.setTimeout(poll, SCAN_POLL_MS)
    return () => {
      if (scanTimer.current) window.clearTimeout(scanTimer.current)
    }
  }, [scanState, refresh, toast])

  // Pull the finished job's findings into the queue; rows re-sort by exposure.
  async function applyScan() {
    orderBeforeScan.current = new Map(visibleRef.current.map((f, i) => [f.fileId, i]))
    const { updated } = await api.ingestScan()
    await refresh()
    setScanState('COMPLETE')
    setFinishedScanStartedAt(null)
    toast(`Scan finished. ${updated} files scored, riskiest first.`)
  }

  async function startScan() {
    try {
      if (scanReady) {
        await applyScan() // a finished job is waiting: no need to start another one
        return
      }
      await api.startScan()
      setScanState('RUNNING')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  function seen(id: string) {
    setMoved((m) => {
      if (!m.has(id)) return m
      const next = new Map(m)
      next.delete(id)
      return next
    })
  }

  async function act(f: FileRecord, action: 'approve' | 'reject' | 'restore' | 'purge') {
    setBusy((b) => new Set(b).add(f.fileId))
    try {
      const run = action === 'purge' ? api.purge : api[action]
      if (!run) return
      const updated = await run(f.fileId)
      upsert([updated])
      const name = fileName(f)
      toast(
        action === 'approve'
          ? `Approved. ${name} is in the grace period and can be restored until it's purged.`
          : action === 'reject'
            ? `Kept ${name}. It won't be deleted.`
            : action === 'purge'
              ? `Purged ${name}. Every stored copy is permanently deleted.`
              : `Restored ${name} to the review queue.`,
      )
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? `Not deleted: ${e.message}` : errorMessage(e), 'error')
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(f.fileId)
        return n
      })
    }
  }

  async function bulkApprove() {
    const ids = [...selected]
    setBusy(new Set(ids))
    try {
      const { approved, blocked } = await api.bulkApprove(ids)
      upsert(approved)
      setSelected(new Set())
      const bytes = approved.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
      if (approved.length) {
        toast(`Approved ${approved.length} files (${formatBytes(bytes)}). They're in the grace period now.`)
      }
      if (blocked.length) {
        toast(`${blocked.length} not approved. ${blocked[0].error}`, 'error')
        void refresh()
      }
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(new Set())
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = deletable.length > 0 && deletable.every((f) => selected.has(f.fileId))
  const selectedBytes = files.filter((f) => selected.has(f.fileId)).reduce((s, f) => s + (f.sizeBytes ?? 0), 0)

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Review queue</h1>
          <p>
            Each file has a recommendation from your firm's retention rules. Approve the ones you're ready to delete.
            Nothing is gone for good until the grace period ends.
          </p>
        </div>
        <ScanControl state={scanState} scanned={scanned} ready={scanReady} onStart={startScan} />
      </header>

      {error && (
        <Sign level="warning" compact className="page-sign">
          {error}
        </Sign>
      )}

      {pending.length > 0 && (
        <div className="queue-summary" aria-label="Summary">
          <span className="summary-item">
            <strong className="num">{pending.filter(canApprove).length}</strong> ready to delete
            {highCount > 0 && (
              <Chip level="solid">
                <span className="num">{highCount}</span> HIGH EXPOSURE
              </Chip>
            )}
          </span>
          {heldCount > 0 && (
            <span className="summary-item">
              <Chip level="hold">
                <span className="num">{heldCount}</span> ON LEGAL HOLD
              </Chip>
              preserved
            </span>
          )}
          {reviewCount > 0 && (
            <span className="summary-item">
              <Chip level="notice">
                <span className="num">{reviewCount}</span> NEED REVIEW
              </Chip>
              classification unclear
            </span>
          )}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            className="tab"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <span className="tab-count num">{counts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>

      {moved.size > 0 && (
        <p className="moved-note">
          <span className="moved">Up 3</span> means the file moved up 3 places after the scan because it holds more
          client data than expected. The marker clears once you've looked at the row.
        </p>
      )}

      <section className="queue" aria-label="Files">
        <div className="queue-head">
          <label className="check">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={deletable.length === 0}
              onChange={() => setSelected(allSelected ? new Set() : new Set(deletable.map((f) => f.fileId)))}
            />
            <span className="visually-hidden">Select every file that can be deleted</span>
          </label>
          <span>Exposure (score)</span>
          <span>File</span>
          <span>Recommendation</span>
          <span>Keep until</span>
          <span className="queue-head-actions">Decision</span>
        </div>

        {!loaded ? (
          <SkeletonRows />
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} hasFiles={files.length > 0} />
        ) : (
          <ul className="rows">
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((f) => (
                <Row
                  key={f.fileId}
                  file={f}
                  selected={selected.has(f.fileId)}
                  expanded={expanded === f.fileId}
                  busy={busy.has(f.fileId)}
                  movedBy={moved.get(f.fileId)}
                  fresh={isFresh(f.fileId)}
                  onSeen={() => seen(f.fileId)}
                  onToggleSelect={() => toggle(f.fileId)}
                  onToggleExpand={() => {
                    seen(f.fileId)
                    setExpanded((x) => (x === f.fileId ? null : f.fileId))
                  }}
                  onAct={(a) => act(f, a)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            className="bulk-bar"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            <span>
              <strong className="num">{selected.size}</strong> selected, {formatBytes(selectedBytes)}
            </span>
            <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
            <button className="btn btn-primary" onClick={bulkApprove} disabled={busy.size > 0}>
              Approve {selected.size} for deletion
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function ScanControl({
  state,
  scanned,
  ready,
  onStart,
}: {
  state: ScanState
  scanned: boolean
  ready: boolean
  onStart: () => void
}) {
  if (state === 'RUNNING') {
    return (
      <div className="scan-running" role="status">
        <span>Scanning for SSNs, account numbers and birth dates</span>
        <span className="scan-track" aria-hidden="true">
          <span />
        </span>
      </div>
    )
  }
  return (
    <button className="btn" onClick={onStart}>
      {ready ? 'Show sensitive-data results' : scanned ? 'Scan for sensitive data again' : 'Scan for sensitive data'}
    </button>
  )
}

function SkeletonRows() {
  return (
    <ul className="rows" aria-label="Loading files">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="row row-skeleton">
          <div className="row-main">
            <span />
            <span className="sk sk-chip" />
            <span className="sk sk-name" />
            <span className="sk sk-chip" />
            <span className="sk sk-date" />
            <span />
          </div>
        </li>
      ))}
    </ul>
  )
}

function EmptyState({ filter, hasFiles }: { filter: Filter; hasFiles: boolean }) {
  if (!hasFiles) {
    return (
      <div className="empty">
        <h2>No files yet</h2>
        <p>Upload a folder and each file will show up here once it's classified.</p>
        <Link className="btn btn-primary" to="/upload">
          Upload files
        </Link>
      </div>
    )
  }
  const copy: Partial<Record<Filter, string>> = {
    PENDING: 'Every file has a decision. The dashboard shows what was cleared.',
    QUARANTINED: 'No files are in the grace period. Approved deletions wait here before they are purged.',
    LOCKED: 'No files are locked. High-sensitivity records that must be kept move here after a scan.',
    REJECTED: 'No files have been kept against a recommendation.',
    PURGED: 'Nothing has been permanently deleted yet.',
  }
  return <div className="empty">{copy[filter] ?? 'No files match this filter.'}</div>
}

interface RowProps {
  ref?: Ref<HTMLLIElement>
  file: FileRecord
  selected: boolean
  expanded: boolean
  busy: boolean
  movedBy?: number
  fresh: boolean
  onSeen: () => void
  onToggleSelect: () => void
  onToggleExpand: () => void
  onAct: (action: 'approve' | 'reject' | 'restore' | 'purge') => void
}

function Row({ ref, file: f, selected, expanded, busy, movedBy, fresh, onSeen, onToggleSelect, onToggleExpand, onAct }: RowProps) {
  const held = isOnHold(f)
  const approvable = canApprove(f)
  const name = fileName(f)
  const detailsId = `details-${f.fileId}`

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={fresh ? { opacity: 0, backgroundColor: 'rgba(255, 209, 0, 0.35)' } : { opacity: 0 }}
      animate={{ opacity: 1, backgroundColor: 'rgba(255, 209, 0, 0)' }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2, ease: EASE_OUT } }}
      transition={{ layout: REORDER, opacity: { duration: 0.2 }, backgroundColor: { duration: 1.6, ease: EASE_OUT } }}
      className={`row ${held ? 'row-held' : ''} ${selected ? 'row-selected' : ''}`}
      onPointerEnter={movedBy ? onSeen : undefined}
      onFocusCapture={movedBy ? onSeen : undefined}
    >
      <div className="row-main">
        <label className="check">
          <input type="checkbox" checked={selected} disabled={!approvable} onChange={onToggleSelect} />
          <span className="visually-hidden">Select {name}</span>
        </label>

        <div className="row-risk">
          <Priority file={f} />
          {movedBy != null && <MovedMarker by={movedBy} />}
        </div>

        <button className="row-file" onClick={onToggleExpand} aria-expanded={expanded} aria-controls={detailsId}>
          <span className="row-name">{name}</span>
          <span className="row-type">
            {docTypeLabel(f.docType)}
            {f.sizeBytes != null && `, ${formatBytes(f.sizeBytes)}`}
          </span>
        </button>

        <div className="row-rec">
          <RecommendationTag file={f} />
        </div>

        <div className="row-keep num">{held ? 'Until hold lifts' : f.keepUntil ? formatDate(f.keepUntil) : '—'}</div>

        <div className="row-actions">
          <RowActions file={f} busy={busy} onAct={onAct} />
        </div>
      </div>

      {held && f.status === 'PENDING' && (
        <Sign level="hold" compact className="hold-sign">
          {f.clientName ? (
            <>
              <strong>{f.clientName}</strong> is under a legal hold, so this file is kept
            </>
          ) : (
            'This file is under a legal hold, so it is kept'
          )}{' '}
          until compliance releases the hold, whatever its retention date says.
        </Sign>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={detailsId}
            className="row-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <Details file={f} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

function MovedMarker({ by }: { by: number }) {
  return (
    <span className="moved" aria-label={`Moved up ${by} places after the scan`}>
      Up <span className="num">{by}</span>
    </span>
  )
}

// Exposure is how much client data a file holds. It sets order, not permission, so it uses a navy
// meter rather than safety colours (those are reserved for files that can't be deleted).
const EXPOSURE_LEVEL = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const

function Priority({ file: f }: { file: FileRecord }) {
  if (!f.priority) return <Chip level="ghost">Not scanned</Chip>
  const level = EXPOSURE_LEVEL[f.priority]
  return (
    <span className={`exposure exposure-${f.priority.toLowerCase()}`}>
      <span className="exposure-meter" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= level ? 'on' : ''} />
        ))}
      </span>
      <span className="exposure-label">{f.priority}</span>
      <span className="exposure-score num">{f.sensitivityScore ?? 0}</span>
    </span>
  )
}

function RecommendationTag({ file: f }: { file: FileRecord }) {
  if (isOnHold(f)) return <Chip level="hold">LEGAL HOLD</Chip>
  switch (f.status) {
    case 'QUARANTINED':
      return <Chip level="ghost">In grace period</Chip>
    case 'PURGED':
      return <Chip level="ghost">Purged</Chip>
    case 'LOCKED':
      return <Chip level="solid">LOCKED RECORD</Chip>
    case 'REJECTED':
      return <Chip level="plain">Kept by you</Chip>
  }
  switch (f.recommendation) {
    case 'DELETE':
      return <Chip level="solid">DELETE</Chip>
    case 'RETAIN':
      return <Chip level="plain">RETAIN</Chip>
    case 'REVIEW':
      return <Chip level="notice">NEEDS REVIEW</Chip>
    default:
      return <Chip level="ghost">Classifying</Chip>
  }
}

function RowActions({ file: f, busy, onAct }: { file: FileRecord; busy: boolean; onAct: RowProps['onAct'] }) {
  if (f.status === 'QUARANTINED') {
    return (
      <>
        <button className="btn btn-small" disabled={busy} onClick={() => onAct('restore')}>
          Restore
        </button>
        {api.purge && (
          <button
            className="btn btn-small btn-quiet btn-purge"
            disabled={busy}
            onClick={() => onAct('purge')}
            title="Demo only: skip the grace period and delete every stored copy now"
          >
            Purge now
          </button>
        )}
      </>
    )
  }
  if (f.status !== 'PENDING') return null
  if (isOnHold(f)) return <span className="row-note">Preserved</span>
  if (f.recommendation === 'RETAIN') return <span className="row-note">Within retention</span>
  return (
    <>
      <button className="btn btn-small" disabled={busy} onClick={() => onAct('reject')}>
        Keep
      </button>
      {f.recommendation === 'DELETE' && (
        <button className="btn btn-small btn-primary btn-approve" disabled={busy} onClick={() => onAct('approve')}>
          Approve
        </button>
      )}
    </>
  )
}

function Details({ file: f }: { file: FileRecord }) {
  const held = isOnHold(f)
  const findings = Object.entries(f.macieFindings ?? {}).filter(([, n]) => n > 0)
  return (
    <div className="details-grid">
      <div className="details-reason">
        <h3>Why this recommendation</h3>
        <p>{f.rationale ?? 'No explanation recorded yet.'}</p>
        {f.citation && (
          <p className="details-cite">
            <span className="muted">Rule</span> {f.citation}
          </p>
        )}
      </div>
      <dl className="details-facts">
        {f.confidence != null && (
          <>
            <dt>Classifier confidence</dt>
            <dd className="num">{Math.round(f.confidence * 100)}%</dd>
          </>
        )}
        {f.clientName && (
          <>
            <dt>Client</dt>
            <dd>{f.clientName}</dd>
          </>
        )}
        {f.accountId && (
          <>
            <dt>Account</dt>
            <dd>{f.accountId}</dd>
          </>
        )}
        {f.priority != null && (
          <>
            <dt>Exposure score</dt>
            <dd className="num">{f.sensitivityScore ?? 0} (SSNs and IDs count 10, account numbers 8, birth dates 5, names 1)</dd>
          </>
        )}
        {held && f.keepUntil && (
          <>
            <dt>Retention date</dt>
            <dd className="num">{formatDate(f.keepUntil)}, superseded by the legal hold</dd>
          </>
        )}
        <dt>Sensitive data found</dt>
        <dd>
          {f.priority == null
            ? 'Not scanned yet'
            : findings.length
              ? findings.map(([t, n]) => `${n} ${t.toLowerCase().replace(/_/g, ' ')}`).join(', ')
              : f.piiTypes?.length
                ? `From the image: ${f.piiTypes.map((t) => t.toLowerCase().replace(/_/g, ' ')).join(', ')}`
                : 'None'}
        </dd>
        {f.sha256 && (
          <>
            <dt>SHA-256</dt>
            <dd className="details-hash num">{f.sha256}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
