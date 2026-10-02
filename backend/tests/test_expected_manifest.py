"""G.4: data/expected.csv describes every demo file, and agrees with the generators."""
import csv
import os
import re
import sys

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "data")
sys.path.insert(0, DATA)
sys.path.insert(0, os.path.join(DATA, "..", "scripts"))
import generate_legal_hold  # noqa: E402
import holds  # noqa: E402
import seed  # noqa: E402
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


def _client(name):
    with open(os.path.join(DATA, "samples", name), errors="ignore") as f:
        match = re.search(r"^Client: (.+)$", f.read(), re.M)
    return match.group(1).strip() if match else ""


def test_held_files_match_the_holds_the_seed_script_loads():
    # The same hold list scripts/seed.py writes to LegalHolds (config + data/legal_hold.json)
    _, seeded = seed.load_config()
    for r in rows():
        held = holds.find_hold({"clientName": _client(r["file"]), "s3Key": f"uploads/x/{r['file']}"}, seeded) is not None
        assert (r["legalHold"] == "yes") == held, r["file"]
        if held:
            assert r["recommendation"] == "RETAIN", r["file"]


def test_the_g3_client_is_one_of_the_held_clients():
    for name in generate_legal_hold.FILES:
        assert next(r for r in rows() if r["file"] == name)["legalHold"] == "yes"
