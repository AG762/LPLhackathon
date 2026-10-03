# Load testing: how many files ShredSafe handles today

Test files: `python data/generate_load.py --count N --out <folder>` (synthetic; see the script for the mix).
Ready-made folders of 100, 1,000 and 10,000 files are easy to regenerate the same way (same seed, same files).

## Limits in the current design (from the code)

| Step | What it does now | Where it stops working |
|---|---|---|
| Browser upload (F.2) | 4 presigned PUTs at a time, one row per file on the page | Fine to ~2,000 per batch; the page slows with very large batches |
| `GET /files` | Scans the whole Files table and returns every row in one response | Lambda responses max out at **6 MB**: about **8,000–10,000 files** per workspace |
| `/scan/ingest` | Updates every file one by one inside one API call (30 s timeout) | About **a few thousand files** per scan |
| Review queue | Renders every row (search and filters, F.20, help find things) | Gets sluggish past a few thousand rows |
| Classification (`process` + Bedrock) | One Lambda and one Bedrock call per file, in parallel | Bounded by the account's Bedrock request quota, not by our code |

**Practical size today: about 1,000–2,000 files per workspace**, plenty for the demo.

## What a million files would take (estimates)

With the limits above fixed (paging, background ingest, bulk upload):

- **Upload:** about 1 hour with a bulk uploader (S3 sync or a desktop agent), versus about a day through a browser.
- **Classification:** about 8 hours at 2,000 Bedrock requests a minute; 1–2 hours with a quota increase or
  **Bedrock batch inference** (asynchronous, about half the price). Cost: about **$35** for a million small files
  (Nova Micro: about 400 input and 150 output tokens each).
- **Sensitive-data scan:** about 4 GB of text, **1–3 hours** in Macie (no published throughput figure), about **$3–4**.
- **Total:** about half a day, under $50.

## To scale (proposal P7)

1. **Page `GET /files`** (`limit` + `nextToken`, a GSI on workspace + status) and virtualize the queue list.
2. **Ingest in the background:** `/scan/ingest` queues the work (SQS, or Step Functions over findings pages)
   instead of doing it in one request; the notify job (D.9) already runs outside the API.
3. **Bulk upload** for whole drives (S3 sync / an agent), with the browser for everyday folders.
4. **Bedrock batch inference** for backfills; real-time classification for everyday uploads.
5. **Incremental Macie scans** (proposal P1).

## Measured (Sample mode, in the browser)

1,000 generated files plus the 16 built-in ones, uploaded as one folder on a MacBook (Chrome, dev build):

| What | Result |
|---|---|
| Upload of 1,000 files | 6 min 22 s, no errors (Sample mode adds about 1.3 s of pretend upload per file, 4 at a time; live S3 PUTs are faster) |
| Auto-started scan after the batch (F.19) | started by itself, finished, all files scored |
| Review queue first render | 0.32 s for 1,016 rows |
| Scrolling the queue | 9 ms a frame on average (smooth), one 0.19 s hitch |
| Search while typing (after the fix below) | keeps up with typing (about 45 ms per keystroke); list settles when typing stops |
| Clearing search back to 1,016 rows | 0.2 s |
| Memory | about 150 MB |

**Fix made from this run:** search used to take 0.7 s to update, because about 1,000 rows played their exit animation
at once. The list now swaps in one go when the tab, search or filter changes (single approvals still animate), and
the search term is deferred so typing never waits for the list.

**Takeaway:** 1,000 files per workspace is comfortable in the browser. Past a few thousand, the limits are on the
API side (the 6 MB `/files` response, `/scan/ingest` in one request), which proposal P7 addresses.
