"""D.6: /dashboard metrics. Expected values follow frontend/src/lib/metrics.ts computeMetrics()."""
import boto3
import pytest

import audit_log
from conftest import HOLDS, call
from test_disposal import add_file


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def test_empty_stack(aws):
    status, body = call("GET", "/dashboard")
    assert status == 200
    assert body == {
        "storageReclaimedBytes": 0, "storageReclaimedPct": 0, "piiItemsRemoved": 0, "highPriorityBacklog": 0,
        "overRetainedPct": 0, "heldFilesDeleted": 0, "autoCleared": 0, "neededReview": 0, "totalFiles": 0,
        "chainOk": True,
    }


def test_metrics_after_approvals(aws, s3):
    pii = {"USA_SOCIAL_SECURITY_NUMBER": 50, "DATE_OF_BIRTH": 10}
    add_file(aws, s3, "csv", sizeBytes=600, macieFindings=pii, priority="HIGH")         # approved below
    add_file(aws, s3, "draft", sizeBytes=200, priority="LOW")                           # approved below
    add_file(aws, s3, "backlog", sizeBytes=100, priority="HIGH")                        # HIGH + DELETE, still pending
    add_file(aws, s3, "keep", sizeBytes=50, recommendation="RETAIN", keepUntil="2099-01-01")
    add_file(aws, s3, "unsure", sizeBytes=50, recommendation="REVIEW", keepUntil=None)
    assert call("POST", "/files/bulk-approve", {"ids": ["csv", "draft"]})[1]["blocked"] == []

    body = call("GET", "/dashboard")[1]
    assert body["storageReclaimedBytes"] == 800
    assert body["storageReclaimedPct"] == pytest.approx(800 / 1000)
    assert body["piiItemsRemoved"] == 60
    assert body["highPriorityBacklog"] == 1
    assert body["overRetainedPct"] == pytest.approx(3 / 5)  # csv, draft, backlog recommended DELETE
    assert body["heldFilesDeleted"] == 0
    assert body["autoCleared"] == 4 and body["neededReview"] == 1
    assert body["totalFiles"] == 5
    assert body["chainOk"] is True  # approvals wrote audit entries and the chain still verifies


def test_held_file_that_was_removed_is_counted(aws, s3):
    # Should never happen through the API (approve refuses), so build the state directly.
    add_file(aws, s3, "a", status="QUARANTINED", clientName="Margaret Whitaker")
    add_file(aws, s3, "b", status="PURGED", ruleApplied="LEGAL_HOLD_OVERRIDE")
    add_file(aws, s3, "c", status="QUARANTINED", clientName="Jane Doe")
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={
        "holdId": "H-1", "scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker", "active": True})
    assert call("GET", "/dashboard")[1]["heldFilesDeleted"] == 2


def test_broken_audit_chain_is_reported(aws, s3, monkeypatch):
    monkeypatch.setattr(audit_log, "verify_chain", lambda: {"ok": False, "brokenAtSeq": 3})
    body = call("GET", "/dashboard")[1]
    assert body["chainOk"] is False and body["brokenAtSeq"] == 3


def test_files_without_sizes_or_findings_are_fine(aws, s3):
    add_file(aws, s3, "a", status="QUARANTINED")
    body = call("GET", "/dashboard")[1]
    assert body["storageReclaimedBytes"] == 0 and body["storageReclaimedPct"] == 0 and body["piiItemsRemoved"] == 0
