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


def queue_url(app_url):
    """APP_URL is the site's root (infra: FrontendOrigin + FrontendBasePath); the email links to the queue."""
    return f"{app_url.rstrip('/')}/queue" if app_url else ""


def compose(summary, app_url):
    """(subject, text, html) for one person's scan summary. The HTML uses tables and inline styles, which is
    what email clients render reliably."""
    s, link = summary, queue_url(app_url)
    subject = f"Your files are scanned and ready for review ({_plural(s['scanned'], 'file', 'files')})"
    intro = f"ShredSafe finished checking {_plural(s['scanned'], 'of your files', 'of your files')} for sensitive client data."
    rows = [
        (s["ready"], "ready to delete", "past retention, waiting for your approval"),
        (s["high"], "high exposure", "hold SSNs or account numbers, so they're at the top of your queue"),
        (s["review"], "need a decision", "not clear-cut, so a person decides"),
        (s["held"], "on legal hold", "kept, whatever their age"),
    ]
    lines = [intro, ""] + [f"- {n} {label}: {why}" for n, label, why in rows] + [
        "", "Nothing has been deleted. Every deletion waits for your approval."]
    if link:
        lines += ["", f"Review them: {link}"]
    text = "\n".join(lines)

    cells = "".join(
        f'<td width="50%" style="padding:14px 16px;border:1px solid #e3e6ea;vertical-align:top">'
        f'<div style="font-size:28px;font-weight:600;letter-spacing:-0.02em;color:#0a0e14">{n}</div>'
        f'<div style="font-size:14px;font-weight:600;color:#0a0e14">{html.escape(label)}</div>'
        f'<div style="font-size:13px;color:#4b5563;line-height:1.4">{html.escape(why)}</div></td>'
        + ("</tr><tr>" if i == 1 else "")
        for i, (n, label, why) in enumerate(rows)
    )
    button = (
        f'<tr><td style="padding:8px 0 24px"><a href="{html.escape(link)}" style="display:inline-block;padding:13px 24px;'
        f'border-radius:999px;background:#0a0e14;color:#ffffff;font-weight:600;text-decoration:none">'
        f"Open your review queue</a></td></tr>"
    ) if link else ""
    body = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:-apple-system,'
        'Segoe UI,Helvetica,Arial,sans-serif;color:#0a0e14;max-width:560px">'
        '<tr><td style="padding:0 0 18px;font-size:17px;font-weight:700;letter-spacing:-0.02em">ShredSafe</td></tr>'
        f'<tr><td style="padding:0 0 16px;font-size:16px;line-height:1.5">{html.escape(intro)}</td></tr>'
        '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:collapse"><tr>{cells}</tr></table></td></tr>'
        '<tr><td style="padding:18px 0 10px;font-size:15px;line-height:1.5"><b>Nothing has been deleted.</b> '
        "Every deletion waits for your approval.</td></tr>"
        f"{button}"
        '<tr><td style="padding:22px 0 0;border-top:1px solid #e3e6ea;font-size:12px;color:#6b7280;line-height:1.5">'
        "You're getting this because you uploaded files to ShredSafe. One email per scan.</td></tr></table>"
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
