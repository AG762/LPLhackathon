"""/dashboard metrics (STORIES.md D.6, PLAN.md section 13).

Same numbers as frontend/src/lib/metrics.ts computeMetrics(), which the UI uses as a fallback,
so the page reads the same whichever one it shows. Percentages are fractions (0..1).
"""
import audit_log
import aws
import holds
from routes.files import visible_to

REMOVED = {"QUARANTINED", "PURGED"}


def _all_files():
    table = aws.table("FILES_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _size(f):
    return int(f.get("sizeBytes") or 0)


def _pii_count(f):
    return sum(int(n) for n in (f.get("macieFindings") or {}).values())


def _held(f, active_holds):
    # Same test as the UI's isOnHold(): a matching active hold, or the rules engine's hold override
    return f.get("ruleApplied") == "LEGAL_HOLD_OVERRIDE" or holds.find_hold(f, active_holds) is not None


def compute(files, active_holds, chain):
    removed = [f for f in files if f.get("status") in REMOVED]
    total_bytes = sum(_size(f) for f in files)
    reclaimed = sum(_size(f) for f in removed)
    total = len(files)
    return {
        "storageReclaimedBytes": reclaimed,
        "storageReclaimedPct": reclaimed / total_bytes if total_bytes else 0,
        "piiItemsRemoved": sum(_pii_count(f) for f in removed),
        "highPriorityBacklog": sum(1 for f in files if f.get("status") == "PENDING"
                                   and f.get("priority") == "HIGH" and f.get("recommendation") == "DELETE"),
        "overRetainedPct": sum(1 for f in files if f.get("recommendation") == "DELETE") / total if total else 0,
        # The "zero-error guarantee": removed files that match a hold. Should always be 0.
        "heldFilesDeleted": sum(1 for f in removed if _held(f, active_holds)),
        "autoCleared": sum(1 for f in files if f.get("recommendation") and f.get("recommendation") != "REVIEW"),
        "neededReview": sum(1 for f in files if f.get("recommendation") == "REVIEW"),
        "totalFiles": total,
        "chainOk": bool(chain.get("ok")),
        **({"brokenAtSeq": chain["brokenAtSeq"]} if chain.get("brokenAtSeq") is not None else {}),
    }


def get(req):
    files = [f for f in _all_files() if visible_to(req.user, f)]  # an advisor's dashboard covers their files
    return 200, compute(files, holds.active_holds(), audit_log.verify_chain())
