// Cognito sign-in settings (docs/login.md, step 3). Values come from the stack outputs:
//   VITE_COGNITO_AUTHORITY  <- CognitoAuthority
//   VITE_COGNITO_CLIENT_ID  <- UserPoolClientId
//   VITE_COGNITO_DOMAIN     <- CognitoDomain
// Sign-in is on only in Live mode with all three set. Demo mode never signs in.
import type { AuthProviderProps } from 'react-oidc-context'
import { mode } from '../api/client'

const authority = import.meta.env.VITE_COGNITO_AUTHORITY ?? ''
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? ''
const domain = (import.meta.env.VITE_COGNITO_DOMAIN ?? '').replace(/\/+$/, '')

export const signInEnabled = mode === 'live' && Boolean(authority && clientId && domain)

// The app's own address, which Cognito sends the user back to. It must match a callback URL on the
// app client exactly, including /ports/5173/ behind the online VS Code proxy (FrontendBasePath).
// Built from VITE_ROUTER_BASE (same as the router), not BASE_URL: `npm run online` builds with --base ./
const routerBase = (import.meta.env.VITE_ROUTER_BASE ?? '').replace(/\/+$/, '')
export const appUrl = `${window.location.origin}${routerBase}/`

export const oidcConfig: AuthProviderProps = {
  authority,
  client_id: clientId,
  redirect_uri: appUrl,
  post_logout_redirect_uri: appUrl,
  response_type: 'code', // authorization code + PKCE (oidc-client-ts adds PKCE)
  scope: 'openid email profile',
  // Drop ?code=&state= from the address bar once sign-in completes
  onSigninCallback: () => window.history.replaceState({}, document.title, window.location.pathname),
}

// Cognito's own sign-out page; the generic OIDC end-session endpoint isn't supported.
export function signOutUrl() {
  return `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(appUrl)}`
}
