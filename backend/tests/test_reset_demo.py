"""Demo reset script (rest of A.8): wipe demo data between rehearsals."""
import os
import sys

import boto3
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import reset_demo  # noqa: E402

from conftest import AUDIT, BUCKET, FILES, HOLDS  # noqa: E402

TARGETS = {"bucket": BUCKET, "files_table": FILES, "audit_table": AUDIT}


@pytest.fixture
def demo_data(aws):
    s3 = boto3.client("s3")
    for key in ("uploads/a/a.pdf", "quarantine/b/b.pdf", "restored/c/c.pdf", "records/d/d.pdf"):
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"x")
    s3.put_object(Bucket=BUCKET, Key="uploads/a/a.pdf", Body=b"second version")
    s3.delete_object(Bucket=BUCKET, Key="quarantine/b/b.pdf")  # leaves a delete marker + old version
    ddb = boto3.resource("dynamodb")
    ddb.Table(FILES).put_item(Item={"fileId": "a", "status": "PENDING"})
    ddb.Table(AUDIT).put_item(Item={"seq": 1, "action": "APPROVED"})
    ddb.Table(HOLDS).put_item(Item={"holdId": "H-1", "active": True})
    return s3


def all_versions(s3):
    res = s3.list_object_versions(Bucket=BUCKET)
    return sorted({v["Key"] for v in res.get("Versions", []) + res.get("DeleteMarkers", [])})


def test_reset_empties_demo_data_but_keeps_locked_records_and_holds(demo_data):
    reset_demo.reset(TARGETS, apply=True)

    assert all_versions(demo_data) == ["records/d/d.pdf"]
    ddb = boto3.resource("dynamodb")
    assert ddb.Table(FILES).scan()["Items"] == []
    assert ddb.Table(AUDIT).scan()["Items"] == []
    assert len(ddb.Table(HOLDS).scan()["Items"]) == 1  # seeded config, not demo data


def test_dry_run_reports_without_deleting(demo_data):
    summary = reset_demo.reset(TARGETS, apply=False)

    assert summary == {"objectVersions": 5, "files": 1, "auditEntries": 1}
    assert "uploads/a/a.pdf" in all_versions(demo_data)
    assert len(boto3.resource("dynamodb").Table(FILES).scan()["Items"]) == 1


def test_targets_come_from_the_stack_outputs():
    outputs = [
        {"OutputKey": "BucketName", "OutputValue": "shredsafe-files-123"},
        {"OutputKey": "FilesTableName", "OutputValue": "shredsafe-Files"},
        {"OutputKey": "AuditLogTableName", "OutputValue": "shredsafe-Audit"},
        {"OutputKey": "ApiUrl", "OutputValue": "https://x"},
    ]

    assert reset_demo.targets_from_outputs(outputs) == {
        "bucket": "shredsafe-files-123", "files_table": "shredsafe-Files", "audit_table": "shredsafe-Audit",
    }
