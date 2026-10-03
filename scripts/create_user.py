"""Create a sign-in user in the stack's Cognito user pool and put them in a role group (docs/login.md).

Cognito emails the user a temporary password; their first sign-in asks for a new one.
For test accounts on addresses that can't receive mail, --password sets a permanent password and sends nothing.

People in the same workspace see the same files. Without --workspace a new account gets a new workspace
(printed, so teammates can be added to it); --workspace ws-... adds or moves the account into that one.

    python scripts/create_user.py alex@example.com                  # advisor
    python scripts/create_user.py sam@example.com --role compliance
    python scripts/create_user.py admin@example.com --role admin --stack shredsafe --region us-east-1
    python scripts/create_user.py test@example.com --password 'Long-test-pass-1' --stack shredsafe-login
    python scripts/create_user.py sam@example.com --workspace ws-1a2b3c4d5e6f7a8b --password 'Long-test-pass-1'
"""
import argparse
import os

import boto3

import uuid

ROLES = ("advisor", "compliance", "admin", "platform")


def new_workspace_id():
    return f"ws-{uuid.uuid4().hex[:16]}"  # same shape as backend/signup/handler.py


def user_pool_id(stack, region):
    outputs = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)["Stacks"][0]["Outputs"]
    for o in outputs:
        if o["OutputKey"] == "UserPoolId":
            return o["OutputValue"]
    raise SystemExit("Stack has no UserPoolId output; deploy the sign-in resources first (sam build && sam deploy)")


def create_user(cognito, pool, email, role, password=None, workspace=None):
    """Create the user if needed and add them to the role's group.

    New accounts join `workspace`, or a new one when it's None. An existing account only changes
    workspace when one is given. Returns (created, workspace set now or None)."""
    invite = {"MessageAction": "SUPPRESS"} if password else {"DesiredDeliveryMediums": ["EMAIL"]}
    try:
        workspace_for_new = workspace or new_workspace_id()
        cognito.admin_create_user(
            UserPoolId=pool, Username=email,
            UserAttributes=[{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"},
                            {"Name": "custom:workspace", "Value": workspace_for_new}],
            **invite,
        )
        created, workspace_set = True, workspace_for_new
    except cognito.exceptions.UsernameExistsException:
        created, workspace_set = False, None
        if workspace:
            cognito.admin_update_user_attributes(
                UserPoolId=pool, Username=email, UserAttributes=[{"Name": "custom:workspace", "Value": workspace}])
            workspace_set = workspace
    if password:
        cognito.admin_set_user_password(UserPoolId=pool, Username=email, Password=password, Permanent=True)
    cognito.admin_add_user_to_group(UserPoolId=pool, Username=email, GroupName=role)
    return created, workspace_set


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("--role", choices=ROLES, default="advisor")
    parser.add_argument("--stack", default="shredsafe")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--password", help="set a permanent password and send no email (test accounts)")
    parser.add_argument("--workspace", help="workspace id to join (default for a new account: a new workspace)")
    args = parser.parse_args(argv)

    pool = user_pool_id(args.stack, args.region)
    cognito = boto3.client("cognito-idp", region_name=args.region)
    created, workspace = create_user(cognito, pool, args.email, args.role, args.password, args.workspace)
    how = "with the password you gave" if args.password else "Cognito emailed a temporary password"
    if created:
        print(f"Created {args.email} as {args.role} ({how}).")
    else:
        print(f"{args.email} already existed; added to {args.role}.")
    if workspace:
        print(f"Workspace: {workspace}   (add teammates with --workspace {workspace})")


if __name__ == "__main__":
    main()
