# Hackathon Plan: Defensible Disposal for Financial Advisors

> Working name: **ShredSafe** (placeholder, rename freely)
> Companion doc: [financial-advisor-file-manager.md](financial-advisor-file-manager.md) (product concept + AWS service list)

---

## 1. One-Line Pitch

**ShredSafe finds the files an advisor is no longer required to keep, proves it is safe to delete them, deletes them, and leaves a record regulators can check.**

Most compliance tools are built to help firms *keep* records. Few help them *get rid of* records in a way they can defend. Keeping data longer than required is a liability: it adds breach exposure, eDiscovery cost, storage cost, and Reg S-P risk.

---

## 2. Why LPL Would Buy This

| LPL reality | What ShredSafe offers |
|---|---|
| Tens of thousands of independent advisors, each running their own office, drives, and inboxes | One disposal policy applied the same way to every branch, with central oversight |
| Branch-office data is hard to supervise | A dashboard showing over-retained data and PII exposure for each branch |
| Amended **Reg S-P** (customer-information disposal + incident response) is now in force | Documented, policy-based disposal of customer information |
| Each breach notification is expensive and damages reputation | Less stored data means fewer records exposed if a breach happens |
| FINRA/SEC exams ask firms to show their policies are actually followed | An immutable audit trail that can be exported as exam evidence |
| Litigation and arbitration discovery costs grow with data volume | Less data to collect and review, with legal holds respected automatically |

**Acquisition angle:** the product sits inside LPL's existing advisor tech stack (ClientWorks-style portal) as a compliance feature. LPL can roll it out to every affiliated advisor on day one, which is the kind of distribution a startup can't get on its own.

---

## 3. The Core Insight (the thing judges should remember)

> **Deleting is risky. Keeping everything is also risky. We make deletion *defensible*.**

"Defensible disposal" means that every deletion can show:
1. **What** was deleted (document type, hash, metadata, but not the content)
2. **Why** (which retention rule had expired)
3. **That it was allowed** (no legal hold, no open exam, retention period over)
4. **Who approved it** (a human approval for anything ambiguous)
5. **When** (timestamped, tamper-evident log)

---

## 4. Users & Personas

**MVP has one user type: the Advisor.**

| Persona | Need | Screens |
|---|---|---|
| **Advisor** | "Clean up my files without getting in trouble" | Upload, review queue (approve/reject), my dashboard, audit log + disposal certificate |

Retention rules and legal holds are **seeded config** for the MVP (no admin UI). Compliance officer, legal, and firm-wide roles are future work.

---

## 5. Scope

### MVP (build during the hackathon)
- [ ] Upload a folder of sample files into S3
- [ ] Classify each file with Bedrock (Claude): document type, confidence, and a one-sentence reason
- [ ] Scan the bucket with Macie; give each file a **sensitivity score** from how much sensitive data it contains
- [ ] Sort the deletion queue by sensitivity so the riskiest deletable files are handled first
- [ ] Retention rules engine: document type → retention period → "keep until" date
- [ ] Legal hold check: matching client/account is blocked from deletion
- [ ] Each file gets a recommendation: **Delete**, **Retain until X**, or **Needs review**
- [ ] Web review queue where a person approves or rejects each recommendation
- [ ] Approved deletions go into a recoverable grace period (soft delete), then are permanently deleted
- [ ] Hash-chained audit log in DynamoDB, plus a downloadable "Certificate of Disposal"
- [ ] Advisor dashboard: GB reclaimed, PII files removed, over-retained files found

### Stretch
- [ ] Duplicate and near-duplicate detection (hashes and embeddings)
- [ ] Natural-language policy authoring ("keep trade confirmations 6 years") converted to rules by Bedrock
- [ ] Connectors for OneDrive/SharePoint, Google Drive, and email export
- [ ] Compliance officer role: firm-wide dashboard, legal hold manager, risk score per branch
- [ ] Ask-the-auditor chat: "Why was file X deleted?"

### Out of scope (say so on stage)
- Production-grade connectors for every system
- Final legal retention schedules (these must be confirmed with LPL compliance; we ship configurable defaults)
- Deleting from systems that already have WORM/archive vendors (we integrate with them, we don't replace them)

---

## 6. Retention Rules (demo defaults, all configurable)

> ⚠️ These are illustrative defaults for the demo, **not legal advice**. Real schedules must come from LPL compliance.

| Document type | Example | Default rule | Source |
|---|---|---|---|
| Trade confirmation | Broker trade confirm PDF | Retain 6 yrs | SEC 17a-4 / FINRA 4511 |
| Account statement | Monthly brokerage statement | Retain 6 yrs | SEC 17a-4 |
| Client communication | Emails about recommendations | Retain 3 yrs (min) | SEC 17a-4(b)(4) |
| Advisory agreement / account record | New-account form, IMA | Retain 6 yrs after account closes | 17a-4 / 204-2 |
| Advertising / marketing | Published newsletter | Retain 5 yrs | Advisers Act 204-2 |
| Draft / working copy | `proposal_v3_FINAL_old.docx` | **Delete** if a final version exists | No requirement |
| Duplicate copy | Same hash as a stored record | **Delete** the copy, keep the original | No requirement |
| Personal / non-business | Vacation photos, recipes | **Delete** (with review) | No requirement |
| Scanned ID / SSN copy, past retention | Driver's license scan | **Delete** + Reg S-P disposal record | Reg S-P disposal rule |
| Anything under legal hold | — | **Never delete** | Legal hold overrides everything |
| Low-confidence classification | — | **Needs review** | Human in the loop |

Decision order: **Legal hold → Regulated retention → Duplicate/draft → Classification confidence → Recommendation**

### Sensitivity priority (Macie)

Macie decides **how urgent** a deletion is, not **whether** a file can be deleted. Legal holds and retention rules always come first.

`sensitivityScore` = weighted count of the sensitive items Macie found in the file:

| Macie finding | Weight |
|---|---|
| SSN, passport, driver's license | 10 per item |
| Bank account / credit card number | 8 per item |
| Date of birth, tax ID | 5 per item |
| Name, address, phone, email | 1 per item |

| Score | Priority | What the advisor sees |
|---|---|---|
| ≥ 50 | 🔴 **High** | Top of the queue: "This file holds 12 SSNs and is past retention. Delete first." |
| 10–49 | 🟠 **Medium** | Middle of the queue |
| < 10 | ⚪ **Low** | Bottom of the queue |

If a high-sensitivity file **must** be retained, it is not queued for deletion. Instead it gets flagged **"Retain – high sensitivity"** and moved to the locked `records/` prefix. That way it's still protected even though it can't be deleted.

---

## 7. Architecture (MVP)

**Only 5 AWS services: S3, Lambda, Bedrock, Macie, DynamoDB.**

```
 React web app (run locally, or a static site in S3)
        │  HTTPS (Lambda Function URL, no API Gateway)
        ▼
 ┌──────────────────────┐  presigned upload URL   ┌──────────────────────┐
 │ Lambda: api          │ ─────────────────────►  │ S3 bucket            │
 │ list / approve /     │                         │  uploads/            │
 │ reject / certificate │                         │  quarantine/  (grace)│
 └─────────┬────────────┘                         │  records/ (Obj. Lock)│
           │                                      └──────────┬───────────┘
           │                                    S3 event      │
           ▼                                    notification  ▼
 ┌──────────────────────┐                     ┌──────────────────────────┐
 │ DynamoDB             │ ◄────────────────── │ Lambda: process          │
 │  files, rules,       │                     │  1. read file            │
 │  holds, audit (hash  │                     │  2. Bedrock: classify +  │
 │  chained)            │                     │     reason (JSON)        │
 └──────────────────────┘                     │  3. rules + hold check   │
                                              │  4. write recommendation │
                                              └──────────────────────────┘
 S3 bucket ──► Macie classification job ──► findings ──► Lambda: api pulls them
               (scan: SSNs, account #s,       (per file)   on a "Scan" click, computes
                DOB, etc.)                                 sensitivityScore, re-sorts queue
```

**AWS services in the MVP**

| Service | What it does for us |
|---|---|
| **S3** | Stores uploads. Approved deletions move to `quarantine/`, and a lifecycle rule purges them after the grace period. Regulated records go to `records/` with Object Lock (WORM). Lifecycle and Object Lock are S3 settings, not extra services. |
| **Lambda** | Two functions. `process` runs when a file is uploaded. `api` serves the web app through a Function URL. |
| **Bedrock (Claude)** | Reads the file directly (Claude accepts PDFs and images), then returns document type, confidence, and a plain-English reason as JSON |
| **Macie** | Scans the S3 bucket for sensitive data and counts it per file (SSNs, bank accounts, DOBs…). We turn those counts into a sensitivity score that sets deletion priority. |
| **DynamoDB** | Files, retention rules, legal holds, hash-chained audit log |

IAM roles and CloudWatch logs come with Lambda automatically, and S3/DynamoDB encrypt data at rest by default, so none of these are extra work.

**Cut to save work**

| Cut | Replaced by |
|---|---|
| Textract | Claude on Bedrock reads PDFs and scanned images directly |
| Comprehend | Macie finds sensitive data in S3, which is what we need |
| Step Functions + EventBridge | S3 event notification triggers the `process` Lambda directly |
| API Gateway | Lambda Function URL |
| Cognito | One hard-coded demo advisor (no login) |
| Amplify | Run the React app locally, or upload the build to S3 as a static site |
| KMS (custom keys) | Default S3/DynamoDB encryption |
| QLDB, SQS, Rekognition | Not needed for the MVP (QLDB is also discontinued) |

On stage, say that Cognito, Step Functions, and Textract would be added for production. Judges care that you know the path, not that you built it.

**Service notes**
- **Audit log:** each DynamoDB entry stores `sha256(prev_hash + entry)`, so editing any row breaks the chain. That makes it tamper-evident, and it's a good demo moment.
- **Bedrock model:** use the latest Claude model available in our region, and ask for structured JSON output: `{doc_type, confidence, pii_types[], client_name?, account_id?, rationale}`. Bedrock's `pii_types` is only used as a fallback for files Macie can't read (e.g. photos of IDs). For `.docx`/`.txt`, extract text in the Lambda first and send it as text.
- **Macie:** run it as a **one-time classification job** on the bucket from a "Scan for sensitive data" button (the `api` Lambda calls `CreateClassificationJob`, then reads results with `ListFindings` / `GetFindings`). Jobs take several minutes even on small buckets, so **run the scan before the demo** and show the results; don't wait on stage. Macie reads text formats (PDF, DOCX, TXT, CSV, XLSX) but not images, which is why Bedrock is the fallback for scans and photos. Enable Macie in hour 0 because the account needs it turned on first.
- **Region:** pick one with the Claude model enabled in Bedrock and Macie available (e.g. `us-east-1`).
- **Cost guard:** keep the demo dataset small (~40 files) and set a billing alert once in the console.

---

## 8. Data Model (DynamoDB)

**`Files`**: PK `fileId`
`s3Key, sha256, sizeBytes, uploadedAt, ownerAdvisorId, branchId, docType, confidence, piiTypes[], macieFindings{type: count}, sensitivityScore, priority (HIGH|MEDIUM|LOW), clientId?, accountId?, keepUntil, recommendation (DELETE|RETAIN|REVIEW), rationale, status (PENDING|APPROVED|REJECTED|QUARANTINED|PURGED|LOCKED)`

**`RetentionRules`**: PK `docType`
`retentionYears, trigger (CREATED|ACCOUNT_CLOSED), citation, action`

**`LegalHolds`**: PK `holdId`
`scope (clientId|accountId|branchId|keyword), createdBy, reason, active`

**`AuditLog`**: PK `seq`
`timestamp, actor, action, fileId, fileHash, ruleApplied, prevHash, entryHash`

---

## 9. Demo Script (5 minutes)

1. **Hook (30s):** "The average advisor keeps documents for years longer than any rule requires. Every extra SSN scan is one more liability if there's a breach. But advisors don't delete anything because they're afraid of breaking a rule."
2. **Upload (30s):** Drag in a messy folder of about 40 synthetic files (statements, drafts, duplicates, ID scans, personal photos, an email under legal hold).
3. **Pipeline (60s):** Files stream into the dashboard with classifications and "keep until" dates. Hover one to see Bedrock's plain-English reason. Click **Scan** to show Macie results (pre-run): the queue re-sorts and a 🔴 file with 12 SSNs, past retention, jumps to the top.
4. **The save (45s):** Point to a file that *looks* like clutter but is blocked because it's tied to a client under **legal hold**. "This is the file that gets firms fined. We caught it."
5. **Approve (45s):** Bulk-approve the safe deletions. Show them moving to the grace period.
6. **Proof (45s):** Download the **Certificate of Disposal** and show the hash-chained audit log. Tamper with one row live and show verification failing.
7. **Business close (45s):** "Across the LPL network, that's X TB and Y PII records removed, and an exam-ready audit trail. Next up: a firm-wide view for compliance officers."

---

---

## 11. Synthetic Demo Dataset (no real client data!)

Generate about 40 files with fake names and accounts:
- 6 account statements (various ages, a few past retention)
- 6 trade confirmations
- 5 drafts with matching finals (`_v1`, `_v2`, `_FINAL`)
- 4 exact duplicates
- 4 scanned IDs / W-9s with fake SSNs (some past retention)
- 3 **text-based** high-PII files Macie can read: an old client-list CSV with ~50 fake SSNs, a PDF export with account numbers + DOBs, an XLSX of client contacts (these produce the 🔴 High priority demo moment)
- 5 client emails (one client under legal hold)
- 4 marketing pieces
- 6 personal / junk files (photos, receipts, memes)

Use Macie-recognizable formats for fake data (e.g. SSNs as `123-45-6789` next to the word "SSN") so the findings are reliable.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Wrongly deleting a regulated record | Default to **Retain** when unsure; human approval; grace period; regulated records locked with Object Lock |
| Misclassification by the LLM | Confidence threshold → "Needs review"; show rationale; rules engine (not LLM) makes the final call |
| Judges ask "isn't this just S3 lifecycle?" | Lifecycle rules are based on age. We decide based on what a document is, who it belongs to, and whether it's under legal hold |
| Judges ask about existing archive vendors (Smarsh, Global Relay, etc.) | They archive communications. We clean up the unstructured files on advisors' drives and integrate with their systems instead of competing |
| Bedrock access / quota delays | Request model access in hour 0; keep a cached-response fallback for the live demo |
| Demo Wi-Fi / AWS hiccup | Pre-recorded backup video; pre-processed dataset |
| Sensitive data handling questions | Encryption at rest by default, least-privilege IAM, synthetic data only; Cognito + KMS keys on the production roadmap |

---

## 13. Success Metrics (to show on the dashboard and slides)

- **Storage reclaimed** (GB / %)
- **PII exposure reduced**: number of sensitive items (SSNs, account numbers…) removed, by Macie count
- **High-priority backlog**: 🔴 files still waiting for review
- **Over-retention found**: % of files kept past their required date
- **Zero-error guarantee**: 0 files under hold or still within retention deleted (in the demo)
- **Review time saved**: files auto-cleared vs. files that needed a human
- **Audit integrity**: verification of the hash chain passes

---

## 14. Business Model (for the pitch)

- **Per-advisor SaaS** (e.g. a monthly fee for each advisor seat), or an enterprise license for the whole firm
- **Land:** LPL affiliated advisors. **Expand:** other broker-dealers, RIAs, insurance BDs
- **For LPL specifically:** a compliance feature that makes LPL more attractive to advisors and helps recruit them, plus lower breach and eDiscovery costs across the firm

---

## 15. Open Questions for the Team

- [ ] What's the hackathon length and judging criteria? (adjust timeline/demo weight)
- [ ] Final product name?
- [ ] Which file sources should the demo claim support for (local upload only vs. a OneDrive mock)?
- [ ] Do we have access to LPL mentors to sanity-check the retention table?
- [ ] AWS account limits: is Bedrock enabled? Which region?

---

## 16. Next Steps

1. Agree on name + roles (15 min)
2. Request Bedrock model access and set a budget alarm
3. Initialize repo structure: `/frontend`, `/backend` (Lambdas), `/infra` (CDK or SAM), `/data` (synthetic files)
4. Build the end-to-end "thin slice" for one file before widening scope
