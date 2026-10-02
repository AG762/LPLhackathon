"""Lazily created AWS clients and table handles (created on first use so tests can mock them)."""
import os

import boto3
from botocore.config import Config

_s3 = None
_dynamodb = None


def s3():
    global _s3
    if _s3 is None:
        # SigV4: SigV2 presigned URLs sign Content-Type, and browsers always send one, so uploads
        # from the frontend failed with SignatureDoesNotMatch. SigV4 signs only the host.
        _s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
    return _s3


def table(env_var):
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb.Table(os.environ[env_var])


def bucket():
    return os.environ["BUCKET_NAME"]


def reset():
    """Drop cached clients (tests)."""
    global _s3, _dynamodb
    _s3 = None
    _dynamodb = None
