"""G.2: high-PII demo files Macie can detect (fake data only)."""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "data"))
import generate_pii  # noqa: E402
from sensitivity import score_sensitivity  # noqa: E402

SSN = re.compile(r"\b(\d{3})-(\d{2})-(\d{4})\b")


def test_writes_the_three_high_pii_files(tmp_path):
    written = generate_pii.build(tmp_path)

    assert sorted(written) == [
        "2016_Client_List_Export.csv",
        "2018_W9_Forms_Batch.txt",
        "2019_Account_Holder_Export.pdf",
    ]
    for name in written:
        assert (tmp_path / name).stat().st_size > 0


def test_the_client_list_holds_about_fifty_labelled_ssns(tmp_path):
    generate_pii.build(tmp_path)
    text = (tmp_path / "2016_Client_List_Export.csv").read_text()

    assert text.splitlines()[0].startswith("Name,SSN,Date of Birth")
    assert len(SSN.findall(text)) == 50


def test_the_w9_batch_has_twelve_ssns_each_next_to_the_word_ssn(tmp_path):
    generate_pii.build(tmp_path)
    text = (tmp_path / "2018_W9_Forms_Batch.txt").read_text()

    assert len(re.findall(r"SSN: \d{3}-\d{2}-\d{4}", text)) == 12


def test_ssns_avoid_areas_that_are_never_issued(tmp_path):
    generate_pii.build(tmp_path)
    text = (tmp_path / "2016_Client_List_Export.csv").read_text()

    for area, group, serial in SSN.findall(text):
        assert area not in ("000", "666") and not area.startswith("9")
        assert group != "00" and serial != "0000"


def test_expected_findings_score_as_planned():
    # These counts drive the demo: both SSN-heavy files are HIGH and jump to the top of the queue.
    assert score_sensitivity(generate_pii.EXPECTED_FINDINGS["2016_Client_List_Export.csv"])[1] == "HIGH"
    assert score_sensitivity(generate_pii.EXPECTED_FINDINGS["2018_W9_Forms_Batch.txt"])[1] == "HIGH"


def test_output_is_the_same_every_run(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate_pii.build(a)
    generate_pii.build(b)

    for name in os.listdir(a):
        assert (a / name).read_bytes() == (b / name).read_bytes()
