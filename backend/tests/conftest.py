import json

import boto3
import pytest
from moto import mock_aws

import aws as aws_clients
import handler

BUCKET = "shredsafe-test"
FILES = "Files"
HOLDS = "LegalHolds"
AUDIT = "AuditLog"


def event(method, path, body=None, query=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
    }


def call(method, path, body=None, query=None):
    res = handler.main(event(method, path, body, query), None)
    return res["statusCode"], json.loads(res["body"])


def _table(ddb, name, key, key_type="S"):
    return ddb.create_table(
        TableName=name,
        KeySchema=[{"AttributeName": key, "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": key, "AttributeType": key_type}],
        BillingMode="PAY_PER_REQUEST",
    )


@pytest.fixture
def aws(monkeypatch):
    """Mocked AWS with the bucket and tables from infra/template.yaml. Yields the Files table."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BUCKET_NAME", BUCKET)
    monkeypatch.setenv("FILES_TABLE", FILES)
    monkeypatch.setenv("HOLDS_TABLE", HOLDS)
    monkeypatch.setenv("AUDIT_TABLE", AUDIT)
    with mock_aws():
        aws_clients.reset()
        # Mirrors infra: Object Lock implies versioning
        boto3.client("s3").create_bucket(Bucket=BUCKET, ObjectLockEnabledForBucket=True)
        ddb = boto3.resource("dynamodb")
        _table(ddb, HOLDS, "holdId")
        _table(ddb, AUDIT, "seq", key_type="N")  # AuditLogTable: numeric seq
        yield _table(ddb, FILES, "fileId")
        aws_clients.reset()
