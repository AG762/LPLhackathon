import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { FileRecord } from '../types'

const POLL_MS = 3000

interface FilesState {
  files: FileRecord[]
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  upsert: (updated: FileRecord[]) => void
}

const FilesContext = createContext<FilesState | null>(null)

// Polls /files so uploads "stream in" without a refresh (F.6). Shared so the nav count and queue agree.
export function FilesProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      setFiles(await api.listFiles())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setLoaded(true)
    }
  }, [])

  const upsert = useCallback((updated: FileRecord[]) => {
    const byId = new Map(updated.map((f) => [f.fileId, f]))
    setFiles((prev) => prev.map((f) => byId.get(f.fileId) ?? f))
  }, [])

  useEffect(() => {
    void refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return <FilesContext.Provider value={{ files, loaded, error, refresh, upsert }}>{children}</FilesContext.Provider>
}

export function useFiles() {
  const ctx = useContext(FilesContext)
  if (!ctx) throw new Error('useFiles must be used inside FilesProvider')
  return ctx
}
