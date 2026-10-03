"""Create a sign-in user in the stack's Cognito user pool and put them in a role group (docs/login.md).

Cognito emails the user a temporary password; their first sign-in asks for a new one.

    python scripts/create_user.py alex@example.com                  # advisor
    python scripts/create_user.py sam@example.com --role compliance
    python scripts/create_user.py admin@example.com --role admin --stack shredsafe --region us-east-1
"""
import argparse
import os

import boto3

ROLES = ("advisor", "compliance", "admin")


def user_pool_id(stack, region):
    outputs = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)["Stacks"][0]["Outputs"]
    for o in outputs:
        if o["OutputKey"] == "UserPoolId":
            return o["OutputValue"]
    raise SystemExit("Stack has no UserPoolId output; deploy the sign-in resources first (sam build && sam deploy)")


def create_user(cognito, pool, email, role):
    """Create the user if needed (existing users are left alone) and add them to the role's group."""
    try:
        cognito.admin_create_user(
            UserPoolId=pool, Username=email,
            UserAttributes=[{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"}],
            DesiredDeliveryMediums=["EMAIL"],
        )
        created = True
    except cognito.exceptions.UsernameExistsException:
        created = False
    cognito.admin_add_user_to_group(UserPoolId=pool, Username=email, GroupName=role)
    return created


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("--role", choices=ROLES, default="advisor")
    parser.add_argument("--stack", default="shredsafe")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    args = parser.parse_args(argv)

    pool = user_pool_id(args.stack, args.region)
    cognito = boto3.client("cognito-idp", region_name=args.region)
    created = create_user(cognito, pool, args.email, args.role)
    if created:
        print(f"Created {args.email} as {args.role}. Cognito emailed a temporary password.")
    else:
        print(f"{args.email} already existed; added to {args.role}.")


if __name__ == "__main__":
    main()
