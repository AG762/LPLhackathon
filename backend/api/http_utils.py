"""Request/response helpers for the Lambda Function URL (payload format 2.0)."""
import base64
import json
from dataclasses import dataclass, field
from decimal import Decimal


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Request:
    method: str
    path: str
    query: dict = field(default_factory=dict)
    body: dict = field(default_factory=dict)
    params: dict = field(default_factory=dict)  # filled from path patterns, e.g. {"file_id": ...}

    @classmethod
    def from_event(cls, event):
        raw = event.get("body") or ""
        if raw and event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise HttpError(400, "Body must be JSON")
        return cls(
            method=event["requestContext"]["http"]["method"],
            path=event.get("rawPath", "/"),
            query=event.get("queryStringParameters") or {},
            body=body,
        )


def _json_default(value):
    # DynamoDB returns numbers as Decimal
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def response(status, body):
    # CORS headers come from the Function URL config (infra), not from here;
    # setting them in both places makes browsers reject duplicate headers.
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=_json_default),
    }
