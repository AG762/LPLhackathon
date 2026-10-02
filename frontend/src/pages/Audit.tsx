import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, mode } from '../api/client'
import { Sign } from '../components/Sign'
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
    if (v) toast(v.ok ? 'Integrity check passed.' : `Integrity check failed at entry ${v.brokenAtSeq}.`, v.ok ? 'ok' : 'error')
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
            Every action on your files is recorded here, and each entry includes a hash of the one before it. If a past
            entry is edited, the integrity check fails at that entry.
          </p>
        </div>
        <div className="audit-actions">
          <button className="btn" onClick={recheck} disabled={checking}>
            {checking ? 'Checking…' : 'Run integrity check'}
          </button>
          <button
            className="btn btn-primary"
            onClick={downloadCertificate}
            disabled={downloading || verify?.ok === false}
            aria-describedby={verify?.ok === false ? 'cert-blocked' : undefined}
          >
            {downloading ? 'Preparing…' : 'Download certificate of disposal'}
          </button>
          {verify?.ok === false && (
            <span id="cert-blocked" className="cert-blocked">
              Unavailable until the integrity check passes. Resolve with Compliance first.
            </span>
          )}
        </div>
      </header>

      {error && (
        <Sign level="warning" compact className="audit-sign">
          {error}
        </Sign>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {verify && entries && (
          <motion.div
            key={verify.ok ? 'ok' : 'broken'}
            className="audit-seal"
            initial={{ clipPath: 'inset(0 0 100% 0)' }}
            animate={{ clipPath: 'inset(0 0 0% 0)' }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            role="status"
          >
            {verify.ok ? (
              <Sign level="safe" word="INTEGRITY CHECK PASSED">
                All <strong className="num">{entries.length}</strong> entries match their recorded hashes. Latest hash{' '}
                <span className="num">{shortHash(entries[entries.length - 1]?.entryHash)}</span>.
              </Sign>
            ) : (
              <Sign level="danger" word="INTEGRITY CHECK FAILED">
                <strong>Entry {broken} doesn't match its recorded hash</strong>, so it was changed after it was written.
                Entries after it can't be relied on. Escalate to Compliance before using this log as exam evidence.
              </Sign>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === 'mock' && api.tamper && (
        <div className="rehearsal">
          <span className="muted">Demo only:</span>
          <button className="btn btn-small" onClick={tamper} disabled={!verify?.ok}>
            Simulate tampering
          </button>
          <button className="btn btn-small btn-quiet" onClick={repair} disabled={verify?.ok}>
            Restore original entry
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
                <div className="link-rail" aria-hidden="true">
                  {i > 0 && <span className="link-joint" />}
                  <span className="link-node num">{e.seq}</span>
                </div>
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
                    <motion.div
                      className="link-alarm"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      Doesn't match its recorded hash.
                    </motion.div>
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
