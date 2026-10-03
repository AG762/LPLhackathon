"""Entry point for the `api` Lambda (Function URL). Routes by method + path.

Contract: docs/api.md. Handler setting in infra: `handler.main`.
"""
import logging
import re

import auth
from http_utils import HttpError, Request, response
from routes import admin, audit, dashboard, disposal, files, records, scan

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ID = r"(?P<file_id>[^/]+)"
HOLD = r"(?P<hold_id>[^/]+)"
USER = r"(?P<user_id>[^/]+)"

# Order matters: literal paths before {id} patterns.
# Optional 4th item: the role the route needs (default "advisor"; advisor < compliance < admin < platform, see auth.py).
# "platform" routes act across every workspace, so no workspace role can reach them.
ROUTES = [
    ("POST", r"/upload-url", files.upload_url),
    ("GET", r"/files", files.list_files),
    ("POST", r"/files/bulk-approve", disposal.bulk_approve),
    ("POST", r"/files/purge-expired", disposal.purge_expired, "platform"),
    ("POST", r"/files/lock-sensitive", records.lock_sensitive, "platform"),
    ("GET", rf"/files/{ID}", files.get_file),
    ("POST", rf"/files/{ID}/approve", disposal.approve),
    ("POST", rf"/files/{ID}/reject", disposal.reject),
    ("POST", rf"/files/{ID}/restore", disposal.restore),
    ("POST", rf"/files/{ID}/purge", disposal.purge),
    ("POST", r"/scan", scan.start),
    ("GET", r"/scan/status", scan.status),
    ("POST", r"/scan/ingest", scan.ingest),
    ("GET", r"/dashboard", dashboard.get),
    ("GET", r"/audit", audit.list_entries),
    ("GET", r"/audit/verify", audit.verify),
    ("POST", r"/audit/demo/tamper", audit.demo_tamper, "platform"),
    ("POST", r"/audit/demo/restore", audit.demo_restore, "platform"),
    ("GET", r"/certificate", audit.certificate),
    # Admin page (docs/admin-api.md): rules for anyone signed in, holds for compliance, people for admins
    ("GET", r"/rules", admin.list_rules),
    ("GET", r"/holds", admin.list_holds, "compliance"),
    ("POST", r"/holds", admin.place_hold, "compliance"),
    ("POST", rf"/holds/{HOLD}/release", admin.release_hold, "compliance"),
    ("GET", r"/admin/users", admin.list_members, "admin"),
    ("POST", r"/admin/users", admin.invite_member, "admin"),
    ("POST", rf"/admin/users/{USER}/role", admin.set_member_role, "admin"),
    ("POST", rf"/admin/users/{USER}/disable", admin.disable_member, "admin"),
    ("POST", rf"/admin/users/{USER}/enable", admin.enable_member, "admin"),
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
