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
| A.7 | Seed script: retention rules + demo legal hold | ✅ Done | `python scripts/seed.py` (`--dry-run`, `--prune`). Data in `config/retention_rules.json` + `config/legal_holds.json`; demo hold `H-DEMO-1` = CLIENT_NAME "Arthur Smith" (matches `2020_Client_Communication_Smith.txt`, not Jane Smith) plus Aryan's G.3 hold from `data/legal_hold.json` (Margaret Whitaker). `reset_demo.py --yes` re-runs it |
| A.8 | One-command deploy / teardown / frontend hosting | 🟡 In progress | `sam build && sam deploy` works. Reset script done by Aryan. Online VS Code: `cd frontend && npm run online` |
| D.1 | Router, `/upload-url`, `/files`, `/files/{id}` | ✅ Done | `/files` also returns `legalHold`/`holdId`/`holdReason` |
| D.2 | Approve / reject / bulk-approve with server-side guards | ✅ Done | Hold / RETAIN / `keepUntil` → 409; bulk returns `{approved, blocked}` |
| D.3 | Restore from quarantine | ✅ Done (Aryan) | See Aryan's section |
| D.4 | Purge → `PURGED` + audit entry | ✅ Done (Aryan) | See Aryan's section |
| D.5 | Macie scan / status / ingest → sensitivity score | ✅ Done (needs live run) | `POST /scan` starts a ONE_TIME job (all managed identifiers, so NAME/ADDRESS count); `GET /scan/status` reads the newest `<bucket>-*` job; `POST /scan/ingest` saves `macieFindings`, `sensitivityScore`, `priority`, `scoreSource` via `sensitivity.score_file`, then `records.lock_if_needed` (D.7). Files uploaded after the job started are skipped until the next scan. **Run a scan well before the demo (minutes).** Classifier fallback (B.7) needs `process` to save `piiTypes` |
| D.6 | `/dashboard` metrics | ✅ Done (PR #15) | Same numbers as `frontend/src/lib/metrics.ts`; `chainOk` re-verifies the audit log on each load, plus `brokenAtSeq` when broken |
| Login | Cognito sign-in end to end + workspaces ([docs/login.md](docs/login.md)) | 🟡 Testing on stack `shredsafe-login` | Branch `arihant-login`: user pool + self sign-up (creates a workspace), ID-token check in the API, **per-workspace visibility** (files, holds, audit, dashboard, certificate, scans), `platform` role for system routes, Aryan's F.16 pages connected. Off by default (`AuthRequired=false`). Admin-panel routes (invites) still to build |
| D.7 | RETAIN + HIGH sensitivity → `records/` (LOCKED) | ✅ Done (Aryan) | See Aryan's section |
| — | Merged `anwesh/process` into `main` + fixed `process` wiring | ✅ Done | Handler name, imports, `fileId` from key, URL-decoded keys |
| — | Re-fixed `process` after merge `b640268` | ✅ Done | That merge restored `from backend.process...` (Lambda import crash → uploads not classified) and `fileId = filename`. `test_process.py` now loads the handler like Lambda does, so this can't regress silently |

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
| B.1 | SEC 17a-4 / FINRA retention rules | ✅ Done | SEC 17a-4(b/c) 3yr/6yr schedules with keepUntil date arithmetic |
| B.2 | Multi-attribute legal hold matching | ✅ Done | Matches on CLIENT_NAME, CLIENT_ID, ACCOUNT_ID, BRANCH_ID, KEYWORD |
| B.3 | Legal hold override | ✅ Done | Strict override sets recommendation to RETAIN and keepUntil to 9999-12-31 |
| B.4 | Defensible disposal of non-records | ✅ Done | Immediate DELETE recommendation for drafts, personal, and duplicate files |

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
| D.3 | Restore from quarantine during the grace period | ✅ Done | `POST /files/{id}/restore`. Moves the object to `restored/<id>/<name>` (outside the `uploads/` trigger, so no re-classification), status back to `PENDING`, `RESTORED` audit entry; 409 if not quarantined or the grace period has ended. Approve accepts `restored/` keys. Process handler fix landed in PR #5, so it can be checked live after the next deploy |
| A.8 (part) | Demo reset script: empty the bucket (all versions) + tables, then re-seed | ✅ Done | `python scripts/reset_demo.py` (dry run) then `--yes`. Finds the bucket and tables from the `shredsafe` stack outputs; deletes all versions except `records/` (Object Lock); empties Files + AuditLog, keeps LegalHolds + RetentionRules. Runs `scripts/seed.py` afterwards if A.7 adds it there |
| D.4 | Purge → `PURGED` + audit entry | ✅ Done | `POST /files/{id}/purge` deletes every stored version (uploads/, quarantine/, restored/) and writes a `PURGED` audit entry; before the grace period ends it needs `DemoControls=true` ("Purge now" button in the queue). `POST /files/purge-expired` marks every file past its grace period. **Live fix merged (PR #19: IAM version list/delete), needs deploy** |
| D.7 | RETAIN + HIGH sensitivity → `records/` with Object Lock, `LOCKED` | ✅ Done | `backend/api/routes/records.py`. `POST /files/lock-sensitive` locks every PENDING file with `recommendation: RETAIN`, `priority: HIGH` and a `keepUntil`, unless it's on a legal hold: copy to `records/`, GOVERNANCE retention until `keepUntil`, status `LOCKED`, `LOCKED` audit entry. **D.5:** call `records.lock_if_needed(file)` after scoring, or hit the route after ingest |
| B.6 | `score_sensitivity()`: Macie counts → score + `HIGH`/`MEDIUM`/`LOW` | ✅ Done | `backend/api/sensitivity.py` (in `api/` because `shared/` isn't packaged into any Lambda). `score_sensitivity({type: count}) -> (score, priority)`; PLAN.md §6 weights; accepts Macie names (`USA_SOCIAL_SECURITY_NUMBER`) and the classifier's short names (`SSN`, `DOB`). **D.5:** call it per file in `/scan/ingest` |
| B.7 | Bedrock `pii_types` fallback score for files Macie can't read | ✅ Done | `sensitivity.score_file(file) -> (score, priority, source)`: Macie findings when present, else `piiTypes` (each type once). **Needs** the process handler to save the classifier's `pii_detected` as `piiTypes` on the Files row (it doesn't yet) |
| G.2 | Macie-friendly high-PII demo files | ✅ Done | `python data/generate_pii.py` writes into `data/samples/`: `2016_Client_List_Export.csv` (50 SSNs + DOB, address, phone), `2018_W9_Forms_Batch.txt` (12 × `SSN: ###-##-####`), `2019_Account_Holder_Export.pdf` (20 account numbers + DOB, text PDF). Seeded, synthetic; expected counts in `EXPECTED_FINDINGS` for G.4. Leaves `data/generate.py` alone |
| G.3 | Legal-hold scenario: one client + files tied to them, matching the seeded hold | ✅ Done | `python data/generate_legal_hold.py`: three Margaret Whitaker files in `data/samples/` (2019 email past retention = the "save", 2021 notes, 2023 statement), each with `Client: Margaret Whitaker`. **A.7:** seed `data/legal_hold.json` into LegalHolds (`CLIENT_NAME` scope, `HOLD-24-01187`). Tested against the real `holds.py` matcher and approve guard |
| G.4 | Expected-results manifest (`data/expected.csv`) | ✅ Done | One row per file in `data/samples/` (11 now): `docType`, `recommendation`, `priority`, `legalHold`, `why`. A test fails if a sample is added without a row, checks priorities against the generators, and checks the legal-hold column against the holds `scripts/seed.py` loads (Arthur Smith + Margaret Whitaker). Use it to measure classifier accuracy (C.1) and as the demo checklist. **G.1:** add a row for each new file |
| H.2, H.5 | Slide deck + judge Q&A | 🟡 In progress | See the Pitch & demo (H) section |
| — | End-to-end test in live mode | ✅ First run done | `python scripts/e2e_live.py --api <url>`. Live run: 69 pass, 7 fail. **Works:** upload → classify (11/11), seeded legal holds block approval (409), approve / restore / re-approve / reject, audit log + integrity check, certificate PDF. **Found + fixed:** browser uploads 403 (SigV2 presign) → SigV4, needs redeploy. **Open (process handler, Anwesh):** `EXPIRED_PII` is recommended RETAIN instead of DELETE (2016 + 2017 client lists); W-9 batch classified PERSONAL; account export PDF classified ACCOUNT_STATEMENT/RETAIN; potluck recipes UNKNOWN/REVIEW. The handler's own if/else decides instead of the rules engine (B.1/B.2) |
| F.9 | Frontend works behind the online VS Code proxy (`/ports/5173/`) | ✅ Done (PR #8, needs deploy) | Router now reads `VITE_ROUTER_BASE` (set by `npm run online`); checked a `--base ./` build served under `/ports/5173/`: pages load, nav links carry the prefix, fonts load. `npm run dev` unchanged |
| B.2 | Wire the rules engine (B.1) into the process Lambda | ✅ Done (PR #10, needs deploy) | Handler calls `evaluate_retention` (copy in `backend/process/rules.py`, a test keeps it identical to `shared/`), reads live LegalHolds, writes `keepUntil`, `ruleApplied`, `piiTypes`, omits `N/A`. Engine gains `EXPIRED_PII` → DELETE (Reg S-P) and `MARKETING` 5-year. 141 tests pass. Needs a deploy |
| G.1 | Rest of the demo dataset (42 files total) | ✅ Done (PR #11, needs deploy) | `python data/generate_more.py`: 31 more synthetic files (statements, confirms, drafts + finals, duplicates, emails, marketing, image scans, personal). Every file has a row in `data/expected.csv` |
| F.10 | Scan button applies an already-finished Macie scan instantly | ✅ Done (PR #13, needs deploy) | On load the queue checks `/scan/status`; a COMPLETE job with no scored files shows **Show sensitive-data results**, which ingests it directly (re-sort + Up-N markers). Checked in demo mode |
| F.11 | Only offer "Show sensitive-data results" for a scan newer than the files | ✅ Done (PR #16; workshop needs git pull + npm run online) | Button offers a finished scan only if it started at or after the newest upload; otherwise it starts a new scan. Checked against live data |
| F.12 | Clearer Demo / Live API switch in the sidebar | ✅ Done (PR #18; workshop needs git pull + npm run online) | Selected option is solid white with a filled dot, the other is faded with a hollow dot, plus a "Showing live / demo data" line |
| F.12b | Selected data-source dot turns green | ⚪ Superseded by F.14 (PR #21 closed) | Solid green dot with a soft ring on the selected option, so it's clear which source is in use |
| F.13 | Product home page at `/` (startup sales page with shredder hero, "Try it" opens the portal) | ✅ Done (PR #22) | Logo links to `/`; review queue moves to `/queue`. Pricing number still needed from the team |
| F.14 | Restyle the portal (queue, upload, dashboard, audit) to match the new home page | ✅ Done (PR #22) | Monochrome ink + silver, Geist, pill buttons; safety-sign colours removed |
| F.15 | Admin panel (`/admin`): team and roles, invites, legal holds, retention rules | ✅ Done (PR #23; live admin routes proposed in docs/admin-api.md) | Frontend only, works in Demo mode. Live needs admin API routes (not built; proposed in the PR). Sign-in/sign-up itself is Arihant's (`arihant-login`), not redone here |
| F.16 | Sign in / sign up / forgot password pages (UI only) | ✅ Done (PR #24; connected to Cognito by Arihant in PR #26) | Our own screens at /signin, /signup, /forgot. Calls go through one adapter (`src/auth/accountApi.ts`) that pretends in Demo mode; connecting it to Cognito is for the login owner (Arihant) |
| F.17 | Launch-ready copy pass over the whole site (home, sign-in, portal, admin) | ✅ Done (PR #25) | Wording only: no hackathon/dev notes in the UI, consistent terms, honest claims |
| F.18 | Admin page checks the role itself (advisors could open /admin) | 🔵 In review (PR #27) | People tab admin-only; compliance keeps holds + rules. Script side reported to Arihant |
| D.8 | Admin API for the Admin page: `/rules`, `/holds` (place, release), `/admin/users` (invite, role, access), scoped to the caller's workspace | 🔵 In review (PR #28, needs deploy) | Per docs/admin-api.md. For Arihant to review + deploy (touches handler routes, template IAM). Not merging myself |
| F.19 | Start the sensitive-data scan automatically when an upload batch finishes, with a time estimate under the scan status | 🔵 In review (PR #29) | Skips if a scan is already running |
| D.9 | Email each uploader when their files are scanned and ready for review (Amazon SES, scheduled) | 🔵 In review (PRs #30 + #35, needs deploy + SES setup) | Off until NotifyFrom is set. Setup: `python scripts/setup_notifications.py --from … --to …`, everyone clicks the SES link, then deploy (docs/notifications.md). Preview: docs/email-preview.html |
| F.20 | Review queue search + recommendation filter; bulk approve in batches of 100 | 🔵 In review (PR #31) | `/` focuses search |
| F.21 | Place a legal hold from a file in the queue (P2); export the audit log as CSV (P3); feature proposals P2–P9 | 🔵 In review (PR #32) | See docs/feature-proposals.md for must-haves |
| F.22 | Account page: name, password, sign out on every device (P5) | 🔵 In review (PR #33) | Two-step sign-in waits for the sign-in code step (joint with Arihant) |
| G.5 | Load-test generator + measured 1,000-file run; faster queue search at volume | 🔵 In review (PR #34) | docs/load-testing.md. Practical limit today ~1–2k files per workspace (6 MB /files response); P7 to scale |
| F.23 | Fixes from the full QA pass: portal (auto-scan timing, toast over bulk bar, purge confirm, dashboard flash, 1024px queue, mobile admin table, hovers, focus, forms, titles) | ✅ Done (PR #36) | Home-page items go to the home polish branch |
| F.24 | Home page: lit product-shot hero (machined shredder, glass bin), no load freeze, nav + section polish | ✅ Done (PR #37) | Researched on 21st.dev + Awwwards. 3D still lazy-loaded |
| F.25 | Auto-scan on the server: starts the sensitive-data scan once uploads settle, even if nobody keeps the Upload page open | ✅ Done (PR #38) | Runs every 2 min; leaves cancelled scans to a person |
| — | `docs/feature-proposals.md` (P1: scan only new or changed files) | ✅ Merged (PR #17) | Team to set the Decision column; mark ✅ there if built |

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
| H.3 | Demo script with timings, two dry runs | Aryan | 🟡 Script merged (PR #12); dry runs open | `docs/demo-script.md`: T-60 setup (reset, seed, pre-upload, pre-run the Macie scan), T-10 preflight, the five minutes with clicks + lines + timings, fallbacks, dry-run log. Dry runs need the team + live app |
| H.4 | Recorded backup demo video | Unclaimed | ⬜ Not started | Rubric strongly recommends a recorded demo. Record after H.3 |
| H.5 | Judge Q&A cheat sheet | Aryan | 🟡 In progress | Backup Q&A slide in the deck (S3 lifecycle?, AI misclassification, held files, log tampering, data handling) |

