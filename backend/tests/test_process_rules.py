"""B.2: the process Lambda decides with the rules engine (B.1) and writes the Files contract row."""
import filecmp
import importlib.util
import io
import os
import sys
from datetime import datetime, timedelta

import boto3
import pytest

from conftest import BUCKET, FILES, HOLDS

PROCESS_DIR = os.path.join(os.path.dirname(__file__), "..", "process")
SHARED_RULES = os.path.join(os.path.dirname(__file__), "..", "shared", "rules.py")
sys.path.append(PROCESS_DIR)


def load_handler():
    # Same way Lambda loads it: its own folder on the path, no `backend.` prefix (AGENTS.md rule 1)
    spec = importlib.util.spec_from_file_location("process_handler_b2", os.path.join(PROCESS_DIR, "handler.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def years_ago(n):
    return (datetime.now() - timedelta(days=int(n * 365.25) + 10)).strftime("%Y-%m-%d")


@pytest.fixture
def run(aws, monkeypatch):
    """Upload one file and run the handler with a canned classification. Returns the stored row."""
    handler = load_handler()
    monkeypatch.setattr(handler, "s3", boto3.client("s3"))
    monkeypatch.setattr(handler, "dynamodb", boto3.resource("dynamodb"))
    monkeypatch.setenv("FILES_TABLE", FILES)
    monkeypatch.setattr(handler, "FILES_TABLE", FILES)
    monkeypatch.setenv("HOLDS_TABLE", HOLDS)

    def _run(classification, file_id="f1", name="doc.txt"):
        handler.CLASSIFICATION_CACHE.clear()
        monkeypatch.setattr(handler, "classify_text", lambda text: dict(classification))
        key = f"uploads/{file_id}/{name}"
        boto3.client("s3").put_object(Bucket=BUCKET, Key=key, Body=f"content of {name}".encode())
        handler.process_file_event({"Records": [{"s3": {"bucket": {"name": BUCKET}, "object": {"key": key}}}]}, None)
        return boto3.resource("dynamodb").Table(FILES).get_item(Key={"fileId": file_id})["Item"]

    return _run


def test_the_deployed_copy_of_the_rules_engine_matches_shared():
    # backend/shared isn't packaged into any Lambda (AGENTS.md), so process carries a copy.
    assert filecmp.cmp(os.path.join(PROCESS_DIR, "rules.py"), SHARED_RULES, shallow=False), \
        "backend/process/rules.py drifted from backend/shared/rules.py: copy shared over process"


def test_expired_client_pii_is_recommended_for_deletion(run):
    row = run({"doc_type": "EXPIRED_PII", "confidence": 0.93, "document_date": "2016-05-01",
               "pii_detected": ["SSN", "DOB"], "rationale": "Old client list with SSNs."})

    assert row["recommendation"] == "DELETE"
    assert row["ruleApplied"] == "REG_SP_DISPOSAL"
    assert row["piiTypes"] == ["SSN", "DOB"]


def test_a_recent_trade_confirmation_is_kept_until_six_years_out(run):
    date = years_ago(1)
    row = run({"doc_type": "TRADE_CONFIRMATION", "confidence": 0.98, "document_date": date})

    assert row["recommendation"] == "RETAIN"
    assert row["ruleApplied"] == "SEC_17A4_6YR_ACTIVE"
    assert row["keepUntil"] == f"{int(date[:4]) + 6}{date[4:]}"


def test_marketing_follows_the_five_year_rule(run):
    row = run({"doc_type": "MARKETING", "confidence": 0.9, "document_date": years_ago(6)})

    assert row["recommendation"] == "DELETE"
    assert row["ruleApplied"] == "ADVISERS_ACT_204_2_EXPIRED"


def test_a_client_under_a_seeded_hold_is_retained(run):
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={
        "holdId": "H-1", "scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker",
        "reason": "Arbitration", "active": True})

    row = run({"doc_type": "CLIENT_COMMUNICATION", "confidence": 0.95, "document_date": years_ago(6),
               "client_name": "Margaret Whitaker"})

    assert row["recommendation"] == "RETAIN"
    assert row["ruleApplied"] == "LEGAL_HOLD_OVERRIDE"


def test_unknown_fields_are_omitted_not_written_as_na(run):
    row = run({"doc_type": "DRAFT", "confidence": 0.9, "client_name": "N/A", "account_id": None,
               "document_date": "N/A"})

    for field in ("clientName", "accountId", "documentDate", "keepUntil"):
        assert field not in row, field
    assert row["recommendation"] == "DELETE"


def test_row_keeps_the_upload_contract(run):
    row = run({"doc_type": "DRAFT", "confidence": 0.9}, file_id="abc123", name="Q3_v1_draft.txt")

    assert row["fileId"] == "abc123" and row["s3Key"] == "uploads/abc123/Q3_v1_draft.txt"
    assert row["status"] == "PENDING" and row["sha256"] and row["rationale"]
