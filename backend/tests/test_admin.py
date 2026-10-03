"""Admin page routes (D.8, docs/admin-api.md): retention rules, legal holds, people.

Signed-in calls use test_auth's throwaway-key tokens; people live in a moto Cognito pool. Workspaces as in
test_auth: Alex and Cara are in ws-acme, Sam in ws-other."""
import boto3
import pytest

import audit_log
import auth
from conftest import HOLDS
from test_auth import ACME, ISSUER, OTHER, call, token
from test_auth import cognito as cognito_tokens  # noqa: F401  (autouse: points token checks at the test key)
from test_disposal import add_file

RULES = "RetentionRules"


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


@pytest.fixture
def rules(aws, monkeypatch):
    monkeypatch.setenv("RULES_TABLE", RULES)
    table = boto3.resource("dynamodb").create_table(
        TableName=RULES, KeySchema=[{"AttributeName": "docType", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "docType", "AttributeType": "S"}], BillingMode="PAY_PER_REQUEST")
    for rule in [
        {"docType": "DRAFT", "retentionYears": 0, "trigger": "CREATED", "action": "DELETE", "citation": "none",
         "description": "Drafts"},
        {"docType": "TRADE_CONFIRMATION", "retentionYears": 6, "trigger": "CREATED", "action": "RETAIN",
         "citation": "SEC Rule 17a-4", "description": "Confirms"},
    ]:
        table.put_item(Item=rule)
    return table


@pytest.fixture
def pool(aws, monkeypatch):
    """A moto user pool shaped like infra: email usernames, custom:workspace, the four role groups."""
    idp = boto3.client("cognito-idp")
    pool_id = idp.create_user_pool(
        PoolName="test", UsernameAttributes=["email"],
        Schema=[{"Name": "workspace", "AttributeDataType": "String", "Mutable": True},
                {"Name": "firm", "AttributeDataType": "String", "Mutable": True}],
    )["UserPool"]["Id"]
    for group in ("advisor", "compliance", "admin", "platform"):
        idp.create_group(UserPoolId=pool_id, GroupName=group)
    monkeypatch.setenv("USER_POOL_ID", pool_id)
    # Tokens are still signed for the test issuer; only the people calls use the moto pool's id.
    monkeypatch.setattr(auth, "_issuer", lambda: ISSUER)
    return idp, pool_id


def add_user(pool, email, workspace, role):
    idp, pool_id = pool
    user = idp.admin_create_user(UserPoolId=pool_id, Username=email, MessageAction="SUPPRESS", UserAttributes=[
        {"Name": "email", "Value": email}, {"Name": "custom:workspace", "Value": workspace}])["User"]
    idp.admin_add_user_to_group(UserPoolId=pool_id, Username=user["Username"], GroupName=role)
    return user["Username"]


def groups_of(pool, username):
    idp, pool_id = pool
    return sorted(g["GroupName"] for g in idp.admin_list_groups_for_user(UserPoolId=pool_id, Username=username)["Groups"])


ADMIN = token("alex@example.com", groups=("admin",))
COMPLIANCE = token("cara@example.com", groups=("compliance",))
ADVISOR = token("cara@example.com", groups=("advisor",))
OTHER_ADMIN = token("sam@example.com", groups=("admin",))


# ---------- retention rules ----------

def test_rules_are_listed_in_schedule_order_for_any_signed_in_user(rules):
    status, body = call("GET", "/rules", ADVISOR)
    assert status == 200
    assert [r["docType"] for r in body] == ["TRADE_CONFIRMATION", "DRAFT"]
    assert body[0]["retentionYears"] == 6  # Decimal comes back as a number


# ---------- legal holds ----------

def test_compliance_places_a_hold_that_blocks_approval_in_its_workspace_only(aws, s3):
    add_file(aws, s3, "mine", clientName="Daniel Okafor", workspaceId=ACME)
    add_file(aws, s3, "theirs", clientName="Daniel Okafor", workspaceId=OTHER)

    status, hold = call("POST", "/holds", COMPLIANCE, {"scopeType": "CLIENT_NAME", "scopeValue": "Daniel Okafor",
                                                      "reason": "Estate dispute"})
    assert status == 201
    assert hold["active"] is True and hold["workspaceId"] == ACME and hold["createdBy"] == "cara@example.com"
    assert hold["matchedFiles"] == 1  # the other firm's Okafor file isn't counted

    assert call("POST", "/files/mine/approve", ADMIN)[0] == 409
    sam = token("sam@example.com", groups=("advisor",))
    assert call("POST", "/files/theirs/approve", sam)[0] == 200  # a hold in ws-acme never reaches ws-other

    actions = [e["action"] for e in audit_log.list_entries()]
    assert "HOLD_PLACED" in actions


def test_holds_are_listed_per_workspace(aws):
    call("POST", "/holds", COMPLIANCE, {"scopeType": "KEYWORD", "scopeValue": "Okafor", "reason": "r"})
    call("POST", "/holds", OTHER_ADMIN, {"scopeType": "KEYWORD", "scopeValue": "Chen", "reason": "r"})
    _, mine = call("GET", "/holds", COMPLIANCE)
    _, theirs = call("GET", "/holds", OTHER_ADMIN)
    assert [h["scopeValue"] for h in mine] == ["Okafor"]
    assert [h["scopeValue"] for h in theirs] == ["Chen"]


def test_advisors_cannot_place_holds(aws):
    status, body = call("POST", "/holds", ADVISOR, {"scopeType": "KEYWORD", "scopeValue": "x", "reason": "r"})
    assert status == 403


@pytest.mark.parametrize("body, message", [
    ({"scopeType": "NOPE", "scopeValue": "x", "reason": "r"}, "scopeType"),
    ({"scopeType": "KEYWORD", "scopeValue": " ", "reason": "r"}, "required"),
    ({"scopeType": "KEYWORD", "scopeValue": "x", "reason": ""}, "reason"),
])
def test_hold_input_is_checked(aws, body, message):
    status, err = call("POST", "/holds", COMPLIANCE, body)
    assert status == 400 and message.lower() in err["error"].lower()


def test_releasing_a_hold_needs_a_reason_and_sends_its_files_back_for_review(aws, s3):
    add_file(aws, s3, "w", clientName="Margaret Whitaker", workspaceId=ACME, recommendation="RETAIN",
             ruleApplied="LEGAL_HOLD_OVERRIDE", keepUntil="9999-12-31")
    _, hold = call("POST", "/holds", COMPLIANCE, {"scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker",
                                                 "reason": "Arbitration"})
    path = f"/holds/{hold['holdId']}/release"

    assert call("POST", path, COMPLIANCE, {"reason": ""})[0] == 400
    status, released = call("POST", path, COMPLIANCE, {"reason": "Settled"})
    assert status == 200
    assert released["active"] is False and released["releaseReason"] == "Settled" and released["reopenedFiles"] == 1

    row = aws.get_item(Key={"fileId": "w"})["Item"]
    assert row["recommendation"] == "REVIEW" and row["ruleApplied"] == "HOLD_RELEASED" and "keepUntil" not in row
    assert call("POST", path, COMPLIANCE, {"reason": "again"})[0] == 409
    assert {"HOLD_RELEASED", "REOPENED"} <= {e["action"] for e in audit_log.list_entries()}


def test_a_file_still_under_another_hold_stays_parked(aws, s3):
    add_file(aws, s3, "w", clientName="Margaret Whitaker", workspaceId=ACME, recommendation="RETAIN",
             ruleApplied="LEGAL_HOLD_OVERRIDE", keepUntil="9999-12-31")
    _, first = call("POST", "/holds", COMPLIANCE, {"scopeType": "CLIENT_NAME", "scopeValue": "Whitaker", "reason": "a"})
    call("POST", "/holds", COMPLIANCE, {"scopeType": "KEYWORD", "scopeValue": "w", "reason": "b"})
    _, released = call("POST", f"/holds/{first['holdId']}/release", COMPLIANCE, {"reason": "done"})
    assert released["reopenedFiles"] == 0
    assert aws.get_item(Key={"fileId": "w"})["Item"]["recommendation"] == "RETAIN"


def test_another_workspaces_hold_looks_missing(aws):
    _, hold = call("POST", "/holds", OTHER_ADMIN, {"scopeType": "KEYWORD", "scopeValue": "x", "reason": "r"})
    assert call("POST", f"/holds/{hold['holdId']}/release", COMPLIANCE, {"reason": "r"})[0] == 404


def test_without_sign_in_holds_work_as_before(aws, s3):
    add_file(aws, s3, "a", clientName="Arthur Smith")
    status, hold = call("POST", "/holds", None, {"scopeType": "CLIENT_NAME", "scopeValue": "Arthur Smith", "reason": "r"})
    assert status == 201 and "workspaceId" not in hold and hold["matchedFiles"] == 1
    assert call("POST", "/files/a/approve")[0] == 409
    assert boto3.resource("dynamodb").Table(HOLDS).get_item(Key={"holdId": hold["holdId"]})["Item"]["active"] is True


# ---------- people ----------

def test_admin_lists_only_their_own_workspace(pool):
    add_user(pool, "alex@example.com", ACME, "admin")
    add_user(pool, "cara@example.com", ACME, "advisor")
    add_user(pool, "sam@example.com", OTHER, "admin")
    status, members = call("GET", "/admin/users", ADMIN)
    assert status == 200
    assert {m["email"]: m["role"] for m in members} == {"alex@example.com": "admin", "cara@example.com": "advisor"}


def test_only_admins_manage_people(pool):
    assert call("GET", "/admin/users", COMPLIANCE)[0] == 403
    assert call("POST", "/admin/users", ADVISOR, {"email": "x@example.com", "role": "advisor"})[0] == 403


def test_people_need_sign_in(pool):
    status, body = call("GET", "/admin/users")
    assert status == 409 and "Sign in" in body["error"]


def test_invite_puts_the_person_in_the_admins_workspace_with_one_role(pool):
    add_user(pool, "alex@example.com", ACME, "admin")
    status, member = call("POST", "/admin/users", ADMIN, {"email": "New.Person@Example.com", "role": "compliance"})
    assert status == 201
    assert member["email"] == "new.person@example.com" and member["role"] == "compliance"
    assert member["status"] == "INVITED"

    idp, pool_id = pool
    attrs = {a["Name"]: a["Value"] for a in idp.admin_get_user(UserPoolId=pool_id, Username=member["userId"])["UserAttributes"]}
    assert attrs["custom:workspace"] == ACME
    assert groups_of(pool, member["userId"]) == ["compliance"]
    assert call("POST", "/admin/users", ADMIN, {"email": "new.person@example.com", "role": "advisor"})[0] == 409
    assert "USER_INVITED" in [e["action"] for e in audit_log.list_entries()]


@pytest.mark.parametrize("body", [{"email": "nope", "role": "advisor"}, {"email": "a@b.com", "role": "platform"}])
def test_invite_input_is_checked(pool, body):
    assert call("POST", "/admin/users", ADMIN, body)[0] == 400


def test_changing_a_role_drops_the_old_one(pool):
    add_user(pool, "alex@example.com", ACME, "admin")
    cara = add_user(pool, "cara@example.com", ACME, "admin")  # e.g. signed up first, then joined Acme
    status, member = call("POST", f"/admin/users/{cara}/role", ADMIN, {"role": "advisor"})
    assert status == 200 and member["role"] == "advisor"
    assert groups_of(pool, cara) == ["advisor"]
    assert "ROLE_CHANGED" in [e["action"] for e in audit_log.list_entries()]


def test_the_last_admin_cannot_be_demoted_or_turned_off(pool):
    alex = add_user(pool, "alex@example.com", ACME, "admin")
    cara_tok = token("cara@example.com", groups=("admin",))
    status, body = call("POST", f"/admin/users/{alex}/role", cara_tok, {"role": "advisor"})
    assert status == 409 and "at least one admin" in body["error"]
    assert call("POST", f"/admin/users/{alex}/disable", cara_tok)[0] == 409


def test_turning_access_off_and_on(pool):
    add_user(pool, "alex@example.com", ACME, "admin")
    cara = add_user(pool, "cara@example.com", ACME, "advisor")
    status, member = call("POST", f"/admin/users/{cara}/disable", ADMIN)
    assert status == 200 and member["status"] == "DISABLED"
    idp, pool_id = pool
    assert idp.admin_get_user(UserPoolId=pool_id, Username=cara)["Enabled"] is False
    status, member = call("POST", f"/admin/users/{cara}/enable", ADMIN)
    assert status == 200 and member["status"] != "DISABLED"


def test_you_cannot_turn_off_your_own_access(pool):
    alex = add_user(pool, "alex@example.com", ACME, "admin")
    add_user(pool, "cara@example.com", ACME, "admin")
    status, body = call("POST", f"/admin/users/{alex}/disable", ADMIN)
    assert status == 409 and "your own" in body["error"]


def test_people_in_another_workspace_look_missing(pool):
    add_user(pool, "alex@example.com", ACME, "admin")
    sam = add_user(pool, "sam@example.com", OTHER, "advisor")
    assert call("POST", f"/admin/users/{sam}/role", ADMIN, {"role": "compliance"})[0] == 404
    assert call("POST", f"/admin/users/{sam}/disable", ADMIN)[0] == 404
