"""Hash-chained audit log (STORIES.md E.1).

Every entry stores entryHash = sha256(prevHash + canonical_json(entry)), where prevHash is the
previous entry's entryHash (64 zeros for the first). Editing any stored field breaks the chain at
that entry, which verify_chain() reports.

AuditLog item: {seq, timestamp, actor, action, fileId?, fileHash?, ruleApplied?, detail?,
                prevHash, entryHash}. PK seq (number).
"""
import hashlib
import json
import logging
import random
import time
from datetime import datetime, timezone

from botocore.exceptions import ClientError

import aws
from http_utils import HttpError

MAX_APPEND_ATTEMPTS = 5

logger = logging.getLogger(__name__)

GENESIS = "0" * 64


def _canonical(entry):
    body = {k: v for k, v in entry.items() if k != "entryHash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"))


def _hash(prev_hash, entry):
    return hashlib.sha256((prev_hash + _canonical(entry)).encode()).hexdigest()


def _from_item(item):
    # DynamoDB returns numbers as Decimal; seq must hash as the int it was written as.
    return {**item, "seq": int(item["seq"])}


def list_entries():
    table = aws.table("AUDIT_TABLE")
    # Strongly consistent: the default scan can miss an entry written milliseconds ago, and append
    # would then pick a seq that's already taken.
    items, kwargs = [], {"ConsistentRead": True}
    while True:  # Scan is fine at demo scale
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return sorted((_from_item(i) for i in items), key=lambda e: e["seq"])


def append(actor, action, file, rule_applied=None, detail=None):
    fields = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "fileId": file.get("fileId"),
        "fileHash": file.get("sha256"),
        "ruleApplied": rule_applied,
        # Stored as text: a number would come back from DynamoDB as Decimal and stop hashing.
        "detail": detail if detail is None or isinstance(detail, str) else json.dumps(detail, sort_keys=True, default=str),
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    # The conditional put on seq means two writers can't both take the same slot. The loser
    # re-reads the head and chains onto the entry that beat it, so the chain never forks.
    for attempt in range(MAX_APPEND_ATTEMPTS):
        if attempt:
            time.sleep(random.uniform(0.02, 0.1) * attempt)  # let the competing writer finish
        entries = list_entries()
        head = entries[-1] if entries else None
        entry = {
            "seq": head["seq"] + 1 if head else 1,
            "prevHash": head["entryHash"] if head else GENESIS,
            **fields,
        }
        entry["entryHash"] = _hash(entry["prevHash"], entry)
        try:
            aws.table("AUDIT_TABLE").put_item(Item=entry, ConditionExpression="attribute_not_exists(seq)")
            return entry
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            logger.info("Audit seq %s taken by another writer, retrying", entry["seq"])
    # An HttpError (not a crash) so bulk-approve reports this file as blocked and carries on.
    raise HttpError(503, "The audit log is busy. Try again in a moment.")


def verify_chain():
    """Recompute every hash in order. The first entry that doesn't match is where the chain broke."""
    prev_hash = GENESIS
    for entry in list_entries():
        if entry.get("prevHash") != prev_hash or entry.get("entryHash") != _hash(prev_hash, entry):
            return {"ok": False, "brokenAtSeq": entry["seq"]}
        prev_hash = entry["entryHash"]
    return {"ok": True}


# ---------- demo controls (STORIES.md E.3) ----------
# Rehearsal only: edit one stored entry the way someone in the DynamoDB console would (no re-hash),
# keeping the original value beside it so restore can put it back. Off unless DEMO_CONTROLS=true.

_DEMO_ORIGINAL = "demoOriginalActor"


def demo_tamper():
    entries = list_entries()
    if len(entries) < 2:
        return None
    target = entries[len(entries) // 2]  # a middle entry, so the break shows entries trusted before and after
    aws.table("AUDIT_TABLE").update_item(
        Key={"seq": target["seq"]},
        UpdateExpression="SET actor = :fake, #orig = if_not_exists(#orig, :real)",
        ExpressionAttributeNames={"#orig": _DEMO_ORIGINAL},
        ExpressionAttributeValues={":fake": "unknown", ":real": target["actor"]},
    )
    return target["seq"]


def demo_restore():
    """Put back every tampered entry. Returns the first restored seq, or None if nothing was tampered."""
    restored = []
    for entry in list_entries():
        if _DEMO_ORIGINAL in entry:
            aws.table("AUDIT_TABLE").update_item(
                Key={"seq": entry["seq"]},
                UpdateExpression="SET actor = :real REMOVE #orig",
                ExpressionAttributeNames={"#orig": _DEMO_ORIGINAL},
                ExpressionAttributeValues={":real": entry[_DEMO_ORIGINAL]},
            )
            restored.append(entry["seq"])
    return restored[0] if restored else None
