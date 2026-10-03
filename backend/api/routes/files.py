"""/upload-url, /files, /files/{id}"""
import os
import uuid
from decimal import Decimal

import aws
import holds
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
    params = {"Bucket": aws.bucket(), "Key": key}
    headers = {}
    if req.user and req.user.get("signedIn"):
        # The owner is signed into the URL, so S3 rejects the upload unless the browser sends exactly
        # this header: nobody can upload as someone else. `process` copies it to ownerAdvisorId.
        # Only for signed-in users, so uploads without sign-in (the demo) work as before.
        params["Metadata"] = {"owner": req.user["id"]}
        headers["x-amz-meta-owner"] = req.user["id"]
    url = aws.s3().generate_presigned_url("put_object", Params=params, ExpiresIn=UPLOAD_URL_TTL_SECONDS)
    return 200, {"fileId": file_id, "key": key, "url": url, "headers": headers}


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

    items = [f for f in items if visible_to(req.user, f)]
    status = req.query.get("status")
    if status:
        items = [f for f in items if f.get("status") == status]

    active = holds.active_holds()
    for item in items:
        _flag_hold(item, active)

    if req.query.get("sort") == "priority":
        items.sort(key=lambda f: (
            PRIORITY_ORDER.get(f.get("priority"), len(PRIORITY_ORDER)),
            -(f.get("sensitivityScore") or Decimal(0)),
        ))
    else:
        items.sort(key=lambda f: f.get("uploadedAt", ""), reverse=True)
    return 200, items


def visible_to(user, file):
    """Each signed-in user is one advisor and sees only their own files, whatever their role.
    No user (internal call) or not signed in (the demo, AuthRequired off) sees everything."""
    if user is None or not user.get("signedIn"):
        return True
    return file.get("ownerAdvisorId") == user["id"]


def all_files():
    table = aws.table("FILES_TABLE")
    items, kwargs = [], {}
    while True:
        page = table.scan(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def visible_file_ids(user):
    return {f["fileId"] for f in all_files() if visible_to(user, f)}


def load_file(file_id, user=None):
    item = aws.table("FILES_TABLE").get_item(Key={"fileId": file_id}).get("Item")
    # Someone else's file is a 404, not a 403, so file ids can't be probed
    if not item or not visible_to(user, item):
        raise HttpError(404, "File not found")
    return item


def _flag_hold(item, active_holds):
    """Add legalHold/holdId/holdReason using the same check as approve, so the
    queue shows a file as held before anyone tries to approve it."""
    hold = holds.find_hold(item, active_holds)
    item["legalHold"] = hold is not None
    if hold:
        item["holdId"] = hold.get("holdId")
        item["holdReason"] = hold.get("reason", "")
    return item


def get_file(req):
    return 200, _flag_hold(load_file(req.params["file_id"], req.user), holds.active_holds())
