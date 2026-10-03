"""Turn on the "your files are scanned" emails (D.9, docs/notifications.md) in one command.

1. Asks Amazon SES to verify the sender and every recipient (SES emails each address a link to click).
   The account starts in the SES sandbox, which only delivers to verified addresses.
2. Shows which addresses are verified so far.
3. Writes NotifyFrom / NotifyFallbackTo into infra/samconfig.toml parameter_overrides, keeping the other
   parameters as they are (a CLI --parameter-overrides would replace them all, see AGENTS.md Rule 3).

Then deploy as usual: cd infra && sam build && sam deploy

    python scripts/setup_notifications.py --from you@example.com --to teammate@example.com --to other@example.com
    python scripts/setup_notifications.py --from you@example.com --status      # just show verification status
    python scripts/setup_notifications.py --from you@example.com --dry-run     # show what would change

--fallback (default: the sender) is who hears about files uploaded without sign-in, i.e. the demo.
"""
import argparse
import os
import re
import sys

import boto3

REPO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SAMCONFIG = os.path.join(REPO_DIR, "infra", "samconfig.toml")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
OVERRIDES = re.compile(r'^(parameter_overrides\s*=\s*")(.*)("\s*)$', re.M)


def set_overrides(text, values):
    """samconfig.toml text with `values` set in parameter_overrides, every other parameter kept."""
    match = OVERRIDES.search(text)
    if not match:
        raise SystemExit("infra/samconfig.toml has no parameter_overrides line; add one first.")
    params = dict(p.split("=", 1) for p in match.group(2).split() if "=" in p)
    params.update(values)
    line = " ".join(f"{k}={v}" for k, v in params.items())
    return text[:match.start(2)] + line + text[match.end(2):]


def verification_status(ses, addresses):
    attrs = ses.get_identity_verification_attributes(Identities=list(addresses))["VerificationAttributes"]
    return {a: attrs.get(a, {}).get("VerificationStatus", "NotStarted") for a in addresses}


def main(argv=None, ses=None, samconfig=SAMCONFIG):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="sender", required=True, help="sender address (must be one you can receive)")
    parser.add_argument("--to", action="append", default=[], help="recipient to verify (repeat for each person)")
    parser.add_argument("--fallback", help="who hears about files uploaded without sign-in (default: --from)")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--status", action="store_true", help="only show verification status")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    fallback = args.fallback or args.sender
    addresses = list(dict.fromkeys([args.sender, fallback, *args.to]))  # unique, in order
    bad = [a for a in addresses if not EMAIL.match(a)]
    if bad:
        raise SystemExit(f"Not an email address: {', '.join(bad)}")

    ses = ses or boto3.client("ses", region_name=args.region)
    if not args.status:
        for address in addresses:
            if args.dry_run:
                print(f"would ask SES to verify {address}")
            else:
                ses.verify_email_identity(EmailAddress=address)
                print(f"SES is emailing a verification link to {address}")

    status = verification_status(ses, addresses)
    print("\nVerification status (each person clicks the link SES sent them):")
    for address, state in status.items():
        print(f"  {'OK ' if state == 'Success' else '...'} {address}: {state}")
    if args.status:
        return 0

    with open(samconfig, encoding="utf-8") as f:
        text = f.read()
    updated = set_overrides(text, {"NotifyFrom": args.sender, "NotifyFallbackTo": fallback})
    if args.dry_run:
        print(f"\nwould set in {os.path.relpath(samconfig, REPO_DIR)}:\n  {OVERRIDES.search(updated).group(2)}")
    elif updated != text:
        with open(samconfig, "w", encoding="utf-8") as f:
            f.write(updated)
        print(f"\nUpdated {os.path.relpath(samconfig, REPO_DIR)}: NotifyFrom={args.sender} NotifyFallbackTo={fallback}")

    pending = [a for a, s in status.items() if s != "Success"]
    print("\nNext:")
    if pending:
        print(f"  1. Click the SES links sent to: {', '.join(pending)} (check spam).")
        print(f"     Re-check with: python scripts/setup_notifications.py --from {args.sender} --status")
    print("  2. cd infra && sam build && sam deploy   (creates NotifyFunction; it runs every 5 minutes)")
    print("  3. Upload a few files; when the scan finishes, the email arrives within 5 minutes. See docs/notifications.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
