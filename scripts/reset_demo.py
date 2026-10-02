"""Reset the demo stack between rehearsals (rest of STORIES.md A.8).

Deletes every object version and delete marker in the files bucket except under records/
(Object Lock keeps those anyway), and empties the Files and AuditLog tables. RetentionRules and
LegalHolds are seeded config, not demo data, so they stay; the A.7 seed script re-applies them.

Dry run by default:
    python scripts/reset_demo.py                 # shows what would be deleted
    python scripts/reset_demo.py --yes           # deletes it
    python scripts/reset_demo.py --stack shredsafe --region us-east-1 --yes
"""
import argparse
import os
import subprocess
import sys

import boto3

KEEP_PREFIXES = ("records/",)
OUTPUT_KEYS = {"BucketName": "bucket", "FilesTableName": "files_table", "AuditLogTableName": "audit_table"}


def targets_from_outputs(outputs):
    found = {OUTPUT_KEYS[o["OutputKey"]]: o["OutputValue"] for o in outputs if o["OutputKey"] in OUTPUT_KEYS}
    missing = set(OUTPUT_KEYS.values()) - set(found)
    if missing:
        raise SystemExit(f"Stack is missing outputs for: {', '.join(sorted(missing))}")
    return found


def stack_targets(stack, region):
    cfn = boto3.client("cloudformation", region_name=region)
    return targets_from_outputs(cfn.describe_stacks(StackName=stack)["Stacks"][0].get("Outputs", []))


def _object_versions(s3, bucket):
    pages = s3.get_paginator("list_object_versions").paginate(Bucket=bucket)
    for page in pages:
        for item in page.get("Versions", []) + page.get("DeleteMarkers", []):
            if not item["Key"].startswith(KEEP_PREFIXES):
                yield {"Key": item["Key"], "VersionId": item["VersionId"]}


def _empty_bucket(s3, bucket, apply):
    versions = list(_object_versions(s3, bucket))
    if apply:
        for i in range(0, len(versions), 1000):  # DeleteObjects takes at most 1000 keys
            s3.delete_objects(Bucket=bucket, Delete={"Objects": versions[i:i + 1000], "Quiet": True})
    return len(versions)


def _empty_table(ddb, name, apply):
    table = ddb.Table(name)
    key_names = [k["AttributeName"] for k in table.key_schema]
    keys, kwargs = [], {"ProjectionExpression": ", ".join(f"#k{i}" for i in range(len(key_names))),
                        "ExpressionAttributeNames": {f"#k{i}": n for i, n in enumerate(key_names)}}
    while True:
        page = table.scan(**kwargs)
        keys.extend({n: item[n] for n in key_names} for item in page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    if apply:
        with table.batch_writer() as batch:
            for key in keys:
                batch.delete_item(Key=key)
    return len(keys)


def reset(targets, apply=False, region=None):
    s3 = boto3.client("s3", region_name=region)
    ddb = boto3.resource("dynamodb", region_name=region)
    return {
        "objectVersions": _empty_bucket(s3, targets["bucket"], apply),
        "files": _empty_table(ddb, targets["files_table"], apply),
        "auditEntries": _empty_table(ddb, targets["audit_table"], apply),
    }


def _reseed(stack, region):
    seed = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed.py")
    if not os.path.exists(seed):
        print("No scripts/seed.py yet (A.7), so retention rules and legal holds were left as they are.")
        return
    subprocess.run([sys.executable, seed, "--stack", stack, "--region", region], check=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", default="shredsafe")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    args = parser.parse_args(argv)

    targets = stack_targets(args.stack, args.region)
    summary = reset(targets, apply=args.yes, region=args.region)
    verb = "Deleted" if args.yes else "Would delete"
    print(f"{verb} {summary['objectVersions']} object versions from {targets['bucket']} (records/ kept), "
          f"{summary['files']} files and {summary['auditEntries']} audit entries.")
    if args.yes:
        _reseed(args.stack, args.region)
    else:
        print("Dry run. Add --yes to delete.")


if __name__ == "__main__":
    main()
