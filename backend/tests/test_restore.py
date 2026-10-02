"""D.3: restore a quarantined file during its grace period."""
import boto3
import pytest

import audit_log
from conftest import FILES, call
from test_disposal import add_file, keys


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def quarantine(aws, s3, file_id="a"):
    add_file(aws, s3, file_id)
    assert call("POST", f"/files/{file_id}/approve")[0] == 200


def test_restore_brings_a_quarantined_file_back_to_review(aws, s3):
    quarantine(aws, s3)

    status, body = call("POST", "/files/a/restore")

    assert status == 200
    assert body["status"] == "PENDING"
    # restored/ is outside the uploads/ trigger, so the file isn't re-classified
    assert body["s3Key"] == "restored/a/a.pdf"
    assert keys(s3) == ["restored/a/a.pdf"]
    assert body["restoredBy"] == "demo-advisor" and body["restoredAt"]


def test_restore_writes_an_audit_entry(aws, s3):
    quarantine(aws, s3)

    call("POST", "/files/a/restore")

    last = audit_log.list_entries()[-1]
    assert last["action"] == "RESTORED" and last["fileId"] == "a"
    assert audit_log.verify_chain() == {"ok": True}


def test_only_quarantined_files_can_be_restored(aws, s3):
    add_file(aws, s3, "a")

    status, body = call("POST", "/files/a/restore")

    assert status == 409
    assert "PENDING" in body["error"]


def test_restore_is_refused_after_the_grace_period(aws, s3):
    quarantine(aws, s3)
    boto3.resource("dynamodb").Table(FILES).update_item(
        Key={"fileId": "a"}, UpdateExpression="SET purgeAfter = :p",
        ExpressionAttributeValues={":p": "2000-01-01T00:00:00+00:00"},
    )

    status, body = call("POST", "/files/a/restore")

    assert status == 409
    assert "grace period" in body["error"]


def test_a_restored_file_can_be_approved_again(aws, s3):
    quarantine(aws, s3)
    call("POST", "/files/a/restore")

    status, body = call("POST", "/files/a/approve")

    assert status == 200
    assert body["s3Key"] == "quarantine/a/a.pdf"
    assert keys(s3) == ["quarantine/a/a.pdf"]


def test_restore_missing_file_is_404(aws):
    assert call("POST", "/files/nope/restore")[0] == 404
