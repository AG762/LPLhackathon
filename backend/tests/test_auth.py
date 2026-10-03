"""Sign-in: Cognito ID tokens checked in handler.dispatch, and per-workspace visibility (docs/login.md).

Tokens are signed with a throwaway RSA key shaped like Cognito's, and the key lookup is pointed at
it, so the real verification code (signature, issuer, expiry, client_id, token_use) runs.
Alex and Cara share the workspace ws-acme; Sam is in ws-other."""
import json
import time
from types import SimpleNamespace

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import audit_log
import auth
import handler
from conftest import BUCKET, HOLDS, event
from test_disposal import add_file
from test_scan import macie  # noqa: F401  (fixture: fake Macie client)

POOL = "us-east-1_TestPool"
CLIENT = "test-client-id"
ISSUER = f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

ACME, OTHER = "ws-acme", "ws-other"
WORKSPACE = {"alex@example.com": ACME, "cara@example.com": ACME, "sam@example.com": OTHER}


@pytest.fixture(autouse=True)
def cognito(monkeypatch):
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("USER_POOL_ID", POOL)
    monkeypatch.setenv("USER_POOL_CLIENT_ID", CLIENT)
    fake_jwks = SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=KEY.public_key()))
    monkeypatch.setattr(auth, "_jwks", fake_jwks)
    yield
    auth.reset()


@pytest.fixture
def required(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")


def token(user="alex@example.com", groups=("advisor",), key=KEY, **overrides):
    now = int(time.time())
    claims = {"sub": "1111-2222", "email": user, "cognito:groups": list(groups), "token_use": "id",
              "custom:workspace": WORKSPACE.get(user), "aud": CLIENT, "iss": ISSUER, "iat": now,
              "exp": now + 3600, **overrides}
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256")


def call(method, path, tok=None, body=None, scheme="Bearer"):
    ev = event(method, path, body)
    ev["headers"] = {"authorization": f"{scheme} {tok}"} if tok else {}
    res = handler.main(ev, None)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def add_hold(holdId="H-1", **fields):
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={
        "holdId": holdId, "scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker", "reason": "Arbitration",
        "active": True, **fields})


# ---------- AUTH_REQUIRED=true ----------

def test_no_token_is_401(aws, required):
    status, body = call("GET", "/files")
    assert status == 401 and "Sign in" in body["error"]


def test_valid_advisor_token_is_accepted(aws, required):
    assert call("GET", "/files", token()) == (200, [])


def test_bearer_scheme_is_case_insensitive(aws, required):
    assert call("GET", "/files", token(), scheme="bearer")[0] == 200


@pytest.mark.parametrize("tok, message", [
    (lambda: token(exp=int(time.time()) - 10), "expired"),
    (lambda: token(key=OTHER_KEY), "Invalid"),                  # not signed by the pool
    (lambda: token(iss="https://cognito-idp.us-east-1.amazonaws.com/other"), "Invalid"),
    (lambda: token(aud="another-app"), "Invalid"),              # issued to a different app client
    (lambda: token(token_use="access"), "Invalid"),             # access token instead of ID token
    (lambda: token(aud=None), "Invalid"),                       # no audience
    (lambda: token(exp=None), "Invalid"),                       # no expiry
    (lambda: "not-a-jwt", "Invalid"),
])
def test_bad_tokens_are_401(aws, required, tok, message):
    status, body = call("GET", "/files", tok())
    assert status == 401 and message in body["error"]


def test_user_in_no_group_can_do_nothing(aws, required):
    assert call("GET", "/files", token(groups=()))[0] == 403


def test_unknown_groups_are_ignored(aws, required):
    assert call("GET", "/files", token(groups=("superuser",)))[0] == 403


@pytest.mark.parametrize("method, path", [
    ("POST", "/audit/demo/tamper"), ("POST", "/files/purge-expired"), ("POST", "/files/lock-sensitive"),
])
def test_system_wide_routes_need_platform_not_a_workspace_admin(aws, required, method, path):
    assert call(method, path, token(groups=("compliance",)))[0] == 403
    assert call(method, path, token(groups=("admin",)))[0] == 403  # admin of one workspace only
    assert call(method, path, token(groups=("platform",)))[0] != 403


def test_any_advisor_can_scan(aws, required, macie):  # noqa: F811
    assert call("POST", "/scan", token(groups=("advisor",)))[0] == 200
    assert call("GET", "/scan/status", token(groups=("advisor",)))[0] == 200


def test_unknown_route_is_still_404(aws, required):
    assert call("GET", "/nope")[0] == 404


# ---------- the real user is recorded ----------

def test_approve_and_reject_record_the_signed_in_user(aws, required, s3):
    add_file(aws, s3, "a", workspaceId=ACME)
    add_file(aws, s3, "b", workspaceId=OTHER)
    approved = call("POST", "/files/a/approve", token("alex@example.com"))[1]
    rejected = call("POST", "/files/b/reject", token("sam@example.com"), body={"reason": "still needed"})[1]
    assert approved["approvedBy"] == "alex@example.com"
    assert rejected["rejectedBy"] == "sam@example.com"
    actors = {(e["action"], e["actor"]) for e in audit_log.list_entries()}
    assert {("APPROVED", "alex@example.com"), ("QUARANTINED", "alex@example.com"),
            ("REJECTED", "sam@example.com")} <= actors


def test_blocked_approval_records_who_tried(aws, required, s3):
    add_file(aws, s3, "held", clientName="Margaret Whitaker", workspaceId=ACME)
    add_hold(workspaceId=ACME)
    assert call("POST", "/files/held/approve", token("alex@example.com"))[0] == 409
    last = audit_log.list_entries()[-1]
    assert (last["action"], last["actor"]) == ("APPROVAL_BLOCKED", "alex@example.com")


def test_bulk_approve_records_the_signed_in_user(aws, required, s3):
    add_file(aws, s3, "a", workspaceId=ACME)
    body = call("POST", "/files/bulk-approve", token("alex@example.com"), body={"ids": ["a"]})[1]
    assert body["approved"][0]["approvedBy"] == "alex@example.com"


def test_user_id_falls_back_to_sub_without_email(aws, s3):
    add_file(aws, s3, "a", workspaceId=ACME)
    tok = token("alex@example.com", email=None, **{"custom:workspace": ACME})
    assert call("POST", "/files/a/approve", tok)[1]["approvedBy"] == "1111-2222"


def test_account_without_a_workspace_gets_one_of_its_own(aws, required, s3):
    add_file(aws, s3, "a", workspaceId=ACME)
    lone = token("new@example.com")  # no custom:workspace claim
    assert call("GET", "/files", lone)[1] == []
    assert call("POST", "/upload-url", lone, body={"filename": "x.pdf"})[1]["headers"]["x-amz-meta-workspace"] == "user:1111-2222"


# ---------- AUTH_REQUIRED off (default, the demo) ----------

def test_off_without_token_acts_as_demo_advisor(aws, s3):
    add_file(aws, s3, "a")
    assert call("POST", "/files/a/approve")[1]["approvedBy"] == "demo-advisor"
    assert call("POST", "/audit/demo/tamper")[0] != 403  # demo user keeps every role


def test_off_with_token_records_the_real_user(aws, s3):
    add_file(aws, s3, "a", workspaceId=ACME)
    assert call("POST", "/files/a/approve", token("alex@example.com"))[1]["approvedBy"] == "alex@example.com"


def test_off_with_bad_token_is_still_401(aws):
    assert call("GET", "/files", token(key=OTHER_KEY))[0] == 401


def test_sign_in_not_configured_rejects_tokens(aws, required, monkeypatch):
    monkeypatch.delenv("USER_POOL_ID")
    status, body = call("GET", "/files", token())
    assert status == 401 and "not configured" in body["error"]


# ---------- workspaces ----------

def test_signed_in_upload_url_signs_owner_and_workspace(aws, required):
    body = call("POST", "/upload-url", token("alex@example.com"), body={"filename": "a.pdf"})[1]
    assert body["headers"] == {"x-amz-meta-owner": "alex@example.com", "x-amz-meta-workspace": ACME}
    # In X-Amz-SignedHeaders: S3 rejects an upload without them, or with a different workspace
    assert "x-amz-meta-owner" in body["url"] and "x-amz-meta-workspace" in body["url"]


def test_upload_url_without_sign_in_has_no_owner(aws):
    body = call("POST", "/upload-url", body={"filename": "a.pdf"})[1]
    assert body["headers"] == {} and "x-amz-meta" not in body["url"]


@pytest.fixture
def two_workspaces(aws, s3):
    add_file(aws, s3, "alex-file", ownerAdvisorId="alex@example.com", workspaceId=ACME, sizeBytes=10)
    add_file(aws, s3, "cara-file", ownerAdvisorId="cara@example.com", workspaceId=ACME, sizeBytes=20)
    add_file(aws, s3, "sam-file", ownerAdvisorId="sam@example.com", workspaceId=OTHER, sizeBytes=90)
    add_file(aws, s3, "demo-file", sizeBytes=5)  # uploaded without sign-in


def ids(files):
    return sorted(f["fileId"] for f in files)


def test_same_workspace_sees_the_same_files(two_workspaces, required):
    for user, groups in (("alex@example.com", ("advisor",)), ("cara@example.com", ("compliance",))):
        assert ids(call("GET", "/files", token(user, groups=groups))[1]) == ["alex-file", "cara-file"]
        assert call("GET", "/dashboard", token(user, groups=groups))[1]["totalFiles"] == 2
    assert ids(call("GET", "/files", token("sam@example.com"))[1]) == ["sam-file"]


def test_teammate_can_act_on_each_others_files(two_workspaces, required):
    approved = call("POST", "/files/cara-file/approve", token("alex@example.com"))[1]
    assert approved["status"] == "QUARANTINED" and approved["approvedBy"] == "alex@example.com"


@pytest.mark.parametrize("groups", [("admin",), ("platform",)])
def test_no_role_reaches_another_workspace(two_workspaces, required, groups):
    sam = token("sam@example.com", groups=groups)
    assert ids(call("GET", "/files", sam)[1]) == ["sam-file"]
    assert call("GET", "/files/alex-file", sam)[0] == 404


def test_another_workspaces_file_is_404_for_every_action(two_workspaces, required):
    alex = token("alex@example.com")
    for method, path in (("GET", "/files/sam-file"), ("POST", "/files/sam-file/approve"),
                         ("POST", "/files/sam-file/reject"), ("POST", "/files/sam-file/restore")):
        assert call(method, path, alex)[0] == 404
    blocked = call("POST", "/files/bulk-approve", alex, body={"ids": ["alex-file", "sam-file"]})[1]
    assert [f["fileId"] for f in blocked["approved"]] == ["alex-file"]
    assert blocked["blocked"] == [{"fileId": "sam-file", "status": 404, "error": "File not found"}]


def test_demo_user_without_sign_in_sees_everything(two_workspaces):
    assert len(call("GET", "/files")[1]) == 4


def test_audit_log_shows_the_workspaces_entries(two_workspaces, required):
    call("POST", "/files/alex-file/approve", token("alex@example.com"))
    call("POST", "/files/cara-file/approve", token("cara@example.com"))
    call("POST", "/files/sam-file/approve", token("sam@example.com"))
    entries = call("GET", "/audit", token("alex@example.com"))[1]
    assert {e["fileId"] for e in entries} == {"alex-file", "cara-file"}
    assert {e["actor"] for e in entries} == {"alex@example.com", "cara@example.com"}
    assert call("GET", "/audit/verify", token("alex@example.com"))[1] == {"ok": True}  # whole chain, ok/broken only


def test_certificate_lists_the_workspaces_disposed_files(two_workspaces, required, monkeypatch):
    import certificate
    seen = {}
    real = certificate.disposed_files
    monkeypatch.setattr(certificate, "disposed_files", lambda *a: seen.setdefault("files", real(*a)))
    call("POST", "/files/cara-file/approve", token("cara@example.com"))
    call("POST", "/files/sam-file/approve", token("sam@example.com"))
    res = handler.main({**event("GET", "/certificate"), "headers": {"authorization": f"Bearer {token('alex@example.com')}"}}, None)
    assert res["statusCode"] == 200
    assert [f["fileId"] for f in seen["files"]] == ["cara-file"]


def test_scan_ingest_reports_the_workspaces_files(two_workspaces, required, macie):  # noqa: F811
    from datetime import datetime, timezone
    macie.jobs.append({"jobId": "job-1", "name": f"{BUCKET}-x", "jobStatus": "COMPLETE",
                       "createdAt": datetime(2999, 1, 1, tzinfo=timezone.utc)})
    body = call("POST", "/scan/ingest", token("alex@example.com"))[1]
    assert body["updated"] == 2  # all four files were scored; alex hears about his workspace's two


# ---------- legal holds are per workspace ----------

def test_hold_only_applies_in_its_own_workspace(aws, required, s3):
    add_file(aws, s3, "acme", clientName="Margaret Whitaker", workspaceId=ACME)
    add_file(aws, s3, "other", clientName="Margaret Whitaker", workspaceId=OTHER)
    add_hold(workspaceId=OTHER)
    acme_file = call("GET", "/files/acme", token("alex@example.com"))[1]
    assert acme_file["legalHold"] is False and "holdReason" not in acme_file  # another firm's hold stays private
    assert call("POST", "/files/acme/approve", token("alex@example.com"))[0] == 200
    assert call("POST", "/files/other/approve", token("sam@example.com"))[0] == 409


def test_demo_holds_only_cover_demo_files(aws, required, s3):
    add_file(aws, s3, "acme", clientName="Margaret Whitaker", workspaceId=ACME)
    add_hold()  # seeded demo hold: no workspace
    assert call("GET", "/files/acme", token("alex@example.com"))[1]["legalHold"] is False


# ---------- scripts ----------

def _scripts():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))


def test_create_user_script_workspaces_and_groups():
    _scripts()
    import create_user

    class Exists(Exception):
        pass

    calls = []

    class FakeCognito:
        exceptions = SimpleNamespace(UsernameExistsException=Exists)
        users = set()

        def admin_create_user(self, **kw):
            if kw["Username"] in self.users:
                raise Exists()
            self.users.add(kw["Username"])
            ws = next(a["Value"] for a in kw["UserAttributes"] if a["Name"] == "custom:workspace")
            calls.append(("create", kw["Username"], ws))

        def admin_update_user_attributes(self, **kw):
            calls.append(("workspace", kw["Username"], kw["UserAttributes"][0]["Value"]))

        def admin_add_user_to_group(self, **kw):
            calls.append(("group", kw["Username"], kw["GroupName"]))

        def admin_set_user_password(self, **kw):
            calls.append(("password", kw["Username"], kw["Permanent"]))

    cognito = FakeCognito()
    created, ws = create_user.create_user(cognito, POOL, "alex@example.com", "admin")
    assert created and ws.startswith("ws-")  # a new account without --workspace starts a workspace
    assert create_user.create_user(cognito, POOL, "cara@example.com", "advisor", workspace=ws) == (True, ws)
    assert create_user.create_user(cognito, POOL, "alex@example.com", "compliance") == (False, None)  # stays put
    assert create_user.create_user(cognito, POOL, "alex@example.com", "advisor", workspace="ws-x") == (False, "ws-x")
    assert calls == [("create", "alex@example.com", ws), ("group", "alex@example.com", "admin"),
                     ("create", "cara@example.com", ws), ("group", "cara@example.com", "advisor"),
                     ("group", "alex@example.com", "compliance"),
                     ("workspace", "alex@example.com", "ws-x"), ("group", "alex@example.com", "advisor")]
    calls.clear()
    create_user.create_user(cognito, POOL, "test@example.com", "advisor", password="Long-test-pass-1", workspace=ws)
    assert calls == [("create", "test@example.com", ws), ("password", "test@example.com", True),
                     ("group", "test@example.com", "advisor")]


def test_seed_can_give_demo_holds_to_a_workspace():
    _scripts()
    import seed
    holds = seed.for_workspace([{"holdId": "H-1", "scopeType": "CLIENT_NAME", "scopeValue": "x"}], ACME)
    assert holds == [{"holdId": f"H-1@{ACME}", "scopeType": "CLIENT_NAME", "scopeValue": "x", "workspaceId": ACME}]


def test_frontend_env_script_maps_stack_outputs():
    _scripts()
    import frontend_env

    outputs = [{"OutputKey": k, "OutputValue": v} for k, v in {
        "ApiUrl": "https://abc.lambda-url.us-east-1.on.aws/", "UserPoolId": POOL,
        "UserPoolClientId": CLIENT, "BucketName": "ignored"}.items()]
    assert frontend_env.env_lines(outputs) == [
        "VITE_API_URL=https://abc.lambda-url.us-east-1.on.aws", f"VITE_COGNITO_USER_POOL_ID={POOL}",
        f"VITE_COGNITO_CLIENT_ID={CLIENT}", "VITE_API_MODE=live", "VITE_DEMO_CONTROLS=true"]
    with pytest.raises(SystemExit, match="UserPoolClientId"):
        frontend_env.env_lines(outputs[:2])
