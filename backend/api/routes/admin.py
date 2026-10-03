"""Admin page routes (docs/admin-api.md, STORIES D.8): retention rules, legal holds, people.

Everything is scoped to the caller's workspace (auth.py): a hold placed in one firm only covers that firm's
files, and an admin only sees and changes people in their own firm. Roles are checked in handler.ROUTES
(rules: anyone signed in; holds: compliance; people: admin). Every change appends an audit entry.

Without sign-in (AuthRequired off, the demo) holds and rules behave as before, with no workspace.
People needs a signed-in admin, because a workspace is what says whose people they are.
"""
import uuid
from datetime import datetime, timezone

from botocore.exceptions import ClientError

import audit_log
import aws
import holds
from http_utils import HttpError
from routes.files import all_files, visible_to

SCOPES = ("CLIENT_NAME", "CLIENT_ID", "ACCOUNT_ID", "BRANCH_ID", "KEYWORD")
WORKSPACE_ROLES = ("advisor", "compliance", "admin")  # platform is the operator's, never handed out here
RULE_ORDER = ["TRADE_CONFIRMATION", "ACCOUNT_STATEMENT", "CLIENT_COMMUNICATION", "ADVISORY_AGREEMENT", "MARKETING",
              "ID_DOCUMENT", "DRAFT", "DUPLICATE", "EXPIRED_PII", "PERSONAL", "UNKNOWN"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _text(body, key, label, limit=300):
    value = str(body.get(key) or "").strip()
    if not value:
        raise HttpError(400, f"{label} is required")
    if len(value) > limit:
        raise HttpError(400, f"{label} is too long (at most {limit} characters)")
    return value


def _workspace(user):
    """The caller's workspace, or None without sign-in (the demo)."""
    return user["workspace"] if user and user.get("signedIn") else None


def _scan(table):
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


# ---------- retention rules ----------

def list_rules(req):
    rules = _scan(aws.table("RULES_TABLE"))
    rank = {d: i for i, d in enumerate(RULE_ORDER)}
    rules.sort(key=lambda r: (rank.get(r.get("docType"), len(rank)), r.get("docType", "")))
    return 200, rules


# ---------- legal holds ----------

def _hold_in_scope(hold, user):
    if not user or not user.get("signedIn"):
        return True  # the demo sees every hold, as it sees every file
    return hold.get("workspaceId") == user["workspace"]


def _with_count(hold, files):
    return {**hold, "matchedFiles": sum(1 for f in files if holds.matches(hold, f))}


def list_holds(req):
    files = [f for f in all_files() if visible_to(req.user, f)]
    items = [h for h in _scan(aws.table("HOLDS_TABLE")) if _hold_in_scope(h, req.user)]
    active = sorted((h for h in items if h.get("active", True)), key=lambda h: str(h.get("createdAt", "")), reverse=True)
    released = sorted((h for h in items if not h.get("active", True)), key=lambda h: str(h.get("releasedAt", "")),
                      reverse=True)
    return 200, [_with_count(h, files) for h in active + released]


def place_hold(req):
    scope = str(req.body.get("scopeType") or "")
    if scope not in SCOPES:
        raise HttpError(400, f"scopeType must be one of {', '.join(SCOPES)}")
    hold = {
        "holdId": f"H-{uuid.uuid4().hex[:6].upper()}",
        "scopeType": scope,
        "scopeValue": _text(req.body, "scopeValue", "Who or what the hold covers", 128),
        "reason": _text(req.body, "reason", "A reason"),
        "active": True,
        "createdBy": req.user["id"],
        "createdAt": _now(),
    }
    workspace = _workspace(req.user)
    if workspace:
        hold["workspaceId"] = workspace
    aws.table("HOLDS_TABLE").put_item(Item=hold, ConditionExpression="attribute_not_exists(holdId)")
    audit_log.append(req.user["id"], "HOLD_PLACED", {}, "LEGAL_HOLD",
                     detail=f"{hold['holdId']}: {scope} {hold['scopeValue']}. {hold['reason']}")
    files = [f for f in all_files() if visible_to(req.user, f)]
    return 201, _with_count(hold, files)


def release_hold(req):
    hold_id = req.params["hold_id"]
    table = aws.table("HOLDS_TABLE")
    hold = table.get_item(Key={"holdId": hold_id}).get("Item")
    if not hold or not _hold_in_scope(hold, req.user):
        raise HttpError(404, "No such hold")  # 404, not 403: another firm's hold ids can't be probed
    if not hold.get("active", True):
        raise HttpError(409, "This hold was already released")
    reason = _text(req.body, "reason", "A reason for releasing the hold")
    released = {"active": False, "releasedBy": req.user["id"], "releasedAt": _now(), "releaseReason": reason}
    table.update_item(
        Key={"holdId": hold_id},
        UpdateExpression="SET active = :a, releasedBy = :b, releasedAt = :t, releaseReason = :r",
        ConditionExpression="active = :yes",
        ExpressionAttributeValues={":a": False, ":b": released["releasedBy"], ":t": released["releasedAt"],
                                   ":r": reason, ":yes": True},
    )
    hold = {**hold, **released}
    audit_log.append(req.user["id"], "HOLD_RELEASED", {}, "LEGAL_HOLD",
                     detail=f"{hold_id}: {hold['scopeType']} {hold['scopeValue']}. {reason}")
    reopened = _reopen_files(hold, req.user)
    return 200, {**_with_count(hold, [f for f in all_files() if visible_to(req.user, f)]), "reopenedFiles": reopened}


def _reopen_files(hold, user):
    """Files the rules engine parked under LEGAL_HOLD_OVERRIDE (RETAIN until 9999) need a fresh decision once
    no hold covers them any more: they go back to REVIEW, so a person decides. Nothing is approved here."""
    still_active = holds.active_holds()
    table, reopened = aws.table("FILES_TABLE"), 0
    for f in all_files():
        if not visible_to(user, f) or not holds.matches(hold, f):
            continue
        if f.get("ruleApplied") != "LEGAL_HOLD_OVERRIDE" or f.get("status") != "PENDING":
            continue
        if holds.find_hold(f, still_active):
            continue  # another hold still covers it
        table.update_item(
            Key={"fileId": f["fileId"]},
            UpdateExpression="SET recommendation = :r, ruleApplied = :ra, rationale = :why REMOVE keepUntil, citation",
            ExpressionAttributeValues={
                ":r": "REVIEW", ":ra": "HOLD_RELEASED",
                ":why": "The legal hold on this file was released. It needs a fresh retention decision."},
        )
        audit_log.append(user["id"], "REOPENED", f, "HOLD_RELEASED", detail=f"hold {hold['holdId']} released")
        reopened += 1
    return reopened


# ---------- people (Cognito) ----------

def _pool():
    return aws.user_pool_id()


def _admin_workspace(user):
    workspace = _workspace(user)
    if not workspace:
        raise HttpError(409, "Sign in as your firm's admin to manage people")
    return workspace


def _attrs(cognito_user):
    pairs = cognito_user.get("Attributes") or cognito_user.get("UserAttributes") or []
    return {a["Name"]: a["Value"] for a in pairs}


def _role_of(groups):
    for role in ("admin", "compliance", "advisor"):
        if role in groups:
            return role
    return "advisor"


def _groups(username):
    page = aws.cognito().admin_list_groups_for_user(UserPoolId=_pool(), Username=username)
    return [g["GroupName"] for g in page.get("Groups", [])]


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)


def _member(cognito_user, groups):
    attrs = _attrs(cognito_user)
    status = cognito_user.get("UserStatus")
    member = {
        "userId": cognito_user["Username"],
        "email": attrs.get("email", ""),
        "name": attrs.get("name"),
        "role": _role_of(groups),
        "status": "DISABLED" if not cognito_user.get("Enabled", True)
        else "INVITED" if status == "FORCE_CHANGE_PASSWORD" else "ACTIVE",
        "invitedAt": _iso(cognito_user.get("UserCreateDate")) if status == "FORCE_CHANGE_PASSWORD" else None,
        "lastActiveAt": _iso(cognito_user.get("UserLastModifiedDate")) if status != "FORCE_CHANGE_PASSWORD" else None,
    }
    return {k: v for k, v in member.items() if v is not None}


def _workspace_users(workspace):
    """Everyone in the workspace. Cognito can't filter on custom attributes, so this pages through the pool
    (fine at firm scale) and keeps the workspace's own people."""
    cognito, users, kwargs = aws.cognito(), [], {"UserPoolId": _pool(), "Limit": 60}
    while True:
        page = cognito.list_users(**kwargs)
        users.extend(u for u in page.get("Users", []) if _attrs(u).get("custom:workspace") == workspace)
        if not page.get("PaginationToken"):
            return users
        kwargs["PaginationToken"] = page["PaginationToken"]


def _load_member(user_id, workspace):
    try:
        found = aws.cognito().admin_get_user(UserPoolId=_pool(), Username=user_id)
    except ClientError as e:
        if e.response["Error"]["Code"] == "UserNotFoundException":
            raise HttpError(404, "No such person")
        raise
    if _attrs(found).get("custom:workspace") != workspace:
        raise HttpError(404, "No such person")  # someone in another firm looks the same as nobody
    return found


def _active_admins(workspace):
    return [u for u in _workspace_users(workspace) if u.get("Enabled", True) and "admin" in _groups(u["Username"])]


def list_members(req):
    workspace = _admin_workspace(req.user)
    members = [_member(u, _groups(u["Username"])) for u in _workspace_users(workspace)]
    members.sort(key=lambda m: ({"ACTIVE": 0, "INVITED": 1, "DISABLED": 2}[m["status"]], m["email"]))
    return 200, members


def invite_member(req):
    workspace = _admin_workspace(req.user)
    email = _text(req.body, "email", "An email address", 254).lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HttpError(400, "Enter a valid email address")
    role = str(req.body.get("role") or "advisor")
    if role not in WORKSPACE_ROLES:
        raise HttpError(400, f"role must be one of {', '.join(WORKSPACE_ROLES)}")
    cognito = aws.cognito()
    try:
        # Cognito emails a temporary password; the first sign-in asks for a new one.
        created = cognito.admin_create_user(
            UserPoolId=_pool(),
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:workspace", "Value": workspace},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )["User"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "UsernameExistsException":
            raise HttpError(409, f"{email} already has a ShredSafe account")
        raise
    cognito.admin_add_user_to_group(UserPoolId=_pool(), Username=created["Username"], GroupName=role)
    audit_log.append(req.user["id"], "USER_INVITED", {}, detail=f"{email} as {role}")
    return 201, _member(created, [role])


def set_member_role(req):
    workspace = _admin_workspace(req.user)
    role = str(req.body.get("role") or "")
    if role not in WORKSPACE_ROLES:
        raise HttpError(400, f"role must be one of {', '.join(WORKSPACE_ROLES)}")
    found = _load_member(req.params["user_id"], workspace)
    username, current = found["Username"], _groups(found["Username"])
    if "admin" in current and role != "admin" and found.get("Enabled", True) and len(_active_admins(workspace)) <= 1:
        raise HttpError(409, "Your firm needs at least one admin")
    cognito = aws.cognito()
    # One role per person: drop the other workspace roles first, so nobody keeps an old, higher one.
    for other in WORKSPACE_ROLES:
        if other != role and other in current:
            cognito.admin_remove_user_from_group(UserPoolId=_pool(), Username=username, GroupName=other)
    if role not in current:
        cognito.admin_add_user_to_group(UserPoolId=_pool(), Username=username, GroupName=role)
    email = _attrs(found).get("email", username)
    audit_log.append(req.user["id"], "ROLE_CHANGED", {}, detail=f"{email} to {role}")
    groups = [g for g in current if g not in WORKSPACE_ROLES] + [role]
    return 200, _member(found, groups)


def _set_enabled(req, enabled):
    workspace = _admin_workspace(req.user)
    found = _load_member(req.params["user_id"], workspace)
    username, email = found["Username"], _attrs(found).get("email", found["Username"])
    cognito = aws.cognito()
    if not enabled:
        if email == req.user["id"] or username == req.user["id"]:
            raise HttpError(409, "You can't turn off your own access")
        if "admin" in _groups(username) and len(_active_admins(workspace)) <= 1:
            raise HttpError(409, "Your firm needs at least one admin")
        cognito.admin_disable_user(UserPoolId=_pool(), Username=username)
        cognito.admin_user_global_sign_out(UserPoolId=_pool(), Username=username)  # end their sessions now
    else:
        cognito.admin_enable_user(UserPoolId=_pool(), Username=username)
    audit_log.append(req.user["id"], "USER_ENABLED" if enabled else "USER_DISABLED", {}, detail=email)
    return 200, _member({**found, "Enabled": enabled}, _groups(username))


def disable_member(req):
    return _set_enabled(req, False)


def enable_member(req):
    return _set_enabled(req, True)
