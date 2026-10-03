import json
import logging
import os
import hashlib
from decimal import Decimal
from urllib.parse import unquote_plus
from datetime import datetime, timezone
import boto3
from classify import classify_text  # Lambda runs from backend/process, so no package prefix
from rules import evaluate_retention  # copy of backend/shared/rules.py (shared/ isn't deployed)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
s3 = boto3.client("s3", region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
FILES_TABLE = os.environ.get("FILES_TABLE", "Files")

# C.4: In-memory cache for fast repeated runs and offline demo resilience
CLASSIFICATION_CACHE = {}

def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def extract_readable_text(file_bytes: bytes, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext in [".txt", ".csv", ".json", ".log", ".tsv", ".md"]:
        return file_bytes.decode("utf-8", errors="ignore")
    try:
        decoded = file_bytes.decode("utf-8", errors="ignore")
        if len([c for c in decoded if c.isprintable()]) > len(decoded) * 0.7:
            return decoded
    except Exception:
        pass
    return f"[Binary or unparsed file content for {filename}]"

UNKNOWN_VALUES = {"", "N/A", "NA", "NONE", "NULL", "UNKNOWN"}


def _known(value):
    """Classifier fields come back as "N/A"/null when unknown; the Files contract omits those."""
    if value is None:
        return None
    text = str(value).strip()
    return None if text.upper() in UNKNOWN_VALUES else text


def active_holds():
    """Legal holds as seeded by scripts/seed.py. Read on every event so a new hold applies at once."""
    name = os.environ.get("HOLDS_TABLE")
    if not name:
        return []
    table, items, kwargs = dynamodb.Table(name), [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return [h for h in items if h.get("active", True)]


def process_file_event(event, context):
    table = dynamodb.Table(FILES_TABLE)
    processed_records = []
    holds = active_holds()

    for record in event.get("Records", []):
        bucket_name = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        object_key = unquote_plus(raw_key)
        filename = os.path.basename(object_key)
        logger.info("Processing s3://%s/%s", bucket_name, object_key)
        
        # 1. Fetch file from S3
        resp = s3.get_object(Bucket=bucket_name, Key=object_key)
        file_bytes = resp["Body"].read()
        size_bytes = len(file_bytes)
        file_hash = compute_sha256(file_bytes)
        
        # C.4: Check Cache first
        if file_hash in CLASSIFICATION_CACHE:
            classification = CLASSIFICATION_CACHE[file_hash]
        else:
            # C.5: Error Handling wrapper
            try:
                text_content = extract_readable_text(file_bytes, filename)
                classification = classify_text(text_content)
                CLASSIFICATION_CACHE[file_hash] = classification
            except Exception as err:
                logger.exception("Classification failed for %s; routing to review", filename)
                classification = {
                    "doc_type": "UNKNOWN",
                    "confidence": 0.0,
                    "client_name": "N/A",
                    "account_id": "N/A",
                    "document_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "pii_detected": [],
                    "rationale": f"Automated processing encountered an issue: {str(err)}"
                }

        uploaded_at = datetime.now(timezone.utc).isoformat()
        doc_type = classification.get("doc_type") or "UNKNOWN"
        confidence = float(classification.get("confidence") or 0.0)

        # Keys are uploads/<fileId>/<filename> (see api /upload-url); fall back to the filename
        parts = object_key.split("/")
        file_id = parts[1] if len(parts) == 3 and parts[0] == "uploads" else filename

        known = {
            "clientName": _known(classification.get("client_name")),
            "accountId": _known(classification.get("account_id")),
            "documentDate": _known(classification.get("document_date")),
        }
        # A hold only covers its own workspace's files (docs/login.md); demo holds have none, like demo uploads
        workspace = (resp.get("Metadata") or {}).get("workspace")
        workspace_holds = [h for h in holds if h.get("workspaceId") == workspace]
        # B.2: the rules engine decides (hold -> confidence -> non-record -> retention), not the model
        decision = evaluate_retention(
            {"docType": doc_type, "confidence": confidence, "fileId": filename, "s3Key": object_key,
             **{k: v for k, v in known.items() if v}},
            workspace_holds,
        )
        classifier_reason = (classification.get("rationale") or "").strip()
        rationale = decision["rationale"] + (f" Classifier: {classifier_reason}" if classifier_reason else "")

        item = {
            "fileId": file_id,
            "s3Key": object_key,
            "sha256": file_hash,
            "sizeBytes": size_bytes,
            "uploadedAt": uploaded_at,
            "docType": doc_type,
            "confidence": Decimal(str(confidence)),
            "rationale": rationale,
            "recommendation": decision["recommendation"],
            "ruleApplied": decision["ruleApplied"],
            "status": "PENDING",
            **{k: v for k, v in known.items() if v},
        }
        if decision.get("keepUntil"):
            item["keepUntil"] = decision["keepUntil"]
        pii_types = [str(t) for t in classification.get("pii_detected") or [] if _known(t)]
        if pii_types:
            item["piiTypes"] = pii_types  # B.7 scores images Macie can't read from these
        meta = resp.get("Metadata") or {}  # signed into the upload URL by the API for signed-in users (docs/login.md)
        if meta.get("owner"):
            item["ownerAdvisorId"] = meta["owner"]
        if meta.get("workspace"):
            item["workspaceId"] = meta["workspace"]  # who can see the file: everyone in this workspace

        try:
            table.put_item(Item=item)
        except Exception as e:
            logger.warning("DynamoDB put_item skipped for %s: %s", file_id, e)
            
        processed_records.append(item)

    return {
        "statusCode": 200,
        "body": json.dumps({"processed": len(processed_records), "items": processed_records}, default=str)
    }
