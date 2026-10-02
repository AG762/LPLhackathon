"""G.3: the legal-hold demo client, their files, and the hold record A.7 seeds."""
import json
import os
import sys

import boto3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "data"))
import generate_legal_hold  # noqa: E402
import holds  # noqa: E402
from conftest import HOLDS, call  # noqa: E402
from test_disposal import add_file  # noqa: E402

CLIENT = "Margaret Whitaker"


def test_writes_the_held_clients_files_and_the_hold_record(tmp_path):
    written = generate_legal_hold.build(tmp_path)

    assert sorted(written) == [
        "2019_Email_Whitaker_Rebalance.eml",
        "2021_Meeting_Notes_Whitaker.txt",
        "2023_Statement_Whitaker_Sept.txt",
        "legal_hold.json",
    ]
    for name in written:
        if name.endswith(".json"):
            continue
        assert f"Client: {CLIENT}" in (tmp_path / name).read_text()


def test_the_hold_record_matches_the_legal_holds_contract(tmp_path):
    generate_legal_hold.build(tmp_path)
    hold = json.loads((tmp_path / "legal_hold.json").read_text())

    assert hold["scopeType"] == "CLIENT_NAME" and hold["scopeValue"] == CLIENT
    assert hold["active"] is True and hold["holdId"] and hold["reason"]


def test_the_hold_matches_whitaker_files_and_nobody_else(tmp_path):
    generate_legal_hold.build(tmp_path)
    hold = json.loads((tmp_path / "legal_hold.json").read_text())

    assert holds.matches(hold, {"clientName": CLIENT, "s3Key": "uploads/x/2019_Email_Whitaker_Rebalance.eml"})
    assert not holds.matches(hold, {"clientName": "Arthur Smith", "s3Key": "uploads/y/2020_Client_Communication_Smith.txt"})


def test_approving_the_old_whitaker_email_is_refused_under_the_hold(aws, tmp_path):
    generate_legal_hold.build(tmp_path)
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item=json.loads((tmp_path / "legal_hold.json").read_text()))
    # Past its 3-year window, so without the hold this would be deletable.
    add_file(aws, boto3.client("s3"), "email", clientName=CLIENT, keepUntil="2022-08-14", recommendation="DELETE")

    status, body = call("POST", "/files/email/approve")

    assert status == 409
    assert "legal hold" in body["error"].lower()
