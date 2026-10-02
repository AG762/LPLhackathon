import type {
  AuditEntry,
  BulkApproveResult,
  DashboardMetrics,
  FileRecord,
  FileStatus,
  ScanStatus,
  UploadUrlResponse,
  VerifyResult,
} from '../types'
import { ApiError } from './errors'
import { mockApi } from './mock'

export { ApiError }

export interface Api {
  uploadUrl(filename: string): Promise<UploadUrlResponse>
  putFile(url: string, file: File, onProgress: (fraction: number) => void): Promise<void>
  listFiles(opts?: { status?: FileStatus; sort?: 'priority' }): Promise<FileRecord[]>
  getFile(id: string): Promise<FileRecord>
  approve(id: string): Promise<FileRecord>
  reject(id: string): Promise<FileRecord>
  restore(id: string): Promise<FileRecord>
  bulkApprove(ids: string[]): Promise<BulkApproveResult>
  startScan(): Promise<{ jobId: string }>
  scanStatus(): Promise<ScanStatus>
  ingestScan(): Promise<{ updated: number }>
  dashboard(): Promise<DashboardMetrics>
  audit(): Promise<AuditEntry[]>
  verifyAudit(): Promise<VerifyResult>
  certificate(): Promise<Blob>
  // Demo-only controls (E.3). Undefined when the backend doesn't expose them.
  tamper?(): Promise<void>
  repair?(): Promise<void>
}

export type ApiMode = 'mock' | 'live'

const MODE_KEY = 'shredsafe.apiMode'
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export function getMode(): ApiMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'mock' || saved === 'live') return saved
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock'
}

export function setMode(mode: ApiMode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* storage unavailable */
  }
  window.location.reload()
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!BASE_URL) throw new ApiError(0, 'VITE_API_URL is not set. Add it to frontend/.env.local.')
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the API. Check your connection and VITE_API_URL.')
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 501) message = `Not built on the backend yet: ${message}`
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

// S3 presigned PUT. Uses XHR because fetch has no upload progress events.
export function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? (onProgress(1), resolve())
        : reject(new ApiError(xhr.status, `Upload rejected by storage (${xhr.status})`))
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check the bucket CORS settings.'))
    xhr.send(file)
  })
}

const liveApi: Api = {
  uploadUrl: (filename) => request('POST', '/upload-url', { filename }),
  putFile: putWithProgress,
  listFiles: (opts = {}) => {
    const q = new URLSearchParams()
    if (opts.status) q.set('status', opts.status)
    if (opts.sort) q.set('sort', opts.sort)
    const qs = q.toString()
    return request('GET', `/files${qs ? `?${qs}` : ''}`)
  },
  getFile: (id) => request('GET', `/files/${encodeURIComponent(id)}`),
  approve: (id) => request('POST', `/files/${encodeURIComponent(id)}/approve`),
  reject: (id) => request('POST', `/files/${encodeURIComponent(id)}/reject`),
  restore: (id) => request('POST', `/files/${encodeURIComponent(id)}/restore`),
  bulkApprove: (ids) => request('POST', '/files/bulk-approve', { ids }),
  startScan: () => request('POST', '/scan'),
  scanStatus: () => request('GET', '/scan/status'),
  ingestScan: () => request('POST', '/scan/ingest'),
  dashboard: () => request('GET', '/dashboard'),
  audit: () => request('GET', '/audit'),
  verifyAudit: () => request('GET', '/audit/verify'),
  // Demo-only routes; the backend returns 404 unless DEMO_CONTROLS=true on the stack.
  tamper: async () => {
    await request('POST', '/audit/demo/tamper')
  },
  repair: async () => {
    await request('POST', '/audit/demo/restore')
  },
  certificate: async () => {
    if (!BASE_URL) throw new ApiError(0, 'VITE_API_URL is not set.')
    const res = await fetch(`${BASE_URL}/certificate`)
    if (!res.ok) {
      throw new ApiError(res.status, res.status === 501 ? 'Not built on the backend yet: certificate' : `Certificate failed (${res.status})`)
    }
    return res.blob()
  },
}

export const mode = getMode()
export const api: Api = mode === 'live' ? liveApi : mockApi
export const apiBaseUrl = BASE_URL
