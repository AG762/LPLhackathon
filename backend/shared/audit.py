import hashlib
import json
from datetime import datetime, timezone

from.db import put_audit_entry

def create_hash(data: dict) -> str:
    serialized = json.dumps(
        data,
        sort_keys = True,
        default = str
    )
    return hashlib.sha256(
        serialized.encode("utf-8")

    ).hexdigest()
def append_audit(
    file_id: str,
    action: str,
    reason: str,
    user: str,
    previous_hash: str | None = None
):
    entry = {
        "file_id": file_id,
        "action": action,
        "reason": reason,
        "user": user,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "previous_hash": previous_hash
    }
    entry["entry_hash"] = create_hash(entry)
    put_audit_entry(entry)
    return entry
