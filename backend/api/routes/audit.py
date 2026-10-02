"""/audit, /audit/verify, /audit/demo/*, /certificate (STORIES.md E.2, E.3, E.4)"""
import os

import audit_log
from http_utils import HttpError


def list_entries(req):
    return 200, audit_log.list_entries()


def _require_demo_controls(req):
    # Never expose tampering outside a rehearsal stack; 404 so the route looks absent.
    if os.environ.get("DEMO_CONTROLS") != "true":
        raise HttpError(404, f"No route for {req.path}")


def demo_tamper(req):
    _require_demo_controls(req)
    seq = audit_log.demo_tamper()
    if seq is None:
        raise HttpError(409, "Need at least two audit entries to simulate tampering")
    return 200, {"tamperedSeq": seq}


def demo_restore(req):
    _require_demo_controls(req)
    seq = audit_log.demo_restore()
    if seq is None:
        raise HttpError(409, "No tampered entry to restore")
    return 200, {"restoredSeq": seq}


def verify(req):
    return 200, audit_log.verify_chain()


def certificate(req):
    # TODO E.4: returns a PDF, so main() will need a binary (isBase64Encoded) response path
    raise HttpError(501, "certificate not implemented")
