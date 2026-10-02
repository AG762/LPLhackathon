"""D.7: retained files that hold a lot of client data move to records/ under S3 Object Lock.

PLAN.md section 6: a high-sensitivity file that must be retained isn't queued for deletion; it's
flagged "Retain, high sensitivity" and moved to the locked records/ prefix until its keepUntil date.

Mode is GOVERNANCE, not COMPLIANCE: a governance lock still blocks ordinary deletes, but an admin
with s3:BypassGovernanceRetention can lift it, which matters on a shared hackathon account.
D.5 can call lock_if_needed() on each file right after scoring it.
"""
import logging
from datetime import datetime, timezone

from botocore.exceptions import ClientError

import audit_log
import aws
import holds
from http_utils import HttpError
from routes.disposal import _moved_key, _set_status

logger = logging.getLogger(__name__)

LOCK_MODE = "GOVERNANCE"


def _should_lock(file, active_holds):
    return (
        file.get("status") == "PENDING"
        and file.get("recommendation") == "RETAIN"
        and file.get("priority") == "HIGH"
        and bool(file.get("keepUntil"))
        and holds.find_hold(file, active_holds) is None  # a held file follows the hold process instead
    )


def lock_if_needed(file, active_holds=None):
    """Lock one file if it qualifies. Returns the updated row, or None if it was left alone."""
    active_holds = holds.active_holds() if active_holds is None else active_holds
    if not _should_lock(file, active_holds):
        return None

    src, dest = file["s3Key"], _moved_key(file["s3Key"], "records")
    retain_until = datetime.fromisoformat(str(file["keepUntil"])[:10]).replace(tzinfo=timezone.utc)
    try:
        s3 = aws.s3()
        s3.copy_object(Bucket=aws.bucket(), Key=dest, CopySource={"Bucket": aws.bucket(), "Key": src})
        # Retention is set as its own call: that's what the stack's IAM grants on records/*
        # (s3:PutObjectRetention), and the SDK adds the checksum S3 requires for it.
        s3.put_object_retention(Bucket=aws.bucket(), Key=dest,
                                Retention={"Mode": LOCK_MODE, "RetainUntilDate": retain_until})
        s3.delete_object(Bucket=aws.bucket(), Key=src)
    except ClientError:
        logger.exception("Locking %s failed", file["fileId"])
        raise HttpError(502, f"Could not move {file['fileId']} into locked records")

    updated = _set_status(file["fileId"], "PENDING", "LOCKED", s3Key=dest,
                          lockedAt=datetime.now(timezone.utc).isoformat(), lockedUntil=retain_until.date().isoformat())
    audit_log.append("system:api", "LOCKED", updated, file.get("ruleApplied"),
                     detail=f"{src} -> {dest}, {LOCK_MODE} retention until {retain_until.date()}")
    return updated


def lock_sensitive(req):
    """Sweep: lock every file that qualifies (run after a sensitivity scan)."""
    table = aws.table("FILES_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    active = holds.active_holds()
    locked = [f["fileId"] for f in sorted(items, key=lambda f: f["fileId"]) if lock_if_needed(f, active)]
    return 200, {"locked": locked}
