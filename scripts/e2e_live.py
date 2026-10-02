"""End-to-end check against the deployed stack, through the public API only (no AWS credentials).

Uploads every file in data/samples/ the way the frontend does (presigned PUT), waits for the
process Lambda to classify them, compares the rows with data/expected.csv, then exercises the
disposal flow and the audit log. Uses only synthetic demo data. Run scripts/reset_demo.py after
if you want the stack empty again.

    python scripts/e2e_live.py --api https://<function-url>   # or set SHREDSAFE_API
"""
import argparse
import csv
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

try:  # python.org builds on macOS ship without CA certificates
    import certifi
    ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())
except ImportError:
    pass

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SAMPLES = os.path.join(ROOT, "data", "samples")


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def call(self, method, path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"content-type": "application/json"} if data else {})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                payload = res.read()
                return res.status, payload if raw else json.loads(payload or b"null")
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                return e.code, json.loads(payload)
            except ValueError:
                return e.code, payload.decode(errors="replace")


def upload(api, path):
    name = os.path.basename(path)
    status, body = api.call("POST", "/upload-url", {"filename": name})
    if status != 200:
        raise SystemExit(f"/upload-url failed for {name}: {status} {body}")
    with open(path, "rb") as f:
        # No Content-Type: works with SigV2 presigned URLs (which sign it) and SigV4 alike
        req = urllib.request.Request(body["url"], data=f.read(), method="PUT", headers={"Content-Type": ""})
    with urllib.request.urlopen(req, timeout=60) as res:
        if res.status not in (200, 204):
            raise SystemExit(f"S3 PUT failed for {name}: {res.status}")
    return body["fileId"]


def wait_for_rows(api, ids, timeout):
    deadline, rows = time.time() + timeout, {}
    while time.time() < deadline and len(rows) < len(ids):
        for name, file_id in ids.items():
            if name not in rows:
                status, body = api.call("GET", f"/files/{file_id}")
                if status == 200:
                    rows[name] = body
        if len(rows) < len(ids):
            time.sleep(3)
    return rows


class Report:
    def __init__(self):
        self.lines, self.failures = [], 0

    def check(self, ok, what, detail=""):
        self.failures += 0 if ok else 1
        self.lines.append(f"{'PASS' if ok else 'FAIL'}  {what}" + (f"  ({detail})" if detail else ""))

    def note(self, text):
        self.lines.append(f"NOTE  {text}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default=os.environ.get("SHREDSAFE_API"))
    parser.add_argument("--timeout", type=int, default=240, help="seconds to wait for classification")
    args = parser.parse_args(argv)
    if not args.api:
        raise SystemExit("Pass --api or set SHREDSAFE_API")
    api, report = Api(args.api), Report()

    with open(os.path.join(ROOT, "data", "expected.csv"), newline="") as f:
        expected = {r["file"]: r for r in csv.DictReader(f)}

    # 1. Upload + classification
    ids = {name: upload(api, os.path.join(SAMPLES, name)) for name in sorted(expected)}
    report.check(True, f"uploaded {len(ids)} files")
    rows = wait_for_rows(api, ids, args.timeout)
    report.check(len(rows) == len(ids), "every upload got a Files row", f"{len(rows)}/{len(ids)} within {args.timeout}s")
    for name, want in expected.items():
        row = rows.get(name)
        if not row:
            report.check(False, f"{name}: classified", "no row")
            continue
        report.check(row.get("docType") == want["docType"], f"{name}: docType",
                     f"got {row.get('docType')}, expected {want['docType']}")
        report.check(row.get("recommendation") == want["recommendation"], f"{name}: recommendation",
                     f"got {row.get('recommendation')}, expected {want['recommendation']}")
        report.check(bool(row.get("legalHold")) == (want["legalHold"] == "yes"), f"{name}: legal hold flag",
                     f"got {row.get('legalHold')}, expected {want['legalHold']}")
        for field in ("sha256", "s3Key", "rationale"):
            report.check(bool(row.get(field)), f"{name}: has {field}")

    # 2. Disposal flow
    held = [n for n, w in expected.items() if w["legalHold"] == "yes" and n in rows]
    if held:
        status, body = api.call("POST", f"/files/{ids[held[0]]}/approve")
        report.check(status == 409, f"approving held file {held[0]} is refused", f"{status} {body}")
    deletable = [n for n, r in rows.items() if r.get("recommendation") == "DELETE" and not r.get("legalHold")]
    if deletable:
        target = deletable[0]
        status, body = api.call("POST", f"/files/{ids[target]}/approve")
        report.check(status == 200 and body.get("status") == "QUARANTINED", f"approve {target}", f"{status}")
        status, body = api.call("POST", f"/files/{ids[target]}/restore")
        report.check(status == 200 and body.get("status") == "PENDING", f"restore {target}", f"{status} {body if status != 200 else ''}")
        status, body = api.call("POST", f"/files/{ids[target]}/approve")
        report.check(status == 200 and body.get("s3Key", "").startswith("quarantine/"), f"re-approve restored {target}", f"{status}")
    else:
        report.note("no deletable file to exercise approve/restore with")
    if len(deletable) > 1:
        status, body = api.call("POST", f"/files/{ids[deletable[1]]}/reject")
        report.check(status == 200 and body.get("status") == "REJECTED", f"reject {deletable[1]}", f"{status}")

    # 3. Audit log + certificate
    status, body = api.call("GET", "/audit")
    report.check(status == 200 and isinstance(body, list) and len(body) > 0, "audit log has entries",
                 f"{len(body) if isinstance(body, list) else body}")
    status, body = api.call("GET", "/audit/verify")
    report.check(status == 200 and body == {"ok": True}, "integrity check passes", f"{body}")
    status, body = api.call("GET", "/certificate", raw=True)
    report.check(status == 200 and isinstance(body, bytes) and body.startswith(b"%PDF-"), "certificate is a PDF",
                 f"{status}")

    print("\n".join(report.lines))
    print(f"\n{report.failures} failed, {len(report.lines) - report.failures} passed or noted")
    print("File ids:", json.dumps(ids))
    return 1 if report.failures else 0


if __name__ == "__main__":
    sys.exit(main())
