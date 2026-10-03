// Sign-in and sign-up screens (docs/login.md). Our own forms, so users never leave ShredSafe; Amplify Auth
// talks to Cognito. Only mounted when signInEnabled (Live mode + Cognito settings).
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  confirmResetPassword,
  confirmSignIn,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  signIn,
  signUp,
  type SignInOutput,
} from 'aws-amplify/auth'
import { useSession } from './session'
import './auth.css'

// Same mark as the sidebar logo (App.tsx): a page going through a shredder.
function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="2" width="16" height="10" />
      <rect x="2" y="12.5" width="20" height="2" />
      <rect x="4" y="16" width="2.6" height="6" />
      <rect x="8.47" y="16" width="2.6" height="4" />
      <rect x="12.93" y="16" width="2.6" height="6" />
      <rect x="17.4" y="16" width="2.6" height="3.5" />
    </svg>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <path d="m8 12.5 2.6 2.5L16 9.5" />
    </svg>
  )
}

const POINTS = [
  ['Finds what you no longer have to keep', 'Each file is matched against SEC and FINRA retention rules.'],
  ['Never deletes what it shouldn’t', 'Legal holds and live retention periods block deletion, every time.'],
  ['Proves every deletion', 'A tamper-evident audit trail and a certificate you can hand to an examiner.'],
]

const MIN_PASSWORD = 12 // matches the user pool's password policy (infra/template.yaml)

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="signin">
      <section className="signin-brand" aria-label="ShredSafe">
        <div className="signin-logo">
          <Mark />
          ShredSafe
        </div>
        <div className="signin-pitch">
          <h1>Delete client files you no longer need. Safely.</h1>
          <p>Defensible disposal for independent financial advisors.</p>
        </div>
        <ul className="signin-points">
          {POINTS.map(([title, text]) => (
            <li key={title}>
              <Check />
              <span>
                <strong>{title}</strong>
                {text}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <main className="signin-main">
        <div className="signin-card">{children}</div>
      </main>
    </div>
  )
}

function Field(props: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  hint?: string
  autoFocus?: boolean
  inputMode?: 'numeric'
}) {
  const id = `f-${props.label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        inputMode={props.inputMode}
        required
        aria-describedby={props.hint ? `${id}-hint` : undefined}
      />
      {props.hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {props.hint}
        </p>
      )}
    </div>
  )
}

// Cognito error names -> plain messages
function friendly(e: unknown): string {
  const err = e as { name?: string; message?: string }
  switch (err.name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'That email and password don’t match an account.'
    case 'UsernameExistsException':
      return 'An account with this email already exists. Sign in instead.'
    case 'CodeMismatchException':
      return 'That code isn’t right. Check the email and try again.'
    case 'ExpiredCodeException':
      return 'That code has expired. Send a new one.'
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'InvalidPasswordException':
      return `Choose a password of at least ${MIN_PASSWORD} characters.`
    case 'NetworkError':
      return 'Couldn’t reach the sign-in service. Check your connection.'
    case 'ResourceNotFoundException':
      return 'Sign-in isn’t set up correctly on this site (check the VITE_COGNITO_* settings).'
    default:
      return err.message || 'Something went wrong. Try again.'
  }
}

type View = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgot' | 'resetPassword' | 'newPassword' | 'totp'

function AuthForms() {
  const { refresh } = useSession()
  const [view, setView] = useState<View>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function go(next: View, message: string | null = null) {
    setView(next)
    setError(null)
    setInfo(message)
    setCode('')
  }

  // What Cognito asks for after a password: done, confirm the email, a new password, or an authenticator code
  async function afterSignIn(result: SignInOutput) {
    switch (result.nextStep.signInStep) {
      case 'DONE':
        await refresh()
        return
      case 'CONFIRM_SIGN_UP':
        await resendSignUpCode({ username: email })
        go('confirmSignUp', `Your email isn’t confirmed yet. We sent a new code to ${email}.`)
        return
      case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
        go('newPassword', 'Your account was set up with a temporary password. Choose your own to continue.')
        return
      case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
        go('totp')
        return
      case 'RESET_PASSWORD':
        await resetPassword({ username: email })
        go('resetPassword', `You need to reset your password. We sent a code to ${email}.`)
        return
      default:
        setError('This account needs a sign-in step ShredSafe doesn’t support yet. Contact support.')
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      if ((e as { name?: string }).name === 'UserAlreadyAuthenticatedException') await refresh()
      else setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = (action: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault()
    void run(action)
  }

  const onSignIn = submit(async () => afterSignIn(await signIn({ username: email, password })))

  const onSignUp = submit(async () => {
    const r = await signUp({ username: email, password, options: { userAttributes: { email } } })
    if (r.nextStep.signUpStep === 'CONFIRM_SIGN_UP') go('confirmSignUp', `We sent a 6-digit code to ${email}.`)
    else await afterSignIn(await signIn({ username: email, password }))
  })

  const onConfirmSignUp = submit(async () => {
    await confirmSignUp({ username: email, confirmationCode: code.trim() })
    if (password) await afterSignIn(await signIn({ username: email, password }))
    else go('signIn', 'Email confirmed. Sign in to continue.')
  })

  const onForgot = submit(async () => {
    await resetPassword({ username: email })
    go('resetPassword', `If ${email} has an account, we sent it a code.`)
  })

  const onReset = submit(async () => {
    await confirmResetPassword({ username: email, confirmationCode: code.trim(), newPassword })
    setPassword(newPassword)
    await afterSignIn(await signIn({ username: email, password: newPassword }))
  })

  const onNewPassword = submit(async () => afterSignIn(await confirmSignIn({ challengeResponse: newPassword })))
  const onTotp = submit(async () => afterSignIn(await confirmSignIn({ challengeResponse: code.trim() })))

  const resend = () =>
    void run(async () => {
      await resendSignUpCode({ username: email })
      setInfo(`We sent a new code to ${email}.`)
    })

  const messages = (
    <>
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
      {info && !error && (
        <p className="signin-info" role="status">
          {info}
        </p>
      )}
    </>
  )
  const submitButton = (label: string) => (
    <button type="submit" className="btn btn-primary" disabled={busy}>
      {busy ? <span className="signin-spinner" aria-label="Working" /> : label}
    </button>
  )
  const back = (
    <p className="signin-alt">
      <button type="button" className="signin-link" onClick={() => go('signIn')}>
        Back to sign in
      </button>
    </p>
  )

  if (view === 'signIn' || view === 'signUp') {
    const isUp = view === 'signUp'
    return (
      <>
        <div className="signin-tabs" role="group" aria-label="Account">
          <button type="button" aria-pressed={!isUp} onClick={() => go('signIn')}>
            Sign in
          </button>
          <button type="button" aria-pressed={isUp} onClick={() => go('signUp')}>
            Create account
          </button>
        </div>
        <h2>{isUp ? 'Create your account' : 'Welcome back'}</h2>
        <p className="lede">
          {isUp ? 'Free for independent advisors. Your files stay private to you.' : 'Sign in to review your files.'}
        </p>
        {messages}
        <form onSubmit={isUp ? onSignUp : onSignIn}>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={isUp ? 'new-password' : 'current-password'}
            hint={isUp ? `At least ${MIN_PASSWORD} characters.` : undefined}
          />
          {!isUp && (
            <p className="signin-forgot">
              <button type="button" className="signin-link" onClick={() => go('forgot')}>
                Forgot password?
              </button>
            </p>
          )}
          {submitButton(isUp ? 'Create account' : 'Sign in')}
        </form>
        <p className="signin-fine">
          Your files are private to your account. Other advisors can’t see them, and nothing is deleted until you approve it.
        </p>
      </>
    )
  }

  if (view === 'confirmSignUp') {
    return (
      <>
        <h2>Check your email</h2>
        <p className="lede">Enter the code we sent to confirm your account.</p>
        {messages}
        <form onSubmit={onConfirmSignUp}>
          <Field label="Confirmation code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" autoFocus />
          {submitButton('Confirm and continue')}
        </form>
        <p className="signin-alt">
          No email? Check spam, or{' '}
          <button type="button" className="signin-link" onClick={resend} disabled={busy}>
            send a new code
          </button>
          .
        </p>
        {back}
      </>
    )
  }

  if (view === 'forgot') {
    return (
      <>
        <h2>Reset your password</h2>
        <p className="lede">We’ll email you a code to choose a new one.</p>
        {messages}
        <form onSubmit={onForgot}>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          {submitButton('Send code')}
        </form>
        {back}
      </>
    )
  }

  if (view === 'resetPassword') {
    return (
      <>
        <h2>Choose a new password</h2>
        {messages}
        <form onSubmit={onReset}>
          <Field label="Code from the email" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" autoFocus />
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
          />
          {submitButton('Save and sign in')}
        </form>
        {back}
      </>
    )
  }

  if (view === 'newPassword') {
    return (
      <>
        <h2>Choose your password</h2>
        {messages}
        <form onSubmit={onNewPassword}>
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            autoFocus
          />
          {submitButton('Save and continue')}
        </form>
        {back}
      </>
    )
  }

  return (
    <>
      <h2>Two-step verification</h2>
      <p className="lede">Enter the 6-digit code from your authenticator app.</p>
      {messages}
      <form onSubmit={onTotp}>
        <Field label="Authenticator code" value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric" autoFocus />
        {submitButton('Verify')}
      </form>
      {back}
    </>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session } = useSession()

  if (session.status === 'loading') {
    return (
      <Layout>
        <p className="signin-status" role="status">
          <span className="signin-spinner" aria-hidden="true" />
          Checking your sign-in…
        </p>
      </Layout>
    )
  }

  if (session.status === 'signedOut') {
    return (
      <Layout>
        <AuthForms />
      </Layout>
    )
  }

  return <>{children}</>
}

// Sidebar block: who is signed in, their role, and sign-out. Replaces the fixed demo advisor.
export function SignedInUser() {
  const { session, signOut } = useSession()
  if (session.status !== 'signedIn') return null
  return (
    <div className="session">
      <span className="session-avatar" aria-hidden="true">
        {session.email.charAt(0) || '?'}
      </span>
      <span>
        <span className="session-email" title={session.email}>
          {session.email}
        </span>
        <span className="session-role">{session.role}</span>
      </span>
      <button type="button" className="session-signout" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
