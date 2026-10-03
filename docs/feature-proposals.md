# Feature proposals

Ideas we might build, written down so the team can decide on each one together.

How to use this file:
- **Decide:** change **Decision** to `Yes`, `No`, or `After the demo`, and add your name.
- **If it's a yes:** claim it in [STATUS.md](../STATUS.md) under your name before starting (AGENTS.md, Rule 0), then set
  **Status** here to 🟡 and link the PR.
- **When it's merged:** set **Status** to ✅ with the PR number. Only ✅ features go in the presentation as built
  (the rubric scores only what we show working). Anything else can go on the roadmap slide, marked "not built yet".

| # | Feature | Decision | Status | Owner |
|---|---|---|---|---|
| P1 | [Scan only new or changed files](#p1-scan-only-new-or-changed-files) | Undecided | ⬜ Not started | Unassigned (touches Arihant's D.5) |
| P2 | [Place a legal hold from a file in the queue](#p2-place-a-legal-hold-from-a-file) **(must-have)** | Undecided | 🟡 Built by Aryan, in review | Aryan |
| P3 | [Export the audit log as CSV for examiners](#p3-export-the-audit-log-as-csv) **(must-have)** | Undecided | 🟡 Built by Aryan, in review | Aryan |
| P4 | [Two-person approval for high-exposure deletions](#p4-two-person-approval-for-high-exposure-deletions) **(must-have for launch)** | Undecided | ⬜ Not started | Arihant (D.2) |
| P5 | [Account settings: profile, password, two-step sign-in](#p5-account-settings) **(must-have for launch)** | Undecided | ⬜ Not started | Aryan (UI) + Arihant (Cognito MFA) |
| P6 | [Sign in with Microsoft / firm SSO](#p6-sign-in-with-microsoft-or-firm-sso) | Undecided | ⬜ Not started | Arihant (Cognito) + Aryan (buttons) |
| P7 | [Large queues: paging for thousands of files](#p7-large-queues) | Undecided | ⬜ Not started | Aryan + Arihant |
| P8 | [Ask ShredSafe: plain-language answers about any file](#p8-ask-shredsafe) | Undecided | ⬜ Not started | Anwesh (Bedrock) |
| P9 | [Firm-wide compliance view across branches](#p9-firm-wide-compliance-view) | Undecided | ⬜ Not started | Unassigned |

---

## P1: Scan only new or changed files

**Decision:** Undecided · **Status:** ⬜ Not started · **Owner:** unassigned · **PR:** none

### The problem
Every time someone clicks **Scan for sensitive data**, `backend/api/routes/scan.py` starts a Macie `ONE_TIME` job
over the **whole bucket**: no date or folder filter. With 1,000 files already scanned plus 100 new ones, the
next scan reads all 1,100 again, including `quarantine/`, `restored/` and `records/`. Time and Macie cost grow
with the total, not with what changed.

At demo size (about 42 small files) this doesn't matter: a full scan costs pennies, and the 5–20 minutes is
mostly Macie's job startup. It matters for a real firm with years of files per advisor.

### What we'd build
1. **Scope each new job to what changed.** Add Macie job scoping so a job includes only objects modified after
   the previous job started (`scoping.includes` on `OBJECT_LAST_MODIFIED_DATE`), and only under `uploads/` and
   `restored/`. The first scan still covers everything.
2. **Keep existing scores when applying a partial scan.** Today `/scan/ingest` rescores **every** file from the
   newest job's findings. After a partial scan, files outside its scope would get "no findings" and drop to LOW.
   Ingest must update only files the job covered (uploaded or modified after the previous job started) and leave
   the rest as they were.
3. **Tests** in `backend/tests/test_scan.py` for both: the scoping sent to Macie, and that old scores survive
   a partial ingest.
4. **Live check:** one full scan, add a few files, one partial scan; confirm only the new files changed.

### Effort and risk
- About 1–2 hours of code and tests, plus 20–40 minutes of live testing (each Macie job takes 5–20 minutes).
- `scan.py` is Arihant's (D.5). Agree with him before starting.
- It changes one of the demo's key moments (the re-sort after the scan). Building it late adds risk with little
  time left to retest. Safest: only after the demo works end to end.

### Alternative with no code
Turn on **Macie automated sensitive data discovery** for the bucket. Macie then samples new and changed objects
continuously in the background. It's an account setting, not code, but results arrive on Macie's schedule rather
than on a button press, so it doesn't fit the live demo flow.

### What to say in the presentation
- **If built (✅):** "Scans are incremental: each one reads only files added or changed since the last scan, so
  cost and time scale with new data, not the whole archive."
- **If not built:** roadmap slide or judge Q&A: "Today each scan covers the whole bucket, which is fine at demo
  size. In production we'd scope Macie jobs to files changed since the last scan, or turn on Macie's automated
  discovery."

---

## Must-haves at a glance (Aryan, 2026-10-03)

- **Before the demo:** deploy #28 (admin API) and #30 (scan emails, plus SES setup), then P2 and P3 (both built,
  in review). Without the deploy, the Admin page is empty on Live.
- **Before a real launch:** P4 (two-person approval) and P5 (account settings with two-step sign-in). A compliance
  buyer will ask for both.
- **Roadmap slide:** P1, P6–P9.

## P2: Place a legal hold from a file

**Why:** compliance usually learns about a dispute while looking at a client's file. Today they'd have to open
Admin, Legal holds, and retype the client's name. A **Place legal hold** action on the expanded row pre-fills the
client and shows how many of their files it would cover. One click to protect them all.
**Effort:** small, frontend only (uses `POST /holds` from #28). **Demo value:** high; it's the "save" moment, live.

## P3: Export the audit log as CSV

**Why:** examiners and auditors work in spreadsheets. The PDF certificate proves the chain; a CSV of every entry
(sequence, time, who, action, file, rule, hashes) is what they actually filter. **Effort:** small, frontend only.

## P4: Two-person approval for high-exposure deletions

**Why:** deleting a file with 50 SSNs on one person's click is the kind of thing a CCO pushes back on. Files with
HIGH exposure (or above a size/count threshold) go to *Awaiting second approval*; a compliance user confirms.
Both names go in the audit log. **Effort:** medium: approve guard (`disposal.py`, Arihant's D.2), a new status,
a queue tab. **Pitch line:** "No single person can destroy a high-risk record."

## P5: Account settings

**Why:** a launched product needs a page to change your name and password and turn on two-step sign-in (the user
pool already allows TOTP MFA). **Effort:** medium: UI (Aryan) plus Amplify calls (`updatePassword`,
`setUpTOTP`, `verifyTOTPSetup`).

## P6: Sign in with Microsoft or firm SSO

**Why:** advisory firms run on Microsoft 365 / Entra ID or Okta, not personal Google accounts. Cognito supports
them as identity providers (OIDC/SAML). **Effort:** an hour or two once the firm's tenant details exist; buttons on
`/signin` are trivial. Google can be offered for independent advisors.

## P7: Large queues

**Why:** a real branch has tens of thousands of files. `/files` scans the whole table and the queue renders every
row. **Fix:** API paging (`limit` + `nextToken`, a GSI on workspace + status) and a virtualized list. Search and
filters (F.20) already help. **Effort:** medium; after the demo.

## P8: Ask ShredSafe

**Why:** "Why is this file being kept?" in plain language, answered by Bedrock from the file's classification,
rule, citation, and holds. It's AI that explains, not decides. **Effort:** medium (a `/files/{id}/explain` route plus
a small panel). Good for the "Best Use of AWS" story.

## P9: Firm-wide compliance view

**Why:** the CCO's question is "which branches are carrying the most risk?" A compliance dashboard across
workspaces/branches: over-retained %, high-exposure files waiting, holds, last scan. **Effort:** medium to large
(needs an org level above workspaces). PLAN.md lists it as a stretch goal.
