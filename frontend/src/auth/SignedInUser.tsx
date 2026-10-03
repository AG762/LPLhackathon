// Sidebar block when sign-in is on: who is signed in, their role, and sign-out (docs/login.md).
import { useNavigate } from 'react-router-dom'
import { useSession } from './session'
import './session.css'

export function SignedInUser() {
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  if (session.status !== 'signedIn') return null
  const shown = session.name || session.email

  async function leave() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="session">
      <span className="session-avatar" aria-hidden="true">
        {shown.charAt(0) || '?'}
      </span>
      <span>
        <span className="session-email" title={session.email}>
          {shown}
        </span>
        <span className="session-role">{session.role}</span>
      </span>
      <button type="button" className="session-signout" onClick={() => void leave()}>
        Sign out
      </button>
    </div>
  )
}
