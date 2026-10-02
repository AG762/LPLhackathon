"""Entry point for the `api` Lambda (Function URL). Routes by method + path.

Contract: docs/api.md. Handler setting in infra: `handler.main`.
"""
import logging
import re

from http_utils import HttpError, Request, response
from routes import audit, dashboard, disposal, files, scan

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ID = r"(?P<file_id>[^/]+)"

# Order matters: literal paths before {id} patterns.
ROUTES = [
    ("POST", r"/upload-url", files.upload_url),
    ("GET", r"/files", files.list_files),
    ("POST", r"/files/bulk-approve", disposal.bulk_approve),
    ("GET", rf"/files/{ID}", files.get_file),
    ("POST", rf"/files/{ID}/approve", disposal.approve),
    ("POST", rf"/files/{ID}/reject", disposal.reject),
    ("POST", rf"/files/{ID}/restore", disposal.restore),
    ("POST", r"/scan", scan.start),
    ("GET", r"/scan/status", scan.status),
    ("POST", r"/scan/ingest", scan.ingest),
    ("GET", r"/dashboard", dashboard.get),
    ("GET", r"/audit", audit.list_entries),
    ("GET", r"/audit/verify", audit.verify),
    ("GET", r"/certificate", audit.certificate),
]
_COMPILED = [(method, re.compile(pattern + r"/?"), fn) for method, pattern, fn in ROUTES]


def dispatch(req):
    path_matched = False
    for method, pattern, fn in _COMPILED:
        match = pattern.fullmatch(req.path)
        if not match:
            continue
        path_matched = True
        if method == req.method:
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
