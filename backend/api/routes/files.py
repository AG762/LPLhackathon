"""/upload-url, /files, /files/{id}"""
import os
import uuid
from decimal import Decimal

import aws
from http_utils import HttpError

UPLOAD_URL_TTL_SECONDS = 15 * 60
PRIORITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


def upload_url(req):
    filename = os.path.basename(str(req.body.get("filename", "")).replace("\\", "/"))
    if not filename:
        raise HttpError(400, "filename is required")

    file_id = uuid.uuid4().hex
    # The `process` Lambda parses fileId out of this key: uploads/<fileId>/<filename>.
    # It creates the Files row on the S3 event, so nothing is written here.
    key = f"uploads/{file_id}/{filename}"
    url = aws.s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": aws.bucket(), "Key": key},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )
    return 200, {"fileId": file_id, "key": key, "url": url}


def list_files(req):
    table = aws.table("FILES_TABLE")
    items = []
    kwargs = {}
    while True:  # Scan is fine at demo scale (~40 files)
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    status = req.query.get("status")
    if status:
        items = [f for f in items if f.get("status") == status]

    if req.query.get("sort") == "priority":
        items.sort(key=lambda f: (
            PRIORITY_ORDER.get(f.get("priority"), len(PRIORITY_ORDER)),
            -(f.get("sensitivityScore") or Decimal(0)),
        ))
    else:
        items.sort(key=lambda f: f.get("uploadedAt", ""), reverse=True)
    return 200, items


def load_file(file_id):
    item = aws.table("FILES_TABLE").get_item(Key={"fileId": file_id}).get("Item")
    if not item:
        raise HttpError(404, "File not found")
    return item


def get_file(req):
    return 200, load_file(req.params["file_id"])
