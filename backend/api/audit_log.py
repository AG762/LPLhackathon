"""Audit hook used by the API routes.

TODO E.1: replace the body with the hash-chained DynamoDB append
(sha256(prevHash + entry)). Callers already pass everything an entry needs.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def append(actor, action, file, rule_applied=None, detail=None):
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "fileId": file.get("fileId"),
        "fileHash": file.get("sha256"),
        "ruleApplied": rule_applied,
        "detail": detail,
    }
    logger.info("AUDIT %s", entry)
    return entry
