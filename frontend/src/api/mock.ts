// In-browser stand-in for the api Lambda, so every screen works before the backend routes land.
// Behaves like the contract in STORIES.md 0.4, including the 409 guard on held / in-retention files
// and a real SHA-256 hash chain, so the tamper demo can be rehearsed.
import type { Api } from './client'
import { ApiError } from './errors'
import type { AuditEntry, DashboardMetrics, FileRecord, Priority, Recommendation } from '../types'
import { DEMO_ADVISOR } from '../lib/format'
import { computeMetrics } from '../lib/metrics'

const CITATIONS: Record<string, string> = {
  SEC_17A4_EXPIRED: 'SEC Rule 17a-4 / FINRA 4511, 6 years',
  SEC_17A4_ACTIVE: 'SEC Rule 17a-4 / FINRA 4511, 6 years',
  SEC_17A4_COMM_EXPIRED: 'SEC Rule 17a-4(b)(4), 3 years',
  SEC_17A4_COMM_ACTIVE: 'SEC Rule 17a-4(b)(4), 3 years',
  ACCOUNT_CLOSED_6Y: 'SEC 17a-4 / Advisers Act 204-2, 6 years after account closes',
  ADVISERS_ACT_204_2_EXPIRED: 'Advisers Act Rule 204-2, 5 years',
  NON_RECORD_DISPOSAL: 'No retention requirement',
  DUPLICATE_COPY: 'No retention requirement; original is kept',
  REG_SP_DISPOSAL: 'Reg S-P disposal rule',
  LEGAL_HOLD_OVERRIDE: 'Legal hold overrides every retention rule',
  LOW_CONFIDENCE: 'Classification confidence below the 0.75 review threshold',
}

const MACIE_WEIGHTS: Record<string, number> = {
  SSN: 10,
  PASSPORT: 10,
  DRIVERS_LICENSE: 10,
  BANK_ACCOUNT: 8,
  CREDIT_CARD: 8,
  DATE_OF_BIRTH: 5,
  TAX_ID: 5,
  NAME: 1,
  ADDRESS: 1,
  PHONE: 1,
  EMAIL: 1,
}

export function scoreSensitivity(findings: Record<string, number>): { score: number; priority: Priority } {
  const score = Object.entries(findings).reduce((sum, [type, n]) => sum + (MACIE_WEIGHTS[type] ?? 1) * n, 0)
  return { score, priority: score >= 50 ? 'HIGH' : score >= 10 ? 'MEDIUM' : 'LOW' }
}

interface Fixture {
  id: string
  name: string
  docType: string
  confidence: number
  recommendation: Recommendation
  rule: string
  rationale: string
  keepUntil?: string
  sizeBytes: number
  clientName?: string
  accountId?: string
  legalHold?: boolean
  findings: Record<string, number> // what Macie will report once the scan is ingested
  piiTypes?: string[] // Bedrock fallback for images Macie can't read
  sameContentAs?: string
}

const FIXTURES: Fixture[] = [
  {
    id: 'f08', name: '2018_W9_Forms_Batch.pdf', docType: 'ID_DOCUMENT', confidence: 0.94, recommendation: 'DELETE',
    rule: 'REG_SP_DISPOSAL', keepUntil: '2024-12-31', sizeBytes: 4_812_330,
    rationale: 'Scanned W-9 forms collected for accounts that closed in 2018. Retention ended in 2024, so these should be disposed of under Reg S-P.',
    findings: { SSN: 12, NAME: 12, ADDRESS: 12 },
  },
  {
    id: 'f01', name: '2017_Client_List_Export.csv', docType: 'ADVISORY_AGREEMENT', confidence: 0.81, recommendation: 'DELETE',
    rule: 'ACCOUNT_CLOSED_6Y', keepUntil: '2024-03-31', sizeBytes: 182_400,
    rationale: 'Spreadsheet export of account records for clients who left in 2018. The 6-year period after closing ended in March 2024.',
    findings: { SSN: 48, DATE_OF_BIRTH: 48, NAME: 52 },
  },
  {
    id: 'f04', name: '2019_Email_Whitaker_Rebalance.eml', docType: 'CLIENT_COMMUNICATION', confidence: 0.97, recommendation: 'RETAIN',
    rule: 'LEGAL_HOLD_OVERRIDE', keepUntil: undefined, sizeBytes: 38_912, clientName: 'Margaret Whitaker', legalHold: true,
    rationale: 'Past its 3-year window and looks safe to delete, but Margaret Whitaker is under an active legal hold (FINRA arbitration 24-01187). It cannot be deleted until the hold is lifted.',
    findings: { NAME: 2, EMAIL: 2 },
  },
  {
    id: 'f02', name: '2016_Brokerage_Statement_Q4_Okafor.pdf', docType: 'ACCOUNT_STATEMENT', confidence: 0.98, recommendation: 'DELETE',
    rule: 'SEC_17A4_EXPIRED', keepUntil: '2022-12-31', sizeBytes: 1_204_771, clientName: 'Daniel Okafor', accountId: 'ACCT-55120',
    rationale: 'Quarterly brokerage statement from Q4 2016. The 6-year retention period ended in December 2022.',
    findings: { BANK_ACCOUNT: 3, NAME: 2, ADDRESS: 1 },
  },
  {
    id: 'f11', name: '2016_Brokerage_Statement_Q4_Okafor (1).pdf', docType: 'DUPLICATE', confidence: 1, recommendation: 'DELETE',
    rule: 'DUPLICATE_COPY', sizeBytes: 1_204_771, clientName: 'Daniel Okafor', sameContentAs: 'f02',
    rationale: 'Byte-for-byte copy of 2016_Brokerage_Statement_Q4_Okafor.pdf. The copy can go; the original follows its own rule.',
    findings: { BANK_ACCOUNT: 3, NAME: 2, ADDRESS: 1 },
  },
  {
    id: 'f05', name: 'Drivers_License_Scan_Patel_2015.jpg', docType: 'ID_DOCUMENT', confidence: 0.91, recommendation: 'DELETE',
    rule: 'REG_SP_DISPOSAL', keepUntil: '2021-08-01', sizeBytes: 2_340_118,
    rationale: "Photo of a client's driver's license from account opening in 2015. The account record it supports is past retention.",
    findings: {}, piiTypes: ['DRIVERS_LICENSE', 'DATE_OF_BIRTH'],
  },
  {
    id: 'f14', name: '2022_Client_SSN_Roster_Active.xlsx', docType: 'ADVISORY_AGREEMENT', confidence: 0.88, recommendation: 'RETAIN',
    rule: 'ACCOUNT_CLOSED_6Y', keepUntil: '2032-01-01', sizeBytes: 96_204,
    rationale: 'Account records for clients with open accounts. These must be kept until 6 years after each account closes.',
    findings: { SSN: 9, DATE_OF_BIRTH: 9, NAME: 9 },
  },
  {
    id: 'f13', name: '2023_Statement_Whitaker_Sept.pdf', docType: 'ACCOUNT_STATEMENT', confidence: 0.96, recommendation: 'RETAIN',
    rule: 'LEGAL_HOLD_OVERRIDE', keepUntil: '2029-09-30', sizeBytes: 988_120, clientName: 'Margaret Whitaker', legalHold: true,
    rationale: 'Within its 6-year retention period, and Margaret Whitaker is also under an active legal hold.',
    findings: { BANK_ACCOUNT: 2, NAME: 2 },
  },
  {
    id: 'f03', name: '2024_Trade_Confirm_AAPL.pdf', docType: 'TRADE_CONFIRMATION', confidence: 0.99, recommendation: 'RETAIN',
    rule: 'SEC_17A4_ACTIVE', keepUntil: '2030-06-14', sizeBytes: 211_045, accountId: 'ACCT-80214',
    rationale: 'Trade confirmation for an AAPL purchase in June 2024. It is within its 6-year retention period.',
    findings: { BANK_ACCOUNT: 1, NAME: 1 },
  },
  {
    id: 'f15', name: 'Confirm_MSFT_Sell_2017-03.pdf', docType: 'TRADE_CONFIRMATION', confidence: 0.97, recommendation: 'DELETE',
    rule: 'SEC_17A4_EXPIRED', keepUntil: '2023-03-17', sizeBytes: 198_556, accountId: 'ACCT-41877',
    rationale: 'Trade confirmation for an MSFT sale in March 2017. The 6-year retention period ended in March 2023.',
    findings: { BANK_ACCOUNT: 1, NAME: 1 },
  },
  {
    id: 'f06', name: 'Q3_Financial_Plan_Proposal_v1_draft.docx', docType: 'DRAFT', confidence: 0.93, recommendation: 'DELETE',
    rule: 'NON_RECORD_DISPOSAL', sizeBytes: 64_310,
    rationale: 'Early draft of a proposal. A final version (Q3_Financial_Plan_Proposal_FINAL.docx) exists and is kept.',
    findings: { NAME: 1 },
  },
  {
    id: 'f07', name: 'Q3_Financial_Plan_Proposal_FINAL.docx', docType: 'CLIENT_COMMUNICATION', confidence: 0.86, recommendation: 'RETAIN',
    rule: 'SEC_17A4_COMM_ACTIVE', keepUntil: '2029-09-30', sizeBytes: 71_882,
    rationale: 'Final proposal sent to a client in Q3 2026. Recommendations to clients are kept for at least 3 years.',
    findings: { NAME: 2 },
  },
  {
    id: 'f12', name: 'Spring_2021_Market_Newsletter.pdf', docType: 'MARKETING', confidence: 0.95, recommendation: 'DELETE',
    rule: 'ADVISERS_ACT_204_2_EXPIRED', keepUntil: '2026-04-15', sizeBytes: 3_102_877,
    rationale: 'Published client newsletter from April 2021. The 5-year retention period for advertising ended in April 2026.',
    findings: {},
  },
  {
    id: 'f09', name: 'Office_Potluck_Recipes_2022.txt', docType: 'PERSONAL', confidence: 0.99, recommendation: 'DELETE',
    rule: 'NON_RECORD_DISPOSAL', sizeBytes: 3_811,
    rationale: 'Recipes from an office potluck. Not a business record.',
    findings: {},
  },
  {
    id: 'f10', name: 'IMG_4471_Cabo_Vacation.jpg', docType: 'PERSONAL', confidence: 0.62, recommendation: 'REVIEW',
    rule: 'LOW_CONFIDENCE', sizeBytes: 5_660_412,
    rationale: 'Looks like a vacation photo, but a document may be visible in the frame. Confidence is too low to recommend deleting it automatically.',
    findings: {},
  },
  {
    id: 'f16', name: 'scan_0032.pdf', docType: 'UNKNOWN', confidence: 0.41, recommendation: 'REVIEW',
    rule: 'LOW_CONFIDENCE', sizeBytes: 712_034,
    rationale: 'Low-quality scan with handwriting. The page could be a signed agreement, so it needs a person to look at it.',
    findings: {},
  },
]

// ---------- helpers ----------

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])))
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const latency = () => wait(120 + Math.random() * 180)
const clone = <T,>(v: T): T => structuredClone(v)
const GENESIS = '0'.repeat(64)

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

// ---------- state ----------

const files = new Map<string, FileRecord>()
const pendingFindings = new Map<string, Fixture>()
let audit: AuditEntry[] = []
let tampered: { seq: number; original: AuditEntry } | null = null
let scan: { jobId: string; startedAt: number; ingested: boolean } | null = null

async function appendAudit(entry: Omit<AuditEntry, 'seq' | 'prevHash' | 'entryHash' | 'timestamp'> & { timestamp?: string }) {
  const prevHash = audit.length ? audit[audit.length - 1].entryHash : GENESIS
  const body = {
    seq: audit.length + 1,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    fileId: entry.fileId,
    fileHash: entry.fileHash,
    ruleApplied: entry.ruleApplied,
    prevHash,
  }
  const entryHash = await sha256Hex(prevHash + canonicalJson(body))
  audit.push({ ...body, entryHash })
}

async function hashBody(e: AuditEntry) {
  const { entryHash: _ignored, ...body } = e
  return sha256Hex(e.prevHash + canonicalJson(body))
}

const ready = (async () => {
  for (const [i, fx] of FIXTURES.entries()) {
    const sha = await sha256Hex(`shredsafe-demo:${fx.sameContentAs ?? fx.id}`)
    const rec: FileRecord = {
      fileId: fx.id,
      s3Key: `uploads/${fx.id}/${fx.name}`,
      sha256: sha,
      sizeBytes: fx.sizeBytes,
      uploadedAt: hoursAgo(26 - i * 0.2),
      ownerAdvisorId: DEMO_ADVISOR.id,
      branchId: 'BR-214',
      docType: fx.docType,
      confidence: fx.confidence,
      piiTypes: fx.piiTypes ?? [],
      clientName: fx.clientName,
      accountId: fx.accountId,
      keepUntil: fx.keepUntil,
      recommendation: fx.recommendation,
      rationale: fx.rationale,
      ruleApplied: fx.rule,
      citation: CITATIONS[fx.rule],
      legalHold: fx.legalHold,
      status: 'PENDING',
    }
    files.set(fx.id, rec)
    pendingFindings.set(fx.id, fx)
    await appendAudit({ actor: 'system:process', action: 'CLASSIFIED', fileId: fx.id, fileHash: sha, ruleApplied: fx.rule, timestamp: rec.uploadedAt })
  }
})()

function mustGet(id: string) {
  const f = files.get(id)
  if (!f) throw new ApiError(404, 'File not found')
  return f
}

function approvalBlocker(f: FileRecord): string | null {
  if (f.legalHold || f.ruleApplied === 'LEGAL_HOLD_OVERRIDE') return 'This file is under a legal hold and cannot be deleted.'
  if (f.status !== 'PENDING') return `This file is already ${f.status.toLowerCase()}.`
  if (f.recommendation === 'RETAIN') return 'This file is still within its retention period.'
  if (f.recommendation === 'REVIEW') return 'This file needs a classification decision before it can be deleted.'
  return null
}

async function approveOne(id: string) {
  const f = mustGet(id)
  const blocker = approvalBlocker(f)
  if (blocker) throw new ApiError(409, blocker)
  f.status = 'QUARANTINED'
  f.s3Key = f.s3Key.replace(/^uploads\//, 'quarantine/')
  await appendAudit({ actor: DEMO_ADVISOR.id, action: 'APPROVED', fileId: id, fileHash: f.sha256, ruleApplied: f.ruleApplied })
  await appendAudit({ actor: 'system:api', action: 'QUARANTINED', fileId: id, fileHash: f.sha256, ruleApplied: f.ruleApplied })
  return clone(f)
}

// Rough filename heuristics so uploads made in mock mode still get a believable classification.
function guessClassification(name: string): Pick<Fixture, 'docType' | 'confidence' | 'recommendation' | 'rule' | 'rationale' | 'keepUntil'> {
  const n = name.toLowerCase()
  const year = Number(n.match(/(20\d\d)/)?.[1] ?? new Date().getFullYear())
  const until = (years: number) => `${year + years}-12-31`
  const expired = (years: number) => new Date(until(years)) < new Date()
  if (/draft|_v\d|_old/.test(n))
    return { docType: 'DRAFT', confidence: 0.9, recommendation: 'DELETE', rule: 'NON_RECORD_DISPOSAL', rationale: 'Working draft; no retention requirement applies.' }
  if (/confirm|trade/.test(n))
    return expired(6)
      ? { docType: 'TRADE_CONFIRMATION', confidence: 0.93, recommendation: 'DELETE', rule: 'SEC_17A4_EXPIRED', keepUntil: until(6), rationale: 'Trade confirmation past its 6-year retention period.' }
      : { docType: 'TRADE_CONFIRMATION', confidence: 0.93, recommendation: 'RETAIN', rule: 'SEC_17A4_ACTIVE', keepUntil: until(6), rationale: 'Trade confirmation within its 6-year retention period.' }
  if (/statement/.test(n))
    return expired(6)
      ? { docType: 'ACCOUNT_STATEMENT', confidence: 0.92, recommendation: 'DELETE', rule: 'SEC_17A4_EXPIRED', keepUntil: until(6), rationale: 'Account statement past its 6-year retention period.' }
      : { docType: 'ACCOUNT_STATEMENT', confidence: 0.92, recommendation: 'RETAIN', rule: 'SEC_17A4_ACTIVE', keepUntil: until(6), rationale: 'Account statement within its 6-year retention period.' }
  if (/email|communication|\.eml$|letter/.test(n))
    return expired(3)
      ? { docType: 'CLIENT_COMMUNICATION', confidence: 0.88, recommendation: 'DELETE', rule: 'SEC_17A4_COMM_EXPIRED', keepUntil: until(3), rationale: 'Client communication past its 3-year retention period.' }
      : { docType: 'CLIENT_COMMUNICATION', confidence: 0.88, recommendation: 'RETAIN', rule: 'SEC_17A4_COMM_ACTIVE', keepUntil: until(3), rationale: 'Client communication within its 3-year retention period.' }
  if (/recipe|vacation|photo|meme|receipt|img_/.test(n))
    return { docType: 'PERSONAL', confidence: 0.84, recommendation: 'DELETE', rule: 'NON_RECORD_DISPOSAL', rationale: 'Personal file; not a business record.' }
  return { docType: 'UNKNOWN', confidence: 0.45, recommendation: 'REVIEW', rule: 'LOW_CONFIDENCE', rationale: 'Could not tell what this document is with enough confidence. A person needs to look at it.' }
}

async function simulateProcess(fileId: string, name: string, size: number) {
  await wait(1500 + Math.random() * 3000)
  const c = guessClassification(name)
  const sha = await sha256Hex(`upload:${fileId}:${name}:${size}`)
  files.set(fileId, {
    fileId,
    s3Key: `uploads/${fileId}/${name}`,
    sha256: sha,
    sizeBytes: size,
    uploadedAt: new Date().toISOString(),
    ownerAdvisorId: DEMO_ADVISOR.id,
    branchId: 'BR-214',
    docType: c.docType,
    confidence: c.confidence,
    piiTypes: [],
    keepUntil: c.keepUntil,
    recommendation: c.recommendation,
    rationale: c.rationale,
    ruleApplied: c.rule,
    citation: CITATIONS[c.rule],
    status: 'PENDING',
  })
  await appendAudit({ actor: 'system:process', action: 'CLASSIFIED', fileId, fileHash: sha, ruleApplied: c.rule })
}

const SCAN_DURATION_MS = 6000

export const mockApi: Api = {
  async uploadUrl(filename) {
    await latency()
    const fileId = crypto.randomUUID().replace(/-/g, '')
    return { fileId, key: `uploads/${fileId}/${filename}`, url: `mock://${fileId}/${encodeURIComponent(filename)}` }
  },

  async putFile(url, file, onProgress) {
    const steps = 6 + Math.floor(Math.random() * 6)
    for (let i = 1; i <= steps; i++) {
      await wait(90 + Math.random() * 120)
      onProgress(i / steps)
    }
    const [, fileId] = url.match(/^mock:\/\/([^/]+)\//) ?? []
    if (fileId) void simulateProcess(fileId, file.name, file.size)
  },

  async listFiles(opts = {}) {
    await ready
    await latency()
    let list = [...files.values()]
    if (opts.status) list = list.filter((f) => f.status === opts.status)
    list.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    return clone(list)
  },

  async getFile(id) {
    await ready
    await latency()
    return clone(mustGet(id))
  },

  async approve(id) {
    await ready
    await latency()
    return approveOne(id)
  },

  async reject(id) {
    await ready
    await latency()
    const f = mustGet(id)
    if (f.status !== 'PENDING') throw new ApiError(409, `This file is already ${f.status.toLowerCase()}.`)
    f.status = 'REJECTED'
    await appendAudit({ actor: DEMO_ADVISOR.id, action: 'REJECTED', fileId: id, fileHash: f.sha256, ruleApplied: f.ruleApplied })
    return clone(f)
  },

  async restore(id) {
    await ready
    await latency()
    const f = mustGet(id)
    if (f.status !== 'QUARANTINED') throw new ApiError(409, 'Only files in the grace period can be restored.')
    f.status = 'PENDING'
    f.s3Key = f.s3Key.replace(/^quarantine\//, 'uploads/')
    await appendAudit({ actor: DEMO_ADVISOR.id, action: 'RESTORED', fileId: id, fileHash: f.sha256, ruleApplied: f.ruleApplied })
    return clone(f)
  },

  async bulkApprove(ids) {
    await ready
    await latency()
    const blocked = ids.map((id) => [id, approvalBlocker(mustGet(id))] as const).filter(([, b]) => b)
    if (blocked.length) {
      throw new ApiError(409, `${blocked.length} of the selected files can't be deleted: ${blocked[0][1]}`)
    }
    const out: FileRecord[] = []
    for (const id of ids) out.push(await approveOne(id))
    return out
  },

  async startScan() {
    await latency()
    scan = { jobId: `macie-${Date.now().toString(36)}`, startedAt: Date.now(), ingested: false }
    return { jobId: scan.jobId }
  },

  async scanStatus() {
    await latency()
    if (!scan) return { jobId: null, state: 'IDLE' }
    return { jobId: scan.jobId, state: Date.now() - scan.startedAt >= SCAN_DURATION_MS ? 'COMPLETE' : 'RUNNING' }
  },

  async ingestScan() {
    await ready
    await latency()
    if (!scan || Date.now() - scan.startedAt < SCAN_DURATION_MS) throw new ApiError(409, 'The scan is still running.')
    let updated = 0
    for (const f of files.values()) {
      const fx = pendingFindings.get(f.fileId)
      const findings = fx?.findings ?? {}
      const fallback = Object.keys(findings).length === 0 && f.piiTypes?.length ? Object.fromEntries(f.piiTypes.map((t) => [t, 1])) : findings
      const { score, priority } = scoreSensitivity(fallback)
      f.macieFindings = findings
      f.sensitivityScore = score
      f.priority = priority
      updated++
      if (priority === 'HIGH' && f.recommendation === 'RETAIN' && f.status === 'PENDING' && !f.legalHold) {
        f.status = 'LOCKED'
        f.s3Key = f.s3Key.replace(/^uploads\//, 'records/')
        f.rationale = `Retain, high sensitivity. ${f.rationale ?? ''}`.trim()
        await appendAudit({ actor: 'system:api', action: 'LOCKED', fileId: f.fileId, fileHash: f.sha256, ruleApplied: f.ruleApplied })
      }
    }
    if (!scan.ingested) await appendAudit({ actor: 'system:api', action: 'SENSITIVITY_SCORED', ruleApplied: 'MACIE_SCAN' })
    scan.ingested = true
    return { updated }
  },

  async dashboard(): Promise<DashboardMetrics> {
    await ready
    await latency()
    const verify = await this.verifyAudit()
    return computeMetrics([...files.values()], verify.ok)
  },

  async audit() {
    await ready
    await latency()
    return clone(audit)
  },

  async verifyAudit() {
    await ready
    let prev = GENESIS
    for (const e of audit) {
      if (e.prevHash !== prev || (await hashBody(e)) !== e.entryHash) return { ok: false, brokenAtSeq: e.seq }
      prev = e.entryHash
    }
    return { ok: true }
  },

  async certificate() {
    await ready
    await latency()
    const disposed = [...files.values()].filter((f) => f.status === 'QUARANTINED' || f.status === 'PURGED')
    const head = audit[audit.length - 1]?.entryHash ?? GENESIS
    const lines = [
      'CERTIFICATE OF DISPOSAL (mock preview; the real one is a PDF from /certificate)',
      `Advisor: ${DEMO_ADVISOR.name} (${DEMO_ADVISOR.id}), ${DEMO_ADVISOR.branch}`,
      `Generated: ${new Date().toISOString()}`,
      `Audit chain head: ${head}`,
      '',
      ...disposed.flatMap((f) => {
        const approval = audit.find((e) => e.fileId === f.fileId && e.action === 'APPROVED')
        return [
          `File ${f.fileId}  sha256 ${f.sha256}`,
          `  What:    ${f.docType}, ${f.sizeBytes} bytes (content not retained)`,
          `  Why:     ${f.ruleApplied}: ${f.citation}`,
          `  Allowed: no legal hold; retention period over (keep until ${f.keepUntil ?? 'n/a'})`,
          `  Who:     ${approval?.actor ?? 'unknown'}`,
          `  When:    ${approval?.timestamp ?? 'unknown'}`,
          '',
        ]
      }),
      disposed.length ? '' : 'No files have been disposed of yet.',
    ]
    return new Blob([lines.join('\n')], { type: 'text/plain' })
  },

  async tamper() {
    await ready
    if (tampered || audit.length < 3) return
    const seq = Math.ceil(audit.length / 2)
    const entry = audit[seq - 1]
    tampered = { seq, original: clone(entry) }
    // Edit a row in place without re-hashing, like someone changing it in the DynamoDB console.
    audit[seq - 1] = { ...entry, actor: 'unknown', action: entry.action === 'APPROVED' ? 'REJECTED' : 'APPROVED' }
  },

  async repair() {
    if (!tampered) return
    audit[tampered.seq - 1] = tampered.original
    tampered = null
  },
}
