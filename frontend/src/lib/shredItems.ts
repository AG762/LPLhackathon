import type { FileRecord } from '../types'
import { docTypeLabel, fileName, formatDate, isOnHold } from './format'

// What the home page shredder shows for each file: the same decision the portal gives it.

export type Outcome = 'shred' | 'hold' | 'keep' | 'review'

export interface ShredItem {
  id: string
  name: string
  kind: string
  client?: string
  outcome: Outcome
  reason: string
  stamp?: string
}

export function toItem(f: FileRecord): ShredItem | null {
  const base = { id: f.fileId, name: fileName(f), kind: docTypeLabel(f.docType), client: f.clientName }
  if (isOnHold(f)) return { ...base, outcome: 'hold', reason: f.holdReason ?? (f.clientName ? `Legal hold on ${f.clientName}` : 'Legal hold on this client') }
  if (f.recommendation === 'DELETE') {
    const reason = f.keepUntil ? `Keep-until date ${formatDate(f.keepUntil)} has passed` : 'No rule requires keeping it'
    return { ...base, outcome: 'shred', reason }
  }
  if (f.recommendation === 'RETAIN') {
    const until = f.keepUntil ? formatDate(f.keepUntil) : undefined
    return { ...base, outcome: 'keep', reason: until ? `Required record, keep until ${until}` : 'Required record', stamp: until ? `Keep until ${until}` : 'Keep' }
  }
  if (f.recommendation === 'REVIEW') return { ...base, outcome: 'review', reason: 'Not clear-cut, so an advisor decides', stamp: 'Needs review' }
  return null
}

// Interleave outcomes so the loop tells the story early: a deletion, a kept record, then the hold.
const PATTERN: Outcome[] = ['shred', 'keep', 'hold', 'shred', 'review', 'shred', 'hold', 'keep', 'shred']

export function pickItems(files: FileRecord[]): ShredItem[] {
  const buckets: Record<Outcome, ShredItem[]> = { shred: [], hold: [], keep: [], review: [] }
  for (const f of files) {
    const item = toItem(f)
    if (item) buckets[item.outcome].push(item)
  }
  const picked = PATTERN.map((o) => buckets[o].shift()).filter((i): i is ShredItem => Boolean(i))
  return picked.length >= 4 ? picked : SAMPLE_ITEMS
}

// Used when there is no data yet (or the API can't be reached). Names match data/samples/.
const SAMPLE_ITEMS: ShredItem[] = [
  { id: 's1', name: 'Fantasy_Football_Draft_2023.txt', kind: 'Personal', outcome: 'shred', reason: 'Not a business record' },
  { id: 's2', name: 'Trade_Confirm_NVDA_2025_04.txt', kind: 'Trade confirmation', outcome: 'keep', reason: 'Required record, keep until Apr 30, 2031', stamp: 'Keep until Apr 30, 2031' },
  { id: 's3', name: 'Statement_Okafor_2017_03.txt', kind: 'Account statement', client: 'Adaeze Okafor', outcome: 'hold', reason: 'Okafor arbitration: legal hold' },
  { id: 's4', name: 'Q3_Financial_Plan_Proposal_v1_draft.txt', kind: 'Draft', outcome: 'shred', reason: 'Superseded by the final version' },
  { id: 's5', name: 'Market_Outlook_2026.txt', kind: 'Unclassified', outcome: 'review', reason: 'Not clear-cut, so an advisor decides', stamp: 'Needs review' },
  { id: 's6', name: 'W9_Scan_Chen_2017.png', kind: 'Expired personal data', client: 'Wei Chen', outcome: 'shred', reason: 'Expired SSN copy, disposed under Reg S-P' },
  { id: 's7', name: 'Newsletter_Spring_2019 (copy).txt', kind: 'Duplicate copy', outcome: 'shred', reason: 'Exact copy of a file already kept' },
]

export const VERDICT: Record<Outcome, string> = {
  shred: 'Cleared to delete',
  hold: 'Stopped',
  keep: 'Kept',
  review: 'Sent for review',
}

