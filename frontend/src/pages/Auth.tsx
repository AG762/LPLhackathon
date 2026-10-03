import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BrandMark } from '../components/BrandMark'
import { ACCOUNTS_ARE_PREVIEW, AccountError, NeedsConfirmation, PASSWORD_RULES, accountApi } from '../auth/accountApi'
import { useToast } from '../state/toast'
import { usePageTitle } from '../lib/title'
import './auth.css'

// Sign in, sign up (with the emailed code) and password reset (F.16). Every call goes through
// auth/accountApi.ts: Amazon Cognito when sign-in is configured, a preview otherwise.

const EASE = [0.16, 1, 0.3, 1] as const
const message = (e: unknown) => (e instanceof AccountError || e instanceof Error ? e.message : String(e))

// Synthetic names from data/samples/, drifting past on the dark side of the screen.
const RIVER: { name: string; state?: 'cleared' | 'held' }[] = [
  { name: 'Fantasy_Football_Draft_2023.txt', state: 'cleared' },
  { name: 'Trade_Confirm_NVDA_2025_04.txt' },
  { name: '2019_Email_Whitaker_Rebalance.eml', state: 'held' },
  { name: 'Q3_Financial_Plan_Proposal_v1_draft.txt', state: 'cleared' },
  { name: 'Statement_Novak_2026_06.txt' },
  { name: 'W9_Scan_Chen_2017.png', state: 'cleared' },
  { name: 'Retirement_Income_Plan_Okafor_FINAL.txt' },
  { name: 'Newsletter_Spring_2019 (copy).txt', state: 'cleared' },
  { name: 'Statement_Okafor_2017_03.txt', state: 'held' },
  { name: 'Gym_Receipt_2024.txt', state: 'cleared' },
  { name: 'Email_Delgado_2025_11.eml' },
  { name: 'Funny_Cat_Meme.png', state: 'cleared' },
]

function AuthLayout({ children, aside }: { children: ReactNode; aside: string }) {
  useEffect(() => {
    document.documentElement.classList.add('au-root')
    return () => document.documentElement.classList.remove('au-root')
  }, [])

  return (
    <div className="au">
      <aside className="au-stage" aria-hidden="true">
        <div className="au-river">
          {[0, 1].map((copy) => (
            <ul key={copy}>
              {RIVER.map((f) => (
                <li key={f.name} className={f.state ? `au-${f.state}` : undefined}>
                  {f.name}
                  {f.state === 'held' && <span className="au-tag">Legal hold</span>}
                </li>
              ))}
            </ul>
          ))}
        </div>
        <p className="au-stage-line">{aside}</p>
      </aside>

      <main className="au-main">
        <Link className="au-brand" to="/">
          <BrandMark />
          ShredSafe
        </Link>
        <div className="au-card">{children}</div>
        {ACCOUNTS_ARE_PREVIEW && (
          <p className="au-foot">Preview: accounts aren't created yet and no email is sent. Any details will work.</p>
        )}
      </main>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="au-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="au-hint">{hint}</div>}
    </div>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="au-password">
      <input
        id={id}
        className="au-input"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="au-reveal" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="au-rules">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password)
        return (
          <li key={r.id} className={ok ? 'au-rule-ok' : undefined}>
            <span className="au-rule-mark" aria-hidden="true" />
            {r.label}
            {!r.required && <span className="au-optional"> (recommended)</span>}
            <span className="visually-hidden">{ok ? ', done' : ', not yet'}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          key={error}
          className="au-error"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

// Six boxes for the emailed code: typing moves forward, Backspace moves back, pasting fills them all.
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, ' ').slice(0, 6).split('')

  useEffect(() => {
    boxes.current[0]?.focus()
  }, [])

  const set = (i: number, d: string) => {
    const next = digits.slice()
    next[i] = d || ' '
    onChange(next.join('').trimEnd())
  }

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i].trim() && i > 0) {
      set(i - 1, '')
      boxes.current[i - 1]?.focus()
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < 5) boxes.current[i + 1]?.focus()
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    e.preventDefault()
    onChange(pasted)
    boxes.current[Math.min(pasted.length, 5)]?.focus()
  }

  return (
    <div className="au-code" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          className="au-code-box"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          value={d.trim()}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1)
            set(i, v)
            if (v && i < 5) boxes.current[i + 1]?.focus()
          }}
        />
      ))}
    </div>
  )
}

function Step({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      key={id}
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -24 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

// ---------- Sign in ----------

export function SignInPage() {
  usePageTitle('Sign in')
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  // Set by RequireSignIn (auth/RequireSignIn.tsx) when a signed-out visitor opened a portal page
  const next = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await accountApi.signIn(email, password, remember)
      toast('Signed in.', 'ok')
      navigate(next, { replace: true })
    } catch (err) {
      if (err instanceof NeedsConfirmation) {
        toast(err.message, 'ok')
        navigate('/signup', { state: { confirmEmail: err.email } })
        return
      }
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout aside="Every file you clear is checked against your firm's rules and recorded, so you can prove it later.">
      <h1>Sign in</h1>
      <p className="au-sub">Welcome back. Your review queue is where you left it.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Work email">
          {(id) => (
            <input
              id={id}
              className="au-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={
            <Link to="/forgot" state={{ email }}>
              Forgot your password?
            </Link>
          }
        >
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" />}
        </Field>
        <label className="au-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in on this device
        </label>
        <ErrorLine error={error} />
        <button type="submit" className="au-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="au-switch">
        New to ShredSafe? <Link to="/signup">Create your firm's workspace</Link>
      </p>
    </AuthLayout>
  )
}

// ---------- Sign up ----------

export function SignUpPage() {
  usePageTitle('Create your workspace')
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  // Sign-in sends unconfirmed accounts here with their email, straight to the code step
  const confirmEmail = (location.state as { confirmEmail?: string } | null)?.confirmEmail
  const [step, setStep] = useState<'details' | 'code'>(confirmEmail ? 'code' : 'details')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(confirmEmail ?? '')
  const [firm, setFirm] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault()
    // Check fields top to bottom, so the first message is about the first thing to fix, and put the
    // cursor there (F.23). The checkbox comes last, as it does on the form.
    const form = e.currentTarget as HTMLFormElement
    const problem: [string, string] | null =
      !name.trim() ? ['name', 'Enter your name.']
      : !firm.trim() ? ['organization', "Enter your firm's name."]
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? ['email', 'Enter a valid work email address.']
      : PASSWORD_RULES.some((r) => r.required && !r.test(password)) ? ['new-password', 'Choose a password of at least 12 characters.']
      : !agreed ? ['checkbox', 'Confirm the files you upload are your firm’s to manage.']
      : null
    if (problem) {
      setError(problem[1])
      const field = form.querySelector<HTMLInputElement>(
        problem[0] === 'checkbox' ? 'input[type="checkbox"]' : `input[autocomplete="${problem[0]}"]`,
      )
      field?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await accountApi.signUp({ name, email, firm, password })
      setStep('code')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const signedIn = await accountApi.confirmSignUp(email, code)
      if (signedIn) {
        const first = name.trim().split(' ')[0]
        toast(first ? `Welcome, ${first}. Your workspace is ready.` : 'Your workspace is ready.', 'ok')
        navigate('/dashboard', { replace: true })
      } else {
        toast('Email confirmed. Sign in to continue.', 'ok')
        navigate('/signin', { state: { email } })
      }
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setResent(false)
    try {
      await accountApi.resendCode(email)
      setResent(true)
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <AuthLayout aside="Most of what's on a branch drive should already be gone. ShredSafe shows you which, and stops at anything under a legal hold.">
      <ol className="au-steps" aria-label="Sign-up steps">
        <li aria-current={step === 'details' ? 'step' : undefined}>Your details</li>
        <li aria-current={step === 'code' ? 'step' : undefined}>Confirm your email</li>
      </ol>
      <AnimatePresence mode="wait" initial={false}>
        {step === 'details' ? (
          <Step id="details">
            <h1>Create your firm's workspace</h1>
            <p className="au-sub">You'll be the admin. Invite advisors and compliance once you're in.</p>
            <form onSubmit={create} noValidate>
              <div className="au-row">
                <Field label="Full name">
                  {(id) => (
                    <input id={id} className="au-input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                  )}
                </Field>
                <Field label="Firm or branch">
                  {(id) => (
                    <input
                      id={id}
                      className="au-input"
                      autoComplete="organization"
                      required
                      value={firm}
                      onChange={(e) => setFirm(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Work email">
                {(id) => (
                  <input
                    id={id}
                    className="au-input"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Password" hint={<PasswordRules password={password} />}>
                {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
              </Field>
              <label className="au-check">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                The files I upload belong to my firm, and I'm allowed to manage their retention.
              </label>
              <ErrorLine error={error} />
              <button type="submit" className="au-submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </form>
            <p className="au-switch">
              Already have an account? <Link to="/signin">Sign in</Link>
            </p>
          </Step>
        ) : (
          <Step id="code">
            <h1>Check your email</h1>
            <p className="au-sub">
              We sent a 6-digit code to <strong>{email}</strong>. It expires in 24 hours.
            </p>
            <form onSubmit={confirm} noValidate>
              <CodeInput value={code} onChange={setCode} />
              <ErrorLine error={error} />
              <button type="submit" className="au-submit" disabled={busy || code.length < 6}>
                {busy ? 'Confirming…' : 'Confirm and continue'}
              </button>
            </form>
            <p className="au-switch">
              {resent ? 'A new code is on its way. ' : "Didn't get it? "}
              <button type="button" className="au-link" onClick={() => void resend()}>
                Send a new code
              </button>{' '}
              or{' '}
              <button
                type="button"
                className="au-link"
                onClick={() => {
                  setStep('details')
                  setCode('')
                  setError(null)
                }}
              >
                change the email
              </button>
              .
            </p>
          </Step>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}

// ---------- Forgot password ----------

export function ForgotPasswordPage() {
  usePageTitle('Reset your password')
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  const [step, setStep] = useState<'email' | 'reset'>('email')
  // Carried over from the sign-in form, so nobody types it twice.
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function request(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await accountApi.requestReset(email)
      setStep('reset')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await accountApi.confirmReset(email, code, password)
      toast('Password changed. Sign in with the new one.', 'ok')
      navigate('/signin')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout aside="Nothing is deleted without a person approving it, and every approval is in the audit log.">
      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <Step id="email">
            <h1>Reset your password</h1>
            <p className="au-sub">Enter your work email and we'll send a code to set a new one.</p>
            <form onSubmit={request} noValidate>
              <Field label="Work email">
                {(id) => (
                  <input
                    id={id}
                    className="au-input"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <ErrorLine error={error} />
              <button type="submit" className="au-submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </form>
          </Step>
        ) : (
          <Step id="reset">
            <h1>Set a new password</h1>
            <p className="au-sub">
              Enter the code we sent to <strong>{email}</strong> and choose a new password.
            </p>
            <form onSubmit={reset} noValidate>
              <CodeInput value={code} onChange={setCode} />
              <Field label="New password" hint={<PasswordRules password={password} />}>
                {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />}
              </Field>
              <ErrorLine error={error} />
              <button type="submit" className="au-submit" disabled={busy || code.length < 6}>
                {busy ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </Step>
        )}
      </AnimatePresence>
      <p className="au-switch">
        Remembered it? <Link to="/signin">Back to sign in</Link>
      </p>
    </AuthLayout>
  )
}
