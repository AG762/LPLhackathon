import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { api, ApiError } from '../api/client'
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
  const scanTimer = useRef<number | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: files.length }
    for (const f of files) c[f.status] = (c[f.status] ?? 0) + 1
    return c
  }, [files])

  const visible = useMemo(() => {
    const list = filter === 'ALL' ? files : files.filter((f) => f.status === filter)
    return list.some((f) => f.priority) ? sortByPriority(list) : list
  }, [files, filter])

  const pending = files.filter((f) => f.status === 'PENDING')
  const deletable = visible.filter(canApprove)
  const heldCount = pending.filter(isOnHold).length
  const reviewCount = pending.filter((f) => f.recommendation === 'REVIEW').length
  const scanned = files.some((f) => f.priority)

  // Drop selections that are no longer approvable (approved elsewhere, filtered out, re-classified).
  useEffect(() => {
    setSelected((prev) => {
      const ok = new Set(deletable.map((f) => f.fileId))
      const next = new Set([...prev].filter((id) => ok.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [deletable])

  useEffect(() => {
    api
      .scanStatus()
      .then((s) => setScanState(s.state === 'RUNNING' ? 'RUNNING' : 'IDLE'))
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
          const { updated } = await api.ingestScan()
          await refresh()
          setScanState('COMPLETE')
          toast(`Scan finished. ${updated} files scored; the riskiest are now at the top.`)
          return
        }
        if (s.state === 'FAILED') {
          setScanState('FAILED')
          toast('The sensitive-data scan failed. Try starting it again.', 'error')
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

  async function startScan() {
    try {
      await api.startScan()
      setScanState('RUNNING')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  async function act(f: FileRecord, action: 'approve' | 'reject' | 'restore') {
    setBusy((b) => new Set(b).add(f.fileId))
    try {
      const updated = await api[action](f.fileId)
      upsert([updated])
      const name = fileName(f)
      toast(
        action === 'approve'
          ? `Approved. ${name} is in the grace period and can be restored until it's purged.`
          : action === 'reject'
            ? `Kept ${name}. It won't be deleted.`
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
      const updated = await api.bulkApprove(ids)
      upsert(updated)
      setSelected(new Set())
      const bytes = updated.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
      toast(`Approved ${updated.length} files (${formatBytes(bytes)}). They're in the grace period now.`)
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? `Nothing deleted: ${e.message}` : errorMessage(e), 'error')
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
        <ScanButton state={scanState} scanned={scanned} onStart={startScan} />
      </header>

      {error && <div className="notice error">{error}</div>}

      {pending.length > 0 && (
        <p className="queue-summary">
          <span>
            <strong className="num">{pending.filter(canApprove).length}</strong> ready to delete
          </span>
          {heldCount > 0 && (
            <span className="summary-hold">
              <strong className="num">{heldCount}</strong> blocked by a legal hold
            </span>
          )}
          {reviewCount > 0 && (
            <span>
              <strong className="num">{reviewCount}</strong> need your judgment
            </span>
          )}
        </p>
      )}

      <div className="filters" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            className="filter"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <span className="num">{counts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <section className="panel queue" aria-label="Files">
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
          <span>Risk</span>
          <span>File</span>
          <span>Recommendation</span>
          <span>Keep until</span>
          <span />
        </div>

        {!loaded ? (
          <div className="empty">Loading files…</div>
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} hasFiles={files.length > 0} />
        ) : (
          <ul className="rows">
            <AnimatePresence initial={false}>
              {visible.map((f) => (
                <Row
                  key={f.fileId}
                  file={f}
                  selected={selected.has(f.fileId)}
                  expanded={expanded === f.fileId}
                  busy={busy.has(f.fileId)}
                  onToggleSelect={() => toggle(f.fileId)}
                  onToggleExpand={() => setExpanded((x) => (x === f.fileId ? null : f.fileId))}
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
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <span>
              <strong className="num">{selected.size}</strong> selected,{' '}
              {formatBytes(files.filter((f) => selected.has(f.fileId)).reduce((s, f) => s + (f.sizeBytes ?? 0), 0))}
            </span>
            <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
              Clear
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

function ScanButton({ state, scanned, onStart }: { state: ScanState; scanned: boolean; onStart: () => void }) {
  if (state === 'RUNNING') {
    return (
      <div className="scan scan-running" role="status">
        <span className="scan-pulse" aria-hidden="true" />
        Scanning files for SSNs, account numbers and birth dates…
      </div>
    )
  }
  return (
    <button className="btn" onClick={onStart}>
      {scanned ? 'Scan for sensitive data again' : 'Scan for sensitive data'}
    </button>
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
    PENDING: 'Every file has a decision. Check the dashboard to see what was cleared.',
    QUARANTINED: 'No files are in the grace period. Approved deletions wait here before they are purged.',
    LOCKED: 'No files are locked. High-sensitivity records that must be kept are moved here after a scan.',
    REJECTED: "No files have been kept against a recommendation.",
    PURGED: 'Nothing has been permanently deleted yet.',
  }
  return <div className="empty">{copy[filter] ?? 'No files match this filter.'}</div>
}

interface RowProps {
  file: FileRecord
  selected: boolean
  expanded: boolean
  busy: boolean
  onToggleSelect: () => void
  onToggleExpand: () => void
  onAct: (action: 'approve' | 'reject' | 'restore') => void
}

function Row({ file: f, selected, expanded, busy, onToggleSelect, onToggleExpand, onAct }: RowProps) {
  const held = isOnHold(f)
  const approvable = canApprove(f)
  const name = fileName(f)
  const detailsId = `details-${f.fileId}`

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, backgroundColor: 'var(--amber-wash)' }}
      animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.22 } }}
      style={{ overflow: 'hidden' }}
      transition={{ layout: { type: 'spring', stiffness: 380, damping: 36 }, backgroundColor: { duration: 1.6 } }}
      className={`row ${held ? 'row-held' : ''} ${selected ? 'row-selected' : ''}`}
    >
      <div className="row-main">
        <label className="check">
          <input type="checkbox" checked={selected} disabled={!approvable} onChange={onToggleSelect} />
          <span className="visually-hidden">Select {name}</span>
        </label>

        <Priority file={f} />

        <button className="row-file" onClick={onToggleExpand} aria-expanded={expanded} aria-controls={detailsId}>
          <span className="row-name">{name}</span>
          <span className="row-type muted">
            {docTypeLabel(f.docType)}
            {f.sizeBytes != null && `, ${formatBytes(f.sizeBytes)}`}
          </span>
        </button>

        <div>
          <RecommendationBadge file={f} />
        </div>

        <div className="row-keep num">{f.keepUntil ? formatDate(f.keepUntil) : held ? 'Hold active' : '—'}</div>

        <div className="row-actions">
          <RowActions file={f} busy={busy} onAct={onAct} />
        </div>
      </div>

      {held && f.status === 'PENDING' && (
        <p className="hold-line">
          <strong>Blocked by legal hold.</strong> {f.clientName ? `${f.clientName} is` : 'This client is'} under an
          active hold, so this file can't be deleted, even though it looks like clutter.
        </p>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={detailsId}
            className="row-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Details file={f} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

function Priority({ file: f }: { file: FileRecord }) {
  if (!f.priority) return <span className="prio prio-none muted">Not scanned</span>
  const label = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }[f.priority]
  return (
    <span className={`prio prio-${f.priority.toLowerCase()}`} title={`Sensitivity score ${f.sensitivityScore ?? 0}`}>
      <span className="prio-dot" aria-hidden="true" />
      {label}
      <span className="prio-score num">{f.sensitivityScore ?? 0}</span>
    </span>
  )
}

function RecommendationBadge({ file: f }: { file: FileRecord }) {
  if (isOnHold(f)) return <span className="badge badge-hold">Legal hold</span>
  switch (f.status) {
    case 'QUARANTINED':
      return <span className="badge badge-grace">In grace period</span>
    case 'PURGED':
      return <span className="badge badge-purged">Purged</span>
    case 'LOCKED':
      return <span className="badge badge-locked">Locked record</span>
    case 'REJECTED':
      return <span className="badge badge-kept">Kept by you</span>
  }
  switch (f.recommendation) {
    case 'DELETE':
      return <span className="badge badge-delete">Delete</span>
    case 'RETAIN':
      return <span className="badge badge-retain">Retain</span>
    case 'REVIEW':
      return <span className="badge badge-review">Needs review</span>
    default:
      return <span className="badge muted">Classifying…</span>
  }
}

function RowActions({ file: f, busy, onAct }: { file: FileRecord; busy: boolean; onAct: RowProps['onAct'] }) {
  if (f.status === 'QUARANTINED') {
    return (
      <button className="btn btn-small" disabled={busy} onClick={() => onAct('restore')}>
        Restore
      </button>
    )
  }
  if (f.status !== 'PENDING') return null
  if (isOnHold(f)) return <span className="muted row-note">Can't be deleted</span>
  if (f.recommendation === 'RETAIN') return <span className="muted row-note">Kept automatically</span>
  return (
    <>
      {f.recommendation === 'DELETE' && (
        <button className="btn btn-small btn-primary" disabled={busy} onClick={() => onAct('approve')}>
          Approve
        </button>
      )}
      <button className="btn btn-small" disabled={busy} onClick={() => onAct('reject')}>
        Keep
      </button>
    </>
  )
}

function Details({ file: f }: { file: FileRecord }) {
  const findings = Object.entries(f.macieFindings ?? {}).filter(([, n]) => n > 0)
  return (
    <div className="details-grid">
      <div className="details-reason">
        <h3>Why</h3>
        <p>{f.rationale ?? 'No explanation recorded yet.'}</p>
        {f.citation && <p className="muted details-cite">Rule: {f.citation}</p>}
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
            <dd className="details-hash">{f.sha256}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
