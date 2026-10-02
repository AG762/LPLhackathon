import json
import os
import hashlib
from urllib.parse import unquote_plus
from datetime import datetime, timezone
import boto3
from classify import classify_text

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
s3 = boto3.client("s3", region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
FILES_TABLE = os.environ.get("FILES_TABLE", "Files")

def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def process_file_event(event, context):
    """
    S3 Event Trigger handler for uploads/ prefix.
    """
    table = dynamodb.Table(FILES_TABLE)
    processed_records = []

    for record in event.get("Records", []):
        bucket_name = record["s3"]["bucket"]["name"]
        object_key = unquote_plus(record["s3"]["object"]["key"])  # S3 events URL-encode keys
        
        # 1. Fetch file from S3
        resp = s3.get_object(Bucket=bucket_name, Key=object_key)
        file_bytes = resp["Body"].read()
        size_bytes = len(file_bytes)
        file_hash = compute_sha256(file_bytes)
        
        # Extract text (handles decode safely)
        text_content = file_bytes.decode("utf-8", errors="ignore")
        
        # 2. Invoke Bedrock Nova classifier
        classification = classify_text(text_content)
        
        # 3. Derive file ID and metadata
        # Keys are uploads/<fileId>/<filename> (see api /upload-url); fall back to the filename
        parts = object_key.split("/")
        file_id = parts[1] if len(parts) == 3 and parts[0] == "uploads" else os.path.basename(object_key)
        uploaded_at = datetime.now(timezone.utc).isoformat()
        
        # 4. Fallback decision logic (Track B contract)
        doc_type = classification.get("doc_type", "UNKNOWN")
        confidence = float(classification.get("confidence", 0.0))
        
        recommendation = "DELETE" if "DRAFT" in doc_type or "PERSONAL" in doc_type else "RETAIN"
        if confidence < 0.75 or doc_type == "UNKNOWN":
            recommendation = "REVIEW"
            
        item = {
            "fileId": file_id,
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
        
        # 5. Write to DynamoDB if table exists
        try:
            table.put_item(Item=item)
        except Exception as e:
            print(f"Warning: DynamoDB put_item skipped (local test): {e}")
            
        processed_records.append(item)

    return {
        "statusCode": 200,
        "body": json.dumps({"processed": len(processed_records), "items": processed_records})
    }
