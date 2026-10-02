import boto3
import pytest

from conftest import BUCKET, HOLDS, call

PAST = "2019-01-01"
FUTURE = "2099-01-01"


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def add_file(files, s3, file_id, **fields):
    key = f"uploads/{file_id}/{file_id}.pdf"
    s3.put_object(Bucket=BUCKET, Key=key, Body=b"data")
    item = {"fileId": file_id, "s3Key": key, "status": "PENDING", "recommendation": "DELETE",
            "keepUntil": PAST, "clientName": "Jane Doe", "ruleApplied": "SEC_17A4_EXPIRED", **fields}
    files.put_item(Item=item)
    return key


def add_hold(**fields):
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={"holdId": "H-1", "active": True, "reason": "Smith arbitration", **fields})


def keys(s3):
    return sorted(o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", []))


def test_approve_moves_file_to_quarantine(aws, s3):
    add_file(aws, s3, "a")
    status, body = call("POST", "/files/a/approve")
    assert status == 200
    assert body["status"] == "QUARANTINED"
    assert body["s3Key"] == "quarantine/a/a.pdf"
    assert body["approvedBy"] == "demo-advisor" and body["purgeAfter"]
    assert keys(s3) == ["quarantine/a/a.pdf"]


@pytest.mark.parametrize("hold", [
    {"scopeType": "CLIENT_NAME", "scopeValue": "smith"},
    {"scopeType": "CLIENT_ID", "scopeValue": "C-42"},
    {"scopeType": "ACCOUNT_ID", "scopeValue": "acct-9"},
    {"scopeType": "KEYWORD", "scopeValue": "held"},
])
def test_legal_hold_blocks_approval(aws, s3, hold):
    add_file(aws, s3, "held", clientName="John Smith", clientId="c-42", accountId="ACCT-9")
    add_hold(**hold)
    status, body = call("POST", "/files/held/approve")
    assert status == 409 and "legal hold" in body["error"]
    assert aws.get_item(Key={"fileId": "held"})["Item"]["status"] == "PENDING"
    assert keys(s3) == ["uploads/held/held.pdf"]


def test_inactive_or_unrelated_hold_does_not_block(aws, s3):
    add_file(aws, s3, "a", clientName="Jane Doe")
    add_hold(scopeType="CLIENT_NAME", scopeValue="Jane", active=False)
    boto3.resource("dynamodb").Table(HOLDS).put_item(
        Item={"holdId": "H-2", "active": True, "scopeType": "CLIENT_NAME", "scopeValue": "Smith"})
    assert call("POST", "/files/a/approve")[0] == 200


def test_hold_added_after_classification_still_blocks(aws, s3):
    add_file(aws, s3, "a", clientName="Jane Doe")
    add_hold(scopeType="CLIENT_NAME", scopeValue="jane doe")  # file row was written before this hold
    assert call("POST", "/files/a/approve")[0] == 409


def test_within_retention_blocks_approval(aws, s3):
    add_file(aws, s3, "a", keepUntil=FUTURE)
    status, body = call("POST", "/files/a/approve")
    assert status == 409 and FUTURE in body["error"]


def test_retain_recommendation_blocks_approval(aws, s3):
    add_file(aws, s3, "a", recommendation="RETAIN", rationale="Must be preserved under SEC Rule 17a-4")
    status, body = call("POST", "/files/a/approve")
    assert status == 409 and "17a-4" in body["error"]


def test_review_recommendation_can_be_approved_by_human(aws, s3):
    add_file(aws, s3, "a", recommendation="REVIEW", keepUntil=None)
    assert call("POST", "/files/a/approve")[0] == 200


def test_cannot_approve_twice(aws, s3):
    add_file(aws, s3, "a")
    assert call("POST", "/files/a/approve")[0] == 200
    assert call("POST", "/files/a/approve")[0] == 409


def test_approve_missing_file_is_404(aws):
    assert call("POST", "/files/nope/approve")[0] == 404


def test_failed_move_rolls_back_to_pending(aws, s3):
    add_file(aws, s3, "a")
    s3.delete_object(Bucket=BUCKET, Key="uploads/a/a.pdf")  # object vanished
    assert call("POST", "/files/a/approve")[0] == 502
    assert aws.get_item(Key={"fileId": "a"})["Item"]["status"] == "PENDING"


def test_reject(aws, s3):
    add_file(aws, s3, "a")
    status, body = call("POST", "/files/a/reject", {"reason": "Still needed for planning"})
    assert status == 200
    assert body["status"] == "REJECTED" and body["rejectReason"] == "Still needed for planning"
    assert keys(s3) == ["uploads/a/a.pdf"]
    assert call("POST", "/files/a/approve")[0] == 409


def test_bulk_approve_reports_blocked_files(aws, s3):
    add_file(aws, s3, "ok1")
    add_file(aws, s3, "ok2")
    add_file(aws, s3, "held", clientName="John Smith")
    add_hold(scopeType="CLIENT_NAME", scopeValue="Smith")
    status, body = call("POST", "/files/bulk-approve", {"ids": ["ok1", "held", "ok2", "ok1", "missing"]})
    assert status == 200
    assert [f["fileId"] for f in body["approved"]] == ["ok1", "ok2"]
    assert {b["fileId"]: b["status"] for b in body["blocked"]} == {"held": 409, "missing": 404}


def test_bulk_approve_validates_input(aws):
    assert call("POST", "/files/bulk-approve", {"ids": "a"})[0] == 400
    assert call("POST", "/files/bulk-approve", {"ids": [str(i) for i in range(101)]})[0] == 400
