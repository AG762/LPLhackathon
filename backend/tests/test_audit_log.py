"""Hash-chained audit log (STORIES.md E.1, E.2)."""
import hashlib
import json

import audit_log

GENESIS = "0" * 64
FILE = {"fileId": "f1", "sha256": "abc123"}


def expected_hash(prev_hash, entry):
    body = {k: v for k, v in entry.items() if k != "entryHash"}
    return hashlib.sha256((prev_hash + json.dumps(body, sort_keys=True, separators=(",", ":"))).encode()).hexdigest()


def test_first_entry_starts_the_chain(aws):
    entry = audit_log.append("demo-advisor", "APPROVED", FILE, "SEC_17A4_EXPIRED")

    assert entry["seq"] == 1
    assert entry["prevHash"] == GENESIS
    assert entry["fileId"] == "f1" and entry["fileHash"] == "abc123"
    assert entry["entryHash"] == expected_hash(GENESIS, entry)


def test_each_entry_links_to_the_one_before(aws):
    first = audit_log.append("demo-advisor", "APPROVED", FILE)
    second = audit_log.append("system:api", "QUARANTINED", FILE)

    assert second["seq"] == 2
    assert second["prevHash"] == first["entryHash"]


def test_verify_passes_on_an_untouched_chain(aws):
    for action in ("APPROVED", "QUARANTINED", "REJECTED"):
        audit_log.append("demo-advisor", action, FILE)

    assert audit_log.verify_chain() == {"ok": True}


def test_verify_passes_on_an_empty_log(aws):
    assert audit_log.verify_chain() == {"ok": True}


def test_editing_a_stored_entry_fails_verification_at_that_entry(aws):
    for action in ("APPROVED", "QUARANTINED", "REJECTED"):
        audit_log.append("demo-advisor", action, FILE)

    # Someone changes entry 2 in the DynamoDB console without re-hashing it.
    import boto3
    from conftest import AUDIT
    boto3.resource("dynamodb").Table(AUDIT).update_item(
        Key={"seq": 2}, UpdateExpression="SET #a = :a",
        ExpressionAttributeNames={"#a": "action"}, ExpressionAttributeValues={":a": "RESTORED"},
    )

    assert audit_log.verify_chain() == {"ok": False, "brokenAtSeq": 2}


def test_a_writer_that_loses_the_race_retries_on_the_new_head(aws, monkeypatch):
    audit_log.append("demo-advisor", "APPROVED", FILE)
    real_list = audit_log.list_entries
    calls = {"n": 0}

    def stale_then_real():
        # First read returns the chain as it was; meanwhile another request appends entry 2.
        calls["n"] += 1
        entries = real_list()
        if calls["n"] == 1:
            monkeypatch.setattr(audit_log, "list_entries", real_list)
            audit_log.append("other-request", "QUARANTINED", FILE)
            monkeypatch.setattr(audit_log, "list_entries", stale_then_real)
        return entries

    monkeypatch.setattr(audit_log, "list_entries", stale_then_real)
    entry = audit_log.append("demo-advisor", "REJECTED", FILE)

    monkeypatch.setattr(audit_log, "list_entries", real_list)
    assert entry["seq"] == 3
    assert [e["seq"] for e in audit_log.list_entries()] == [1, 2, 3]
    assert audit_log.verify_chain() == {"ok": True}


def test_audit_route_lists_entries_in_order(aws):
    from conftest import call
    audit_log.append("demo-advisor", "APPROVED", FILE)
    audit_log.append("system:api", "QUARANTINED", FILE)

    status, body = call("GET", "/audit")

    assert status == 200
    assert [(e["seq"], e["action"]) for e in body] == [(1, "APPROVED"), (2, "QUARANTINED")]
    assert body[1]["prevHash"] == body[0]["entryHash"]


def test_verify_route_reports_a_broken_chain(aws):
    import boto3
    from conftest import AUDIT, call
    audit_log.append("demo-advisor", "APPROVED", FILE)
    assert call("GET", "/audit/verify") == (200, {"ok": True})

    boto3.resource("dynamodb").Table(AUDIT).update_item(
        Key={"seq": 1}, UpdateExpression="SET actor = :a", ExpressionAttributeValues={":a": "someone-else"},
    )

    assert call("GET", "/audit/verify") == (200, {"ok": False, "brokenAtSeq": 1})
