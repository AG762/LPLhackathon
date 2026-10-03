import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api/client'
import { signInEnabled } from '../auth/config'
import { useOptionalSession } from '../auth/session'
import { Chip } from '../components/Sign'
import { DEMO_ADVISOR, docTypeLabel, fileName, formatDate } from '../lib/format'
import { useFiles } from '../state/files'
import { useToast } from '../state/toast'
import type { FileRecord, HoldScope, LegalHold, Member, RetentionRule, Role } from '../types'
import './admin.css'

// Admin (F.15): who can use ShredSafe, the legal holds that protect files, and the retention schedule.
// In Demo mode everything works against the in-browser backend; on the live stack these routes are
// proposed and not built yet, so each tab says so instead of failing silently.

type Tab = 'team' | 'holds' | 'rules'

const ROLES: { value: Role; label: string; can: string }[] = [
  { value: 'advisor', label: 'Advisor', can: 'Uploads files and approves deletions for their own clients' },
  { value: 'compliance', label: 'Compliance', can: 'Sees every file in the firm and manages legal holds' },
  { value: 'admin', label: 'Admin', can: 'Everything compliance can, plus people and settings' },
]

const SCOPES: { value: HoldScope; label: string; placeholder: string }[] = [
  { value: 'CLIENT_NAME', label: 'Client name', placeholder: 'e.g. Margaret Whitaker' },
  { value: 'CLIENT_ID', label: 'Client ID', placeholder: 'e.g. CL-20431' },
  { value: 'ACCOUNT_ID', label: 'Account', placeholder: 'e.g. ACCT-55120' },
  { value: 'BRANCH_ID', label: 'Branch', placeholder: 'e.g. BR-214' },
  { value: 'KEYWORD', label: 'File name keyword', placeholder: 'e.g. Okafor' },
]

const whenShort = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const scopeLabel = (s: HoldScope) => SCOPES.find((x) => x.value === s)?.label ?? s
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Mirrors the matching in backend/api/holds.py, so the form can preview what a hold would cover.
function wouldMatch(scope: HoldScope, value: string, f: FileRecord) {
  const v = value.trim().toLowerCase()
  if (!v) return false
  if (scope === 'CLIENT_NAME') return (f.clientName ?? '').toLowerCase().includes(v)
  if (scope === 'CLIENT_ID') return (f.clientId ?? '').toLowerCase() === v
  if (scope === 'ACCOUNT_ID') return (f.accountId ?? '').toLowerCase() === v
  if (scope === 'BRANCH_ID') return (f.branchId ?? '').toLowerCase() === v
  return fileName(f).toLowerCase().includes(v)
}

// The page checks the role itself, not just the sidebar link: an advisor who types /admin gets a plain
// "no access" screen. People is for admins; compliance manages holds and reads the rules. The API checks
// the same roles, so this is about not showing controls that would fail.
export default function AdminPage() {
  const auth = useOptionalSession()
  const selfEmail = auth?.session.status === 'signedIn' ? auth.session.email : undefined
  if (signInEnabled && (!auth || auth.session.status === 'loading')) {
    return (
      <p className="muted" role="status">
        Checking your access…
      </p>
    )
  }
  // Without sign-in (sample workspace) the demo advisor is the firm's admin.
  const role = !signInEnabled ? 'admin' : auth?.session.status === 'signedIn' ? auth.session.role : null
  const canManagePeople = role === 'admin' || role === 'platform'
  const canManageHolds = canManagePeople || role === 'compliance'

  if (!canManageHolds) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Admin</h1>
            <p>
              Only your firm's admins and compliance team can manage people and legal holds. Ask one of them if you
              need a hold placed or someone added.
            </p>
          </div>
        </header>
        <Link className="btn btn-primary" to="/queue">
          Back to the review queue
        </Link>
      </>
    )
  }
  return <AdminTabs canManagePeople={canManagePeople} selfEmail={selfEmail} />
}

function AdminTabs({ canManagePeople, selfEmail }: { canManagePeople: boolean; selfEmail?: string }) {
  const [tab, setTab] = useState<Tab>(canManagePeople ? 'team' : 'holds')
  const [counts, setCounts] = useState<Record<Tab, number | undefined>>({ team: undefined, holds: undefined, rules: undefined })
  const setCount = useCallback((t: Tab, n: number) => setCounts((c) => (c[t] === n ? c : { ...c, [t]: n })), [])

  const tabs: { value: Tab; label: string }[] = [
    ...(canManagePeople ? [{ value: 'team' as const, label: 'People' }] : []),
    { value: 'holds', label: 'Legal holds' },
    { value: 'rules', label: 'Retention rules' },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Admin</h1>
          <p>
            Who can use ShredSafe at your firm, the legal holds that stop files from being deleted, and the retention
            schedule behind every recommendation. Every change here is written to the audit log.
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {tabs.map((t) => (
          <button
            key={t.value}
            id={`admin-tab-${t.value}`}
            role="tab"
            aria-selected={tab === t.value}
            aria-controls={`admin-panel-${t.value}`}
            className="tab"
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {counts[t.value] != null && <span className="tab-count num">{counts[t.value]}</span>}
          </button>
        ))}
      </div>

      <section className="admin-panel" role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'team' && <People onCount={(n) => setCount('team', n)} selfEmail={selfEmail} />}
        {tab === 'holds' && <Holds onCount={(n) => setCount('holds', n)} />}
        {tab === 'rules' && <Rules onCount={(n) => setCount('rules', n)} />}
      </section>
    </>
  )
}

function Unavailable({ message, retry }: { message: string; retry: () => void }) {
  const notBuilt = message.startsWith('Not built on the backend yet')
  return (
    <div className="admin-unavailable">
      <h2>{notBuilt ? 'Not connected to the live stack yet' : "Couldn't load this"}</h2>
      <p>
        {notBuilt
          ? 'This part of your workspace isn\'t switched on yet. Switch the workspace data to Sample to explore it.'
          : message}
      </p>
      <button type="button" className="btn btn-small" onClick={retry}>
        Try again
      </button>
    </div>
  )
}

// ---------- People ----------

function People({ onCount, selfEmail }: { onCount: (n: number) => void; selfEmail?: string }) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('advisor')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.listMembers()
      setMembers(list)
      onCount(list.length)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [onCount])

  useEffect(() => {
    void load()
  }, [load])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy('invite')
    try {
      const m = await api.inviteMember(email, role)
      toast(`Invite sent to ${m.email}.`, 'ok')
      setEmail('')
      await load()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function changeRole(m: Member, next: Role) {
    setBusy(m.userId)
    try {
      await api.setMemberRole(m.userId, next)
      toast(`${m.name ?? m.email} is now ${next === 'admin' ? 'an admin' : `a ${next} user`}.`, 'ok')
      await load()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function toggle(m: Member) {
    const enable = m.status === 'DISABLED'
    setBusy(m.userId)
    try {
      await api.setMemberEnabled(m.userId, enable)
      toast(enable ? `${m.name ?? m.email} can sign in again.` : `${m.name ?? m.email} can no longer sign in.`, 'ok')
      await load()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Unavailable message={error} retry={() => void load()} />

  return (
    <>
      <form className="admin-form" onSubmit={invite}>
        <div className="admin-form-title">
          <h2>Invite someone</h2>
          <p>They get an email to set a password. Nobody can join your firm's workspace without an invite.</p>
        </div>
        <div className="admin-fields">
          <label className="field field-grow">
            <span>Work email</span>
            <input
              className="input"
              type="email"
              required
              autoComplete="off"
              placeholder="name@yourfirm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy === 'invite' || !email.trim()}>
            {busy === 'invite' ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        <p className="admin-hint">{ROLES.find((r) => r.value === role)?.can}.</p>
      </form>

      {!members ? (
        <p className="muted" role="status">
          Loading people…
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last active</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {members.map((m) => {
                  // Signed in: match on email (Cognito user ids are opaque). Sample workspace: the demo advisor.
                  const self = selfEmail ? m.email.toLowerCase() === selfEmail.toLowerCase() : m.userId === DEMO_ADVISOR.id
                  return (
                    <motion.tr
                      key={m.userId}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={m.status === 'DISABLED' ? 'member-disabled' : undefined}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <td>
                        <div className="person">
                          <span className="avatar" aria-hidden="true">
                            {(m.name ?? m.email).slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <span className="person-name">
                              {m.name ?? m.email.split('@')[0]}
                              {self && <span className="muted"> (you)</span>}
                            </span>
                            <span className="person-email">{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="input input-small"
                          aria-label={`Role for ${m.name ?? m.email}`}
                          value={m.role}
                          disabled={busy === m.userId || m.status === 'DISABLED'}
                          onChange={(e) => void changeRole(m, e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {m.status === 'ACTIVE' && <Chip level="plain">Active</Chip>}
                        {m.status === 'INVITED' && <Chip level="notice" symbol={false}>Invited</Chip>}
                        {m.status === 'DISABLED' && <Chip level="ghost">Disabled</Chip>}
                      </td>
                      <td className="muted">
                        {m.lastActiveAt ? whenShort(m.lastActiveAt) : m.invitedAt ? `Invited ${formatDate(m.invitedAt)}` : '—'}
                      </td>
                      <td className="admin-actions">
                        {!self && (
                          <button type="button" className="btn btn-small" disabled={busy === m.userId} onClick={() => void toggle(m)}>
                            {m.status === 'DISABLED' ? 'Turn back on' : 'Turn off access'}
                          </button>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <dl className="role-key">
        {ROLES.map((r) => (
          <div key={r.value}>
            <dt>{r.label}</dt>
            <dd>{r.can}.</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

// ---------- Legal holds ----------

function Holds({ onCount }: { onCount: (n: number) => void }) {
  const toast = useToast()
  const { files, refresh } = useFiles()
  const [holds, setHolds] = useState<LegalHold[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<HoldScope>('CLIENT_NAME')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [releaseReason, setReleaseReason] = useState('')

  const load = useCallback(async () => {
    try {
      const list = await api.listHolds()
      setHolds(list)
      onCount(list.filter((h) => h.active).length)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [onCount])

  useEffect(() => {
    void load()
  }, [load])

  const preview = useMemo(() => files.filter((f) => wouldMatch(scope, value, f)), [files, scope, value])
  const clientNames = useMemo(() => [...new Set(files.map((f) => f.clientName).filter(Boolean))] as string[], [files])

  async function place(e: FormEvent) {
    e.preventDefault()
    setBusy('place')
    try {
      const h = await api.placeHold({ scopeType: scope, scopeValue: value, reason })
      toast(
        `Hold ${h.holdId} placed. ${h.matchedFiles ?? 0} ${h.matchedFiles === 1 ? 'file is' : 'files are'} now protected from deletion.`,
        'ok',
      )
      setValue('')
      setReason('')
      await Promise.all([load(), refresh()])
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function release(h: LegalHold) {
    setBusy(h.holdId)
    try {
      const released = await api.releaseHold(h.holdId, releaseReason)
      const reopened = released.reopenedFiles ?? 0
      toast(
        reopened
          ? `Hold ${h.holdId} released. ${reopened} ${reopened === 1 ? 'file goes' : 'files go'} back for review.`
          : `Hold ${h.holdId} released.`,
        'ok',
      )
      setReleasing(null)
      setReleaseReason('')
      await Promise.all([load(), refresh()])
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Unavailable message={error} retry={() => void load()} />

  const active = holds?.filter((h) => h.active) ?? []
  const released = holds?.filter((h) => !h.active) ?? []
  const scopeInfo = SCOPES.find((s) => s.value === scope)!

  return (
    <>
      <form className="admin-form" onSubmit={place}>
        <div className="admin-form-title">
          <h2>Place a legal hold</h2>
          <p>
            Matching files can't be approved for deletion by anyone, whatever the retention rules say, until the hold is
            released.
          </p>
        </div>
        <div className="admin-fields">
          <label className="field">
            <span>Applies to</span>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value as HoldScope)}>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-grow">
            <span>{scopeInfo.label}</span>
            <input
              className="input"
              required
              list={scope === 'CLIENT_NAME' ? 'admin-client-names' : undefined}
              placeholder={scopeInfo.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <datalist id="admin-client-names">
              {clientNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="admin-fields">
          <label className="field field-grow">
            <span>Reason</span>
            <input
              className="input"
              required
              placeholder="e.g. Arbitration filed over 2022 annuity recommendation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy === 'place' || !value.trim() || !reason.trim()}>
            {busy === 'place' ? 'Placing…' : 'Place hold'}
          </button>
        </div>
        <p className="admin-hint" aria-live="polite">
          {value.trim()
            ? preview.length
              ? `Covers ${preview.length} ${preview.length === 1 ? 'file' : 'files'} right now: ${preview
                  .slice(0, 3)
                  .map(fileName)
                  .join(', ')}${preview.length > 3 ? ', …' : ''}. Files uploaded later are covered too.`
              : 'No current files match. Files uploaded later that match will be covered.'
            : 'The hold also covers files uploaded after it is placed.'}
        </p>
      </form>

      {!holds ? (
        <p className="muted" role="status">
          Loading holds…
        </p>
      ) : (
        <>
          <h2 className="admin-subhead">
            Active <span className="num muted">{active.length}</span>
          </h2>
          {active.length === 0 && <p className="muted">No active holds. Every file follows the retention rules.</p>}
          <ul className="hold-list">
            <AnimatePresence initial={false}>
              {active.map((h) => (
                <motion.li
                  key={h.holdId}
                  layout
                  className="hold"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="hold-main">
                    <div className="hold-title">
                      <Chip level="hold">{h.holdId}</Chip>
                      <span className="hold-scope">{scopeLabel(h.scopeType)}</span>
                      <strong>{h.scopeValue}</strong>
                    </div>
                    <p className="hold-reason">{h.reason}</p>
                    <p className="hold-meta">
                      Placed {h.createdAt ? formatDate(h.createdAt) : ''}
                      {h.createdBy ? ` by ${h.createdBy}` : ''}. Protecting{' '}
                      <span className="num">{h.matchedFiles ?? 0}</span> {h.matchedFiles === 1 ? 'file' : 'files'}.
                    </p>
                  </div>
                  {releasing === h.holdId ? (
                    <form
                      className="hold-release"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void release(h)
                      }}
                    >
                      <label className="field field-grow">
                        <span>Why is it being released?</span>
                        <input
                          className="input"
                          autoFocus
                          required
                          placeholder="e.g. Case settled; counsel confirmed in writing"
                          value={releaseReason}
                          onChange={(e) => setReleaseReason(e.target.value)}
                          onKeyDown={(e) => e.key === 'Escape' && setReleasing(null)}
                        />
                      </label>
                      <div className="hold-release-actions">
                        <button type="button" className="btn btn-small" onClick={() => setReleasing(null)}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn-small btn-primary"
                          disabled={busy === h.holdId || !releaseReason.trim()}
                        >
                          Release hold
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        setReleasing(h.holdId)
                        setReleaseReason('')
                      }}
                    >
                      Release…
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {released.length > 0 && (
            <details className="released">
              <summary>
                Released <span className="num muted">{released.length}</span>
              </summary>
              <ul className="hold-list">
                {released.map((h) => (
                  <li key={h.holdId} className="hold hold-released">
                    <div className="hold-main">
                      <div className="hold-title">
                        <Chip level="ghost">{h.holdId}</Chip>
                        <span className="hold-scope">{scopeLabel(h.scopeType)}</span>
                        <strong>{h.scopeValue}</strong>
                      </div>
                      <p className="hold-reason">{h.reason}</p>
                      <p className="hold-meta">
                        Released {h.releasedAt ? formatDate(h.releasedAt) : ''}
                        {h.releasedBy ? ` by ${h.releasedBy}` : ''}
                        {h.releaseReason ? `: ${h.releaseReason}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  )
}

// ---------- Retention rules ----------

function Rules({ onCount }: { onCount: (n: number) => void }) {
  const [rules, setRules] = useState<RetentionRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.listRules()
      setRules(list)
      onCount(list.length)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [onCount])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <Unavailable message={error} retry={() => void load()} />
  if (!rules)
    return (
      <p className="muted" role="status">
        Loading rules…
      </p>
    )

  const keepFor = (r: RetentionRule) =>
    r.retentionYears === 0
      ? 'No minimum'
      : `${r.retentionYears} years${r.trigger === 'ACCOUNT_CLOSED' ? ' after the account closes' : ' from creation'}`
  const outcome = { RETAIN: 'Keep, then delete', DELETE: 'Delete', REVIEW: 'A person decides' } as const

  return (
    <>
      <p className="admin-intro">
        The schedule the rules engine applies to every file. A legal hold overrides all of it. Changes go through
        compliance and are version-controlled, so every recommendation can be traced
        to the rule that made it.
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Document type</th>
              <th scope="col">Keep for</th>
              <th scope="col">Then</th>
              <th scope="col">Basis</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.docType}>
                <td>
                  <div className="person-name">{docTypeLabel(r.docType)}</div>
                  <div className="person-email">{r.description}</div>
                </td>
                <td className="num">{keepFor(r)}</td>
                <td>
                  <Chip level={r.action === 'REVIEW' ? 'notice' : r.action === 'DELETE' ? 'plain' : 'ghost'} symbol={false}>
                    {outcome[r.action]}
                  </Chip>
                </td>
                <td className="muted">{r.citation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
