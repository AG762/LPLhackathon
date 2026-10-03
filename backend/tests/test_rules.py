from datetime import datetime, timedelta
import importlib.util
import os

# Load by path: `backend.` imports are banned (AGENTS.md rule 1) and pytest runs from backend/
_spec = importlib.util.spec_from_file_location(
    "shared_rules", os.path.join(os.path.dirname(__file__), "..", "shared", "rules.py"))
_rules = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_rules)
evaluate_retention = _rules.evaluate_retention

def test_legal_hold_override():
    file_meta = {
        "doc_type": "ACCOUNT_STATEMENT",
        "confidence": 0.95,
        "document_date": "2015-01-01",
        "client_name": "Acme Holdings LLC",
        "account_id": "ACC-999"
    }
    active_holds = [{
        "holdId": "HOLD-101",
        "scopeType": "CLIENT_NAME",
        "scopeValue": "Acme Holdings",
        "reason": "DOJ Subpoena 2026-A",
        "active": True
    }]
    decision = evaluate_retention(file_meta, active_holds)
    assert decision["recommendation"] == "RETAIN"
    assert decision["legalHold"] is True
    assert decision["ruleApplied"] == "LEGAL_HOLD_OVERRIDE"

def test_draft_immediate_deletion():
    file_meta = {
        "doc_type": "DRAFT",
        "confidence": 0.90,
        "document_date": "2026-05-01"
    }
    decision = evaluate_retention(file_meta)
    assert decision["recommendation"] == "DELETE"
    assert decision["ruleApplied"] == "NON_RECORD_DISPOSAL"

def test_six_year_expired():
    past_date = (datetime.now() - timedelta(days=7*365)).strftime("%Y-%m-%d")
    file_meta = {
        "doc_type": "ACCOUNT_STATEMENT",
        "confidence": 0.95,
        "document_date": past_date
    }
    decision = evaluate_retention(file_meta)
    assert decision["recommendation"] == "DELETE"
    assert decision["ruleApplied"] == "SEC_17A4_6YR_EXPIRED"

def test_six_year_active():
    recent_date = (datetime.now() - timedelta(days=2*365)).strftime("%Y-%m-%d")
    file_meta = {
        "doc_type": "ACCOUNT_STATEMENT",
        "confidence": 0.95,
        "document_date": recent_date
    }
    decision = evaluate_retention(file_meta)
    assert decision["recommendation"] == "RETAIN"
    assert decision["ruleApplied"] == "SEC_17A4_6YR_ACTIVE"

def test_low_confidence_review():
    file_meta = {
        "doc_type": "ACCOUNT_STATEMENT",
        "confidence": 0.50,
        "document_date": "2015-01-01"
    }
    decision = evaluate_retention(file_meta)
    assert decision["recommendation"] == "REVIEW"
    assert decision["ruleApplied"] == "MANUAL_REVIEW_REQUIRED"

if __name__ == "__main__":
    test_legal_hold_override()
    test_draft_immediate_deletion()
    test_six_year_expired()
    test_six_year_active()
    test_low_confidence_review()
    print("All 5 Track B rules tests passed successfully!")
