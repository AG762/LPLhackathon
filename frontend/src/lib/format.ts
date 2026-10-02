import type { FileRecord, Priority } from '../types'

export const DEMO_ADVISOR = { id: 'adv-1042', name: 'Jordan Reyes', branch: 'Branch 214, Austin TX' }

const DOC_TYPE_LABELS: Record<string, string> = {
  TRADE_CONFIRMATION: 'Trade confirmation',
  ACCOUNT_STATEMENT: 'Account statement',
  CLIENT_COMMUNICATION: 'Client communication',
  ADVISORY_AGREEMENT: 'Advisory agreement',
  MARKETING: 'Marketing',
  DRAFT: 'Draft',
  DUPLICATE: 'Duplicate copy',
  PERSONAL: 'Personal',
  ID_DOCUMENT: 'ID / SSN scan',
  EXPIRED_PII: 'Expired personal data',
  UNKNOWN: 'Unclassified',
}

export function docTypeLabel(docType?: string) {
  if (!docType) return 'Classifying…'
  return DOC_TYPE_LABELS[docType] ?? docType.toLowerCase().replace(/_/g, ' ')
}

export function fileName(f: FileRecord) {
  const parts = f.s3Key.split('/')
  return parts[parts.length - 1] || f.fileId
}

export function isOnHold(f: FileRecord) {
  return Boolean(f.legalHold) || f.ruleApplied === 'LEGAL_HOLD_OVERRIDE'
}

export function canApprove(f: FileRecord) {
  return f.status === 'PENDING' && f.recommendation === 'DELETE' && !isOnHold(f)
}

export const PRIORITY_ORDER: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export function sortByPriority(files: FileRecord[]) {
  return [...files].sort(
    (a, b) =>
      (a.priority ? PRIORITY_ORDER[a.priority] : 3) - (b.priority ? PRIORITY_ORDER[b.priority] : 3) ||
      (b.sensitivityScore ?? 0) - (a.sensitivityScore ?? 0),
  )
}

export function formatBytes(bytes?: number) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Date-only strings ("2026-04-15") parse as UTC midnight; format them in UTC so they don't shift a day.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: dateOnly ? 'UTC' : undefined })
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

export function shortHash(h?: string) {
  return h ? h.slice(0, 10) : '—'
}
