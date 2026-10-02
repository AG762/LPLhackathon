import json

import boto3
import pytest
from moto import mock_aws

import handler
from routes import files

BUCKET = "shredsafe-test"
TABLE = "Files"


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


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BUCKET_NAME", BUCKET)
    monkeypatch.setenv("FILES_TABLE", TABLE)
    with mock_aws():
        monkeypatch.setattr(files, "_s3", None)
        monkeypatch.setattr(files, "_dynamodb", None)
        boto3.client("s3").create_bucket(Bucket=BUCKET)
        table = boto3.resource("dynamodb").create_table(
            TableName=TABLE,
            KeySchema=[{"AttributeName": "fileId", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "fileId", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield table


def test_unknown_path_is_404():
    assert call("GET", "/nope")[0] == 404


def test_wrong_method_is_405():
    assert call("DELETE", "/files")[0] == 405


def test_bad_json_is_400():
    res = handler.main({**event("POST", "/upload-url"), "body": "{not json"}, None)
    assert res["statusCode"] == 400


def test_bulk_approve_not_captured_by_id_route():
    status, body = call("POST", "/files/bulk-approve", {"ids": []})
    assert status == 501 and "bulk-approve" in body["error"]


def test_upload_url_strips_directories(aws):
    status, body = call("POST", "/upload-url", {"filename": r"..\evil/../statement.pdf"})
    assert status == 200
    assert body["key"] == f"uploads/{body['fileId']}/statement.pdf"
    assert BUCKET in body["url"]


def test_upload_url_requires_filename(aws):
    assert call("POST", "/upload-url", {})[0] == 400


def test_list_sorts_by_priority_then_score(aws):
    for fid, pri, score in [("a", "LOW", 1), ("b", "HIGH", 60), ("c", "HIGH", 120), ("d", "MEDIUM", 20)]:
        aws.put_item(Item={"fileId": fid, "priority": pri, "sensitivityScore": score, "status": "PENDING"})
    aws.put_item(Item={"fileId": "e", "status": "PENDING"})  # not scanned yet

    status, body = call("GET", "/files", query={"sort": "priority"})
    assert status == 200
    assert [f["fileId"] for f in body] == ["c", "b", "d", "a", "e"]
    assert body[0]["sensitivityScore"] == 120  # Decimal serialized as int


def test_list_filters_by_status(aws):
    aws.put_item(Item={"fileId": "a", "status": "PENDING"})
    aws.put_item(Item={"fileId": "b", "status": "QUARANTINED"})
    _, body = call("GET", "/files", query={"status": "QUARANTINED"})
    assert [f["fileId"] for f in body] == ["b"]


def test_get_file(aws):
    aws.put_item(Item={"fileId": "a", "status": "PENDING"})
    assert call("GET", "/files/a") == (200, {"fileId": "a", "status": "PENDING"})
    assert call("GET", "/files/missing")[0] == 404
