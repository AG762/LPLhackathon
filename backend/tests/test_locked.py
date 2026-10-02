"""D.7: files that must be retained and hold a lot of client data move to records/ under Object Lock."""
import boto3
import pytest

import audit_log
from conftest import BUCKET, HOLDS, call
from test_disposal import add_file

KEEP = {"recommendation": "RETAIN", "keepUntil": "2031-06-30", "priority": "HIGH", "sensitivityScore": 144}


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def test_retained_high_sensitivity_file_is_locked_in_records(aws, s3):
    add_file(aws, s3, "a", **KEEP)

    status, body = call("POST", "/files/lock-sensitive")

    assert status == 200 and body == {"locked": ["a"]}
    file = call("GET", "/files/a")[1]
    assert file["status"] == "LOCKED" and file["s3Key"] == "records/a/a.pdf"
    head = s3.head_object(Bucket=BUCKET, Key="records/a/a.pdf")  # moto's GetObjectRetention 500s
    assert head["ObjectLockMode"] == "GOVERNANCE"
    assert head["ObjectLockRetainUntilDate"].date().isoformat() == "2031-06-30"


def test_locking_writes_an_audit_entry(aws, s3):
    add_file(aws, s3, "a", **KEEP)

    call("POST", "/files/lock-sensitive")

    last = audit_log.list_entries()[-1]
    assert (last["action"], last["fileId"]) == ("LOCKED", "a")


@pytest.mark.parametrize("fields", [
    {**KEEP, "priority": "MEDIUM"},          # not sensitive enough
    {**KEEP, "recommendation": "DELETE"},    # deletable files are queued, not locked
    {**KEEP, "keepUntil": None},             # no retention date to lock until
])
def test_other_files_are_left_alone(aws, s3, fields):
    add_file(aws, s3, "a", **{k: v for k, v in fields.items() if v is not None})
    if fields.get("keepUntil") is None:
        boto3.resource("dynamodb").Table("Files").update_item(Key={"fileId": "a"}, UpdateExpression="REMOVE keepUntil")

    assert call("POST", "/files/lock-sensitive") == (200, {"locked": []})
    assert call("GET", "/files/a")[1]["status"] == "PENDING"


def test_held_files_are_not_locked(aws, s3):
    add_file(aws, s3, "a", **KEEP)
    boto3.resource("dynamodb").Table(HOLDS).put_item(
        Item={"holdId": "H-1", "active": True, "scopeType": "CLIENT_NAME", "scopeValue": "Jane Doe"})

    assert call("POST", "/files/lock-sensitive") == (200, {"locked": []})


def test_a_locked_file_cannot_be_approved(aws, s3):
    add_file(aws, s3, "a", **KEEP)
    call("POST", "/files/lock-sensitive")

    assert call("POST", "/files/a/approve")[0] == 409
