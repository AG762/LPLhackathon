// Guards the portal routes (docs/login.md). Signed out: off to /signin, which brings you back here
// afterwards. The home page and the sign-in pages stay public. A no-op when sign-in isn't configured.
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { signInEnabled } from './config'
import { useSession } from './session'

function Guard({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const location = useLocation()
  if (session.status === 'loading') {
    return (
      <p className="muted" role="status" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        Checking your sign-in…
      </p>
    )
  }
  if (session.status === 'signedOut') {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}

export function RequireSignIn({ children }: { children: ReactNode }) {
  return signInEnabled ? <Guard>{children}</Guard> : <>{children}</>
}
