// Every call the sign-in, sign-up and password-reset screens (pages/Auth.tsx) make, in one place.
//
// Live mode with Cognito configured (auth/config.ts): real Amazon Cognito calls through aws-amplify/auth.
// Otherwise (Sample mode, or no Cognito settings) they pretend: wait a moment, check the obvious things,
// and succeed, so the screens can be demoed.
// Throw AccountError with a message a person can act on; the screens show it as is.
import {
  confirmResetPassword,
  confirmSignUp,
  resendSignUpCode,
  fetchAuthSession,
  resetPassword,
  signIn,
  signOut,
  signUp,
  updatePassword,
  updateUserAttributes,
} from 'aws-amplify/auth'
import { setRememberMe, signInEnabled } from './config'
import { refreshSession } from './session'

export class AccountError extends Error {}

// Sign-in found an account whose email was never confirmed. A new code has been sent; the screen should
// take the person to the code step of sign-up.
export class NeedsConfirmation extends AccountError {
  readonly email: string
  constructor(email: string) {
    super(`Your email isn’t confirmed yet. We sent a new code to ${email}.`)
    this.email = email
  }
}

// True while the calls only pretend; the screens then show their "Preview" note.
export const ACCOUNTS_ARE_PREVIEW = !signInEnabled

export interface SignUpInput {
  name: string
  email: string
  firm: string
  password: string
}

// Cognito's policy for this stack (infra/template.yaml): at least 12 characters. The others are shown as tips.
export const PASSWORD_RULES: { id: string; label: string; test: (p: string) => boolean; required: boolean }[] = [
  { id: 'length', label: 'At least 12 characters', test: (p) => p.length >= 12, required: true },
  { id: 'mixed', label: 'Upper and lower case letters', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p), required: false },
  { id: 'number', label: 'A number or symbol', test: (p) => /[\d\W_]/.test(p), required: false },
]

const pause = (ms = 650) => new Promise((r) => setTimeout(r, ms))
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())

function checkPassword(p: string) {
  const missing = PASSWORD_RULES.filter((r) => r.required && !r.test(p))
  if (missing.length) throw new AccountError(`Password needs: ${missing.map((r) => r.label.toLowerCase()).join(', ')}.`)
}

function checkCode(code: string) {
  if (!/^\d{6}$/.test(code)) throw new AccountError('Enter the 6-digit code from the email.')
}

// Cognito error names -> messages a person can act on
function friendly(e: unknown): AccountError {
  if (e instanceof AccountError) return e
  const err = e as { name?: string; message?: string }
  switch (err.name) {
    case 'UserNotFoundException':
      return new AccountError('That email and password don’t match an account.')
    case 'NotAuthorizedException':
      // Cognito uses NotAuthorized for more than a wrong password (account turned off, too many attempts,
      // app settings). Only the wrong-password case gets the generic line; the rest say what's wrong.
      return new AccountError(
        !err.message || /incorrect username or password/i.test(err.message)
          ? 'That email and password don’t match an account.'
          : `Couldn’t sign in: ${err.message}`,
      )
    case 'UsernameExistsException':
      return new AccountError('An account with this email already exists. Sign in instead.')
    case 'CodeMismatchException':
      return new AccountError('That code isn’t right. Check the email and try again.')
    case 'ExpiredCodeException':
      return new AccountError('That code has expired. Send a new one.')
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new AccountError('Too many attempts. Wait a few minutes and try again.')
    case 'InvalidPasswordException':
      return new AccountError('Choose a password of at least 12 characters.')
    case 'NetworkError':
      return new AccountError('Couldn’t reach the sign-in service. Check your connection.')
    case 'ResourceNotFoundException':
      return new AccountError('Sign-in isn’t set up correctly on this site (check the VITE_COGNITO_* settings).')
    default:
      return new AccountError(err.message || 'Something went wrong. Try again.')
  }
}

async function cognito<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (e) {
    throw friendly(e)
  }
}

// The password from sign-up, kept in memory only until the emailed code is confirmed, so confirming
// can sign the new advisor straight in.
let pendingSignUp: { email: string; password: string } | null = null

async function liveSignIn(email: string, password: string) {
  const result = await cognito(() => signIn({ username: email, password }))
  switch (result.nextStep.signInStep) {
    case 'DONE':
      await refreshSession()
      return
    case 'CONFIRM_SIGN_UP':
      await cognito(() => resendSignUpCode({ username: email }))
      pendingSignUp = { email, password }
      throw new NeedsConfirmation(email)
    case 'RESET_PASSWORD':
      throw new AccountError('You need to choose a new password. Use “Forgot your password?” below.')
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      throw new AccountError('This account still has its temporary password. Ask whoever set it up to reset it.')
    default:
      throw new AccountError('This account needs a sign-in step this page doesn’t support yet (such as an authenticator code).')
  }
}

export const accountApi = {
  async signIn(email: string, password: string, remember: boolean) {
    if (!validEmail(email)) throw new AccountError('Enter the email address you signed up with.')
    if (!password) throw new AccountError('Enter your password.')
    if (!signInEnabled) return pause()
    setRememberMe(remember)
    await liveSignIn(email.trim(), password)
  },

  async signUp(input: SignUpInput) {
    if (!input.name.trim()) throw new AccountError('Enter your name.')
    if (!validEmail(input.email)) throw new AccountError('Enter a valid work email address.')
    if (!input.firm.trim()) throw new AccountError("Enter your firm's name.")
    checkPassword(input.password)
    if (!signInEnabled) return pause()
    const email = input.email.trim()
    await cognito(() =>
      signUp({
        username: email,
        password: input.password,
        options: { userAttributes: { email, name: input.name.trim(), 'custom:firm': input.firm.trim() } },
      }),
    )
    pendingSignUp = { email, password: input.password }
  },

  // Returns true when the new advisor is signed in; false means "confirmed, now sign in".
  async confirmSignUp(email: string, code: string): Promise<boolean> {
    checkCode(code)
    if (!signInEnabled) {
      await pause()
      return true
    }
    const username = email.trim()
    await cognito(() => confirmSignUp({ username, confirmationCode: code }))
    const pending = pendingSignUp?.email === username ? pendingSignUp : null
    pendingSignUp = null
    if (!pending) return false
    await liveSignIn(username, pending.password)
    return true
  },

  async resendCode(email: string) {
    if (!signInEnabled) return pause(400)
    await cognito(() => resendSignUpCode({ username: email.trim() }))
  },

  async requestReset(email: string) {
    if (!validEmail(email)) throw new AccountError('Enter the email address you signed up with.')
    if (!signInEnabled) return pause()
    await cognito(() => resetPassword({ username: email.trim() }))
  },

  // ---------- Account page (P5) ----------

  async updateName(name: string) {
    if (!name.trim()) throw new AccountError('Enter your name.')
    if (!signInEnabled) return pause()
    await cognito(() => updateUserAttributes({ userAttributes: { name: name.trim() } }))
    // The sidebar reads the name from the ID token, so get a fresh one
    await cognito(() => fetchAuthSession({ forceRefresh: true }))
    await refreshSession()
  },

  async changePassword(current: string, next: string) {
    if (!current) throw new AccountError('Enter your current password.')
    checkPassword(next)
    if (current === next) throw new AccountError('Choose a password you haven’t used here before.')
    if (!signInEnabled) return pause()
    try {
      await updatePassword({ oldPassword: current, newPassword: next })
    } catch (e) {
      // Here NotAuthorized means the current password was wrong, not that the account doesn't exist
      if ((e as { name?: string }).name === 'NotAuthorizedException') {
        throw new AccountError('Your current password isn’t right.')
      }
      throw friendly(e)
    }
  },

  // Ends every session this account has (other browsers and devices too), then this one.
  async signOutEverywhere() {
    if (!signInEnabled) return pause()
    await cognito(() => signOut({ global: true }))
    await refreshSession()
  },

  async confirmReset(email: string, code: string, newPassword: string) {
    checkCode(code)
    checkPassword(newPassword)
    if (!signInEnabled) return pause()
    await cognito(() => confirmResetPassword({ username: email.trim(), confirmationCode: code, newPassword }))
  },
}
