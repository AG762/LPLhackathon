# ShredSafe frontend (Track F)

React + TypeScript + Vite. Four screens: review queue, upload, dashboard, audit log.

## Run it

```bash
cd frontend
npm install
cp .env.example .env.local   # sets VITE_API_URL to the api Lambda Function URL
npm run dev                  # http://localhost:5173 (the port the backend's CORS allows)
```

## Demo data vs. live API

The sidebar has a **Data source** switch:

- **Demo** runs an in-browser mock of the whole API (`src/api/mock.ts`): 16 sample files, a
  6-second fake Macie scan, approve/reject/restore with the same 409 guard the backend uses,
  and a real SHA-256 hash chain so the tamper demo can be rehearsed. Reloading the page resets it.
- **Live API** calls `VITE_API_URL`. Routes the backend hasn't built yet return 501 and the UI
  says so. The dashboard falls back to computing its numbers from `/files`.

The default comes from `VITE_API_MODE` in `.env.local`; the switch overrides it per browser.

## What the frontend expects from the backend

The HTTP contract is STORIES.md 0.4, and the types are in `src/types.ts`. A few things aren't
pinned down in PLAN.md yet, so here's what the UI reads:

| Field / route | Used for |
|---|---|
| `File.ruleApplied`, `File.citation` | "Why" panel on each row. `ruleApplied === 'LEGAL_HOLD_OVERRIDE'` (or `legalHold: true`) marks a held file. |
| `File.clientName` | Shown in the legal-hold note ("Margaret Whitaker is under an active hold") |
| `File.s3Key` | The file name is the last path segment |
| `POST /files/{id}/approve` → 409 `{error}` | The error text is shown to the user, so keep it readable |
| `GET /scan/status` → `{jobId, state}` | `state` is `IDLE`, `RUNNING`, `COMPLETE` or `FAILED`. On `COMPLETE` the UI calls `POST /scan/ingest` |
| `GET /dashboard` | The shape is `DashboardMetrics` in `src/types.ts`. `src/lib/metrics.ts` is the reference calculation |
| `GET /certificate` | Any blob. A `application/pdf` content type downloads as `.pdf` |

## Layout

```
src/
  api/       client.ts (live client + mode switch), mock.ts (demo backend), errors.ts
  state/     files.tsx (polls /files every 3 s), toast.tsx
  pages/     Queue, Upload, Dashboard, Audit (+ a CSS file each)
  lib/       format.ts (labels, dates, hold/approve rules), metrics.ts
  types.ts   frontend copy of PLAN.md §8
```
