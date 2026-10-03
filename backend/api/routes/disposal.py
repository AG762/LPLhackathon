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

MAX_BULK = 100


def _now():
    return datetime.now(timezone.utc)


def _check_can_approve(file, actor):
    if file.get("status") != "PENDING":
        raise HttpError(409, f"File is {file.get('status')}, only PENDING files can be approved")

    hold = holds.find_hold(file)
    if hold:
        audit_log.append(actor, "APPROVAL_BLOCKED", file, "LEGAL_HOLD",
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


def _moved_key(key, prefix):
    """uploads/<id>/<name> or restored/<id>/<name> -> <prefix>/<id>/<name>"""
    for source in ("uploads/", "restored/", "quarantine/"):
        if key.startswith(source):
            key = key[len(source):]
            break
    return f"{prefix}/{key}"


def _quarantine_key(key):
    return _moved_key(key, "quarantine")


def _move_object(src, dest):
    s3 = aws.s3()
    s3.copy_object(Bucket=aws.bucket(), Key=dest, CopySource={"Bucket": aws.bucket(), "Key": src})
    s3.delete_object(Bucket=aws.bucket(), Key=src)


def _approve(file_id, actor):
    file = load_file(file_id)
    _check_can_approve(file, actor)

    approved_at = _now()
    _set_status(file_id, "PENDING", "APPROVED", approvedBy=actor, approvedAt=approved_at.isoformat())

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
    audit_log.append(actor, "APPROVED", updated, file.get("ruleApplied"))
    audit_log.append(actor, "QUARANTINED", updated, file.get("ruleApplied"),
                     detail=f"{src} -> {dest}, purge after {purge_after.date()}")
    return updated


def approve(req):
    return 200, _approve(req.params["file_id"], req.user["id"])


def reject(req):
    file = load_file(req.params["file_id"])
    if file.get("status") != "PENDING":
        raise HttpError(409, f"File is {file.get('status')}, only PENDING files can be rejected")
    reason = str(req.body.get("reason", ""))[:500]
    updated = _set_status(file["fileId"], "PENDING", "REJECTED", rejectedBy=req.user["id"],
                          rejectedAt=_now().isoformat(), rejectReason=reason)
    audit_log.append(req.user["id"], "REJECTED", updated, file.get("ruleApplied"), detail=reason or None)
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
            approved.append(_approve(file_id, req.user["id"]))
        except HttpError as e:
            blocked.append({"fileId": file_id, "status": e.status, "error": e.message})
    return 200, {"approved": approved, "blocked": blocked}


def restore(req):
    """Undo an approval during the grace period (D.3).

    The object goes to restored/, not back to uploads/: the process Lambda's S3 trigger only
    watches uploads/, so restoring never re-classifies the file. Approve accepts restored/ keys.
    """
    file = load_file(req.params["file_id"])
    if file.get("status") != "QUARANTINED":
        raise HttpError(409, f"File is {file.get('status')}, only QUARANTINED files can be restored")
    purge_after = file.get("purgeAfter")
    if purge_after and str(purge_after) <= _now().isoformat():
        raise HttpError(409, f"The grace period ended at {purge_after}, so the file can't be restored")

    src, dest = file["s3Key"], _moved_key(file["s3Key"], "restored")
    try:
        _move_object(src, dest)
    except ClientError:
        logger.exception("Restore move failed for %s", file["fileId"])
        raise HttpError(502, "Could not move the file out of quarantine; it is still in the grace period")

    updated = _set_status(file["fileId"], "QUARANTINED", "PENDING", s3Key=dest,
                          restoredBy=req.user["id"], restoredAt=_now().isoformat())
    audit_log.append(req.user["id"], "RESTORED", updated, file.get("ruleApplied"), detail=f"{src} -> {dest}")
    return 200, updated


# ---------- D.4 purge ----------

def _delete_all_versions(file_id):
    """Permanent delete: every version and delete marker the file left under any prefix.

    The bucket is versioned (Object Lock requires it), so a plain delete only hides the object.
    """
    s3 = aws.s3()
    for prefix in ("uploads", "quarantine", "restored"):
        pages = s3.get_paginator("list_object_versions").paginate(Bucket=aws.bucket(), Prefix=f"{prefix}/{file_id}/")
        doomed = [{"Key": v["Key"], "VersionId": v["VersionId"]}
                  for page in pages for v in page.get("Versions", []) + page.get("DeleteMarkers", [])]
        for i in range(0, len(doomed), 1000):
            res = s3.delete_objects(Bucket=aws.bucket(), Delete={"Objects": doomed[i:i + 1000], "Quiet": True})
            # Quiet mode reports refused keys in Errors instead of raising; a partial purge is a failure.
            if res.get("Errors"):
                first = res["Errors"][0]
                raise ClientError({"Error": {"Code": first.get("Code", "DeleteFailed"),
                                             "Message": f"{first.get('Key')}: {first.get('Message', '')}"}},
                                  "DeleteObjects")


def _grace_over(file):
    purge_after = file.get("purgeAfter")
    return not purge_after or str(purge_after) <= _now().isoformat()


def _purge(file):
    try:
        _delete_all_versions(file["fileId"])
    except ClientError as e:
        logger.exception("Purge failed for %s", file["fileId"])
        code = e.response.get("Error", {}).get("Code", "unknown")
        raise HttpError(502, f"Could not delete the file from storage ({code}); it is still quarantined")
    updated = _set_status(file["fileId"], "QUARANTINED", "PURGED", purgedAt=_now().isoformat())
    audit_log.append("system:api", "PURGED", updated, file.get("ruleApplied"),
                     detail="all stored versions permanently deleted")
    return updated


def purge(req):
    """Purge one quarantined file. Before its grace period ends this is a demo-only "purge now"."""
    file = load_file(req.params["file_id"])
    if file.get("status") != "QUARANTINED":
        raise HttpError(409, f"File is {file.get('status')}, only QUARANTINED files can be purged")
    if not _grace_over(file) and os.environ.get("DEMO_CONTROLS") != "true":
        raise HttpError(409, f"The grace period runs until {file.get('purgeAfter')}; the file can still be restored")
    return 200, _purge(file)


def purge_expired(req):
    """Mark every quarantined file whose grace period has ended as PURGED (the bucket lifecycle
    may already have removed the object; this keeps the Files table and audit log in step)."""
    table = aws.table("FILES_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    due = sorted((f for f in items if f.get("status") == "QUARANTINED" and _grace_over(f)), key=lambda f: f["fileId"])
    return 200, {"purged": [_purge(f)["fileId"] for f in due]}
