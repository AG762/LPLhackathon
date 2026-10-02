"""/upload-url, /files, /files/{id}"""
import os
import uuid
from decimal import Decimal

import boto3

from http_utils import HttpError

UPLOAD_URL_TTL_SECONDS = 15 * 60
PRIORITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

_s3 = None
_dynamodb = None


def _s3_client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def _files_table():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb.Table(os.environ["FILES_TABLE"])


def upload_url(req):
    filename = os.path.basename(str(req.body.get("filename", "")).replace("\\", "/"))
    if not filename:
        raise HttpError(400, "filename is required")

    file_id = uuid.uuid4().hex
    # The `process` Lambda parses fileId out of this key: uploads/<fileId>/<filename>.
    # It creates the Files row on the S3 event, so nothing is written here.
    key = f"uploads/{file_id}/{filename}"
    url = _s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": os.environ["BUCKET_NAME"], "Key": key},
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )
    return 200, {"fileId": file_id, "key": key, "url": url}


def list_files(req):
    table = _files_table()
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


def get_file(req):
    item = _files_table().get_item(Key={"fileId": req.params["file_id"]}).get("Item")
    if not item:
        raise HttpError(404, "File not found")
    return 200, item
