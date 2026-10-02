"""Seed script for retention rules and demo legal holds (A.7)."""
import json
import os
import sys

import boto3
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import seed  # noqa: E402

import holds  # noqa: E402
from conftest import HOLDS  # noqa: E402

RULES = "RetentionRules"
TARGETS = {"rules_table": RULES, "holds_table": HOLDS}


@pytest.fixture
def rules_table(aws):
    return boto3.resource("dynamodb").create_table(
        TableName=RULES,
        KeySchema=[{"AttributeName": "docType", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "docType", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def scan(name):
    return boto3.resource("dynamodb").Table(name).scan()["Items"]


def test_repo_config_is_valid_and_covers_classifier_types():
    rules, demo_holds = seed.load_config()
    doc_types = {r["docType"] for r in rules}
    for t in ("TRADE_CONFIRMATION", "ACCOUNT_STATEMENT", "CLIENT_COMMUNICATION", "ADVISORY_AGREEMENT",
              "MARKETING", "DRAFT", "PERSONAL", "EXPIRED_PII", "UNKNOWN"):  # backend/process/prompt.py
        assert t in doc_types
    assert demo_holds


def test_demo_hold_matches_held_sample_only():
    _, demo_holds = seed.load_config()
    assert holds.find_hold({"clientName": "Arthur Smith"}, demo_holds)  # data/samples/2020_Client_Communication_Smith.txt
    assert not holds.find_hold({"clientName": "Jane Smith"}, demo_holds)  # in the tax-records CSV
    assert not holds.find_hold({"clientName": "Marcus Vance"}, demo_holds)


def test_seed_writes_rules_and_holds(rules_table):
    rules, demo_holds = seed.load_config()
    summary = seed.seed(TARGETS, rules, demo_holds)
    assert summary["rules"]["written"] == len(rules) and summary["holds"]["written"] == len(demo_holds)
    stored = {r["docType"]: r for r in scan(RULES)}
    assert stored["TRADE_CONFIRMATION"]["retentionYears"] == 6
    assert stored["TRADE_CONFIRMATION"]["citation"]
    assert {h["holdId"] for h in scan(HOLDS)} == {h["holdId"] for h in demo_holds}


def test_seed_is_idempotent_and_keeps_manual_holds_without_prune(rules_table):
    rules, demo_holds = seed.load_config()
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={"holdId": "H-MANUAL", "active": True})
    seed.seed(TARGETS, rules, demo_holds)
    seed.seed(TARGETS, rules, demo_holds)
    assert len(scan(RULES)) == len(rules)
    assert {h["holdId"] for h in scan(HOLDS)} == {h["holdId"] for h in demo_holds} | {"H-MANUAL"}


def test_prune_removes_items_not_in_config(rules_table):
    rules, demo_holds = seed.load_config()
    ddb = boto3.resource("dynamodb")
    ddb.Table(HOLDS).put_item(Item={"holdId": "H-OLD", "active": True})
    ddb.Table(RULES).put_item(Item={"docType": "OLD_TYPE", "retentionYears": 1})
    summary = seed.seed(TARGETS, rules, demo_holds, prune=True)
    assert summary["holds"]["deleted"] == 1 and summary["rules"]["deleted"] == 1
    assert "H-OLD" not in {h["holdId"] for h in scan(HOLDS)}
    assert "OLD_TYPE" not in {r["docType"] for r in scan(RULES)}


def test_dry_run_writes_nothing(rules_table):
    rules, demo_holds = seed.load_config()
    seed.seed(TARGETS, rules, demo_holds, apply=False)
    assert scan(RULES) == [] and scan(HOLDS) == []


@pytest.mark.parametrize("rule, hold, message", [
    ({"docType": "X", "retentionYears": -1, "trigger": "CREATED", "action": "RETAIN", "citation": "c"}, None, "retentionYears"),
    ({"docType": "X", "retentionYears": 1, "trigger": "SOMEDAY", "action": "RETAIN", "citation": "c"}, None, "trigger"),
    ({"docType": "X", "retentionYears": 1, "trigger": "CREATED", "action": "SHRED", "citation": "c"}, None, "action"),
    ({"docType": "X", "retentionYears": 1, "trigger": "CREATED", "action": "RETAIN"}, None, "citation"),
    (None, {"holdId": "H", "scopeType": "NAME", "scopeValue": "x"}, "scopeType"),
    (None, {"holdId": "H", "scopeType": "CLIENT_NAME", "scopeValue": " "}, "scopeValue"),
])
def test_validation_rejects_bad_config(tmp_path, rule, hold, message):
    good_rule = {"docType": "OK", "retentionYears": 1, "trigger": "CREATED", "action": "RETAIN", "citation": "c"}
    good_hold = {"holdId": "OK", "scopeType": "CLIENT_NAME", "scopeValue": "x"}
    (tmp_path / "retention_rules.json").write_text(json.dumps({"rules": [rule or good_rule]}))
    (tmp_path / "legal_holds.json").write_text(json.dumps({"holds": [hold or good_hold]}))
    with pytest.raises(SystemExit, match=message):
        seed.load_config(str(tmp_path))


def test_duplicate_keys_rejected():
    r = {"docType": "A", "retentionYears": 1, "trigger": "CREATED", "action": "RETAIN", "citation": "c"}
    with pytest.raises(SystemExit, match="duplicate docType"):
        seed.validate([r, dict(r)], [])


def test_targets_from_outputs():
    outputs = [{"OutputKey": "RetentionRulesTableName", "OutputValue": "r"},
               {"OutputKey": "LegalHoldsTableName", "OutputValue": "h"},
               {"OutputKey": "ApiUrl", "OutputValue": "u"}]
    assert seed.targets_from_outputs(outputs) == {"rules_table": "r", "holds_table": "h"}
    with pytest.raises(SystemExit, match="rules_table"):
        seed.targets_from_outputs(outputs[1:])
