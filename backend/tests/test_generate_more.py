"""G.1: the rest of the demo dataset (PLAN.md section 11). Synthetic data only."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "data"))
import generate_more  # noqa: E402

HELD_CLIENTS = ("Smith", "Whitaker")  # config/legal_holds.json + data/legal_hold.json


def test_brings_the_dataset_to_about_forty_files(tmp_path):
    written = generate_more.build(tmp_path)
    samples = os.listdir(os.path.join(os.path.dirname(__file__), "..", "..", "data", "samples"))
    already = {n for n in samples if n not in written}

    assert len(written) == 31
    assert 40 <= len(already) + len(written) <= 45


def test_covers_each_category_in_the_plan(tmp_path):
    names = generate_more.build(tmp_path)
    assert sum("Statement" in n for n in names) >= 5
    assert sum("Confirm" in n for n in names) >= 5
    assert sum("_v1" in n or "_v2" in n for n in names) >= 3 and sum("_FINAL" in n for n in names) >= 2
    assert sum(n.endswith(".png") for n in names) >= 3


def test_duplicates_are_byte_for_byte_copies(tmp_path):
    generate_more.build(tmp_path)
    for copy, original in generate_more.DUPLICATES.items():
        assert (tmp_path / copy).read_bytes() == (tmp_path / original).read_bytes()


def test_no_new_file_names_a_held_client(tmp_path):
    for name in generate_more.build(tmp_path):
        if name.endswith(".png"):
            continue
        text = (tmp_path / name).read_text()
        assert not any(c in text or c in name for c in HELD_CLIENTS), name


def test_images_are_valid_pngs(tmp_path):
    for name in generate_more.build(tmp_path):
        if name.endswith(".png"):
            assert (tmp_path / name).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_output_is_the_same_every_run(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    names = generate_more.build(a)
    generate_more.build(b)
    for name in names:
        assert (a / name).read_bytes() == (b / name).read_bytes()
