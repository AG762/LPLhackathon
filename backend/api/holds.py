"""Legal hold matching for the approve guard.

LegalHolds item: {holdId, scopeType, scopeValue, reason, active, workspaceId?}
  A hold only applies to files of its own workspace (workspaceId), so one firm's hold never blocks or
  reveals anything in another. Holds without a workspace (the seeded demo holds) apply to files without
  one (uploads made without sign-in).
  scopeType: CLIENT_NAME (substring, case-insensitive) | CLIENT_ID | ACCOUNT_ID | BRANCH_ID | KEYWORD
  KEYWORD matches the file name or client name.

Holds are read fresh on every approval: a hold placed after a file was
classified must still block its deletion.
"""
import aws

_ID_FIELDS = {"CLIENT_ID": "clientId", "ACCOUNT_ID": "accountId", "BRANCH_ID": "branchId"}


def active_holds():
    table = aws.table("HOLDS_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return [h for h in items if h.get("active", True)]


def _norm(value):
    return str(value or "").strip().lower()


def matches(hold, file):
    if hold.get("workspaceId") != file.get("workspaceId"):
        return False
    scope, value = hold.get("scopeType"), _norm(hold.get("scopeValue"))
    if not value:
        return False
    if scope == "CLIENT_NAME":
        return value in _norm(file.get("clientName"))
    if scope in _ID_FIELDS:
        return value == _norm(file.get(_ID_FIELDS[scope]))
    if scope == "KEYWORD":
        filename = _norm(file.get("s3Key")).rsplit("/", 1)[-1]
        return value in filename or value in _norm(file.get("clientName"))
    return False


def find_hold(file, holds=None):
    for hold in active_holds() if holds is None else holds:
        if matches(hold, file):
            return hold
    return None
