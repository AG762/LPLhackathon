import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, mode } from '../api/client'
import { fileName, formatDateTime, shortHash } from '../lib/format'
import { useFiles } from '../state/files'
import { useToast } from '../state/toast'
import type { AuditEntry, VerifyResult } from '../types'
import './audit.css'

const ACTION_LABELS: Record<string, string> = {
  CLASSIFIED: 'Classified',
  APPROVED: 'Approved for deletion',
  REJECTED: 'Kept against recommendation',
  QUARANTINED: 'Moved to grace period',
  RESTORED: 'Restored from grace period',
  PURGED: 'Permanently deleted',
  LOCKED: 'Locked as a record',
  SENSITIVITY_SCORED: 'Sensitive-data scan scored',
}

function actorLabel(actor: string) {
  if (actor.startsWith('system:')) return `System (${actor.slice(7)})`
  return actor
}

export default function AuditPage() {
  const { files } = useFiles()
  const toast = useToast()
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const brokenRef = useRef<HTMLLIElement>(null)

  const names = useMemo(() => new Map(files.map((f) => [f.fileId, fileName(f)])), [files])

  const load = useCallback(async () => {
    setChecking(true)
    try {
      const [list, v] = await Promise.all([api.audit(), api.verifyAudit()])
      setEntries(list)
      setVerify(v)
      setError(null)
      return v
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (verify && !verify.ok) brokenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [verify])

  async function recheck() {
    const v = await load()
    if (v) toast(v.ok ? 'Chain verified. Every entry matches its hash.' : `Chain broken at entry ${v.brokenAtSeq}.`, v.ok ? 'ok' : 'error')
  }

  async function tamper() {
    await api.tamper?.()
    await load()
  }

  async function repair() {
    await api.repair?.()
    await load()
  }

  async function downloadCertificate() {
    setDownloading(true)
    try {
      const blob = await api.certificate()
      const ext = blob.type.includes('pdf') ? 'pdf' : 'txt'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `certificate-of-disposal-${new Date().toISOString().slice(0, 10)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setDownloading(false)
    }
  }

  const broken = verify && !verify.ok ? (verify.brokenAtSeq ?? 0) : null

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>
            Every decision is written here and sealed with a hash of the entry before it. If anyone edits a past entry,
            the chain breaks at that point.
          </p>
        </div>
        <div className="audit-actions">
          <button className="btn" onClick={recheck} disabled={checking}>
            {checking ? 'Checking…' : 'Verify chain'}
          </button>
          <button className="btn btn-primary" onClick={downloadCertificate} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download certificate of disposal'}
          </button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      {verify && entries && (
        <div className={`seal ${verify.ok ? 'seal-ok' : 'seal-broken'}`} role="status">
          <ChainGlyph ok={verify.ok} />
          <div>
            <div className="seal-title">{verify.ok ? 'Chain intact' : `Chain broken at entry ${broken}`}</div>
            <div className="seal-sub">
              {verify.ok
                ? `All ${entries.length} entries match their hashes. Head ${shortHash(entries[entries.length - 1]?.entryHash)}`
                : 'This entry was changed after it was written. Every entry after it can no longer be trusted.'}
            </div>
          </div>
        </div>
      )}

      {mode === 'mock' && api.tamper && (
        <div className="rehearsal">
          <span className="muted">Rehearsal controls for the demo:</span>
          <button className="btn btn-small" onClick={tamper} disabled={!verify?.ok}>
            Edit an entry behind the system's back
          </button>
          <button className="btn btn-small btn-quiet" onClick={repair} disabled={verify?.ok}>
            Undo the edit
          </button>
        </div>
      )}

      {entries == null ? (
        !error && <div className="empty">Loading the audit log…</div>
      ) : entries.length === 0 ? (
        <div className="panel empty">No entries yet. Every classification, approval and deletion will be recorded here.</div>
      ) : (
        <ol className="chain">
          {entries.map((e, i) => {
            const state = broken == null ? 'ok' : e.seq < broken ? 'ok' : e.seq === broken ? 'broken' : 'untrusted'
            return (
              <li key={e.seq} ref={e.seq === broken ? brokenRef : undefined} className={`link link-${state}`}>
                {i > 0 && <span className="link-joint" aria-hidden="true" />}
                <div className="link-seq num">{e.seq}</div>
                <div className="link-body">
                  <div className="link-top">
                    <span className="link-action">{ACTION_LABELS[e.action] ?? e.action}</span>
                    {e.fileId && <span className="link-file">{names.get(e.fileId) ?? e.fileId}</span>}
                  </div>
                  <div className="link-meta muted">
                    {formatDateTime(e.timestamp)}, by {actorLabel(e.actor)}
                    {e.ruleApplied && `, rule ${e.ruleApplied}`}
                  </div>
                  {state === 'broken' && (
                    <div className="link-alarm">This entry's contents no longer match the hash it was sealed with.</div>
                  )}
                </div>
                <div className="link-hashes" title={`Entry hash ${e.entryHash}\nPrevious hash ${e.prevHash}`}>
                  <span className="num">{shortHash(e.entryHash)}</span>
                  <span className="muted num">prev {shortHash(e.prevHash)}</span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

function ChainGlyph({ ok }: { ok: boolean }) {
  return (
    <svg className="seal-glyph" viewBox="0 0 40 24" aria-hidden="true">
      <rect x="2" y="6" width="16" height="12" rx="6" fill="none" stroke="currentColor" strokeWidth="2.6" />
      {ok ? (
        <rect x="22" y="6" width="16" height="12" rx="6" fill="none" stroke="currentColor" strokeWidth="2.6" />
      ) : (
        <path d="M26 6h6a6 6 0 0 1 0 12h-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {ok && <line x1="14" y1="12" x2="26" y2="12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />}
    </svg>
  )
}
