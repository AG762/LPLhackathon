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
  | 'EXPIRED_PII'
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
  // Set by GET /files and /files/{id} from the active LegalHolds (same check as approve).
  holdId?: string
  holdReason?: string
  status: FileStatus
}

export interface UploadUrlResponse {
  fileId: string
  key?: string
  url: string
  // Headers the upload must send as-is (signed into the URL), e.g. x-amz-meta-owner when signed in
  headers?: Record<string, string>
}

// POST /files/bulk-approve: each id is approved or reported back with the guard that blocked it.
export interface BulkApproveResult {
  approved: FileRecord[]
  blocked: { fileId: string; status: number; error: string }[]
}

export type ScanState = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED'

export interface ScanStatus {
  jobId: string | null
  state: ScanState
  startedAt?: string // when the newest job started; files uploaded after it weren't scanned
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
  detail?: string // e.g. why a hold was released, who was invited
  prevHash: string
  entryHash: string
}

export interface VerifyResult {
  ok: boolean
  brokenAtSeq?: number
}

// ---------- Admin (F.15) ----------
// Roles match the Cognito groups in docs/login.md.
export type Role = 'advisor' | 'compliance' | 'admin'
export type MemberStatus = 'ACTIVE' | 'INVITED' | 'DISABLED'

export interface Member {
  userId: string
  email: string
  name?: string
  role: Role
  status: MemberStatus
  branchId?: string
  invitedAt?: string
  lastActiveAt?: string
}

// Same shape as the LegalHolds table (AGENTS.md Rule 2), plus who placed or released it and how many files it covers.
export type HoldScope = 'CLIENT_NAME' | 'CLIENT_ID' | 'ACCOUNT_ID' | 'BRANCH_ID' | 'KEYWORD'

export interface LegalHold {
  holdId: string
  scopeType: HoldScope
  scopeValue: string
  reason: string
  active: boolean
  createdBy?: string
  createdAt?: string
  releasedBy?: string
  releasedAt?: string
  releaseReason?: string
  matchedFiles?: number
  workspaceId?: string
  // Only on a release: files the hold had parked that went back to REVIEW.
  reopenedFiles?: number
}

// One row of config/retention_rules.json.
export interface RetentionRule {
  docType: string
  retentionYears: number
  trigger: string
  action: 'RETAIN' | 'DELETE' | 'REVIEW'
  citation: string
  description: string
}
