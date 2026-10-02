"""/audit, /audit/verify, /certificate (STORIES.md E.2, E.4)"""
from http_utils import HttpError


def list_entries(req):
    raise HttpError(501, "audit not implemented")


def verify(req):
    raise HttpError(501, "audit verify not implemented")


def certificate(req):
    # TODO E.4: returns a PDF, so main() will need a binary (isBase64Encoded) response path
    raise HttpError(501, "certificate not implemented")
