"""D.4: purge quarantined files (permanent delete) -> PURGED + audit entry."""
import boto3
import pytest

import audit_log
from conftest import BUCKET, FILES, call
from test_disposal import add_file


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def quarantine(aws, s3, file_id):
    add_file(aws, s3, file_id, sha256=f"hash-{file_id}")
    assert call("POST", f"/files/{file_id}/approve")[0] == 200


def expire(file_id):
    boto3.resource("dynamodb").Table(FILES).update_item(
        Key={"fileId": file_id}, UpdateExpression="SET purgeAfter = :p",
        ExpressionAttributeValues={":p": "2000-01-01T00:00:00+00:00"},
    )


def versions(s3):
    res = s3.list_object_versions(Bucket=BUCKET)
    return sorted(v["Key"] for v in res.get("Versions", []) + res.get("DeleteMarkers", []))


def test_purge_now_deletes_every_version_and_marks_purged(aws, s3, monkeypatch):
    monkeypatch.setenv("DEMO_CONTROLS", "true")
    quarantine(aws, s3, "a")

    status, body = call("POST", "/files/a/purge")

    assert status == 200
    assert body["status"] == "PURGED" and body["purgedAt"]
    assert versions(s3) == []  # the upload's old version and the quarantine copy are both gone


def test_purge_writes_an_audit_entry_with_the_file_hash(aws, s3, monkeypatch):
    monkeypatch.setenv("DEMO_CONTROLS", "true")
    quarantine(aws, s3, "a")

    call("POST", "/files/a/purge")

    last = audit_log.list_entries()[-1]
    assert (last["action"], last["fileId"], last["fileHash"]) == ("PURGED", "a", "hash-a")
    assert audit_log.verify_chain() == {"ok": True}


def test_purge_during_the_grace_period_needs_demo_controls(aws, s3):
    quarantine(aws, s3, "a")

    status, body = call("POST", "/files/a/purge")

    assert status == 409
    assert "grace period" in body["error"]


def test_purge_after_the_grace_period_is_allowed(aws, s3):
    quarantine(aws, s3, "a")
    expire("a")

    status, body = call("POST", "/files/a/purge")

    assert status == 200 and body["status"] == "PURGED"


def test_only_quarantined_files_can_be_purged(aws, s3, monkeypatch):
    monkeypatch.setenv("DEMO_CONTROLS", "true")
    add_file(aws, s3, "a")

    status, _ = call("POST", "/files/a/purge")

    assert status == 409


def test_sweep_purges_only_files_past_their_grace_period(aws, s3):
    quarantine(aws, s3, "old")
    quarantine(aws, s3, "new")
    expire("old")

    status, body = call("POST", "/files/purge-expired")

    assert status == 200 and body == {"purged": ["old"]}
    assert call("GET", "/files/old")[1]["status"] == "PURGED"
    assert call("GET", "/files/new")[1]["status"] == "QUARANTINED"


def test_a_refused_version_delete_is_not_reported_as_purged(aws, s3, monkeypatch):
    # delete_objects with Quiet=True reports refused keys in Errors instead of raising.
    import aws as aws_clients
    monkeypatch.setenv("DEMO_CONTROLS", "true")
    quarantine(aws, s3, "a")
    client = aws_clients.s3()
    monkeypatch.setattr(client, "delete_objects", lambda **kw: {"Errors": [
        {"Key": kw["Delete"]["Objects"][0]["Key"], "Code": "AccessDenied", "Message": "Access Denied"}]})

    status, body = call("POST", "/files/a/purge")

    assert status == 502
    assert "AccessDenied" in body["error"]
    assert call("GET", "/files/a")[1]["status"] == "QUARANTINED"


def test_the_api_function_may_list_and_delete_object_versions():
    # moto doesn't enforce IAM, so check the template grants what purge calls (S3CrudPolicy doesn't).
    import os
    template = open(os.path.join(os.path.dirname(__file__), "..", "..", "infra", "template.yaml")).read()
    api = template[template.index("  ApiFunction:"):template.index("FunctionUrlConfig")]
    assert "s3:ListBucketVersions" in api
    assert "s3:DeleteObjectVersion" in api
