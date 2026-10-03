// Who is signed in (docs/login.md). Amplify keeps the Cognito tokens and refreshes them; this exposes the
// session to the UI and hands the ID token to the API client.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth'
import { configureAuth } from '../api/client'

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; email: string; role: string }

interface SessionApi {
  session: Session
  refresh: () => Promise<void> // re-read the session after the forms sign someone in
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionApi | null>(null)

const ROLES = ['admin', 'compliance', 'advisor'] // highest first

async function readSession(): Promise<Session> {
  try {
    const { tokens } = await fetchAuthSession()
    const claims = tokens?.idToken?.payload
    if (!claims) return { status: 'signedOut' }
    const groups = (claims['cognito:groups'] as string[] | undefined) ?? []
    return {
      status: 'signedIn',
      email: String(claims.email ?? claims.sub ?? ''),
      role: ROLES.find((r) => groups.includes(r)) ?? 'no role',
    }
  } catch {
    return { status: 'signedOut' } // e.g. the refresh token expired
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' })

  const refresh = useCallback(async () => setSession(await readSession()), [])

  const signOut = useCallback(async () => {
    try {
      await amplifySignOut()
    } finally {
      setSession({ status: 'signedOut' })
    }
  }, [])

  useEffect(() => {
    // The ID token, not the access token: it carries the email the API records as who approved what.
    // fetchAuthSession refreshes it first when it's about to expire.
    configureAuth({
      getToken: async () => (await fetchAuthSession()).tokens?.idToken?.toString(),
      onUnauthorized: () => void signOut(), // revoked or expired beyond refresh: back to the sign-in screen
    })
    void refresh()
  }, [refresh, signOut])

  const value = useMemo(() => ({ session, refresh, signOut }), [session, refresh, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
