// Every call the sign-in, sign-up and password-reset screens make, in one place.
//
// Today these pretend: they wait a moment, check the obvious things, and succeed, so the screens can be
// demoed. To go live, replace each body with the matching Amazon Cognito call (docs/login.md), e.g. with
// `aws-amplify/auth`:
//   signIn        -> signIn({ username: email, password })
//   signUp        -> signUp({ username: email, password, options: { userAttributes: { email, name, 'custom:firm': firm } } })
//   confirmSignUp -> confirmSignUp({ username: email, confirmationCode: code })
//   resendCode    -> resendSignUpCode({ username: email })
//   requestReset  -> resetPassword({ username: email })
//   confirmReset  -> confirmResetPassword({ username: email, confirmationCode: code, newPassword })
// Throw AccountError with a message a person can act on; the screens show it as is.

export class AccountError extends Error {}

// True while the calls below only pretend. Set to false once they talk to Cognito; the screens then drop
// their "Preview" note.
export const ACCOUNTS_ARE_PREVIEW = true

export interface SignUpInput {
  name: string
  email: string
  firm: string
  password: string
}

// Cognito's policy for this stack (docs/login.md): at least 12 characters. The others are shown as tips.
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

export const accountApi = {
  async signIn(email: string, password: string, _remember: boolean) {
    if (!validEmail(email)) throw new AccountError('Enter the email address you signed up with.')
    if (!password) throw new AccountError('Enter your password.')
    await pause()
  },

  async signUp(input: SignUpInput) {
    if (!input.name.trim()) throw new AccountError('Enter your name.')
    if (!validEmail(input.email)) throw new AccountError('Enter a valid work email address.')
    if (!input.firm.trim()) throw new AccountError("Enter your firm's name.")
    checkPassword(input.password)
    await pause()
  },

  async confirmSignUp(_email: string, code: string) {
    checkCode(code)
    await pause()
  },

  async resendCode(_email: string) {
    await pause(400)
  },

  async requestReset(email: string) {
    if (!validEmail(email)) throw new AccountError('Enter the email address you signed up with.')
    await pause()
  },

  async confirmReset(_email: string, code: string, newPassword: string) {
    checkCode(code)
    checkPassword(newPassword)
    await pause()
  },
}
