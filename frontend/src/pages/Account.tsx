import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccountError, PASSWORD_RULES, accountApi } from '../auth/accountApi'
import { mode } from '../api/client'
import { signInEnabled } from '../auth/config'
import { useOptionalSession } from '../auth/session'
import { DEMO_ADVISOR } from '../lib/format'
import { useToast } from '../state/toast'
import './admin.css'
import './account.css'

// Your account (P5): name, password, and signing out everywhere. Reached from your name in the sidebar.
// Two-step sign-in is left for when the sign-in page can ask for an authenticator code (docs/feature-proposals.md).

const ROLE_LABEL: Record<string, string> = {
  advisor: 'Advisor',
  compliance: 'Compliance',
  admin: 'Admin',
  platform: 'ShredSafe operator',
}

const message = (e: unknown) => (e instanceof AccountError || e instanceof Error ? e.message : String(e))

export default function AccountPage() {
  const auth = useOptionalSession()
  const toast = useToast()
  const navigate = useNavigate()
  const signedIn = auth?.session.status === 'signedIn' ? auth.session : null

  const email = signedIn?.email ?? 'jordan.reyes@branch214.example'
  const firm = signedIn ? signedIn.firm : DEMO_ADVISOR.branch
  const role = ROLE_LABEL[signedIn?.role ?? 'admin'] ?? signedIn?.role

  const [name, setName] = useState(signedIn?.name ?? DEMO_ADVISOR.name)
  const [savingName, setSavingName] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  async function saveName(e: FormEvent) {
    e.preventDefault()
    setSavingName(true)
    try {
      await accountApi.updateName(name)
      toast('Name saved.', 'ok')
    } catch (err) {
      toast(message(err), 'error')
    } finally {
      setSavingName(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    if (next !== confirm) {
      setPasswordError('The new passwords don’t match.')
      return
    }
    setSavingPassword(true)
    try {
      await accountApi.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast('Password changed. Use the new one next time you sign in.', 'ok')
    } catch (err) {
      setPasswordError(message(err))
    } finally {
      setSavingPassword(false)
    }
  }

  async function signOutEverywhere() {
    setLeaving(true)
    try {
      await accountApi.signOutEverywhere()
      if (signInEnabled) {
        navigate('/', { replace: true })
      } else {
        toast('The sample workspace has no other sessions to end.', 'ok')
      }
    } catch (err) {
      toast(message(err), 'error')
    } finally {
      setLeaving(false)
    }
  }

  if (mode === 'live' && !signInEnabled) {
    return (
      <header className="page-head">
        <div>
          <h1>Your account</h1>
          <p>
            Sign-in isn't switched on for this site yet, so there's no account to show. Ask your administrator to turn
            it on, or switch the workspace data to Sample to explore this page.
          </p>
        </div>
      </header>
    )
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Your account</h1>
          <p>How you appear to your firm, and how you sign in.</p>
        </div>
      </header>

      <div className="account-grid">
        <form className="admin-form" onSubmit={saveName}>
          <div className="admin-form-title">
            <h2>Profile</h2>
            <p>Your name appears in the audit log next to everything you approve.</p>
          </div>
          <div className="admin-fields">
            <label className="field field-grow">
              <span>Name</span>
              <input className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingName || !name.trim()}>
              {savingName ? 'Saving…' : 'Save'}
            </button>
          </div>
          <dl className="account-facts">
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
            {firm && (
              <div>
                <dt>Firm</dt>
                <dd>{firm}</dd>
              </div>
            )}
            <div>
              <dt>Role</dt>
              <dd>{role}</dd>
            </div>
          </dl>
          <p className="admin-hint">To change your email or role, ask your firm's admin.</p>
        </form>

        <form className="admin-form" onSubmit={savePassword} noValidate>
          <div className="admin-form-title">
            <h2>Password</h2>
            <p>Changing it here doesn't sign you out on this device.</p>
          </div>
          <label className="field">
            <span>Current password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <ul className="account-rules">
            {PASSWORD_RULES.map((r) => (
              <li key={r.id} className={r.test(next) ? 'account-rule-ok' : undefined}>
                <span aria-hidden="true" />
                {r.label}
                {!r.required && <span className="muted"> (recommended)</span>}
              </li>
            ))}
          </ul>
          <label className="field">
            <span>New password again</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {passwordError && (
            <p className="account-error" role="alert">
              {passwordError}
            </p>
          )}
          <div>
            <button type="submit" className="btn btn-primary" disabled={savingPassword || !current || !next || !confirm}>
              {savingPassword ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>

        <section className="admin-form account-danger">
          <div className="admin-form-title">
            <h2>Signed-in devices</h2>
            <p>Lost a laptop, or signed in on a shared computer? This ends every session, including this one.</p>
          </div>
          <div>
            <button type="button" className="btn" onClick={() => void signOutEverywhere()} disabled={leaving}>
              {leaving ? 'Signing out…' : 'Sign out on every device'}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
