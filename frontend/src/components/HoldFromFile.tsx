import { useMemo, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api/client'
import { signInEnabled } from '../auth/config'
import { useOptionalSession } from '../auth/session'
import { isOnHold } from '../lib/format'
import { useFiles } from '../state/files'
import { useToast } from '../state/toast'
import type { FileRecord } from '../types'

// Place a legal hold on this file's client without leaving the queue (P2). Compliance usually learns about a
// dispute while looking at a client's file; this pre-fills the client and says how many files it would protect.
// Same API as Admin > Legal holds (POST /holds), so the hold covers every file for the client, now and later.

const EASE = [0.16, 1, 0.3, 1] as const

export function HoldFromFile({ file }: { file: FileRecord }) {
  const auth = useOptionalSession()
  const { files, refresh } = useFiles()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const client = file.clientName?.trim()
  const covered = useMemo(
    () => (client ? files.filter((f) => (f.clientName ?? '').toLowerCase().includes(client.toLowerCase())).length : 0),
    [files, client],
  )

  // Holds are compliance's call (the API checks the same thing). Without sign-in the demo advisor can.
  const role = auth?.session.status === 'signedIn' ? auth.session.role : null
  const allowed = !signInEnabled || role === 'compliance' || role === 'admin' || role === 'platform'
  if (!client || isOnHold(file) || !allowed) return null

  async function place(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const hold = await api.placeHold({ scopeType: 'CLIENT_NAME', scopeValue: client!, reason })
      toast(
        `Hold ${hold.holdId} placed. ${hold.matchedFiles ?? covered} ${client} ${
          (hold.matchedFiles ?? covered) === 1 ? 'file is' : 'files are'
        } protected from deletion.`,
        'ok',
      )
      setOpen(false)
      setReason('')
      await refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hold-from-file">
      <AnimatePresence initial={false} mode="wait">
        {!open ? (
          <motion.button
            key="open"
            type="button"
            className="btn btn-small"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            Place a legal hold on {client}
          </motion.button>
        ) : (
          <motion.form
            key="form"
            onSubmit={place}
            className="hold-from-file-form"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <label>
              <span>
                Why is {client} on hold? It protects {covered} {covered === 1 ? 'file' : 'files'} now, and any
                uploaded later.
              </span>
              <input
                autoFocus
                required
                value={reason}
                placeholder="e.g. Arbitration filed over 2022 annuity advice"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              />
            </label>
            <div className="hold-from-file-actions">
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-small btn-primary" disabled={busy || !reason.trim()}>
                {busy ? 'Placing…' : 'Place hold'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
