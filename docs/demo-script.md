# Demo script (H.3)

Five minutes, live app, synthetic data only. Based on PLAN.md section 9 and the hackathon rubric:
judges score only what they see working, and a recorded backup is strongly recommended (H.4).

The deck's Demo slide and speaker notes follow the same steps.

## Roles

| Who | Does |
|---|---|
| Presenter | Talks, owns the clicker for the slides |
| Driver | Runs the app (one browser window, zoom 125%, Live API selected) |
| Backup | Has the recorded video open and ready; watches the clock |

## T-60 min: get the stack ready

Run these in the online VS Code workspace (it has AWS credentials). Only Arihant deploys (AGENTS.md).

1. **Deploy `main`** (Arihant): `cd infra && sam build && sam deploy`. Check `infra/samconfig.toml` still has
   `DemoControls=true` and the CloudFront `FrontendOrigin`.
2. **Reset and seed**:
   ```bash
   python3 scripts/reset_demo.py --yes        # empties the bucket (except records/) and the Files + AuditLog tables
   python3 scripts/seed.py                    # retention rules + legal holds (Arthur Smith, Margaret Whitaker)
   ```
3. **Data**: `data/samples/` is in the repo (42 files). To rebuild it:
   `python3 data/generate.py && python3 data/generate_pii.py && python3 data/generate_legal_hold.py && python3 data/generate_more.py`.
4. **Pre-upload the main set and pre-run the scan.** Macie jobs take several minutes, so the scan can't run
   live. Upload everything except the "live" folder below (drag `data/samples/` into the Upload page, or run
   `python3 scripts/e2e_live.py --api <url>`, which also checks every file against `data/expected.csv`).
   Then start the scan and let it finish:
   ```bash
   curl -X POST "$API/scan"; sleep 600; curl "$API/scan/status"   # wait for "COMPLETE"
   ```
   **Don't ingest yet.** The demo's "queue re-sorts" moment is the ingest. (Needs the follow-up below.)
5. **Live folder**: keep 4 files aside for the on-stage upload, e.g. `Trade_Confirm_SPY_2026_03.txt`,
   `Q3_Financial_Plan_Proposal_v2_draft.txt`, `Gym_Receipt_2024.txt`, `Email_Delgado_2025_11.eml`.
6. **Frontend**: `cd frontend && npm run online` (needs PR #8), then open
   `https://d18wlstpxd4zq5.cloudfront.net/ports/5173/`, choose **Live API**, check the queue loads.
   `frontend/.env.local` needs `VITE_API_MODE=live` and `VITE_DEMO_CONTROLS=true`.

## T-10 min: preflight

- [ ] `curl $API/audit/verify` returns `{"ok": true}`
- [ ] Queue shows the pre-uploaded files, the two held clients flagged LEGAL HOLD
- [ ] `curl $API/scan/status` shows `COMPLETE`
- [ ] Audit page: "Simulate tampering" and "Restore original entry" are visible (demo controls on)
- [ ] Backup video plays offline
- [ ] Notifications off, browser zoom 125%, one tab

## The five minutes

| # | Time | Driver does | Presenter says |
|---|---|---|---|
| 1 | 0:00–0:30 | Slides: cover, problem | "The average advisor keeps documents for years longer than any rule requires. Every extra SSN is one more liability in a breach. But advisors don't delete anything, because they're afraid of breaking a rule." |
| 2 | 0:30–1:00 | Upload page: drag the 4-file live folder in | "An advisor drops in a folder. Each file goes straight to S3, and a Lambda sends it to Amazon Bedrock to classify." |
| 3 | 1:00–2:00 | Review queue: new rows appear. Open one row. Click **Scan for sensitive data** | "Every file gets a recommendation and the reason: the rule, its citation, the AI's confidence. The AI suggests; the rules engine decides." Then: "Macie counted the SSNs and account numbers in every file. The riskiest files jump to the top: this client list holds 50 SSNs and is past retention. Delete first." |
| 4 | 2:00–2:45 | Point at the LEGAL HOLD row (Margaret Whitaker's 2019 email). Try **Approve**: it's blocked | "This email is past its 3-year window and looks like clutter. But the client is under a legal hold, so the server refuses to delete it. This is the file that gets firms fined. We caught it." |
| 5 | 2:45–3:30 | Select all deletable files, **Approve N for deletion**. Open **Grace period** tab | "One click approves the safe deletions. Nothing is gone yet: they wait in a grace period where any file can be restored, then purge for good." |
| 6 | 3:30–4:15 | Audit log: show **Integrity check passed**. Click **Simulate tampering**: it fails at one entry. **Restore original entry**. **Download certificate of disposal** | "Every action is in a hash-chained log. If anyone edits an entry, the check fails at exactly that entry, and the certificate is blocked. Restore it, and here's the certificate an examiner can check." |
| 7 | 4:15–5:00 | Slides: impact, AWS, close | "Across LPL's 32,000 advisors, that's breach exposure removed and an exam-ready trail. Deleting is risky. Keeping everything is riskier. We make deletion defensible." |

## If something breaks

| Problem | Do this |
|---|---|
| Upload doesn't appear within 20 s | Say "classification runs in the background," move on to the pre-uploaded files |
| Scan button spins | Skip the re-sort line; the queue is already sorted from the pre-run scan |
| API or Wi-Fi down | Switch the sidebar to **Demo** (works offline with the same screens), or play the backup video |
| Tamper control missing | Stack was deployed without `DemoControls=true`; show the passed check and the certificate only |

## After each rehearsal

```bash
python3 scripts/reset_demo.py --yes && python3 scripts/seed.py
```
Then redo T-60 steps 4–5. Log each dry run:

| Run | Date | Total time | What went wrong | Fix |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |

## Follow-up needed for step 3

The frontend's Scan button starts a new Macie job (minutes). For the demo it should apply a finished scan
instantly: when `/scan/status` is `COMPLETE` and no file has a priority yet, call `/scan/ingest` directly.
Tracked as a frontend task in STATUS.md.
