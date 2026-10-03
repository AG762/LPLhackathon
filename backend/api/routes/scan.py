"""/scan, /scan/status, /scan/ingest: Macie sensitive-data scan (STORIES.md D.5).

POST /scan starts a one-time Macie classification job on the files bucket. Jobs take several
minutes even for a few files, so run one well before the demo. GET /scan/status reports the newest
job; the UI polls it. POST /scan/ingest reads that job's findings, stores per-file counts
(macieFindings) and the sensitivity score/priority (sensitivity.score_file, B.6/B.7), then locks
retained high-sensitivity files in records/ (records.lock_if_needed, D.7).

No job id is stored: jobs are named "<bucket>-<timestamp>" and the newest one with that prefix is
the current scan.
"""
import logging
import os
import uuid
from datetime import datetime, timezone

import aws
import holds
import sensitivity
from http_utils import HttpError
from routes import records
from routes.files import visible_to

logger = logging.getLogger(__name__)

# Macie job states -> the UI's ScanState (frontend/src/types.ts)
_STATE = {
    "RUNNING": "RUNNING",
    "PAUSED": "RUNNING",
    "USER_PAUSED": "RUNNING",
    "IDLE": "RUNNING",
    "COMPLETE": "COMPLETE",
    "CANCELLED": "FAILED",
}
FINDINGS_PAGE = 50  # GetFindings accepts at most 50 ids per call
SKIP_STATUSES = {"PURGED"}  # nothing left in S3 to score


def _job_prefix():
    return f"{aws.bucket()}-"


def latest_job():
    """Newest Macie job for this stack's bucket, or None."""
    res = aws.macie().list_classification_jobs(
        filterCriteria={"includes": [{"comparator": "STARTS_WITH", "key": "name", "values": [_job_prefix()]}]},
        sortCriteria={"attributeName": "createdAt", "orderBy": "DESC"},
        maxResults=1,
    )
    items = res.get("items", [])
    return items[0] if items else None


def _state(job):
    return _STATE.get(job.get("jobStatus"), "FAILED") if job else "IDLE"


def start(req):
    job = latest_job()
    if _state(job) == "RUNNING":
        return 200, {"jobId": job["jobId"], "alreadyRunning": True}

    name = _job_prefix() + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    res = aws.macie().create_classification_job(
        clientToken=str(uuid.uuid4()),
        jobType="ONE_TIME",
        name=name,
        description="ShredSafe sensitive-data scan",
        # ALL: the recommended set skips NAME and ADDRESS, which the demo dataset expects (data/generate_pii.py)
        managedDataIdentifierSelector="ALL",
        s3JobDefinition={"bucketDefinitions": [{"accountId": os.environ["ACCOUNT_ID"], "buckets": [aws.bucket()]}]},
    )
    return 200, {"jobId": res["jobId"]}


def status(req):
    job = latest_job()
    if not job:
        return 200, {"jobId": None, "state": "IDLE"}
    return 200, {"jobId": job["jobId"], "state": _state(job), "startedAt": _iso(job.get("createdAt"))}


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _finding_ids(job_id):
    ids, kwargs = [], {}
    while True:
        res = aws.macie().list_findings(
            findingCriteria={"criterion": {"classificationDetails.jobId": {"eq": [job_id]}}},
            maxResults=FINDINGS_PAGE, **kwargs)
        ids.extend(res.get("findingIds", []))
        if not res.get("nextToken"):
            return ids
        kwargs = {"nextToken": res["nextToken"]}


def counts_by_key(job_id):
    """{s3 key: {finding type: count}} for this bucket's objects in the job's findings."""
    ids = _finding_ids(job_id)
    out = {}
    for i in range(0, len(ids), FINDINGS_PAGE):
        for finding in aws.macie().get_findings(findingIds=ids[i:i + FINDINGS_PAGE]).get("findings", []):
            resources = finding.get("resourcesAffected") or {}
            if (resources.get("s3Bucket") or {}).get("name") != aws.bucket():
                continue
            key = (resources.get("s3Object") or {}).get("key")
            result = (finding.get("classificationDetails") or {}).get("result") or {}
            if not key:
                continue
            counts = out.setdefault(key, {})
            for category in result.get("sensitiveData") or []:
                for detection in category.get("detections") or []:
                    kind, n = detection.get("type"), int(detection.get("count") or 0)
                    if kind and n:
                        counts[kind] = counts.get(kind, 0) + n
    return out


def _all_files():
    table = aws.table("FILES_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def ingest(req):
    job = latest_job()
    state = _state(job)
    if state == "IDLE":
        raise HttpError(409, "No scan has been run yet. Start one first.")
    if state == "RUNNING":
        raise HttpError(409, "The scan is still running.")
    if state == "FAILED":
        raise HttpError(409, "The last scan was cancelled. Start a new one.")

    job_id = job["jobId"]
    started = _iso(job.get("createdAt")) or ""
    by_key = counts_by_key(job_id)
    table = aws.table("FILES_TABLE")
    active_holds = holds.active_holds()
    scanned_at = datetime.now(timezone.utc).isoformat()

    # The scan covers the whole bucket, but each advisor only hears about their own files
    updated, locked, lock_errors, with_findings = 0, 0, [], 0
    for file in _all_files():
        if file.get("status") in SKIP_STATUSES:
            continue
        # Files uploaded after the job started weren't scanned; leave them for the next scan.
        if started and str(file.get("uploadedAt", "")) > started:
            continue
        findings = by_key.get(file.get("s3Key"), {})
        score, priority, source = sensitivity.score_file({**file, "macieFindings": findings})
        mine = visible_to(req.user, file)
        file = table.update_item(
            Key={"fileId": file["fileId"]},
            UpdateExpression="SET macieFindings = :f, sensitivityScore = :s, priority = :p, "
                             "scoreSource = :src, macieJobId = :j, scannedAt = :t",
            ExpressionAttributeValues={":f": findings, ":s": score, ":p": priority, ":src": source,
                                       ":j": job_id, ":t": scanned_at},
            ReturnValues="ALL_NEW",
        )["Attributes"]
        updated += mine
        with_findings += mine and bool(findings)
        try:
            if records.lock_if_needed(file, active_holds):
                locked += mine
        except HttpError as e:
            logger.warning("Lock after scan failed for %s: %s", file["fileId"], e.message)
            if mine:
                lock_errors.append({"fileId": file["fileId"], "error": e.message})

    return 200, {"jobId": job_id, "updated": updated, "locked": locked, "lockErrors": lock_errors,
                 "filesWithFindings": with_findings}
