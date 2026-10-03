"""scripts/setup_notifications.py: SES verification requests and the samconfig edit (D.9)."""
import os
import sys

import boto3
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import setup_notifications as setup  # noqa: E402

SAMCONFIG = """version = 0.1

[default.deploy.parameters]
capabilities = "CAPABILITY_IAM"
parameter_overrides = "DemoControls=true FrontendOrigin=https://x.example FrontendBasePath=/ports/5173/ AuthRequired=false"
"""


@pytest.fixture
def config(tmp_path):
    path = tmp_path / "samconfig.toml"
    path.write_text(SAMCONFIG)
    return path


def test_keeps_every_other_parameter_and_adds_the_notify_ones():
    out = setup.set_overrides(SAMCONFIG, {"NotifyFrom": "a@b.com", "NotifyFallbackTo": "a@b.com"})
    line = setup.OVERRIDES.search(out).group(2)
    assert line == ("DemoControls=true FrontendOrigin=https://x.example FrontendBasePath=/ports/5173/ "
                    "AuthRequired=false NotifyFrom=a@b.com NotifyFallbackTo=a@b.com")


def test_running_again_replaces_instead_of_duplicating():
    once = setup.set_overrides(SAMCONFIG, {"NotifyFrom": "a@b.com"})
    twice = setup.set_overrides(once, {"NotifyFrom": "new@b.com"})
    line = setup.OVERRIDES.search(twice).group(2)
    assert line.count("NotifyFrom=") == 1 and "NotifyFrom=new@b.com" in line


def test_requests_verification_and_writes_the_config(aws, config, capsys):
    ses = boto3.client("ses", region_name="us-east-1")
    assert setup.main(["--from", "me@example.com", "--to", "team@example.com"], ses=ses, samconfig=str(config)) == 0
    identities = ses.list_identities(IdentityType="EmailAddress")["Identities"]
    assert sorted(identities) == ["me@example.com", "team@example.com"]
    assert "NotifyFrom=me@example.com NotifyFallbackTo=me@example.com" in config.read_text()
    assert "DemoControls=true" in config.read_text()
    assert "sam build && sam deploy" in capsys.readouterr().out


def test_dry_run_changes_nothing(aws, config):
    ses = boto3.client("ses", region_name="us-east-1")
    setup.main(["--from", "me@example.com", "--dry-run"], ses=ses, samconfig=str(config))
    assert ses.list_identities()["Identities"] == []
    assert config.read_text() == SAMCONFIG


def test_status_only_reads(aws, config, capsys):
    ses = boto3.client("ses", region_name="us-east-1")
    ses.verify_email_identity(EmailAddress="me@example.com")
    setup.main(["--from", "me@example.com", "--status"], ses=ses, samconfig=str(config))
    assert config.read_text() == SAMCONFIG
    assert "me@example.com" in capsys.readouterr().out


def test_rejects_things_that_are_not_email_addresses(aws, config):
    with pytest.raises(SystemExit, match="Not an email address"):
        setup.main(["--from", "not-an-email"], ses=boto3.client("ses", region_name="us-east-1"), samconfig=str(config))
