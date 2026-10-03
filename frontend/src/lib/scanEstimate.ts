import { mode } from '../api/client'

// How long a sensitive-data scan should take, for the "usually done by…" line under the scan status.
// A Macie one-time job spends most of its time starting up (about 8–10 minutes on our stack, D.5), and each
// file adds a little. The in-browser sample scan takes a few seconds (api/mock.ts SCAN_DURATION_MS).
const MIN_MS = 8 * 60_000
const MAX_MS = 30 * 60_000

export function scanEstimateMs(fileCount: number) {
  if (mode === 'mock') return 6_000
  return Math.min(MAX_MS, Math.max(MIN_MS, 9 * 60_000 + fileCount * 3_000))
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export function scanEta(startedAt: string | null, fileCount: number, now = Date.now()): string {
  const started = startedAt ? Date.parse(startedAt) : NaN
  const expected = scanEstimateMs(fileCount)
  if (Number.isNaN(started)) {
    return mode === 'mock' ? 'Done in a few seconds.' : `Usually takes ${Math.round(expected / 60_000)} minutes or so.`
  }
  const left = started + expected - now
  if (mode === 'mock') return left > 0 ? 'Done in a few seconds.' : 'Finishing up…'
  if (left <= 0) {
    return 'Taking longer than usual. Some scans need up to 30 minutes; you can leave this page and come back.'
  }
  const minutes = Math.ceil(left / 60_000)
  return minutes <= 1
    ? `Almost done, expected by ${clock(started + expected)}.`
    : `Expected by ${clock(started + expected)}, about ${minutes} minutes from now. You can leave this page.`
}
