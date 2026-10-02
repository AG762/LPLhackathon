"""/files/{id}/approve|reject|restore, /files/bulk-approve (STORIES.md D.2-D.4)

Approve = move the object from uploads/ to quarantine/ (the grace period;
the bucket lifecycle purges quarantine/ later). The server re-checks every
guard on approval, so the UI can't delete a held or still-retained file.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from botocore.exceptions import ClientError

import audit_log
import aws
import holds
from http_utils import HttpError
from routes.files import load_file

logger = logging.getLogger(__name__)

DEMO_ADVISOR = "demo-advisor"  # no login in the MVP
MAX_BULK = 100


def _now():
    return datetime.now(timezone.utc)


def _check_can_approve(file):
    if file.get("status") != "PENDING":
        raise HttpError(409, f"File is {file.get('status')}, only PENDING files can be approved")

    hold = holds.find_hold(file)
    if hold:
        audit_log.append(DEMO_ADVISOR, "APPROVAL_BLOCKED", file, "LEGAL_HOLD",
                         detail=f"hold {hold.get('holdId')}: {hold.get('reason', '')}")
        raise HttpError(409, f"Blocked by legal hold {hold.get('holdId')}: {hold.get('reason', '')}".strip())

    if file.get("recommendation") == "RETAIN":
        raise HttpError(409, "File must be retained: " + (file.get("rationale") or "retention rule applies"))

    keep_until = file.get("keepUntil")
    if keep_until and str(keep_until) > _now().date().isoformat():
        raise HttpError(409, f"File is within its retention period until {keep_until}")


def _set_status(file_id, expected, new, **fields):
    """Conditional status change: fails with 409 if someone else changed it first."""
    names = {"#s": "status"}
    values = {":expected": expected, ":new": new}
    sets = ["#s = :new"]
    for i, (key, value) in enumerate(fields.items()):
        names[f"#f{i}"] = key
        values[f":v{i}"] = value
        sets.append(f"#f{i} = :v{i}")
    try:
        return aws.table("FILES_TABLE").update_item(
            Key={"fileId": file_id},
            UpdateExpression="SET " + ", ".join(sets),
            ConditionExpression="#s = :expected",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HttpError(409, "File status changed, refresh and try again")
        raise


def _quarantine_key(key):
    rest = key[len("uploads/"):] if key.startswith("uploads/") else key
    return f"quarantine/{rest}"


def _approve(file_id):
    file = load_file(file_id)
    _check_can_approve(file)

    approved_at = _now()
    _set_status(file_id, "PENDING", "APPROVED", approvedBy=DEMO_ADVISOR, approvedAt=approved_at.isoformat())

    src, dest = file["s3Key"], _quarantine_key(file["s3Key"])
    try:
        s3 = aws.s3()
        s3.copy_object(Bucket=aws.bucket(), Key=dest, CopySource={"Bucket": aws.bucket(), "Key": src})
        s3.delete_object(Bucket=aws.bucket(), Key=src)
    except ClientError:
        logger.exception("Quarantine move failed for %s", file_id)
        _set_status(file_id, "APPROVED", "PENDING")
        raise HttpError(502, "Could not move file to quarantine, approval rolled back")

    purge_after = approved_at + timedelta(days=int(os.environ.get("QUARANTINE_DAYS", "1")))
    updated = _set_status(file_id, "APPROVED", "QUARANTINED", s3Key=dest,
                          quarantinedAt=_now().isoformat(), purgeAfter=purge_after.isoformat())
    audit_log.append(DEMO_ADVISOR, "APPROVED", updated, file.get("ruleApplied"))
    audit_log.append(DEMO_ADVISOR, "QUARANTINED", updated, file.get("ruleApplied"),
                     detail=f"{src} -> {dest}, purge after {purge_after.date()}")
    return updated


def approve(req):
    return 200, _approve(req.params["file_id"])


def reject(req):
    file = load_file(req.params["file_id"])
    if file.get("status") != "PENDING":
        raise HttpError(409, f"File is {file.get('status')}, only PENDING files can be rejected")
    reason = str(req.body.get("reason", ""))[:500]
    updated = _set_status(file["fileId"], "PENDING", "REJECTED", rejectedBy=DEMO_ADVISOR,
                          rejectedAt=_now().isoformat(), rejectReason=reason)
    audit_log.append(DEMO_ADVISOR, "REJECTED", updated, file.get("ruleApplied"), detail=reason or None)
    return 200, updated


def bulk_approve(req):
    ids = req.body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise HttpError(400, "ids must be a list of file ids")
    if len(ids) > MAX_BULK:
        raise HttpError(400, f"At most {MAX_BULK} ids per request")

    approved, blocked = [], []
    for file_id in dict.fromkeys(ids):  # dedupe, keep order
        try:
            approved.append(_approve(file_id))
        except HttpError as e:
            blocked.append({"fileId": file_id, "status": e.status, "error": e.message})
    return 200, {"approved": approved, "blocked": blocked}


def restore(req):
    # TODO D.3: move quarantine/ -> uploads/ (note: that re-triggers `process`), audit entry
    raise HttpError(501, "restore not implemented")
