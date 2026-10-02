import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { mode, setMode, type ApiMode } from './api/client'
import { DEMO_ADVISOR } from './lib/format'
import { FilesProvider, useFiles } from './state/files'
import { ToastProvider } from './state/toast'
import QueuePage from './pages/Queue'
import UploadPage from './pages/Upload'
import DashboardPage from './pages/Dashboard'
import AuditPage from './pages/Audit'

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="2" width="16" height="11" rx="1.5" fill="currentColor" />
      <rect x="4" y="15" width="2.6" height="7" fill="currentColor" />
      <rect x="8.35" y="15" width="2.6" height="5" fill="currentColor" />
      <rect x="12.7" y="15" width="2.6" height="7" fill="currentColor" />
      <rect x="17.05" y="15" width="2.95" height="4" fill="currentColor" />
    </svg>
  )
}

function Sidebar() {
  const { files } = useFiles()
  const toReview = files.filter((f) => f.status === 'PENDING').length

  const choose = (next: ApiMode) => {
    if (next !== mode) setMode(next)
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        ShredSafe
      </div>
      <nav className="nav" aria-label="Main">
        <NavLink to="/" end>
          Review queue
          {toReview > 0 && <span className="nav-count">{toReview}</span>}
        </NavLink>
        <NavLink to="/upload">Upload</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/audit">Audit log</NavLink>
      </nav>
      <div className="sidebar-foot">
        <div className="advisor">
          <div className="advisor-name">{DEMO_ADVISOR.name}</div>
          <div className="muted">{DEMO_ADVISOR.branch}</div>
        </div>
        <div>
          <div className="muted" id="mode-label" style={{ marginBottom: 6 }}>
            Data source
          </div>
          <div className="mode-switch" role="group" aria-labelledby="mode-label">
            <button type="button" aria-pressed={mode === 'mock'} onClick={() => choose('mock')}>
              Demo
            </button>
            <button type="button" aria-pressed={mode === 'live'} onClick={() => choose('live')}>
              Live API
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <FilesProvider>
        <div className="shell">
          <Sidebar />
          <main className="main">
            <Routes>
              <Route path="/" element={<QueuePage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </FilesProvider>
    </ToastProvider>
  )
}
