import json
import logging
import os
import urllib.parse
from datetime import datetime
import boto3
from classify import classify_text   # Lambda runs from backend/process, so no package prefix
try:
    from shared.rules import evaluate_retention
except ImportError:
    from backend.shared.rules import evaluate_retention

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ.get("FILES_TABLE", "shredsafe-Files")
files_table = dynamodb.Table(TABLE_NAME)

def process_file_event(event, context):
    logger.info(f"Received event: {json.dumps(event)}")

    for record in event.get("Records", []):
        bucket_name = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        object_key = urllib.parse.unquote_plus(raw_key)

        filename = object_key.split("/")[-1]
        logger.info(f"Processing s3://{bucket_name}/{object_key}")

        try:
            head_resp = s3.head_object(Bucket=bucket_name, Key=object_key)
            size_bytes = head_resp.get("ContentLength", 0)
        except Exception as e:
            logger.warning(f"Could not read S3 object metadata for {object_key}: {e}")
            size_bytes = 0

        classification, file_hash = classify_text(bucket_name, object_key)
        uploaded_at = datetime.utcnow().isoformat() + "Z"

        confidence = float(classification.get("confidence", 0.0))
        doc_type = classification.get("doc_type", "UNKNOWN")

        # Keys are uploads/<fileId>/<filename> (see api /upload-url); fall back to the filename
        parts = object_key.split("/")
        file_id = parts[1] if len(parts) == 3 and parts[0] == "uploads" else filename

        # Evaluate SEC 17a-4 retention schedules and legal holds
        retention = evaluate_retention(classification)

        item = {
            "fileId": file_id,
            "s3Key": object_key,
            "sha256": file_hash,
            "sizeBytes": size_bytes,
            "uploadedAt": uploaded_at,
            "docType": doc_type,
            "confidence": str(confidence),
            "recommendation": retention.get("recommendation", "REVIEW"),
            "ruleApplied": retention.get("ruleApplied", "MANUAL_REVIEW_REQUIRED"),
            "rationale": retention.get("rationale", classification.get("rationale", "")),
            "legalHold": retention.get("legalHold", False),
            "status": "PENDING"
        }

        # Omit missing fields instead of storing "N/A" per team contract
        if retention.get("keepUntil"):
            item["keepUntil"] = retention["keepUntil"]
        if classification.get("client_name"):
            item["clientName"] = classification["client_name"]
        if classification.get("account_id"):
            item["accountId"] = classification["account_id"]
        if classification.get("document_date"):
            item["documentDate"] = classification["document_date"]
        if classification.get("pii_detected"):
            item["piiTypes"] = classification["pii_detected"]

        logger.info(f"Writing item to DynamoDB: {item}")
        files_table.put_item(Item=item)
        logger.info(f"Successfully processed {object_key}")

    return {"status": "SUCCESS"}
