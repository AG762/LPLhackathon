# Task Status

Story IDs are from [STORIES.md](STORIES.md). Each person updates **only their own section** (keeps pushes to `main` conflict-free).
Statuses: ✅ Done · 🟡 In progress · ⬜ Not started. "Planned" means claimed but not started yet.

**Unclaimed:** see "Available for person 4" below. When you take something, move it into your own section.

---

## Available for person 4
_Nobody owns these yet (as of 2026-10-02). Ordered by value to the demo. H is held for the whole team to decide at the end._

| Task | Size | Where to start | Depends on / notes |
|---|---|---|---|
| **H: Pitch & demo** (H.1, H.3, H.4 still open; H.2 + H.5 taken by Aryan): award categories, demo script with timings, backup video | Large | PLAN.md §1–3, §9 (demo script), §12 (risks), §14 (business model) | Can start now. Rehearsal + video need the live app working end to end |
| **End-to-end test in live mode**: upload `data/samples/`, check queue, approve/reject, audit page, certificate; file bugs to owners | Small, ongoing | `frontend/README.md`; switch the sidebar to Live | Needs your forwarded frontend URL in `FrontendOrigin` (ask Arihant to deploy) |

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

| ID | Task | Status | Notes |
|---|---|---|---|
| C.1 | Prompt + Bedrock JSON schema | ✅ Done | Nova Micro (amazon.nova-micro-v1:0) tested, 98% accuracy |
| C.2 | Multi-file text extraction | ✅ Done | Safe reader for .txt, .csv, .json, and binary fallbacks |
| C.3 | S3 event trigger & DynamoDB write | ✅ Done | SHA-256 fingerprinting + item staging; merged to main |
| C.4 | Cached-response fallback | ✅ Done | In-memory cache keyed by SHA-256 for demo resilience |
| C.5 | Error guardrails (corrupt/unknown -> REVIEW) | ✅ Done | Default to UNKNOWN / confidence 0.0 without crashing |
| B.1 | SEC 17a-4 / FINRA retention rules | 🟡 In progress | Claimed; connecting rules engine to classification output |

## Aryan: audit log (E), frontend (F), plus D.3 / D.4 / D.7 / demo reset
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
| F.4 | Approve / reject / bulk-approve / restore; held files blocked | ✅ Done | Reads `legalHold` from `/files`; bulk handles `{approved, blocked}`. Restore + "Purge now" wired to D.3 / D.4 |
| F.5 | Scan button + re-sort animation | ✅ Done | Live mode waits on D.5 |
| F.6 | Live updates (polls `/files` every 3 s) | ✅ Done | |
| F.7 | Dashboard | ✅ Done | Falls back to computing from `/files` until D.6 lands; reference calc in `frontend/src/lib/metrics.ts` |
| F.8 | Audit log view, integrity badge, certificate download | ✅ Done | Certificate button disabled while the check fails |
| D.3 | Restore from quarantine during the grace period | ✅ Done | `POST /files/{id}/restore`. Moves the object to `restored/<id>/<name>` (outside the `uploads/` trigger, so no re-classification), status back to `PENDING`, `RESTORED` audit entry; 409 if not quarantined or the grace period has ended. Approve accepts `restored/` keys. Live check waits on the process handler fix (new uploads aren't classified on `main`) |
| A.8 (part) | Demo reset script: empty the bucket (all versions) + tables, then re-seed | ✅ Done | `python scripts/reset_demo.py` (dry run) then `--yes`. Finds the bucket and tables from the `shredsafe` stack outputs; deletes all versions except `records/` (Object Lock); empties Files + AuditLog, keeps LegalHolds + RetentionRules. Runs `scripts/seed.py` afterwards if A.7 adds it there |
| D.4 | Purge → `PURGED` + audit entry | ✅ Done | `POST /files/{id}/purge` deletes every stored version (uploads/, quarantine/, restored/) and writes a `PURGED` audit entry; before the grace period ends it needs `DemoControls=true` ("Purge now" button in the queue). `POST /files/purge-expired` marks every file past its grace period |
| D.7 | RETAIN + HIGH sensitivity → `records/` with Object Lock, `LOCKED` | ✅ Done | `backend/api/routes/records.py`. `POST /files/lock-sensitive` locks every PENDING file with `recommendation: RETAIN`, `priority: HIGH` and a `keepUntil`, unless it's on a legal hold: copy to `records/`, GOVERNANCE retention until `keepUntil`, status `LOCKED`, `LOCKED` audit entry. **D.5:** call `records.lock_if_needed(file)` after scoring, or hit the route after ingest |
| B.6 | `score_sensitivity()`: Macie counts → score + `HIGH`/`MEDIUM`/`LOW` | ✅ Done | `backend/api/sensitivity.py` (in `api/` because `shared/` isn't packaged into any Lambda). `score_sensitivity({type: count}) -> (score, priority)`; PLAN.md §6 weights; accepts Macie names (`USA_SOCIAL_SECURITY_NUMBER`) and the classifier's short names (`SSN`, `DOB`). **D.5:** call it per file in `/scan/ingest` |
| B.7 | Bedrock `pii_types` fallback score for files Macie can't read | ✅ Done | `sensitivity.score_file(file) -> (score, priority, source)`: Macie findings when present, else `piiTypes` (each type once). **Needs** the process handler to save the classifier's `pii_detected` as `piiTypes` on the Files row (it doesn't yet) |
| G.2 | Macie-friendly high-PII demo files | ✅ Done | `python data/generate_pii.py` writes into `data/samples/`: `2016_Client_List_Export.csv` (50 SSNs + DOB, address, phone), `2018_W9_Forms_Batch.txt` (12 × `SSN: ###-##-####`), `2019_Account_Holder_Export.pdf` (20 account numbers + DOB, text PDF). Seeded, synthetic; expected counts in `EXPECTED_FINDINGS` for G.4. Leaves `data/generate.py` alone |
| G.3 | Legal-hold scenario: one client + files tied to them, matching the seeded hold | ✅ Done | `python data/generate_legal_hold.py`: three Margaret Whitaker files in `data/samples/` (2019 email past retention = the "save", 2021 notes, 2023 statement), each with `Client: Margaret Whitaker`. **A.7:** seed `data/legal_hold.json` into LegalHolds (`CLIENT_NAME` scope, `HOLD-24-01187`). Tested against the real `holds.py` matcher and approve guard |
| G.4 | Expected-results manifest (`data/expected.csv`) | ✅ Done | One row per file in `data/samples/` (11 now): `docType`, `recommendation`, `priority`, `legalHold`, `why`. A test fails if a sample is added without a row, and checks priorities against the generators. Use it to measure classifier accuracy (C.1) and as the demo checklist. **G.1:** add a row for each new file |
| H.2, H.5 | Slide deck + judge Q&A | 🟡 In progress | See the Pitch & demo (H) section |

**Not yet verified live:** everything above is tested locally (65 backend tests + mock mode) but not against the deployed stack. As of the last check the live API still returns 501 for `/audit`, so it needs a redeploy.

**Contracts others depend on**
- Call `audit_log.append(actor, action, file, rule_applied=None, detail=None)` for every state change; it reads `fileId` and `sha256` from `file`.
- Score files with `sensitivity.score_file(file)`; store `sensitivityScore` + `priority` on the row. The process handler should save Bedrock's `pii_detected` list as `piiTypes` so images get a score.
- Frontend reads these `Files` fields beyond the API list above: `docType`, `confidence`, `sensitivityScore`, `priority` (`HIGH|MEDIUM|LOW`), `macieFindings`, `citation`, `sizeBytes`, `sha256`.
- `/dashboard` shape the frontend expects: `DashboardMetrics` in `frontend/src/types.ts`.

## Pitch & demo (H)
_Last updated: 2026-10-02. Rubric: 2026 LPL Financial University Hackathon Team Presentation Rubric. Judges score only what we show working; every team is also judged on Best Use of AWS._

| ID | Task | Owner | Status | Notes |
|---|---|---|---|---|
| H.1 | Open questions: **pick our two award categories**, final name, presentation length | Team | ⬜ Not started | Categories: Startup We'd Buy Tomorrow · Biggest Business Impact · Best Customer Experience · Best Technical Execution (pick two). Length unknown; deck is built for 5 min + backup slides |
| H.2 | Slide deck | Aryan | 🟡 In progress | Covers every rubric section (problem + research, user, solution, features built, demo, value, impact, tech + AWS, close). Real sources: IBM 2025, Veritas Databerg, SEC Reg S-P, LPL Q2 2026 8-K. Category tie-back slide added once H.1 is decided |
| H.3 | Demo script with timings, two dry runs | Unclaimed | ⬜ Not started | Draft script is in the deck's speaker notes. Needs the live app working end to end (redeploy + process handler fix) |
| H.4 | Recorded backup demo video | Unclaimed | ⬜ Not started | Rubric strongly recommends a recorded demo. Record after H.3 |
| H.5 | Judge Q&A cheat sheet | Aryan | 🟡 In progress | Backup Q&A slide in the deck (S3 lifecycle?, AI misclassification, held files, log tampering, data handling) |

