"""D.9: the scheduled job that emails people when their files are scanned and ready for review.
Macie is the fake from test_scan; SES is moto's, so the messages that would have been sent can be read back."""
import boto3
import pytest
from moto.core import DEFAULT_ACCOUNT_ID
from moto.ses.models import ses_backends

import audit_log
import aws as aws_clients
import notify
from conftest import call
from test_disposal import add_file
from test_scan import BEFORE, finding
from test_scan import macie  # noqa: F401  (fixture)

SENDER = "notifications@shredsafe.example"


@pytest.fixture
def s3(aws):
    return boto3.client("s3")


@pytest.fixture
def ses(aws, monkeypatch):
    monkeypatch.setenv("NOTIFY_FROM", SENDER)
    monkeypatch.setenv("APP_URL", "https://app.example/queue")
    client = boto3.client("ses")
    for address in (SENDER, "alex@example.com", "sam@example.com", "demo@example.com"):
        client.verify_email_identity(EmailAddress=address)
    return client


def sent():
    """[(to, subject, text body)] for every message moto's SES accepted."""
    out = []
    for m in ses_backends[DEFAULT_ACCOUNT_ID]["us-east-1"].sent_messages:
        out.append((m.destinations["ToAddresses"][0], m.subject, m.body))
    return out


def test_does_nothing_until_a_sender_is_configured(macie, aws, monkeypatch):
    monkeypatch.delenv("NOTIFY_FROM", raising=False)
    assert notify.main() == {"skipped": "NOTIFY_FROM is not set"}


def test_waits_for_a_finished_scan(macie, ses):
    macie.add_job("RUNNING")
    assert "no finished scan" in notify.main()["skipped"]
    assert sent() == []


def test_scores_the_scan_and_emails_each_uploader_their_own_summary(macie, ses, aws, s3):
    add_file(aws, s3, "a1", uploadedAt=BEFORE, ownerAdvisorId="alex@example.com", keepUntil="2019-01-01")
    add_file(aws, s3, "a2", uploadedAt=BEFORE, ownerAdvisorId="alex@example.com", recommendation="REVIEW",
             keepUntil=None)
    add_file(aws, s3, "s1", uploadedAt=BEFORE, ownerAdvisorId="sam@example.com", keepUntil="2019-01-01")
    macie.add_job("COMPLETE")
    macie.findings = [finding("uploads/a1/a1.pdf", {"USA_SOCIAL_SECURITY_NUMBER": 50})]

    result = notify.main()
    assert result["sent"] == ["alex@example.com", "sam@example.com"] and result["failed"] == []

    # Scored exactly as "Show sensitive-data results" would have
    files = {f["fileId"]: f for f in call("GET", "/files")[1]}
    assert files["a1"]["priority"] == "HIGH" and files["a1"]["macieJobId"] == "job-1"

    mail = {to: (subject, body) for to, subject, body in sent()}
    subject, body = mail["alex@example.com"]
    assert subject == "Your files are scanned and ready for review (2 files)"
    assert "1 file is past retention and ready to delete" in body
    assert "1 file holds a lot of client data" in body
    assert "1 file needs a person to decide" in body
    assert "Nothing has been deleted" in body and "https://app.example/queue" in body
    assert "(1 file)" in mail["sam@example.com"][0]  # Sam only hears about Sam's file


def test_each_scan_is_announced_once(macie, ses, aws, s3):
    add_file(aws, s3, "a1", uploadedAt=BEFORE, ownerAdvisorId="alex@example.com")
    macie.add_job("COMPLETE")
    notify.main()
    assert notify.main()["skipped"] == "already notified"
    assert len(sent()) == 1
    entry = [e for e in audit_log.list_entries() if e["action"] == "SCAN_NOTIFIED"]
    assert len(entry) == 1 and entry[0]["detail"].startswith("job-1: emailed 1")


def test_files_uploaded_without_sign_in_go_to_the_fallback_address(macie, ses, aws, s3, monkeypatch):
    add_file(aws, s3, "d1", uploadedAt=BEFORE)  # no ownerAdvisorId: the demo, sign-in off
    macie.add_job("COMPLETE")
    monkeypatch.setenv("NOTIFY_FALLBACK_TO", "demo@example.com")
    assert notify.main()["sent"] == ["demo@example.com"]


def test_no_fallback_means_no_email_for_unowned_files(macie, ses, aws, s3):
    add_file(aws, s3, "d1", uploadedAt=BEFORE)
    macie.add_job("COMPLETE")
    assert notify.main()["sent"] == []


def test_one_bad_address_does_not_stop_the_others(macie, ses, aws, s3, monkeypatch):
    # moto doesn't enforce the sandbox rule that recipients must be verified, so reject like SES does
    real = ses.send_email

    def send_email(**kwargs):
        if kwargs["Destination"]["ToAddresses"] == ["unverified@example.com"]:
            raise ses.exceptions.MessageRejected({"Error": {"Code": "MessageRejected", "Message": "not verified"}},
                                                 "SendEmail")
        return real(**kwargs)

    monkeypatch.setattr(aws_clients, "ses", lambda: type("Ses", (), {"send_email": staticmethod(send_email)})())
    add_file(aws, s3, "a1", uploadedAt=BEFORE, ownerAdvisorId="alex@example.com")
    add_file(aws, s3, "u1", uploadedAt=BEFORE, ownerAdvisorId="unverified@example.com")  # SES sandbox rejects
    macie.add_job("COMPLETE")
    result = notify.main()
    assert result["sent"] == ["alex@example.com"] and result["failed"] == ["unverified@example.com"]


def test_already_ingested_scans_are_not_rescored(macie, ses, aws, s3):
    add_file(aws, s3, "a1", uploadedAt=BEFORE, ownerAdvisorId="alex@example.com")
    macie.add_job("COMPLETE")
    call("POST", "/scan/ingest")  # someone opened the results in the queue first
    before = call("GET", "/files/a1")[1]["scannedAt"]
    notify.main()
    assert call("GET", "/files/a1")[1]["scannedAt"] == before
