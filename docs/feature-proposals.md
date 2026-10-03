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
