"""Certificate of Disposal (STORIES.md E.4)."""
import base64

import boto3
import pytest

import audit_log
import handler
from conftest import AUDIT, event
from test_disposal import add_file


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


def get_certificate(query=None):
    res = handler.main(event("GET", "/certificate", query=query), None)
    body = base64.b64decode(res["body"]) if res.get("isBase64Encoded") else res["body"].encode()
    return res["statusCode"], res["headers"], body


def test_certificate_is_a_pdf(aws, s3):
    status, headers, body = get_certificate()

    assert status == 200
    assert headers["Content-Type"] == "application/pdf"
    assert body.startswith(b"%PDF-") and body.rstrip().endswith(b"%%EOF")


def test_certificate_lists_disposed_files_with_proof(aws, s3):
    add_file(aws, s3, "gone", sha256="feedbeef", docType="TRADE_CONFIRMATION")
    add_file(aws, s3, "pending", sha256="cafe0000")
    from conftest import call
    assert call("POST", "/files/gone/approve")[0] == 200

    _, _, body = get_certificate()

    assert b"gone" in body and b"feedbeef" in body
    assert b"TRADE_CONFIRMATION" in body and b"SEC_17A4_EXPIRED" in body
    assert b"demo-advisor" in body
    assert b"pending" not in body and b"cafe0000" not in body
    assert audit_log.list_entries()[-1]["entryHash"].encode() in body  # chain head


def test_certificate_is_refused_while_the_chain_is_broken(aws, s3):
    add_file(aws, s3, "gone", sha256="feedbeef")
    from conftest import call
    call("POST", "/files/gone/approve")
    boto3.resource("dynamodb").Table(AUDIT).update_item(
        Key={"seq": 1}, UpdateExpression="SET actor = :a", ExpressionAttributeValues={":a": "x"},
    )

    status, _, body = get_certificate()

    assert status == 409
    assert b"integrity check" in body.lower()


def test_certificate_date_range_filters_by_approval_date(aws, s3):
    add_file(aws, s3, "gone", sha256="feedbeef")
    from conftest import call
    call("POST", "/files/gone/approve")

    _, _, body = get_certificate({"from": "2000-01-01", "to": "2000-12-31"})

    assert b"feedbeef" not in body
    assert b"No files were disposed of in this period" in body
