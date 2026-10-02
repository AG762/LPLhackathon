import json
import os
import hashlib
from datetime import datetime, timezone
import boto3
from backend.process.classify import classify_text

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
s3 = boto3.client("s3", region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
FILES_TABLE = os.environ.get("FILES_TABLE", "Files")

# C.4: In-memory cache for fast repeated runs and offline demo resilience
CLASSIFICATION_CACHE = {}

def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def extract_readable_text(file_bytes: bytes, filename: str) -> str:
    """
    C.2: Multi-file reader supporting txt, csv, json, and text-based formats.
    """
    ext = os.path.splitext(filename)[1].lower()
    
    if ext in [".txt", ".csv", ".json", ".log", ".tsv", ".md"]:
        return file_bytes.decode("utf-8", errors="ignore")
    
    # Simple binary/mock handling for docs/spreadsheets without heavy external deps
    try:
        decoded = file_bytes.decode("utf-8", errors="ignore")
        if len([c for c in decoded if c.isprintable()]) > len(decoded) * 0.7:
            return decoded
    except Exception:
        pass
        
    return f"[Binary or unparsed file content for {filename}]"

def process_file_event(event, context):
    """
    S3 Event Trigger handler for uploads/ prefix.
    """
    table = dynamodb.Table(FILES_TABLE)
    processed_records = []

    for record in event.get("Records", []):
        bucket_name = record["s3"]["bucket"]["name"]
        object_key = record["s3"]["object"]["key"]
        filename = os.path.basename(object_key)
        
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
                print(f"Error processing {filename}: {err}")
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
        doc_type = classification.get("doc_type", "UNKNOWN")
        confidence = float(classification.get("confidence", 0.0))
        
        # Recommendation logic according to PLAN.md §6
        recommendation = "DELETE" if ("DRAFT" in doc_type or "PERSONAL" in doc_type) else "RETAIN"
        if confidence < 0.75 or doc_type == "UNKNOWN":
            recommendation = "REVIEW"
            
        item = {
            "fileId": filename,
            "s3Key": object_key,
            "sha256": file_hash,
            "sizeBytes": size_bytes,
            "uploadedAt": uploaded_at,
            "docType": doc_type,
            "confidence": str(confidence),
            "clientName": classification.get("client_name") or "N/A",
            "accountId": classification.get("account_id") or "N/A",
            "documentDate": classification.get("document_date") or "N/A",
            "rationale": classification.get("rationale") or "",
            "recommendation": recommendation,
            "status": "PENDING"
        }
        
        try:
            table.put_item(Item=item)
        except Exception as e:
            print(f"DynamoDB put_item skipped (local test): {e}")
            
        processed_records.append(item)

    return {
        "statusCode": 200,
        "body": json.dumps({"processed": len(processed_records), "items": processed_records})
    }
