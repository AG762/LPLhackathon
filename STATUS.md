# Task Status

Story IDs are from [STORIES.md](STORIES.md). Each person updates **only their own section** (keeps pushes to `main` conflict-free).
Statuses: ✅ Done · 🟡 In progress · ⬜ Not started. "Planned" means claimed but not started yet.

**Unclaimed:** see "Available for person 4" below. When you take something, move it into your own section.

---

## Available for person 4
_Nobody owns these yet (as of 2026-10-02). Ordered by value to the demo._

| Task | Size | Where to start | Depends on / notes |
|---|---|---|---|
| **H: Pitch & demo** (H.1–H.5): slides, demo script with timings, backup video, judge Q&A sheet | Large | PLAN.md §1–3, §9 (demo script), §12 (risks), §14 (business model) | Can start now. Rehearsal + video need the live app working end to end |
| **End-to-end test in live mode**: upload `data/samples/`, check queue, approve/reject, audit page, certificate; file bugs to owners | Small, ongoing | `frontend/README.md`; switch the sidebar to Live | Needs your forwarded frontend URL in `FrontendOrigin` (ask Arihant to deploy) |
| **Demo reset script** (rest of A.8): empty the bucket (all versions) + tables, then re-seed, for rehearsals | Small | new `scripts/reset_demo.py` | Re-seed calls Arihant's A.7 seed script. Don't touch `records/` (Object Lock) |
| **D.3 Restore** from quarantine during grace period | Small | `backend/api/routes/disposal.py` → `restore()` (frontend already calls it) | Decide first: copying back to `uploads/` re-triggers `process`. Suggest `process` skips a `fileId` that already has a row |
| **D.4 Purge**: mark `PURGED` + audit entry when a quarantined file is deleted | Medium | `disposal.py` + `infra/template.yaml` | Either an S3 `LifecycleExpiration` event → Lambda, or a "Purge now" demo route (simpler) |
| **D.7 Locked records**: RETAIN + HIGH sensitivity → copy to `records/` with Object Lock retention, status `LOCKED` | Medium | `backend/api/routes/` | Needs `priority` from D.5 (Arihant). Can build against a hand-set `priority: HIGH` row |

Conventions: branch from `main`, open a PR, Arihant merges + deploys. Backend tests: `cd backend && python -m pytest -q`.
Stretch items (PLAN.md §5: near-duplicate detection, NL policy authoring, compliance-officer view, ask-the-auditor chat) only after the demo works end to end.

---

## Arihant: infra (A) + API (D)
_Last updated: 2026-10-02_

| ID | Task | Status | Notes |
|---|---|---|---|
| A.1 | Account setup: region, Bedrock access, Macie | ✅ Done | `us-east-1`; Bedrock + Macie checks pass. Billing alarm not confirmed. |
| A.2 | S3 bucket (`uploads/`, `quarantine/`, `records/`), CORS | ✅ Done | CORS origin is the `FrontendOrigin` parameter |
| A.3 | Lifecycle purge of `quarantine/` | ✅ Done | `QuarantineDays` (default 1) + cleanup of old versions |
| A.4 | Object Lock on bucket | ✅ Done | Enabled at creation; per-object retention is D.7 |
| A.5 | DynamoDB tables (Files, RetentionRules, LegalHolds, AuditLog) | ✅ Done | |
| A.6 | `process` + `api` Lambdas, S3 trigger, Function URL, IAM | ✅ Done | Deployed as stack `shredsafe` |
| A.7 | Seed script: retention rules + demo legal hold | ⬜ Not started | Planned: Arihant (next) |
| A.8 | One-command deploy / teardown / frontend hosting | 🟡 In progress | `sam build && sam deploy` works. No teardown script; frontend runs via `npm run dev` |
| D.1 | Router, `/upload-url`, `/files`, `/files/{id}` | ✅ Done | `/files` also returns `legalHold`/`holdId`/`holdReason` |
| D.2 | Approve / reject / bulk-approve with server-side guards | ✅ Done | Hold / RETAIN / `keepUntil` → 409; bulk returns `{approved, blocked}` |
| D.3 | Restore from quarantine | ⬜ Not started | Unclaimed. Needs decision: restoring to `uploads/` re-triggers `process` |
| D.4 | Purge → `PURGED` + audit entry | ⬜ Not started | Unclaimed |
| D.5 | Macie scan / status / ingest → sensitivity score | ⬜ Not started | Planned: Arihant (after A.7) |
| D.6 | `/dashboard` metrics | ⬜ Not started | Planned: Arihant (after D.5) |
| D.7 | RETAIN + HIGH sensitivity → `records/` (LOCKED) | ⬜ Not started | Unclaimed. Depends on D.5 |
| — | Merged `anwesh/process` into `main` + fixed `process` wiring | ✅ Done | Handler name, imports, `fileId` from key, URL-decoded keys |

**Contracts others depend on**
- `Files` row fields the API reads: `s3Key`, `status` (`PENDING`), `recommendation`, `keepUntil` (`YYYY-MM-DD`), `ruleApplied`, `rationale`, and `clientName` / `clientId` / `accountId` / `branchId` when known (omit instead of `"N/A"`).
- `LegalHolds` item: `{holdId, scopeType: CLIENT_NAME|CLIENT_ID|ACCOUNT_ID|BRANCH_ID|KEYWORD, scopeValue, reason, active}`.
- Deploy params live in `infra/samconfig.toml` (`parameter_overrides`); CLI `--parameter-overrides` replaces them, so edit the file instead.

---

## Anwesh: classification (C), rules (B), dataset (G)
_Owner to fill in._

## Audit log (E)
_Owner to fill in. E.1–E.4 are merged to `main`._

## Frontend (F)
_Owner to fill in._

## Pitch & demo (H)
_Unclaimed._
