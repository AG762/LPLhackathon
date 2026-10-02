"""/scan, /scan/status, /scan/ingest: Macie (STORIES.md D.5)"""
from http_utils import HttpError


def start(req):
    # TODO D.5: macie2.create_classification_job on the bucket
    raise HttpError(501, "scan not implemented")


def status(req):
    raise HttpError(501, "scan status not implemented")


def ingest(req):
    # TODO D.5: list_findings/get_findings -> per-file counts -> shared sensitivity score
    raise HttpError(501, "scan ingest not implemented")
