"""/files/{id}/approve|reject|restore, /files/bulk-approve (STORIES.md D.2-D.4)"""
from http_utils import HttpError


def approve(req):
    # TODO D.2: refuse (409) if on legal hold / within retention, move to quarantine/, audit entry
    raise HttpError(501, "approve not implemented")


def reject(req):
    raise HttpError(501, "reject not implemented")


def restore(req):
    # TODO D.3: move quarantine/ -> uploads/, audit entry
    raise HttpError(501, "restore not implemented")


def bulk_approve(req):
    raise HttpError(501, "bulk-approve not implemented")
