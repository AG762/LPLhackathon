# Task Status

Story IDs are from [STORIES.md](STORIES.md). Each person updates **only their own section** (keeps pushes to `main` conflict-free).
Statuses: ✅ Done · 🟡 In progress · ⬜ Not started. "Planned" means claimed but not started yet.

**Unclaimed:** see "Available for person 4" below. When you take something, move it into your own section.

---

## Available for person 4
_Nobody owns these yet (as of 2026-10-02). Ordered by value to the demo. H is held for the whole team to decide at the end._

| Task | Size | Where to start | Depends on / notes |
|---|---|---|---|
| **H: Pitch & demo** (H.1–H.5): slides, demo script with timings, backup video, judge Q&A sheet | Large | PLAN.md §1–3, §9 (demo script), §12 (risks), §14 (business model) | Can start now. Rehearsal + video need the live app working end to end |
| **End-to-end test in live mode**: upload `data/samples/`, check queue, approve/reject, audit page, certificate; file bugs to owners | Small, ongoing | `frontend/README.md`; switch the sidebar to Live | Needs your forwarded frontend URL in `FrontendOrigin` (ask Arihant to deploy) |
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

## Aryan: audit log (E) + frontend (F)
_Last updated: 2026-10-02_

| ID | Task | Status | Notes |
|---|---|---|---|
| E.1 | `append_audit()`: hash-chained entries, safe against concurrent writers | ✅ Done | `backend/api/audit_log.py`. `entryHash = sha256(prevHash + canonical entry)`; conditional put on `seq` + retry; strongly consistent scans |
| E.2 | `verify_chain()` + `/audit` and `/audit/verify` | ✅ Done | Returns `{ok}` or `{ok: false, brokenAtSeq}` |
| E.3 | Tamper demo + restore for rehearsals | ✅ Done | `POST /audit/demo/tamper` and `/audit/demo/restore`, 404 unless `DemoControls=true` (set in `samconfig.toml` for the demo stack) |
| E.4 | Certificate of Disposal PDF | ✅ Done | `GET /certificate?from=&to=`; 409 while the integrity check fails; no new dependencies |
| F.1 | App shell, routing, mock/live API toggle, demo advisor | ✅ Done | `cd frontend && npm run dev`; sidebar switches Demo ↔ Live API |
| F.2 | Folder drag-and-drop upload with per-file progress | ✅ Done | Presigned PUTs, 4 at a time |
| F.3 | Review queue sorted by exposure, rationale + rule on expand | ✅ Done | |
| F.4 | Approve / reject / bulk-approve / restore; held files blocked | ✅ Done | Reads `legalHold` from `/files`; bulk handles `{approved, blocked}`. Restore waits on D.3 |
| F.5 | Scan button + re-sort animation | ✅ Done | Live mode waits on D.5 |
| F.6 | Live updates (polls `/files` every 3 s) | ✅ Done | |
| F.7 | Dashboard | ✅ Done | Falls back to computing from `/files` until D.6 lands; reference calc in `frontend/src/lib/metrics.ts` |
| F.8 | Audit log view, integrity badge, certificate download | ✅ Done | Certificate button disabled while the check fails |

| D.3 | Restore from quarantine during the grace period | ✅ Done | `POST /files/{id}/restore`. Moves the object to `restored/<id>/<name>` (outside the `uploads/` trigger, so no re-classification), status back to `PENDING`, `RESTORED` audit entry; 409 if not quarantined or the grace period has ended. Approve accepts `restored/` keys. Live check waits on the process handler fix (new uploads aren't classified on `main`) |

| A.8 (part) | Demo reset script: empty the bucket (all versions) + tables, then re-seed | ✅ Done | `python scripts/reset_demo.py` (dry run) then `--yes`. Finds the bucket and tables from the `shredsafe` stack outputs; deletes all versions except `records/` (Object Lock); empties Files + AuditLog, keeps LegalHolds + RetentionRules. Runs `scripts/seed.py` afterwards if A.7 adds it there |

| D.4 | Purge → `PURGED` + audit entry | 🟡 In progress | "Purge now" demo route + a sweep that marks files whose grace period ended |

**Not yet verified live:** E and F are tested locally (backend tests + mock mode) but not against the deployed stack. Needs a redeploy with the E changes.

**Contracts others depend on**
- Call `audit_log.append(actor, action, file, rule_applied=None, detail=None)` for every state change; it reads `fileId` and `sha256` from `file`.
- Frontend reads these `Files` fields beyond the API list above: `docType`, `confidence`, `sensitivityScore`, `priority` (`HIGH|MEDIUM|LOW`), `macieFindings`, `citation`, `sizeBytes`, `sha256`.
- `/dashboard` shape the frontend expects: `DashboardMetrics` in `frontend/src/types.ts`.

## Pitch & demo (H)
_Unclaimed._
