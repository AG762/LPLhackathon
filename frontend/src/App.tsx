import { Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { mode, setMode, type ApiMode } from './api/client'
import { DEMO_ADVISOR } from './lib/format'
import { AuthGate, SignedInUser } from './auth/AuthGate'
import { signInEnabled } from './auth/config'
import { FilesProvider, useFiles } from './state/files'
import { ToastProvider } from './state/toast'
import QueuePage from './pages/Queue'
import UploadPage from './pages/Upload'
import DashboardPage from './pages/Dashboard'
import AuditPage from './pages/Audit'
import AdminPage from './pages/Admin'
import { ForgotPasswordPage, SignInPage, SignUpPage } from './pages/Auth'
import HomePage from './pages/Home'
import { BrandMark } from './components/BrandMark'

function Sidebar() {
  const { files } = useFiles()
  const toReview = files.filter((f) => f.status === 'PENDING').length

  const choose = (next: ApiMode) => {
    if (next !== mode) setMode(next)
  }

  return (
    <aside className="sidebar">
      <Link className="brand" to="/" title="ShredSafe home">
        <BrandMark />
        ShredSafe
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLink to="/queue">
          Review queue
          {toReview > 0 && <span className="nav-count">{toReview}</span>}
        </NavLink>
        <NavLink to="/upload">Upload</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/audit">Audit log</NavLink>
        {/* Admins and compliance only once sign-in is on; the demo advisor is the firm's admin. */}
        <NavLink to="/admin">Admin</NavLink>
      </nav>
      <div className="sidebar-foot">
        {signInEnabled ? (
          <SignedInUser />
        ) : (
          <div className="advisor">
            <div className="advisor-name">{DEMO_ADVISOR.name}</div>
            <div className="muted">{DEMO_ADVISOR.branch}</div>
          </div>
        )}
        <div>
          <div className="muted mode-label" id="mode-label" style={{ marginBottom: 6 }}>
            Workspace data
          </div>
          <div className="mode-switch" role="group" aria-labelledby="mode-label">
            <button type="button" aria-pressed={mode === 'mock'} onClick={() => choose('mock')}>
              <span className="mode-dot" aria-hidden="true" />
              Sample
            </button>
            <button type="button" aria-pressed={mode === 'live'} onClick={() => choose('live')}>
              <span className="mode-dot" aria-hidden="true" />
              Live
            </button>
          </div>
          <p className="mode-now">{mode === 'live' ? 'Showing your files' : 'Showing sample files for a demo branch'}</p>
        </div>
      </div>
    </aside>
  )
}

// The portal: sidebar plus the page for the current route.
function Portal() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  const app = (
    <ToastProvider>
      <FilesProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />
          <Route element={<Portal />}>
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </FilesProvider>
    </ToastProvider>
  )
  // Signed-out users see only the sign-in screen, so nothing calls the API without a token
  return signInEnabled ? <AuthGate>{app}</AuthGate> : app
}
