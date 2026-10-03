// Cognito sign-in settings (docs/login.md). Values come from the stack outputs (scripts/frontend_env.py):
//   VITE_COGNITO_USER_POOL_ID  <- UserPoolId
//   VITE_COGNITO_CLIENT_ID     <- UserPoolClientId
// Sign-in is on only in Live mode with both set. Demo mode never signs in.
// The forms are our own screens (AuthGate.tsx) talking to Cognito through Amplify Auth, so users never
// leave ShredSafe for a Cognito-hosted page.
import { Amplify } from 'aws-amplify'
import { mode } from '../api/client'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? ''
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? ''

export const signInEnabled = mode === 'live' && Boolean(userPoolId && userPoolClientId)

if (signInEnabled) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
      },
    },
  })
}
