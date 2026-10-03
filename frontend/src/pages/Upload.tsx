import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { formatBytes } from '../lib/format'
import { scanEta } from '../lib/scanEstimate'
import { useFiles } from '../state/files'
import './upload.css'

const CONCURRENCY = 4

interface Item {
  key: string
  file: File
  path: string
  progress: number
  state: 'queued' | 'uploading' | 'done' | 'failed'
  error?: string
}

// Folders dropped from Finder/Explorer arrive as directory entries; walk them to get every file.
async function filesFromEntry(entry: FileSystemEntry, prefix = ''): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    return [{ file, path: prefix + file.name }]
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const children: FileSystemEntry[] = []
    // readEntries returns results in batches; keep reading until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      children.push(...batch)
    }
    const nested = await Promise.all(children.map((c) => filesFromEntry(c, `${prefix}${entry.name}/`)))
    return nested.flat()
  }
  return []
}

// After a batch lands, the sensitive-data scan starts by itself (F.19), unless one is already running.
type ScanNote =
  | { kind: 'waiting'; ready: number; total: number }
  | { kind: 'started'; startedAt: string }
  | { kind: 'done' }
  | { kind: 'busy' }
  | { kind: 'failed'; message: string }

const CLASSIFY_WAIT_MS = 3 * 60_000 // give up waiting for classification after this and scan anyway
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isJunk = (name: string) => name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini'

export default function UploadPage() {
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const [scanNote, setScanNote] = useState<ScanNote | null>(null)
  // Stops the background waits when you leave the page (the scan itself keeps running on the server).
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const { refresh } = useFiles()

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  async function uploadAll(picked: { file: File; path: string }[]) {
    const fresh: Item[] = picked
      .filter(({ file }) => !isJunk(file.name))
      .map(({ file, path }, i) => ({ key: `${Date.now()}-${i}-${path}`, file, path, progress: 0, state: 'queued' }))
    if (!fresh.length) return
    setItems((list) => [...fresh, ...list])
    setRunning(true)

    let next = 0
    const uploadedIds: string[] = []
    const worker = async () => {
      while (next < fresh.length) {
        const it = fresh[next++]
        update(it.key, { state: 'uploading' })
        try {
          const { fileId, url, headers } = await api.uploadUrl(it.file.name)
          await api.putFile(url, it.file, (p) => update(it.key, { progress: p }), headers)
          update(it.key, { state: 'done', progress: 1 })
          uploadedIds.push(fileId)
        } catch (e) {
          update(it.key, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fresh.length) }, worker))
    setRunning(false)
    void refresh()
    if (uploadedIds.length > 0) void scanAfterUpload(uploadedIds)
  }

  // Classification already happens per file as it lands; this starts the slower sensitive-data scan so the
  // queue can rank the new files by exposure without anyone having to remember to click.
  //
  // It waits until every new file has been classified first: a file's upload time is recorded when it's
  // classified, and a scan only counts files recorded before it started. Starting too early left the last
  // few files out (QA, F.23).
  async function scanAfterUpload(ids: string[]) {
    try {
      const want = new Set(ids)
      const deadline = Date.now() + CLASSIFY_WAIT_MS
      for (;;) {
        const listed = await api.listFiles()
        const ready = listed.filter((f) => want.has(f.fileId) && f.docType).length
        if (!alive.current) return
        setScanNote({ kind: 'waiting', ready, total: want.size })
        if (ready >= want.size || Date.now() > deadline) break
        await sleep(2000)
      }
      const status = await api.scanStatus()
      if (status.state === 'RUNNING') {
        if (alive.current) setScanNote({ kind: 'busy' })
        return
      }
      await api.startScan()
      if (!alive.current) return
      setScanNote({ kind: 'started', startedAt: new Date().toISOString() })
      // Follow it here too, so the page doesn't sit on "finishing up" after it's done.
      for (;;) {
        await sleep(5000)
        if (!alive.current) return
        const s = await api.scanStatus()
        if (s.state === 'COMPLETE') return setScanNote({ kind: 'done' })
        if (s.state === 'FAILED') return setScanNote({ kind: 'failed', message: 'the scan was cancelled' })
      }
    } catch (e) {
      if (alive.current) setScanNote({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[]
    if (entries.length) {
      uploadAll((await Promise.all(entries.map((en) => filesFromEntry(en)))).flat())
    } else {
      uploadAll([...e.dataTransfer.files].map((file) => ({ file, path: file.name })))
    }
  }

  function onPick(list: FileList | null) {
    if (!list) return
    uploadAll([...list].map((file) => ({ file, path: file.webkitRelativePath || file.name })))
  }

  const done = items.filter((i) => i.state === 'done').length
  const failed = items.filter((i) => i.state === 'failed').length
  const totalBytes = items.reduce((s, i) => s + i.file.size, 0)
  const sentBytes = items.reduce((s, i) => s + i.file.size * i.progress, 0)

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Upload files</h1>
          <p>
            Drop a folder from your drive. Each file is read, classified against your firm's retention rules, and added
            to the review queue. Nothing is deleted without your approval.
          </p>
        </div>
      </header>

      <div
        className={`dropzone ${dragging ? 'dropzone-over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Choose files to upload, or drop a folder here"
        // The whole area opens the file picker, not just the buttons (F.23)
        onClick={(e) => {
          // Ignore clicks from the buttons and from the hidden inputs themselves: input.click() bubbles up to here,
          // and opening a second picker in the same click cancels the first, so neither opened.
          if (!(e.target as HTMLElement).closest('button, input')) fileInput.current?.click()
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault()
            fileInput.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg className="dropzone-icon" viewBox="0 0 48 48" aria-hidden="true">
          <path d="M6 14a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M24 34V21m0 0-5 5m5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="dropzone-title">Drag a folder or files here</p>
        <p className="muted">PDF, Word, Excel, CSV, text, email and image files</p>
        <div className="dropzone-actions">
          <button className="btn btn-primary" onClick={() => folderInput.current?.click()}>
            Choose a folder
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Choose files
          </button>
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (onPick(e.target.files), (e.target.value = ''))} />
        <input
          ref={folderInput}
          type="file"
          hidden
          // @ts-expect-error webkitdirectory is supported by every current browser but missing from React's types
          webkitdirectory=""
          onChange={(e) => (onPick(e.target.files), (e.target.value = ''))}
        />
      </div>

      {items.length > 0 && (
        <section className="panel upload-list" aria-label="Uploads">
          <div className="upload-summary">
            <div>
              <strong className="num">
                {done} of {items.length}
              </strong>{' '}
              uploaded
              {failed > 0 && <span className="upload-failed-count">, {failed} failed</span>}
              <span className="muted">
                {' '}
                ({formatBytes(sentBytes)} of {formatBytes(totalBytes)})
              </span>
            </div>
            {!running && done > 0 && (
              <Link className="btn btn-primary" to="/queue">
                Go to review queue
              </Link>
            )}
          </div>
          {!running && done > 0 && (
            <p className="upload-hint muted">Files show up in the queue as soon as they're classified, usually within a few seconds.</p>
          )}
          {!running && scanNote && <ScanNoteLine note={scanNote} fileCount={done} />}
          <ul className="upload-items">
            {items.map((it) => (
              <li key={it.key} className={`upload-item upload-${it.state}`}>
                <span className="upload-name" title={it.path}>
                  {it.path}
                </span>
                <span className="upload-size muted num">{formatBytes(it.file.size)}</span>
                <span
                  className="upload-bar"
                  role="progressbar"
                  aria-label={`Upload progress for ${it.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(it.progress * 100)}
                >
                  <span style={{ transform: `scaleX(${it.progress})` }} />
                </span>
                <span className="upload-state">
                  {it.state === 'queued' && 'Waiting'}
                  {it.state === 'uploading' && `${Math.round(it.progress * 100)}%`}
                  {it.state === 'done' && 'Uploaded'}
                  {it.state === 'failed' && <span title={it.error}>Failed</span>}
                </span>
                {it.state === 'failed' && <span className="upload-error">{it.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ScanNoteLine({ note, fileCount }: { note: ScanNote; fileCount: number }) {
  if (note.kind === 'failed') {
    return (
      <p className="upload-scan upload-scan-failed" role="status">
        Couldn't start the sensitive-data scan ({note.message}). Start it from the review queue.
      </p>
    )
  }
  if (note.kind === 'waiting') {
    return (
      <p className="upload-scan" role="status">
        <strong>Classifying your files</strong> ({note.ready} of {note.total} done). The sensitive-data scan starts as
        soon as they're all in.
      </p>
    )
  }
  if (note.kind === 'done') {
    return (
      <p className="upload-scan" role="status">
        <strong>Sensitive-data scan finished.</strong> Open the review queue and choose{' '}
        <strong>Show sensitive-data results</strong> to rank the files by exposure.
      </p>
    )
  }
  if (note.kind === 'busy') {
    return (
      <p className="upload-scan" role="status">
        A sensitive-data scan was already running, so it may not include these files. When it finishes, start another
        from the review queue.
      </p>
    )
  }
  return (
    <p className="upload-scan" role="status">
      <strong>Sensitive-data scan started.</strong> {scanEta(note.startedAt, fileCount)} The review queue ranks the files
      by exposure when it's done.
    </p>
  )
}
