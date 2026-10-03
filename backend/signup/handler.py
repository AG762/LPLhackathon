"""Cognito post-confirmation trigger: a self-sign-up gets its own workspace and runs it (docs/login.md).

Cognito calls this right after someone confirms their email on the sign-up page. People in the same
workspace see the same files; signing up creates a new, empty workspace, and its creator is its admin.
Others join an existing workspace by being added to it (scripts/create_user.py --workspace, later the
admin panel's invites), not by signing up. Users can't change custom:workspace themselves: the app
client isn't allowed to write it.
"""
import logging
import uuid

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

FOUNDER_GROUP = "admin"  # admin of their own workspace only; system-wide routes need "platform"
_cognito = None


def _client():
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


def new_workspace_id():
    return f"ws-{uuid.uuid4().hex[:16]}"


def main(event, context):
    # Also fires after a forgotten-password reset (PostConfirmation_ConfirmForgotPassword): nothing to do then
    if event.get("triggerSource") != "PostConfirmation_ConfirmSignUp":
        return event
    pool, user = event["userPoolId"], event["userName"]
    attrs = (event.get("request") or {}).get("userAttributes") or {}
    if attrs.get("custom:workspace"):
        logger.info("User %s already belongs to workspace %s", user, attrs["custom:workspace"])
    else:
        workspace = new_workspace_id()
        _client().admin_update_user_attributes(
            UserPoolId=pool, Username=user, UserAttributes=[{"Name": "custom:workspace", "Value": workspace}])
        _client().admin_add_user_to_group(UserPoolId=pool, Username=user, GroupName=FOUNDER_GROUP)
        logger.info("New workspace %s for %s", workspace, user)
    return event  # Cognito requires the event back
