# ShredSafe: Work Breakdown (parallel stories)

> Derived from [PLAN.md](PLAN.md). Stories are grouped into **tracks** that one person can own end to end.
> Everyone can start at the same time once **Story 0 (contracts)** is merged, because every track codes against those contracts and uses stubs/fixtures until the real pieces land.

---

## How to use this

- **Owner:** put your name next to a track. Each track is sized for one person; with fewer people, merge tracks (suggested pairings at the bottom).
- **IDs:** `T<track>.<n>`, e.g. `B.2`. Reference the ID in branch names and commits (`b2-rules-engine`).
- **Depends on:** a story only blocks on the listed IDs. Anything marked *(stub OK)* can be built against a fake until the dependency is ready.
- **Done means:** acceptance criteria pass and it's merged to `main`.

### Tracks at a glance

| Track | Theme | Owner | Can start |
|---|---|---|---|
| **0** | Shared contracts (everyone, 30–45 min) | all | now |
| **A** | AWS infra & deployment | | after 0 |
| **B** | Decision core: rules engine, legal holds, sensitivity score (pure code, no AWS) | | after 0 |
| **C** | `process` Lambda: Bedrock classification pipeline | | after 0 |
| **D** | `api` Lambda: endpoints, Macie scan, disposal flow | | after 0 |
| **E** | Audit log & Certificate of Disposal | | after 0 |
| **F** | React frontend | | after 0 |
| **G** | Synthetic demo dataset | | **now** |
| **H** | Pitch, demo script, backup video | | **now** |

---

## Story 0: Shared contracts (do together, first)

Goal: freeze the interfaces so the tracks below don't block each other.

**0.1 Repo skeleton**
- `/frontend`, `/backend/process`, `/backend/api`, `/backend/shared`, `/infra`, `/data`, `/docs`
- Agree on language for Lambdas (suggest Python 3.12 + boto3) and IaC tool (SAM or CDK).
- AC: skeleton committed; README says how to run each piece.

**0.2 Data model** → `backend/shared/models` (+ a TypeScript copy in `frontend/src/types.ts`)
- Copy the 4 tables from PLAN.md §8 into code: `File`, `RetentionRule`, `LegalHold`, `AuditEntry`.
- Freeze enums: `recommendation = DELETE | RETAIN | REVIEW`, `status = PENDING | APPROVED | REJECTED | QUARANTINED | PURGED | LOCKED`, `priority = HIGH | MEDIUM | LOW`, and the `docType` list from §6.
- AC: one example JSON per type checked into `backend/shared/fixtures/`.

**0.3 Function signatures for shared modules** (bodies can be `raise NotImplementedError`)
```
classify(file_bytes, filename) -> Classification        # Track C
decide(classification, file, rules, holds, now) -> Decision  # Track B
score_sensitivity(macie_findings) -> (score, priority)  # Track B
append_audit(actor, action, file, rule_applied) -> AuditEntry  # Track E
verify_chain() -> {ok, broken_at_seq?}                  # Track E
```

**0.4 HTTP API contract** → `docs/api.md` (single Lambda Function URL, routed by path)

| Method | Path | Returns |
|---|---|---|
| POST | `/upload-url` `{filename}` | `{fileId, url}` presigned PUT |
| GET | `/files?status=&sort=priority` | `File[]` |
| GET | `/files/{id}` | `File` |
| POST | `/files/{id}/approve` · `/reject` · `/restore` | `File` |
| POST | `/files/bulk-approve` `{ids[]}` | `File[]` |
| POST | `/scan` | `{jobId}` (starts Macie job) |
| GET | `/scan/status` | `{jobId, state}` |
| POST | `/scan/ingest` | `{updated: n}` (pull findings → scores) |
| GET | `/dashboard` | metrics object (§13) |
| GET | `/audit` · `/audit/verify` | `AuditEntry[]` · `{ok, brokenAtSeq?}` |
| GET | `/certificate?from=&to=` | PDF |

- AC: Track F has a mock server / JSON fixtures for every route.

---

## Track A: AWS infra & deployment

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **A.1** | **Hour-0 account setup:** pick region (e.g. `us-east-1`), request Bedrock Claude model access, **enable Macie**, set billing alarm | none | Bedrock `InvokeModel` works from CLI; Macie enabled; budget alarm email confirmed |
| **A.2** | S3 bucket with `uploads/`, `quarantine/`, `records/` prefixes; CORS for presigned uploads from the web app | 0.1 | Can PUT via presigned URL from `localhost` |
| **A.3** | S3 lifecycle rule: purge `quarantine/` after grace period (short for demo, e.g. 1 day) | A.2 | Rule visible in console; documented |
| **A.4** | Object Lock on `records/` (bucket must be created with Object Lock enabled; decide this **before** A.2) | A.2 | Object in `records/` can't be deleted during retention |
| **A.5** | DynamoDB tables `Files`, `RetentionRules`, `LegalHolds`, `AuditLog` | 0.2 | Tables deployed via IaC |
| **A.6** | Lambdas `process` (S3 event trigger on `uploads/`) and `api` (Function URL, CORS), least-privilege IAM roles | A.2, A.5 | Hello-world versions deploy; upload triggers `process` (see CloudWatch) |
| **A.7** | Seed script: load retention rules (§6) + demo legal hold into DynamoDB | A.5, B.1 | `make seed` (or equivalent) is idempotent |
| **A.8** | One-command deploy + teardown; frontend hosting (local or S3 static site) | A.6 | Teammate can deploy from a clean clone |

---

## Track B: Decision core (pure logic, unit-tested, no AWS)

This is the "rules engine, not the LLM, makes the final call" story. Develop entirely against fixtures.

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **B.1** | Retention rules config as data (doc type → years, trigger, citation, action) from §6 | 0.2 | JSON/YAML file used by both engine and seed script |
| **B.2** | `decide()` implementing decision order: **Legal hold → Regulated retention → Duplicate/draft → Confidence → Recommendation**; computes `keepUntil`; produces human-readable `rationale` + `ruleApplied` | 0.3, B.1 | Unit test for every row of the §6 table |
| **B.3** | Legal hold matching by `clientId`, `accountId`, `branchId`, keyword | B.2 | Held file → `RETAIN` with "legal hold" rationale, always, regardless of other rules |
| **B.4** | Duplicate & draft detection inputs: same `sha256` as another file → duplicate; `_v1/_v2/_old` with a matching `_FINAL` → draft | B.2 | Tests with filename sets from the dataset |
| **B.5** | Confidence threshold → `REVIEW` (default threshold configurable, e.g. 0.75) | B.2 | Test |
| **B.6** | `score_sensitivity()` with Macie weights (§6) → `HIGH ≥50`, `MEDIUM 10–49`, `LOW <10`; "Retain – high sensitivity" rule moves must-keep HIGH files to `LOCKED` | 0.3 | Unit tests incl. the "12 SSNs" case |
| **B.7** | Bedrock `pii_types` fallback score for files Macie can't read (images) | B.6 | Test |

---

## Track C: `process` Lambda (Bedrock classification)

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **C.1** | Bedrock prompt + JSON schema `{doc_type, confidence, pii_types[], client_name?, account_id?, rationale}`; iterate locally on sample files | A.1, G.1 *(stub OK: any PDFs)* | ≥90% correct doc type on dataset; always valid JSON |
| **C.2** | File reading: send PDFs/images directly to Claude; extract text for `.docx/.txt/.csv/.xlsx` | C.1 | Works for every file type in dataset |
| **C.3** | Handler: S3 event → read file → sha256/size → `classify()` → `decide()` → write `Files` item → `append_audit("CLASSIFIED")` | A.6, C.2, B.2 *(stub OK)*, E.1 *(stub OK)* | Uploading a file produces a complete `Files` row |
| **C.4** | Cached-response fallback: store classification results per sha256 so the demo works if Bedrock is slow/throttled | C.3 | Flag to force cache mode |
| **C.5** | Error handling: unreadable/oversized file → `REVIEW` with reason, never crash | C.3 | Test with a corrupted file |

---

## Track D: `api` Lambda (endpoints, Macie, disposal)

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **D.1** | Router + `/upload-url`, `/files`, `/files/{id}` | 0.4, A.6 | Frontend can list real files |
| **D.2** | Approve / reject / bulk-approve: approve `DELETE` → move object to `quarantine/`, status `QUARANTINED`; reject → `REJECTED`; each writes audit entry. **Refuse** approval if file is on legal hold or within retention (server-side guard) | D.1, E.1 *(stub OK)* | Test: approving a held file returns 409 |
| **D.3** | `/restore` from quarantine during grace period | D.2 | Object back in `uploads/`, audit entry written |
| **D.4** | Purge path: mark `PURGED` + audit entry when lifecycle deletes (or a "purge now" demo button) | D.2, A.3 | Audit shows PURGED with file hash |
| **D.5** | Macie: `/scan` (`CreateClassificationJob`), `/scan/status`, `/scan/ingest` (`ListFindings`/`GetFindings` → per-file counts → `score_sensitivity()` → update `Files`) | A.1, B.6 *(stub OK)* | Running on dataset updates `sensitivityScore` + `priority`; results saved so demo doesn't wait on Macie |
| **D.6** | `/dashboard` metrics: GB reclaimed, PII items removed (Macie counts), HIGH backlog, % over-retained, held-files-deleted = 0, auto-cleared vs. reviewed, chain verify status | D.1, E.2 | Numbers match a hand count on the dataset |
| **D.7** | Locked flow: RETAIN + HIGH sensitivity → copy to `records/` (Object Lock), status `LOCKED` | D.1, A.4, B.6 | Demo file shows LOCKED |

---

## Track E: Audit log & Certificate of Disposal

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **E.1** | `append_audit()`: sequential `seq`, `entryHash = sha256(prevHash + canonical_json(entry))`; safe against concurrent writers (conditional put on `seq`) | 0.3, A.5 *(local DynamoDB OK)* | Concurrent appends never fork the chain |
| **E.2** | `verify_chain()` → `{ok, brokenAtSeq}`; `/audit` and `/audit/verify` handlers | E.1 | Manually editing a row in console makes verify fail at that seq |
| **E.3** | "Tamper" demo script/button that edits one row, plus a "repair" for rehearsals | E.2 | Works live in < 5 s |
| **E.4** | Certificate of Disposal PDF: what (type, hash, metadata, no content), why (rule + citation), allowed (no hold, retention over), who approved, when; includes chain head hash | E.1 | `/certificate` downloads a PDF that looks exam-ready |

---

## Track F: React frontend

Build against the mock API from 0.4; switch to the real Function URL when D.1 lands.

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **F.1** | App shell, routing, API client with mock/real toggle, hard-coded demo advisor | 0.4 | Runs with `npm run dev` on mocks |
| **F.2** | Upload: drag-and-drop folder → presigned PUTs, progress per file | F.1 | 40 files upload in one drop |
| **F.3** | Review queue: table sorted by priority (🔴🟠⚪), recommendation badge, keep-until date, hover/expand for Bedrock rationale + rule citation; filter by status | F.1 | Matches demo step 3 |
| **F.4** | Approve / reject / bulk-approve / restore; legal-hold rows visibly blocked ("This is the file that gets firms fined") | F.3 | Approving a held file is impossible in UI |
| **F.5** | "Scan for sensitive data" button + status + re-sort animation when scores arrive | F.3 | Queue visibly re-sorts |
| **F.6** | Live updates: poll `/files` so files "stream in" after upload | F.3 | Rows appear without refresh |
| **F.7** | Dashboard tiles for §13 metrics | F.1 | Uses `/dashboard` |
| **F.8** | Audit log view with chain-verify badge (green/red) + certificate download button | F.1 | Tamper demo turns badge red |

---

## Track G: Synthetic demo dataset (no real client data)

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **G.1** | Generator script for ~40 files per §11 (statements, confirms, drafts + finals, exact duplicates, ID/W-9 scans, 3 text high-PII files, emails, marketing, personal junk) with backdated "created" dates in metadata | none | `python data/generate.py` reproduces the set |
| **G.2** | Macie-friendly PII formatting (`SSN: 123-45-6789`, etc.); the CSV with ~50 SSNs that becomes the 🔴 demo file | G.1 | Macie job (D.5) flags them HIGH |
| **G.3** | Legal-hold scenario: one client + emails/files tied to them, matching the seeded hold | G.1, A.7 | That file shows "blocked: legal hold" |
| **G.4** | Expected-results manifest (`data/expected.csv`: file → expected docType / recommendation / priority) | G.1 | Used by B and C to measure accuracy |

---

## Track H: Pitch & demo

| ID | Story | Depends on | Acceptance criteria |
|---|---|---|---|
| **H.1** | Resolve open questions (§15): judging criteria, final name, mentors, region | none | Answers recorded in PLAN.md |
| **H.2** | Slide deck: problem, core insight, LPL fit (§2), architecture, business model (§14), roadmap (Cognito, Step Functions, Textract, compliance-officer role) | none | ≤ 8 slides |
| **H.3** | Demo script rehearsed against the real build (§9), with timings | F.4, E.3 | Two clean dry runs under 5 min |
| **H.4** | Pre-recorded backup video + pre-processed dataset state | H.3 | Video plays offline |
| **H.5** | Judge Q&A cheat sheet (§12 risks: "isn't this just S3 lifecycle?", archive vendors, data handling) | none | One page |

---

## Integration milestones

1. **Thin slice (first priority):** one file uploaded → `process` classifies → `decide` → row in `Files` → shows in queue → approve → quarantined → audit entry. Needs A.2, A.5, A.6, C.3, B.2, D.1, D.2, E.1, F.3. *Stubs are fine everywhere else.*
2. **Full dataset:** all 40 files classified correctly vs. G.4 manifest.
3. **Macie + priority:** scan pre-run, queue re-sorts, 🔴 file on top.
4. **Proof:** certificate + tamper demo.
5. **Dashboard + polish + rehearsal.**
6. *(Stretch, only after 5)*: near-duplicate detection, NL policy authoring, compliance-officer view, ask-the-auditor chat (PLAN.md §5).

## Critical path / do-first

- **A.1** (Bedrock access + Macie enablement can take time) → hour 0.
- **A.4 decision** (Object Lock must be on at bucket creation) → before A.2.
- **G.1** early so C.1 prompt work and D.5 Macie scan have real inputs.
- **D.5** Macie scan run well before demo; it takes minutes.

## If you have fewer people

| Team size | Suggested ownership |
|---|---|
| 3 | (A + D + E) · (B + C + G) · (F + H) |
| 4 | (A + D) · (B + C) · (E + G) · (F + H) |
| 5 | A · (B + E) · (C + G) · D · (F + H) |
| 6+ | One track each; H is whoever is least needed during final integration |
