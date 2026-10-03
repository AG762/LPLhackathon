// Cognito sign-in settings (docs/login.md). Values come from the stack outputs (scripts/frontend_env.py):
//   VITE_COGNITO_USER_POOL_ID  <- UserPoolId
//   VITE_COGNITO_CLIENT_ID     <- UserPoolClientId
// Sign-in is on only in Live mode with both set. Sample mode never signs in, and the sign-in pages
// (pages/Auth.tsx) keep their preview behaviour there.
import { Amplify } from 'aws-amplify'
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito'
import { defaultStorage, sessionStorage } from 'aws-amplify/utils'
import { mode } from '../api/client'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? ''
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? ''

export const signInEnabled = mode === 'live' && Boolean(userPoolId && userPoolClientId)

// "Keep me signed in on this device": tokens in localStorage (survive closing the browser) or in
// sessionStorage (gone with the tab). Remembered here so a reload looks in the same place.
const REMEMBER_KEY = 'shredsafe.rememberMe'

function remembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setRememberMe(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, String(remember))
  } catch {
    /* storage unavailable: fall back to the default */
  }
  cognitoUserPoolsTokenProvider.setKeyValueStorage(remember ? defaultStorage : sessionStorage)
}

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
  cognitoUserPoolsTokenProvider.setKeyValueStorage(remembered() ? defaultStorage : sessionStorage)
}
