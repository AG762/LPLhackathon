"""D.5: Macie scan start/status/ingest. Moto doesn't cover Macie classification jobs, so a small fake
stands in, returning findings in the shape GetFindings uses."""
from datetime import datetime, timedelta, timezone

import boto3
import pytest

import aws as aws_clients
from conftest import BUCKET, HOLDS, call
from test_disposal import add_file

JOB_START = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
BEFORE = (JOB_START - timedelta(hours=1)).isoformat()
AFTER = (JOB_START + timedelta(minutes=5)).isoformat()


def finding(key, detections, bucket=BUCKET):
    return {
        "resourcesAffected": {"s3Bucket": {"name": bucket}, "s3Object": {"key": key}},
        "classificationDetails": {"jobId": "job-1", "result": {"sensitiveData": [
            {"category": "PERSONAL_INFORMATION", "detections": [{"type": t, "count": n} for t, n in detections.items()]},
        ]}},
    }


class FakeMacie:
    def __init__(self):
        self.jobs = []  # newest last
        self.findings = []
        self.created = []

    def add_job(self, status, job_id="job-1", name=f"{BUCKET}-20261002T120000Z"):
        self.jobs.append({"jobId": job_id, "name": name, "jobStatus": status, "createdAt": JOB_START})

    def list_classification_jobs(self, filterCriteria, sortCriteria, maxResults):
        prefix = filterCriteria["includes"][0]["values"][0]
        jobs = [j for j in reversed(self.jobs) if j["name"].startswith(prefix)]
        return {"items": jobs[:maxResults]}

    def create_classification_job(self, **kwargs):
        self.created.append(kwargs)
        job_id = f"job-{len(self.jobs) + 1}"
        self.add_job("RUNNING", job_id=job_id, name=kwargs["name"])
        return {"jobId": job_id}

    def list_findings(self, findingCriteria, maxResults, nextToken=None):
        start = int(nextToken or 0)
        ids = [str(i) for i in range(len(self.findings))][start:start + maxResults]
        more = start + maxResults < len(self.findings)
        return {"findingIds": ids, **({"nextToken": str(start + maxResults)} if more else {})}

    def get_findings(self, findingIds):
        assert len(findingIds) <= 50
        return {"findings": [self.findings[int(i)] for i in findingIds]}


@pytest.fixture
def macie(aws, monkeypatch):
    monkeypatch.setenv("ACCOUNT_ID", "123456789012")
    fake = FakeMacie()
    monkeypatch.setattr(aws_clients, "macie", lambda: fake)
    return fake


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def test_status_idle_before_any_scan(macie):
    assert call("GET", "/scan/status") == (200, {"jobId": None, "state": "IDLE"})


def test_start_creates_one_time_job_on_bucket(macie):
    status, body = call("POST", "/scan")
    assert status == 200 and body["jobId"] == "job-1"
    job = macie.created[0]
    assert job["jobType"] == "ONE_TIME" and job["name"].startswith(f"{BUCKET}-")
    assert job["managedDataIdentifierSelector"] == "ALL"
    assert job["s3JobDefinition"]["bucketDefinitions"] == [{"accountId": "123456789012", "buckets": [BUCKET]}]
    assert call("GET", "/scan/status")[1]["state"] == "RUNNING"


def test_start_while_running_returns_existing_job(macie):
    macie.add_job("RUNNING")
    status, body = call("POST", "/scan")
    assert status == 200 and body == {"jobId": "job-1", "alreadyRunning": True}
    assert macie.created == []


def test_other_stacks_jobs_are_ignored(macie):
    macie.add_job("COMPLETE", name="someone-elses-bucket-20261002T120000Z")
    assert call("GET", "/scan/status")[1]["state"] == "IDLE"


@pytest.mark.parametrize("job_status, state", [
    ("RUNNING", "RUNNING"), ("USER_PAUSED", "RUNNING"), ("COMPLETE", "COMPLETE"), ("CANCELLED", "FAILED"),
])
def test_status_maps_macie_states(macie, job_status, state):
    macie.add_job(job_status)
    assert call("GET", "/scan/status")[1]["state"] == state


@pytest.mark.parametrize("job_status, message", [
    (None, "No scan"), ("RUNNING", "still running"), ("CANCELLED", "cancelled"),
])
def test_ingest_refuses_without_a_finished_scan(macie, job_status, message):
    if job_status:
        macie.add_job(job_status)
    status, body = call("POST", "/scan/ingest")
    assert status == 409 and message in body["error"]


def test_ingest_scores_files_and_sorts_riskiest_first(macie, aws, s3):
    add_file(aws, s3, "csv", uploadedAt=BEFORE, keepUntil="2019-01-01")
    add_file(aws, s3, "w9", uploadedAt=BEFORE, keepUntil="2019-01-01")
    add_file(aws, s3, "clean", uploadedAt=BEFORE)
    add_file(aws, s3, "photo", uploadedAt=BEFORE, piiTypes=["SSN"])  # image: Macie can't read it
    macie.add_job("COMPLETE")
    macie.findings = [
        finding("uploads/csv/csv.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 50, "DATE_OF_BIRTH": 50, "NAME": 50}),
        finding("uploads/w9/w9.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 3}),
    ]

    status, body = call("POST", "/scan/ingest")
    assert status == 200
    assert body["updated"] == 4 and body["filesWithFindings"] == 2 and body["jobId"] == "job-1"

    files = {f["fileId"]: f for f in call("GET", "/files")[1]}
    assert files["csv"]["sensitivityScore"] == 50 * 10 + 50 * 5 + 50 and files["csv"]["priority"] == "HIGH"
    assert files["csv"]["macieFindings"] == {"USA_SOCIAL_SECURITY_NUMBER": 50, "DATE_OF_BIRTH": 50, "NAME": 50}
    assert files["w9"]["priority"] == "MEDIUM" and files["w9"]["scoreSource"] == "macie"
    assert files["clean"]["priority"] == "LOW" and files["clean"]["macieFindings"] == {}
    assert files["photo"]["scoreSource"] == "classifier" and files["photo"]["sensitivityScore"] == 10

    order = [f["fileId"] for f in call("GET", "/files", query={"sort": "priority"})[1]]
    assert order[0] == "csv"


def test_ingest_sums_multiple_findings_for_one_file_and_pages(macie, aws, s3):
    add_file(aws, s3, "a", uploadedAt=BEFORE)
    macie.add_job("COMPLETE")
    macie.findings = [finding("uploads/a/a.pdf", {"NAME": 1}) for _ in range(120)]  # > 2 pages
    call("POST", "/scan/ingest")
    assert call("GET", "/files/a")[1]["macieFindings"] == {"NAME": 120}


def test_ingest_ignores_other_buckets_and_skips_late_or_purged_files(macie, aws, s3):
    add_file(aws, s3, "late", uploadedAt=AFTER)
    add_file(aws, s3, "gone", uploadedAt=BEFORE, status="PURGED")
    add_file(aws, s3, "a", uploadedAt=BEFORE)
    macie.add_job("COMPLETE")
    macie.findings = [finding("uploads/a/a.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 9}, bucket="other-bucket")]

    assert call("POST", "/scan/ingest")[1]["updated"] == 1
    files = {f["fileId"]: f for f in call("GET", "/files")[1]}
    assert "priority" not in files["late"] and "priority" not in files["gone"]
    assert files["a"]["macieFindings"] == {}


def test_ingest_locks_retained_high_sensitivity_files_but_not_held_ones(macie, aws, s3):
    keep = {"uploadedAt": BEFORE, "recommendation": "RETAIN", "keepUntil": "2031-06-30"}
    add_file(aws, s3, "keep", **keep)
    add_file(aws, s3, "held", clientName="Margaret Whitaker", **keep)
    boto3.resource("dynamodb").Table(HOLDS).put_item(Item={
        "holdId": "H-1", "scopeType": "CLIENT_NAME", "scopeValue": "Margaret Whitaker", "active": True})
    macie.add_job("COMPLETE")
    macie.findings = [finding(f"uploads/{k}/{k}.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 12}) for k in ("keep", "held")]

    body = call("POST", "/scan/ingest")[1]
    assert body["locked"] == 1 and body["lockErrors"] == []
    files = {f["fileId"]: f for f in call("GET", "/files")[1]}
    assert files["keep"]["status"] == "LOCKED" and files["keep"]["s3Key"] == "records/keep/keep.pdf"
    assert files["held"]["status"] == "PENDING" and files["held"]["priority"] == "HIGH"


def test_rescan_overwrites_previous_scores(macie, aws, s3):
    add_file(aws, s3, "a", uploadedAt=BEFORE)
    macie.add_job("COMPLETE")
    macie.findings = [finding("uploads/a/a.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 9})]
    call("POST", "/scan/ingest")
    macie.findings = []
    call("POST", "/scan/ingest")
    file = call("GET", "/files/a")[1]
    assert file["priority"] == "LOW" and file["macieFindings"] == {}
