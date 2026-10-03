import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow/700.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import './index.css'
import App from './App'
import { signInEnabled } from './auth/config'
import { SessionProvider } from './auth/session'

// Behind the online VS Code proxy the app lives under /ports/5173 (`npm run online` sets this).
// Unset for `npm run dev`, so the app keeps running at the root.
const routerBase = (import.meta.env.VITE_ROUTER_BASE ?? '').replace(/\/+$/, '') || undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBase}>
      <MotionConfig reducedMotion="user">
        {signInEnabled ? (
          <SessionProvider>
            <App />
          </SessionProvider>
        ) : (
          <App />
        )}
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
)
