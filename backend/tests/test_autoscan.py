"""F.25: the scheduled job that starts the sensitive-data scan on the server once uploads settle, so it no
longer depends on the uploader keeping the Upload page open. Macie is the fake from test_scan."""
from datetime import timedelta

import boto3
import pytest

import autoscan
from test_disposal import add_file
from test_scan import AFTER, BEFORE, JOB_START
from test_scan import macie  # noqa: F401  (fixture)

LATER = JOB_START + timedelta(hours=1)  # "now" for most tests: long after every upload


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def test_starts_a_scan_for_classified_files_nobody_has_scanned(macie, aws, s3):
    add_file(aws, s3, "a", uploadedAt=BEFORE, docType="statement")
    result = autoscan.main(now=LATER)
    assert result["started"] == "job-1" and result["files"] == 1
    assert len(macie.created) == 1


def test_does_nothing_without_new_files(macie, aws, s3):
    assert autoscan.main(now=LATER) == {"skipped": "no new files"}
    assert macie.created == []


def test_waits_for_uploads_to_settle(macie, aws, s3):
    add_file(aws, s3, "a", uploadedAt=BEFORE, docType="statement")
    just_after = JOB_START - timedelta(hours=1) + timedelta(seconds=30)
    assert "still arriving" in autoscan.main(now=just_after)["skipped"]
    assert macie.created == []


def test_ignores_files_that_are_not_classified_yet(macie, aws, s3):
    add_file(aws, s3, "a", uploadedAt=BEFORE)  # no docType: still being sorted
    assert autoscan.main(now=LATER) == {"skipped": "no new files"}


def test_leaves_a_running_scan_alone(macie, aws, s3):
    macie.add_job("RUNNING")
    add_file(aws, s3, "late", uploadedAt=AFTER, docType="statement")
    assert autoscan.main(now=LATER) == {"skipped": "a scan is running"}
    assert macie.created == []


def test_leaves_a_cancelled_scan_for_a_person_to_restart(macie, aws, s3):
    macie.add_job("CANCELLED")
    add_file(aws, s3, "late", uploadedAt=AFTER, docType="statement")
    assert "cancelled" in autoscan.main(now=LATER)["skipped"]
    assert macie.created == []


def test_files_covered_by_the_last_scan_are_not_new(macie, aws, s3):
    macie.add_job("COMPLETE")
    add_file(aws, s3, "a", uploadedAt=BEFORE, docType="statement", macieJobId="job-1")
    assert autoscan.main(now=LATER) == {"skipped": "no new files"}
    assert macie.created == []


def test_scores_a_finished_scan_then_scans_files_that_arrived_during_it(macie, aws, s3):
    macie.add_job("COMPLETE")
    add_file(aws, s3, "old", uploadedAt=BEFORE, docType="statement")
    add_file(aws, s3, "late", uploadedAt=AFTER, docType="statement")
    result = autoscan.main(now=LATER)
    assert result["scored"] == "job-1"
    files = {f["fileId"]: f for f in aws.scan()["Items"]}
    assert files["old"]["macieJobId"] == "job-1" and "macieJobId" not in files["late"]
    assert result["started"] == "job-2" and result["files"] == 1


def test_purged_files_never_trigger_a_scan(macie, aws, s3):
    add_file(aws, s3, "gone", uploadedAt=BEFORE, docType="statement", status="PURGED")
    assert autoscan.main(now=LATER) == {"skipped": "no new files"}
