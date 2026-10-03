// Sign-in gate (docs/login.md). Only mounted when signInEnabled (Live mode + Cognito settings).
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { configureAuth } from '../api/client'
import { signOutUrl } from './config'
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

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()

  if (auth.isLoading || auth.activeNavigator) {
    return (
      <Layout>
        <p className="signin-status" role="status">
          <span className="signin-spinner" aria-hidden="true" />
          {auth.activeNavigator === 'signoutRedirect' ? 'Signing you out…' : 'Checking your sign-in…'}
        </p>
      </Layout>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <Layout>
        <h2>Welcome</h2>
        <p className="lede">Sign in to review your files, or create a free advisor account.</p>
        {auth.error && (
          <p className="signin-error" role="alert">
            Sign-in didn’t complete: {auth.error.message}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void auth.signinRedirect()}>
          Sign in or create account
        </button>
        <p className="signin-alt">
          New here? Choose <strong>Sign up</strong> on the next screen.
        </p>
        <p className="signin-fine">
          Your files are private to your account. Other advisors can’t see them, and nothing is deleted until you approve it.
        </p>
      </Layout>
    )
  }

  // Every API call reads the current token; a 401 (expired or revoked) sends the user to sign in again.
  // The ID token, not the access token: it carries the email the API records as who approved what.
  configureAuth({
    getToken: () => auth.user?.id_token,
    onUnauthorized: () => void auth.signinRedirect(),
  })
  return <>{children}</>
}

// Sidebar block: who is signed in, their role, and sign-out. Replaces the fixed demo advisor.
export function SignedInUser() {
  const auth = useAuth()
  const profile = auth.user?.profile
  const email = (profile?.email as string | undefined) ?? profile?.sub ?? ''
  const groups = (profile?.['cognito:groups'] as string[] | undefined) ?? []
  const role = ['admin', 'compliance', 'advisor'].find((g) => groups.includes(g)) ?? 'no role'

  async function signOut() {
    await auth.removeUser() // forget the tokens here, then end the Cognito session
    window.location.href = signOutUrl()
  }

  return (
    <div className="session">
      <span className="session-avatar" aria-hidden="true">
        {email.charAt(0) || '?'}
      </span>
      <span>
        <span className="session-email" title={email}>
          {email}
        </span>
        <span className="session-role">{role}</span>
      </span>
      <button type="button" className="session-signout" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
