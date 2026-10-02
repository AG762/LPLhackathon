"""Seed retention rules and demo legal holds into DynamoDB (STORIES.md A.7).

Reads config/retention_rules.json, config/legal_holds.json and data/legal_hold.json (the G.3
demo client's hold, written by data/generate_legal_hold.py) and writes them to the
RetentionRules and LegalHolds tables of the deployed stack. Safe to re-run: each item is
overwritten by its key. scripts/reset_demo.py calls this after wiping demo data.

    python scripts/seed.py                         # uses stack shredsafe
    python scripts/seed.py --stack shredsafe --region us-east-1
    python scripts/seed.py --prune                 # also delete rules/holds not in the config
    python scripts/seed.py --dry-run               # validate config and show what would be written
"""
import argparse
import json
import os

import boto3

REPO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CONFIG_DIR = os.path.join(REPO_DIR, "config")
EXTRA_HOLD_FILES = (os.path.join(REPO_DIR, "data", "legal_hold.json"),)  # G.3, one hold object
OUTPUT_KEYS = {"RetentionRulesTableName": "rules_table", "LegalHoldsTableName": "holds_table"}

TRIGGERS = {"CREATED", "ACCOUNT_CLOSED"}
ACTIONS = {"RETAIN", "DELETE", "REVIEW"}
SCOPE_TYPES = {"CLIENT_NAME", "CLIENT_ID", "ACCOUNT_ID", "BRANCH_ID", "KEYWORD"}


def load_config(config_dir=CONFIG_DIR, extra_hold_files=EXTRA_HOLD_FILES):
    with open(os.path.join(config_dir, "retention_rules.json"), encoding="utf-8") as f:
        rules = json.load(f)["rules"]
    with open(os.path.join(config_dir, "legal_holds.json"), encoding="utf-8") as f:
        holds = json.load(f)["holds"]
    for path in extra_hold_files:
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                extra = json.load(f)
            holds.extend(extra if isinstance(extra, list) else [extra])
    validate(rules, holds)
    return rules, holds


def validate(rules, holds):
    errors = []
    seen = set()
    for i, r in enumerate(rules):
        where = f"rule {i} ({r.get('docType', '?')})"
        if not r.get("docType"):
            errors.append(f"{where}: docType is required")
        elif r["docType"] in seen:
            errors.append(f"{where}: duplicate docType")
        seen.add(r.get("docType"))
        if not isinstance(r.get("retentionYears"), int) or r["retentionYears"] < 0:
            errors.append(f"{where}: retentionYears must be a whole number >= 0")
        if r.get("trigger") not in TRIGGERS:
            errors.append(f"{where}: trigger must be one of {sorted(TRIGGERS)}")
        if r.get("action") not in ACTIONS:
            errors.append(f"{where}: action must be one of {sorted(ACTIONS)}")
        if not r.get("citation"):
            errors.append(f"{where}: citation is required (the certificate prints it)")

    seen = set()
    for i, h in enumerate(holds):
        where = f"hold {i} ({h.get('holdId', '?')})"
        if not h.get("holdId"):
            errors.append(f"{where}: holdId is required")
        elif h["holdId"] in seen:
            errors.append(f"{where}: duplicate holdId")
        seen.add(h.get("holdId"))
        if h.get("scopeType") not in SCOPE_TYPES:
            errors.append(f"{where}: scopeType must be one of {sorted(SCOPE_TYPES)}")
        if not str(h.get("scopeValue", "")).strip():
            errors.append(f"{where}: scopeValue is required")
        if not isinstance(h.get("active", True), bool):
            errors.append(f"{where}: active must be true or false")

    if errors:
        raise SystemExit("Invalid seed config:\n  " + "\n  ".join(errors))


def targets_from_outputs(outputs):
    found = {OUTPUT_KEYS[o["OutputKey"]]: o["OutputValue"] for o in outputs if o["OutputKey"] in OUTPUT_KEYS}
    missing = set(OUTPUT_KEYS.values()) - set(found)
    if missing:
        raise SystemExit(f"Stack is missing outputs for: {', '.join(sorted(missing))}")
    return found


def stack_targets(stack, region):
    cfn = boto3.client("cloudformation", region_name=region)
    return targets_from_outputs(cfn.describe_stacks(StackName=stack)["Stacks"][0].get("Outputs", []))


def _existing_keys(table, key):
    keys, kwargs = set(), {"ProjectionExpression": "#k", "ExpressionAttributeNames": {"#k": key}}
    while True:
        page = table.scan(**kwargs)
        keys.update(item[key] for item in page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return keys
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _sync(table, items, key, prune, apply):
    stale = sorted(_existing_keys(table, key) - {i[key] for i in items}) if prune else []
    if apply:
        with table.batch_writer() as batch:
            for item in items:
                batch.put_item(Item=item)
            for k in stale:
                batch.delete_item(Key={key: k})
    return {"written": len(items), "deleted": len(stale)}


def seed(targets, rules, holds, prune=False, apply=True, region=None):
    ddb = boto3.resource("dynamodb", region_name=region)
    return {
        "rules": _sync(ddb.Table(targets["rules_table"]), rules, "docType", prune, apply),
        "holds": _sync(ddb.Table(targets["holds_table"]), holds, "holdId", prune, apply),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", default="shredsafe")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--prune", action="store_true", help="delete rules/holds that are not in the config")
    parser.add_argument("--dry-run", action="store_true", help="validate and report without writing")
    args = parser.parse_args(argv)

    rules, holds = load_config()
    targets = stack_targets(args.stack, args.region)
    summary = seed(targets, rules, holds, prune=args.prune, apply=not args.dry_run, region=args.region)
    verb = "Would write" if args.dry_run else "Wrote"
    for name, table_key in (("rules", "rules_table"), ("holds", "holds_table")):
        s = summary[name]
        extra = f", {'would delete' if args.dry_run else 'deleted'} {s['deleted']} not in config" if args.prune else ""
        print(f"{verb} {s['written']} {name} to {targets[table_key]}{extra}")


if __name__ == "__main__":
    main()
