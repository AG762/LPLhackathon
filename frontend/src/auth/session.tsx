// Who is signed in (docs/login.md). Amplify keeps the Cognito tokens and refreshes them; this exposes the
// session to the UI and hands the ID token to the API client. Only mounted when sign-in is configured.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'
import { configureAuth } from '../api/client'

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; email: string; name?: string; firm?: string; role: string }

interface SessionApi {
  session: Session
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionApi | null>(null)

const ROLES = ['platform', 'admin', 'compliance', 'advisor'] // highest first

async function readSession(): Promise<Session> {
  try {
    const { tokens } = await fetchAuthSession()
    const claims = tokens?.idToken?.payload
    if (!claims) return { status: 'signedOut' }
    const groups = (claims['cognito:groups'] as string[] | undefined) ?? []
    return {
      status: 'signedIn',
      email: String(claims.email ?? claims.sub ?? ''),
      name: typeof claims.name === 'string' ? claims.name : undefined,
      firm: typeof claims['custom:firm'] === 'string' ? claims['custom:firm'] : undefined,
      role: ROLES.find((r) => groups.includes(r)) ?? 'no role',
    }
  } catch {
    return { status: 'signedOut' } // e.g. the refresh token expired
  }
}

// accountApi.ts runs outside React; after signing someone in it awaits this so the portal guard sees the
// new session before the page navigates.
let refreshFromOutside: () => Promise<void> = async () => {}
export function refreshSession() {
  return refreshFromOutside()
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
    refreshFromOutside = refresh
    // The ID token, not the access token: it carries the email the API records as who approved what.
    // fetchAuthSession refreshes it first when it's about to expire.
    configureAuth({
      getToken: async () => (await fetchAuthSession()).tokens?.idToken?.toString(),
      onUnauthorized: () => void signOut(), // revoked or expired beyond refresh: signed out
    })
    void refresh()
    // A refresh token that can't be used any more (expired, or signed out elsewhere) ends the session here too
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'tokenRefresh_failure' || payload.event === 'signedOut') void refresh()
    })
    return stop
  }, [refresh, signOut])

  const value = useMemo(() => ({ session, refresh, signOut }), [session, refresh, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// null when sign-in isn't configured (Sample mode, or no Cognito settings)
export function useOptionalSession() {
  return useContext(SessionContext)
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
