"""Entry point for the `api` Lambda (Function URL). Routes by method + path.

Contract: docs/api.md. Handler setting in infra: `handler.main`.
"""
import logging
import re

import auth
from http_utils import HttpError, Request, response
from routes import audit, dashboard, disposal, files, records, scan

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ID = r"(?P<file_id>[^/]+)"

# Order matters: literal paths before {id} patterns.
# Optional 4th item: the role the route needs (default "advisor"; roles rank advisor < compliance < admin, see auth.py).
ROUTES = [
    ("POST", r"/upload-url", files.upload_url),
    ("GET", r"/files", files.list_files),
    ("POST", r"/files/bulk-approve", disposal.bulk_approve),
    ("POST", r"/files/purge-expired", disposal.purge_expired, "admin"),
    ("POST", r"/files/lock-sensitive", records.lock_sensitive, "admin"),
    ("GET", rf"/files/{ID}", files.get_file),
    ("POST", rf"/files/{ID}/approve", disposal.approve),
    ("POST", rf"/files/{ID}/reject", disposal.reject),
    ("POST", rf"/files/{ID}/restore", disposal.restore),
    ("POST", rf"/files/{ID}/purge", disposal.purge),
    ("POST", r"/scan", scan.start, "compliance"),
    ("GET", r"/scan/status", scan.status),
    ("POST", r"/scan/ingest", scan.ingest, "compliance"),
    ("GET", r"/dashboard", dashboard.get),
    ("GET", r"/audit", audit.list_entries),
    ("GET", r"/audit/verify", audit.verify),
    ("POST", r"/audit/demo/tamper", audit.demo_tamper, "admin"),
    ("POST", r"/audit/demo/restore", audit.demo_restore, "admin"),
    ("GET", r"/certificate", audit.certificate),
]
_COMPILED = [(r[0], re.compile(r[1] + r"/?"), r[2], r[3] if len(r) > 3 else "advisor") for r in ROUTES]


def dispatch(req):
    path_matched = False
    for method, pattern, fn, role in _COMPILED:
        match = pattern.fullmatch(req.path)
        if not match:
            continue
        path_matched = True
        if method == req.method:
            # Every route goes through here, so a new route can't skip the sign-in check
            req.user = auth.current_user(req.headers)
            auth.require_role(req.user, role)
            req.params = match.groupdict()
            return fn(req)
    if path_matched:
        raise HttpError(405, f"{req.method} not allowed on {req.path}")
    raise HttpError(404, f"No route for {req.path}")


def main(event, context):
    try:
        req = Request.from_event(event)
        status, body = dispatch(req)
        return response(status, body)
    except HttpError as e:
        return response(e.status, {"error": e.message})
    except Exception:
        logger.exception("Unhandled error")
        return response(500, {"error": "Internal error"})
