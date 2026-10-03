"""Lazily created AWS clients and table handles (created on first use so tests can mock them)."""
import os

import boto3
from botocore.config import Config

_s3 = None
_dynamodb = None
_macie = None
_cognito = None


def s3():
    global _s3
    if _s3 is None:
        # SigV4: SigV2 presigned URLs sign Content-Type, and browsers always send one, so uploads
        # from the frontend failed with SignatureDoesNotMatch. SigV4 signs only the host.
        _s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
    return _s3


def macie():
    global _macie
    if _macie is None:
        _macie = boto3.client("macie2")
    return _macie


def cognito():
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


def user_pool_id():
    pool = os.environ.get("USER_POOL_ID")
    if not pool:
        from http_utils import HttpError  # local import: aws.py has no other app dependencies
        raise HttpError(409, "Sign-in isn't set up on this stack, so there are no people to manage")
    return pool


def table(env_var):
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb.Table(os.environ[env_var])


def bucket():
    return os.environ["BUCKET_NAME"]


def reset():
    """Drop cached clients (tests)."""
    global _s3, _dynamodb, _macie, _cognito
    _s3 = None
    _dynamodb = None
    _macie = None
    _cognito = None
