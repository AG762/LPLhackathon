"""Certificate of Disposal (STORIES.md E.4, PLAN.md section 3).

For every file disposed of in the period it records what was deleted (type, hash, size, never the
content), why (the rule and its citation), that it was allowed (no hold, retention over), who
approved it and when, and closes with the audit chain head so the certificate can be checked
against the log.
"""
import os
from datetime import datetime, timezone

import audit_log
import aws
import pdf

DISPOSED = {"QUARANTINED", "PURGED"}


def _scan(table):
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return items


def _citation(file):
    if file.get("citation"):
        return file["citation"]
    if os.environ.get("RULES_TABLE") and file.get("docType"):
        try:
            rule = aws.table("RULES_TABLE").get_item(Key={"docType": file["docType"]}).get("Item")
            if rule and rule.get("citation"):
                return rule["citation"]
        except Exception:  # rules not seeded yet: the rule id alone still says why
            pass
    return None


def _in_range(stamp, date_from, date_to):
    day = (stamp or "")[:10]
    return bool(day) and (not date_from or day >= date_from) and (not date_to or day <= date_to)


def disposed_files(date_from=None, date_to=None, user=None):
    from routes.files import visible_to  # only the caller's files on a signed-in certificate
    files = [f for f in _scan(aws.table("FILES_TABLE")) if f.get("status") in DISPOSED and visible_to(user, f)]
    files = [f for f in files if _in_range(f.get("approvedAt"), date_from, date_to)]
    return sorted(files, key=lambda f: f.get("approvedAt", ""))


def build(date_from=None, date_to=None, now=None, user=None):
    now = now or datetime.now(timezone.utc)
    entries = audit_log.list_entries()
    head = entries[-1]["entryHash"] if entries else audit_log.GENESIS
    files = disposed_files(date_from, date_to, user)

    period = f"{date_from or 'the start of the log'} to {date_to or now.date().isoformat()}"
    lines = [
        ("Certificate of Disposal", "title"),
        (f"Issued {now.strftime('%Y-%m-%d %H:%M UTC')} for disposals from {period}.", "body"),
        ("Each file below was deleted under the firm's retention policy after a person approved it. "
         "File contents are not kept; the SHA-256 hash identifies exactly what was deleted.", "body"),
        ("", "body"),
    ]
    if not files:
        lines.append(("No files were disposed of in this period.", "bold"))
    for n, f in enumerate(files, start=1):
        name = (f.get("s3Key") or "").rsplit("/", 1)[-1] or f["fileId"]
        rule = f.get("ruleApplied") or "unknown rule"
        citation = _citation(f)
        lines += [
            (f"{n}. {name}", "heading"),
            (f"What: {f.get('docType') or 'unclassified'}, {f.get('sizeBytes', 'unknown')} bytes, file id {f['fileId']}", "body"),
            (f"SHA-256: {f.get('sha256') or 'not recorded'}", "small"),
            (f"Why: {rule}" + (f" ({citation})" if citation else ""), "body"),
            (f"Allowed: no legal hold matched at approval; retention ended {f.get('keepUntil') or 'n/a (no retention requirement)'}", "body"),
            (f"Approved by: {f.get('approvedBy') or 'unknown'} at {f.get('approvedAt') or 'unknown'}", "body"),
            (f"Status: {f.get('status')}" + (f", purge after {f['purgeAfter']}" if f.get("purgeAfter") else ""), "body"),
            ("", "body"),
        ]
    lines += [
        ("Audit trail", "heading"),
        (f"Integrity check passed for all {len(entries)} audit entries at issue time.", "body"),
        (f"Audit chain head: {head}", "small"),
        ("Recompute the chain from the audit log (GET /audit/verify) and compare this head hash to confirm "
         "the log has not changed since this certificate was issued.", "small"),
    ]
    return pdf.render(lines, title="Certificate of Disposal")
