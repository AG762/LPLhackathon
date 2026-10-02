import type { DashboardMetrics, FileRecord } from '../types'
import { isOnHold } from './format'

export const isRemoved = (f: FileRecord) => f.status === 'QUARANTINED' || f.status === 'PURGED'

// Same numbers the /dashboard route should return (PLAN.md §13). Used by the mock backend, and by the
// dashboard as a fallback while the real route is still a 501.
export function computeMetrics(files: FileRecord[], chainOk: boolean): DashboardMetrics {
  const removed = files.filter(isRemoved)
  const totalBytes = files.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
  const reclaimed = removed.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
  return {
    storageReclaimedBytes: reclaimed,
    storageReclaimedPct: totalBytes ? reclaimed / totalBytes : 0,
    piiItemsRemoved: removed.reduce((s, f) => s + Object.values(f.macieFindings ?? {}).reduce((a, b) => a + b, 0), 0),
    highPriorityBacklog: files.filter((f) => f.status === 'PENDING' && f.priority === 'HIGH' && f.recommendation === 'DELETE').length,
    overRetainedPct: files.length ? files.filter((f) => f.recommendation === 'DELETE').length / files.length : 0,
    heldFilesDeleted: removed.filter(isOnHold).length,
    autoCleared: files.filter((f) => f.recommendation && f.recommendation !== 'REVIEW').length,
    neededReview: files.filter((f) => f.recommendation === 'REVIEW').length,
    totalFiles: files.length,
    chainOk,
  }
}
