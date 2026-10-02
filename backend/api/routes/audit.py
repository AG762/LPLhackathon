"""/audit, /audit/verify, /certificate (STORIES.md E.2, E.4)"""
import audit_log
from http_utils import HttpError


def list_entries(req):
    return 200, audit_log.list_entries()


def verify(req):
    return 200, audit_log.verify_chain()


def certificate(req):
    # TODO E.4: returns a PDF, so main() will need a binary (isBase64Encoded) response path
    raise HttpError(501, "certificate not implemented")
