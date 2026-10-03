"""Scheduled job: start the sensitive-data scan on the server once uploads settle (STORIES F.25).

The Upload page also starts a scan when its uploads are classified, but only while it stays open: leave the
page, or upload while another scan is running, and the new files used to wait for someone to click. This job
runs every few minutes (infra: AutoScanFunction) and closes that gap:

- A scan is running: nothing to do; the files that arrived meanwhile are picked up after it ends.
- The newest scan was cancelled: leave it, so a person decides whether to scan again (no restart loop).
- The newest scan finished and nobody has opened its results: score it, like "Show sensitive-data results",
  so the queue is ranked even if nobody comes back to the app.
- Classified files that no scan has covered, and no upload in the last SETTLE: start a scan. Waiting for
  uploads to settle keeps one large upload to one scan instead of one per batch.
"""
import logging
from datetime import datetime, timedelta, timezone

from http_utils import Request
from routes import scan

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SETTLE = timedelta(minutes=2)


def _parse(value):
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def main(event=None, context=None, now=None):
    now = now or datetime.now(timezone.utc)
    job = scan.latest_job()
    state = scan._state(job)
    if state == "RUNNING":
        return {"skipped": "a scan is running"}
    if state == "FAILED":
        return {"skipped": "the last scan was cancelled; start the next one from the app"}

    result = {}
    files = [f for f in scan._all_files() if f.get("status") not in scan.SKIP_STATUSES]
    if state == "COMPLETE":
        if not any(f.get("macieJobId") == job["jobId"] for f in files):
            scan.ingest(Request(method="POST", path="/scan/ingest", user=None))
            result["scored"] = job["jobId"]
            files = [f for f in scan._all_files() if f.get("status") not in scan.SKIP_STATUSES]
        started = _parse(scan._iso(job.get("createdAt")))
    else:
        started = None

    # New: classified (docType set) after the newest scan started, so no scan has seen it
    new = [f for f in files if f.get("docType") and f.get("uploadedAt")
           and (started is None or (_parse(f["uploadedAt"]) or now) > started)]
    if not new:
        return {**result, "skipped": "no new files"}
    newest = max((_parse(f["uploadedAt"]) or now) for f in new)
    if now - newest < SETTLE:
        return {**result, "skipped": f"uploads still arriving ({len(new)} new files so far)"}

    _, body = scan.start(Request(method="POST", path="/scan", user=None))
    logger.info("Started scan %s for %d new files", body["jobId"], len(new))
    return {**result, "started": body["jobId"], "files": len(new)}
