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
from datetime import datetime, timezone

from botocore.exceptions import ClientError

import aws

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
    items, kwargs = [], {}
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
        "detail": detail,
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    # The conditional put on seq means two writers can't both take the same slot. The loser
    # re-reads the head and chains onto the entry that beat it, so the chain never forks.
    for _ in range(MAX_APPEND_ATTEMPTS):
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
    raise RuntimeError(f"Could not append audit entry after {MAX_APPEND_ATTEMPTS} attempts")


def verify_chain():
    """Recompute every hash in order. The first entry that doesn't match is where the chain broke."""
    prev_hash = GENESIS
    for entry in list_entries():
        if entry.get("prevHash") != prev_hash or entry.get("entryHash") != _hash(prev_hash, entry):
            return {"ok": False, "brokenAtSeq": entry["seq"]}
        prev_hash = entry["entryHash"]
    return {"ok": True}
