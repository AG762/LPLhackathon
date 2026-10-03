// Sign-in gate (docs/login.md, step 3). Only mounted when signInEnabled (Live mode + Cognito settings).
import type { ReactNode } from 'react'
import { useAuth } from 'react-oidc-context'
import { configureAuth } from '../api/client'
import { signOutUrl } from './config'

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="main" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="panel empty" style={{ maxWidth: 460 }}>
        {children}
      </div>
    </main>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()

  if (auth.isLoading || auth.activeNavigator) {
    return (
      <Centered>
        <p role="status">Checking your sign-in…</p>
      </Centered>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <Centered>
        <h2>Sign in to ShredSafe</h2>
        <p>Use the account your compliance team set up for you.</p>
        {auth.error && (
          <p role="alert">Sign-in didn't complete: {auth.error.message}</p>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void auth.signinRedirect()}>
          Sign in
        </button>
      </Centered>
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
  const groups = (profile?.['cognito:groups'] as string[] | undefined) ?? []
  const role = ['admin', 'compliance', 'advisor'].find((g) => groups.includes(g)) ?? 'no role'

  async function signOut() {
    await auth.removeUser() // forget the tokens here, then end the Cognito session
    window.location.href = signOutUrl()
  }

  return (
    <div className="advisor">
      <div className="advisor-name">{profile?.email ?? profile?.sub}</div>
      <div className="muted" style={{ textTransform: 'capitalize' }}>{role}</div>
      <button type="button" className="btn btn-small btn-quiet" style={{ marginTop: 8 }} onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
