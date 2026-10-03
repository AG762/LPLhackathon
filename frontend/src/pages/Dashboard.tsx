import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { Sign } from '../components/Sign'
import { formatBytes, isOnHold } from '../lib/format'
import { computeMetrics, isRemoved } from '../lib/metrics'
import { useFiles } from '../state/files'
import type { DashboardMetrics, FileRecord } from '../types'
import './dashboard.css'

const pct = (x: number) => `${Math.round(x * 100)}%`

interface Segment {
  key: string
  label: string
  count: number
}

function breakdown(files: FileRecord[]): Segment[] {
  const pending = files.filter((f) => f.status === 'PENDING')
  return [
    { key: 'removed', label: 'Approved for deletion', count: files.filter(isRemoved).length },
    { key: 'delete', label: 'Ready to delete', count: pending.filter((f) => f.recommendation === 'DELETE' && !isOnHold(f)).length },
    { key: 'review', label: 'Needs review', count: pending.filter((f) => f.recommendation === 'REVIEW').length },
    { key: 'hold', label: 'On legal hold', count: files.filter(isOnHold).length },
    {
      key: 'retain',
      label: 'Retained as records',
      count: files.filter(
        (f) => !isOnHold(f) && (f.status === 'LOCKED' || f.status === 'REJECTED' || (f.status === 'PENDING' && f.recommendation === 'RETAIN')),
      ).length,
    },
  ]
}

export default function DashboardPage() {
  const { files, loaded } = useFiles()
  const [server, setServer] = useState<DashboardMetrics | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const filesKey = files.map((f) => `${f.fileId}:${f.status}:${f.priority ?? ''}`).join('|')

  useEffect(() => {
    let cancelled = false
    api
      .dashboard()
      .then((m) => {
        if (cancelled) return
        setServer(m)
        setFallbackReason(null)
      })
      .catch((e) => {
        if (cancelled) return
        setServer(null)
        setFallbackReason(e instanceof ApiError && e.status === 501 ? 'not-built' : e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [filesKey])

  const m = server ?? computeMetrics(files, true)
  const chainKnown = server != null
  const segments = breakdown(files)
  const total = segments.reduce((s, x) => s + x.count, 0)
  const scanned = files.some((f) => f.priority)
  const readyCount = segments.find((s) => s.key === 'delete')?.count ?? 0

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>What you've cleared out, what's left, and the proof that nothing protected was touched.</p>
        </div>
      </header>

      {fallbackReason && (
        <Sign level="notice" compact className="dash-notice">
          {fallbackReason === 'not-built'
            ? "The dashboard endpoint isn't built on the backend yet, so these numbers are worked out from your file list."
            : `Couldn't load dashboard numbers (${fallbackReason}). Showing figures from your file list instead.`}
        </Sign>
      )}

      {!loaded && !server ? (
        // Until the file list arrives, don't claim there's nothing to report (QA, F.23)
        <p className="muted dash-loading" role="status">
          Loading your numbers…
        </p>
      ) : m.totalFiles === 0 ? (
        <div className="panel empty">
          <h2>Nothing to report yet</h2>
          <p>Upload files and approve some deletions, and your results will show up here.</p>
          <Link className="btn btn-primary" to="/upload">
            Upload files
          </Link>
        </div>
      ) : (
        <>
          <section className="dash-lead">
            {m.storageReclaimedBytes > 0 ? (
              <p className="dash-sentence">
                You've cleared <strong className="num">{formatBytes(m.storageReclaimedBytes)}</strong> and removed{' '}
                <strong className="num">{m.piiItemsRemoved}</strong> pieces of client personal data from your files.
              </p>
            ) : (
              <p className="dash-sentence">
                Nothing cleared yet. <strong className="num">{readyCount}</strong> of your files are past retention and
                ready to delete.
              </p>
            )}
            {m.heldFilesDeleted === 0 ? (
              <Sign level="safe" word="NO PROTECTED FILES DELETED" className="dash-guarantee">
                Files under a legal hold or still inside their retention period can't be approved, so none have been
                deleted.
              </Sign>
            ) : (
              <Sign level="danger" word={`${m.heldFilesDeleted} PROTECTED FILES DELETED`} className="dash-guarantee">
                Files under a legal hold or still within retention were deleted. Escalate to Compliance.
              </Sign>
            )}
          </section>

          <section className="dash-breakdown" aria-labelledby="breakdown-title">
            <h2 id="breakdown-title">Where your {m.totalFiles} files stand</h2>
            <div className="stack" role="img" aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(', ')}>
              {segments
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span key={s.key} className={`stack-seg seg-${s.key}`} style={{ flexGrow: s.count }} title={`${s.label}: ${s.count}`} />
                ))}
            </div>
            <ul className="legend">
              {segments.map((s) => (
                <li key={s.key}>
                  <span className={`legend-swatch seg-${s.key}`} aria-hidden="true" />
                  {s.label}
                  <span className="num legend-count">{s.count}</span>
                  <span className="muted num">{total ? pct(s.count / total) : '0%'}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="dash-measures" aria-labelledby="measures-title">
            <h2 id="measures-title">Measures</h2>
            <dl>
              <Measure label="Storage reclaimed" value={formatBytes(m.storageReclaimedBytes)} note={`${pct(m.storageReclaimedPct)} of everything uploaded`} />
              <Measure label="Personal data removed" value={String(m.piiItemsRemoved)} note="SSNs, account numbers, birth dates and other items found by the scan" />
              <Measure
                label="High-exposure files waiting"
                value={scanned ? String(m.highPriorityBacklog) : '—'}
                note={
                  !scanned
                    ? 'Run the sensitive-data scan from the review queue to find these.'
                    : m.highPriorityBacklog
                      ? 'Past retention and full of client data. Clear these first.'
                      : 'None left to review.'
                }
                tone={undefined}
                link={!scanned || m.highPriorityBacklog ? { to: '/queue', text: 'Open the review queue' } : undefined}
              />
              <Measure label="Kept longer than required" value={pct(m.overRetainedPct)} note="Share of your files that were past their retention date when found" />
              <Measure
                label="Recommended automatically"
                value={`${m.autoCleared} of ${m.autoCleared + m.neededReview}`}
                note={`${m.neededReview} needed a person to decide`}
              />
              <Measure
                label="Audit trail"
                value={chainKnown ? (m.chainOk ? 'Verified' : 'Failed') : 'Not checked'}
                note={chainKnown ? (m.chainOk ? 'Integrity check passed' : 'Integrity check failed: an entry was changed after it was written') : 'Run the integrity check on the audit log page'}
                tone={chainKnown && !m.chainOk ? 'danger' : undefined}
                link={{ to: '/audit', text: 'View the audit log' }}
              />
            </dl>
          </section>
        </>
      )}
    </>
  )
}

function Measure({
  label,
  value,
  note,
  tone,
  link,
}: {
  label: string
  value: string
  note: string
  tone?: 'warning' | 'danger'
  link?: { to: string; text: string }
}) {
  return (
    <div className={`measure ${tone ? `measure-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd className="measure-value num">{value}</dd>
      <dd className="measure-note">
        {note}
        {link && (
          <>
            {' '}
            <Link to={link.to}>{link.text}</Link>
          </>
        )}
      </dd>
    </div>
  )
}
