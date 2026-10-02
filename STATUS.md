# Task Status

Story IDs are from [STORIES.md](STORIES.md). Each person updates **only their own section** (keeps pushes to `main` conflict-free).
Statuses: ✅ Done · 🟡 In progress · ⬜ Not started. "Planned" means claimed but not started yet.

**Unclaimed:** anything not listed under a person below. Take it and add it to your section.

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
