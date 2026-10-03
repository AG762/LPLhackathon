"""Sign-in: Cognito ID tokens checked in handler.dispatch, and per-advisor file ownership (docs/login.md).

Tokens are signed with a throwaway RSA key shaped like Cognito's, and the key lookup is pointed at
it, so the real verification code (signature, issuer, expiry, client_id, token_use) runs."""
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
from conftest import BUCKET, event
from test_disposal import add_file
from test_scan import macie  # noqa: F401  (fixture: fake Macie client)

POOL = "us-east-1_TestPool"
CLIENT = "test-client-id"
ISSUER = f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


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
              "aud": CLIENT, "iss": ISSUER, "iat": now, "exp": now + 3600, **overrides}
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
def test_admin_routes_need_admin(aws, required, method, path):
    assert call(method, path, token(groups=("compliance",)))[0] == 403
    assert call(method, path, token(groups=("admin",)))[0] != 403


def test_any_advisor_can_scan(aws, required, macie):  # noqa: F811
    assert call("POST", "/scan", token(groups=("advisor",)))[0] == 200
    assert call("GET", "/scan/status", token(groups=("advisor",)))[0] == 200


def test_unknown_route_is_still_404(aws, required):
    assert call("GET", "/nope")[0] == 404


# ---------- the real user is recorded ----------

def test_approve_and_reject_record_the_signed_in_user(aws, required, s3):
    add_file(aws, s3, "a", ownerAdvisorId="alex@example.com")
    add_file(aws, s3, "b", ownerAdvisorId="sam@example.com")
    approved = call("POST", "/files/a/approve", token("alex@example.com"))[1]
    rejected = call("POST", "/files/b/reject", token("sam@example.com"), body={"reason": "still needed"})[1]
    assert approved["approvedBy"] == "alex@example.com"
    assert rejected["rejectedBy"] == "sam@example.com"
    actors = {(e["action"], e["actor"]) for e in audit_log.list_entries()}
    assert {("APPROVED", "alex@example.com"), ("QUARANTINED", "alex@example.com"),
            ("REJECTED", "sam@example.com")} <= actors


def test_blocked_approval_records_who_tried(aws, required, s3):
    add_file(aws, s3, "held", clientName="Margaret Whitaker", ownerAdvisorId="alex@example.com")
    boto3.resource("dynamodb").Table("LegalHolds").put_item(Item={
        "holdId": "H-1", "scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker", "active": True})
    assert call("POST", "/files/held/approve", token("alex@example.com"))[0] == 409
    last = audit_log.list_entries()[-1]
    assert (last["action"], last["actor"]) == ("APPROVAL_BLOCKED", "alex@example.com")


def test_bulk_approve_records_the_signed_in_user(aws, required, s3):
    add_file(aws, s3, "a", ownerAdvisorId="alex@example.com")
    body = call("POST", "/files/bulk-approve", token("alex@example.com"), body={"ids": ["a"]})[1]
    assert body["approved"][0]["approvedBy"] == "alex@example.com"


# ---------- AUTH_REQUIRED off (default, the demo) ----------

def test_off_without_token_acts_as_demo_advisor(aws, s3):
    add_file(aws, s3, "a")
    assert call("POST", "/files/a/approve")[1]["approvedBy"] == "demo-advisor"
    assert call("POST", "/audit/demo/tamper")[0] != 403  # demo user keeps every role


def test_off_with_token_records_the_real_user(aws, s3):
    add_file(aws, s3, "a", ownerAdvisorId="alex@example.com")
    assert call("POST", "/files/a/approve", token("alex@example.com"))[1]["approvedBy"] == "alex@example.com"


def test_off_with_bad_token_is_still_401(aws):
    assert call("GET", "/files", token(key=OTHER_KEY))[0] == 401


def test_sign_in_not_configured_rejects_tokens(aws, required, monkeypatch):
    monkeypatch.delenv("USER_POOL_ID")
    status, body = call("GET", "/files", token())
    assert status == 401 and "not configured" in body["error"]


# ---------- scripts/create_user.py ----------

def test_create_user_script_creates_then_only_regroups():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
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
            calls.append(("create", kw["Username"]))

        def admin_add_user_to_group(self, **kw):
            calls.append(("group", kw["Username"], kw["GroupName"]))

        def admin_set_user_password(self, **kw):
            calls.append(("password", kw["Username"], kw["Permanent"]))

    cognito = FakeCognito()
    assert create_user.create_user(cognito, POOL, "alex@example.com", "advisor") is True
    assert create_user.create_user(cognito, POOL, "alex@example.com", "compliance") is False
    assert calls == [("create", "alex@example.com"), ("group", "alex@example.com", "advisor"),
                     ("group", "alex@example.com", "compliance")]
    calls.clear()
    assert create_user.create_user(cognito, POOL, "test@example.com", "admin", password="Long-test-pass-1") is True
    assert calls == [("create", "test@example.com"), ("password", "test@example.com", True),
                     ("group", "test@example.com", "admin")]


def test_user_id_falls_back_to_sub_without_email(aws, s3):
    add_file(aws, s3, "a", ownerAdvisorId="1111-2222")
    assert call("POST", "/files/a/approve", token(email=None))[1]["approvedBy"] == "1111-2222"


# ---------- file ownership ----------

def test_signed_in_upload_url_signs_the_owner(aws, required):
    body = call("POST", "/upload-url", token("alex@example.com"), body={"filename": "a.pdf"})[1]
    assert body["headers"] == {"x-amz-meta-owner": "alex@example.com"}
    assert "x-amz-meta-owner" in body["url"]  # in X-Amz-SignedHeaders: S3 rejects uploads without it


def test_upload_url_without_sign_in_has_no_owner(aws):
    body = call("POST", "/upload-url", body={"filename": "a.pdf"})[1]
    assert body["headers"] == {} and "x-amz-meta-owner" not in body["url"]


@pytest.fixture
def two_advisors(aws, s3):
    add_file(aws, s3, "mine", ownerAdvisorId="alex@example.com", sizeBytes=10)
    add_file(aws, s3, "theirs", ownerAdvisorId="sam@example.com", sizeBytes=90)
    add_file(aws, s3, "nobody", sizeBytes=5)  # uploaded before sign-in existed


def test_advisor_sees_only_their_files(two_advisors, required):
    files = call("GET", "/files", token("alex@example.com"))[1]
    assert [f["fileId"] for f in files] == ["mine"]
    assert call("GET", "/dashboard", token("alex@example.com"))[1]["totalFiles"] == 1


@pytest.mark.parametrize("groups", [("compliance",), ("admin",)])
def test_every_role_sees_only_their_own_files(two_advisors, required, groups):
    assert call("GET", "/files", token("cara@example.com", groups=groups))[1] == []
    assert call("GET", "/files/mine", token("cara@example.com", groups=groups))[0] == 404


def test_someone_elses_file_is_404_for_every_action(two_advisors, required):
    alex = token("alex@example.com")
    assert call("GET", "/files/theirs", alex)[0] == 404
    assert call("POST", "/files/theirs/approve", alex)[0] == 404
    assert call("POST", "/files/theirs/reject", alex)[0] == 404
    assert call("POST", "/files/theirs/restore", alex)[0] == 404
    blocked = call("POST", "/files/bulk-approve", alex, body={"ids": ["mine", "theirs"]})[1]
    assert [f["fileId"] for f in blocked["approved"]] == ["mine"]
    assert blocked["blocked"] == [{"fileId": "theirs", "status": 404, "error": "File not found"}]


def test_demo_user_without_sign_in_sees_everything(two_advisors):
    assert len(call("GET", "/files")[1]) == 3


def test_frontend_env_script_maps_stack_outputs():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
    import frontend_env

    outputs = [{"OutputKey": k, "OutputValue": v} for k, v in {
        "ApiUrl": "https://abc.lambda-url.us-east-1.on.aws/", "CognitoAuthority": ISSUER,
        "UserPoolClientId": CLIENT, "CognitoDomain": "https://shredsafe-login-1.auth.us-east-1.amazoncognito.com",
        "BucketName": "ignored"}.items()]
    assert frontend_env.env_lines(outputs) == [
        "VITE_API_URL=https://abc.lambda-url.us-east-1.on.aws", f"VITE_COGNITO_AUTHORITY={ISSUER}",
        f"VITE_COGNITO_CLIENT_ID={CLIENT}", "VITE_COGNITO_DOMAIN=https://shredsafe-login-1.auth.us-east-1.amazoncognito.com",
        "VITE_API_MODE=live", "VITE_DEMO_CONTROLS=true"]
    with pytest.raises(SystemExit, match="CognitoDomain"):
        frontend_env.env_lines(outputs[:3])


def test_audit_log_shows_only_your_files_and_actions(two_advisors, required):
    call("POST", "/files/mine/approve", token("alex@example.com"))
    call("POST", "/files/theirs/approve", token("sam@example.com"))
    alex_entries = call("GET", "/audit", token("alex@example.com"))[1]
    assert alex_entries and {e["fileId"] for e in alex_entries} == {"mine"}
    assert all(e["actor"] == "alex@example.com" for e in alex_entries)
    assert call("GET", "/audit/verify", token("alex@example.com"))[1] == {"ok": True}  # whole chain, ok/broken only


def test_certificate_lists_only_your_disposed_files(two_advisors, required, monkeypatch):
    import certificate
    seen = {}
    real = certificate.disposed_files
    monkeypatch.setattr(certificate, "disposed_files", lambda *a: seen.setdefault("files", real(*a)))
    call("POST", "/files/mine/approve", token("alex@example.com"))
    call("POST", "/files/theirs/approve", token("sam@example.com"))
    res = handler.main({**event("GET", "/certificate"), "headers": {"authorization": f"Bearer {token('alex@example.com')}"}}, None)
    assert res["statusCode"] == 200
    assert [f["fileId"] for f in seen["files"]] == ["mine"]


def test_scan_ingest_reports_only_your_files(two_advisors, required, macie):  # noqa: F811
    from datetime import datetime, timezone
    macie.jobs.append({"jobId": "job-1", "name": f"{BUCKET}-x", "jobStatus": "COMPLETE",
                       "createdAt": datetime(2999, 1, 1, tzinfo=timezone.utc)})
    body = call("POST", "/scan/ingest", token("alex@example.com"))[1]
    assert body["updated"] == 1  # all three files were scored, alex hears about his one
