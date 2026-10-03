"""Scheduled job: email people when their files are scanned and ready for review (STORIES D.9).

Runs every few minutes (infra: NotifyFunction, only when NotifyFrom is set). When the newest Macie scan has
finished and nobody has been told yet, it scores the scan's files if no one has opened the results already
(same code as POST /scan/ingest), then emails each uploader one summary of their own files: how many were
scanned, how many hold a lot of client data, how many are ready to delete, how many are on legal hold.

- Recipients: the uploader (ownerAdvisorId, an email once sign-in is on). Files uploaded without sign-in go
  to NOTIFY_FALLBACK_TO, or nobody if that's empty.
- Sent with Amazon SES from NOTIFY_FROM. In SES's sandbox both addresses must be verified first.
- Each scan is announced once: the job writes a SCAN_NOTIFIED audit entry, which is also the record that
  people were told.
"""
import html
import logging
import os

import audit_log
import aws
import holds
from http_utils import Request
from routes import scan

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ACTOR = "system:notify"


def _already_notified(job_id):
    return any(e.get("action") == "SCAN_NOTIFIED" and str(e.get("detail", "")).startswith(job_id)
               for e in audit_log.list_entries())


def _recipient(file):
    owner = str(file.get("ownerAdvisorId") or "")
    return owner if "@" in owner else (os.environ.get("NOTIFY_FALLBACK_TO") or "").strip() or None


def _summary(files, active):
    return {
        "scanned": len(files),
        "high": sum(1 for f in files if f.get("priority") == "HIGH"),
        "ready": sum(1 for f in files if f.get("status") == "PENDING" and f.get("recommendation") == "DELETE"
                     and not holds.find_hold(f, active)),
        "held": sum(1 for f in files if holds.find_hold(f, active)),
        "review": sum(1 for f in files if f.get("status") == "PENDING" and f.get("recommendation") == "REVIEW"),
    }


def _plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def compose(summary, app_url):
    """(subject, text, html) for one person's scan summary."""
    s = summary
    subject = f"Your files are scanned and ready for review ({_plural(s['scanned'], 'file', 'files')})"
    lines = [
        f"ShredSafe finished checking {_plural(s['scanned'], 'of your files', 'of your files')} for sensitive client data.",
        "",
        f"- {_plural(s['ready'], 'file is', 'files are')} past retention and ready to delete",
        f"- {_plural(s['high'], 'file holds', 'files hold')} a lot of client data (SSNs, account numbers), so they're at the top of your queue",
        f"- {_plural(s['review'], 'file needs', 'files need')} a person to decide",
        f"- {_plural(s['held'], 'file is', 'files are')} under a legal hold and will be kept",
        "",
        "Nothing has been deleted. Every deletion waits for your approval.",
    ]
    if app_url:
        lines += ["", f"Review them: {app_url}"]
    text = "\n".join(lines)
    items = "".join(f"<li>{html.escape(line[2:])}</li>" for line in lines if line.startswith("- "))
    link = (f'<p><a href="{html.escape(app_url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;'
            f'background:#0a0e14;color:#ffffff;text-decoration:none">Open your review queue</a></p>') if app_url else ""
    body = (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0e14;max-width:520px">'
        '<p style="font-weight:600;font-size:18px;margin:0 0 12px">ShredSafe</p>'
        f"<p>{html.escape(lines[0])}</p><ul>{items}</ul>"
        "<p>Nothing has been deleted. Every deletion waits for your approval.</p>"
        f"{link}</div>"
    )
    return subject, text, body


def main(event=None, context=None):
    sender = (os.environ.get("NOTIFY_FROM") or "").strip()
    if not sender:
        return {"skipped": "NOTIFY_FROM is not set"}
    job = scan.latest_job()
    if scan._state(job) != "COMPLETE":
        return {"skipped": f"no finished scan ({scan._state(job)})"}
    job_id = job["jobId"]
    if _already_notified(job_id):
        return {"skipped": "already notified", "jobId": job_id}

    files = scan._all_files()
    if not any(f.get("macieJobId") == job_id for f in files):
        # Nobody has opened the results yet: score them now, exactly like "Show sensitive-data results".
        scan.ingest(Request(method="POST", path="/scan/ingest", user=None))
        files = scan._all_files()
    scanned = [f for f in files if f.get("macieJobId") == job_id and f.get("status") != "PURGED"]

    by_person = {}
    for f in scanned:
        to = _recipient(f)
        if to:
            by_person.setdefault(to, []).append(f)

    active = holds.active_holds()
    app_url = (os.environ.get("APP_URL") or "").strip()
    sent, failed = [], []
    for to, mine in sorted(by_person.items()):
        subject, text, body = compose(_summary(mine, active), app_url)
        try:
            aws.ses().send_email(
                Source=sender,
                Destination={"ToAddresses": [to]},
                Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": text}, "Html": {"Data": body}}},
            )
            sent.append(to)
        except Exception as e:  # one bad address (e.g. unverified in the SES sandbox) mustn't stop the rest
            logger.warning("Scan email to %s failed: %s", to, e)
            failed.append(to)

    audit_log.append(ACTOR, "SCAN_NOTIFIED", {}, "MACIE_SCAN",
                     detail=f"{job_id}: emailed {len(sent)}" + (f", failed {len(failed)}" if failed else ""))
    logger.info("Scan %s: emailed %s, failed %s", job_id, sent, failed)
    return {"jobId": job_id, "sent": sent, "failed": failed}
