import type { MouseEvent, ReactNode } from 'react'
import { Link, useHref } from 'react-router-dom'
import { mode, openWithSampleData } from '../api/client'
import { useOptionalSession } from '../auth/session'

// "Try it now": the demo, with no account. Signed in, it's simply your dashboard. Signed out on a site with
// Live data, the portal would send you to sign in, so it switches to Sample data first (which needs no sign-in)
// and opens the dashboard there; the sidebar's Sample/Live switch goes back to Live and sign-in.
export function TryLink({ className, children }: { className?: string; children: ReactNode }) {
  const auth = useOptionalSession()
  const href = useHref('/dashboard')
  const signedIn = auth?.session.status === 'signedIn'

  if (mode === 'mock' || signedIn) {
    return (
      <Link className={className} to="/dashboard">
        {children}
      </Link>
    )
  }
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // new tab: let the browser handle it
    e.preventDefault()
    openWithSampleData(href)
  }
  return (
    <a className={className} href={href} onClick={onClick}>
      {children}
    </a>
  )
}
