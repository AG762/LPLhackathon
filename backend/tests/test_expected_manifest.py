"""G.4: data/expected.csv describes every demo file, and agrees with the generators."""
import csv
import os
import sys

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "data")
sys.path.insert(0, DATA)
import generate_legal_hold  # noqa: E402
import generate_pii  # noqa: E402
from sensitivity import score_sensitivity  # noqa: E402

DOC_TYPES = {"TRADE_CONFIRMATION", "ACCOUNT_STATEMENT", "CLIENT_COMMUNICATION", "ADVISORY_AGREEMENT",
             "MARKETING", "DRAFT", "PERSONAL", "EXPIRED_PII", "UNKNOWN"}  # backend/process/prompt.py


def rows():
    with open(os.path.join(DATA, "expected.csv"), newline="") as f:
        return list(csv.DictReader(f))


def test_every_sample_file_has_exactly_one_row():
    names = [r["file"] for r in rows()]
    assert len(names) == len(set(names))
    assert sorted(names) == sorted(os.listdir(os.path.join(DATA, "samples")))


def test_values_come_from_the_allowed_sets():
    for r in rows():
        assert r["docType"] in DOC_TYPES, r["file"]
        assert r["recommendation"] in {"DELETE", "RETAIN", "REVIEW"}, r["file"]
        assert r["priority"] in {"HIGH", "MEDIUM", "LOW"}, r["file"]
        assert r["legalHold"] in {"yes", "no"}, r["file"]
        assert r["why"].strip(), r["file"]


def test_priorities_agree_with_the_generated_findings():
    expected = {r["file"]: r["priority"] for r in rows()}
    for name, findings in generate_pii.EXPECTED_FINDINGS.items():
        assert expected[name] == score_sensitivity(findings)[1], name


def test_the_held_clients_files_are_marked_held_and_retained():
    for r in rows():
        held = r["file"] in generate_legal_hold.FILES
        assert (r["legalHold"] == "yes") == held, r["file"]
        if held:
            assert r["recommendation"] == "RETAIN", r["file"]
