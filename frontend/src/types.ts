// Frontend copy of the data model in PLAN.md §8 and the HTTP contract in STORIES.md 0.4.
// Keep in sync with backend/shared/models.

export type Recommendation = 'DELETE' | 'RETAIN' | 'REVIEW'
export type FileStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED' | 'PURGED' | 'LOCKED'
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW'

export type DocType =
  | 'TRADE_CONFIRMATION'
  | 'ACCOUNT_STATEMENT'
  | 'CLIENT_COMMUNICATION'
  | 'ADVISORY_AGREEMENT'
  | 'MARKETING'
  | 'DRAFT'
  | 'DUPLICATE'
  | 'PERSONAL'
  | 'ID_DOCUMENT'
  | 'UNKNOWN'

export interface FileRecord {
  fileId: string
  s3Key: string
  sha256?: string
  sizeBytes?: number
  uploadedAt: string
  ownerAdvisorId?: string
  branchId?: string
  docType?: DocType | string
  confidence?: number
  piiTypes?: string[]
  macieFindings?: Record<string, number>
  sensitivityScore?: number
  priority?: Priority
  clientId?: string
  clientName?: string
  accountId?: string
  keepUntil?: string
  recommendation?: Recommendation
  rationale?: string
  // Not in PLAN.md §8 yet; the rules engine returns these alongside the recommendation.
  ruleApplied?: string
  citation?: string
  legalHold?: boolean
  status: FileStatus
}

export interface UploadUrlResponse {
  fileId: string
  key?: string
  url: string
}

export type ScanState = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED'

export interface ScanStatus {
  jobId: string | null
  state: ScanState
}

export interface DashboardMetrics {
  storageReclaimedBytes: number
  storageReclaimedPct: number
  piiItemsRemoved: number
  highPriorityBacklog: number
  overRetainedPct: number
  heldFilesDeleted: number
  autoCleared: number
  neededReview: number
  totalFiles: number
  chainOk: boolean
}

export interface AuditEntry {
  seq: number
  timestamp: string
  actor: string
  action: string
  fileId?: string
  fileHash?: string
  ruleApplied?: string
  prevHash: string
  entryHash: string
}

export interface VerifyResult {
  ok: boolean
  brokenAtSeq?: number
}
