"""Cognito post-confirmation trigger: every self-signed-up user becomes an advisor (docs/login.md).

Cognito calls this right after someone confirms their email on the sign-up page. Without a group a
user can do nothing (the API requires at least `advisor`), so new accounts are added to it here.
Each advisor only ever sees their own files, so a new account starts with an empty queue.
Accounts made by scripts/create_user.py don't come through here; that script sets the group itself.
"""
import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DEFAULT_GROUP = "advisor"
_cognito = None


def _client():
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


def main(event, context):
    # Also fires after a forgotten-password reset (PostConfirmation_ConfirmForgotPassword); only new sign-ups get the group
    if event.get("triggerSource") == "PostConfirmation_ConfirmSignUp":
        _client().admin_add_user_to_group(UserPoolId=event["userPoolId"], Username=event["userName"],
                                          GroupName=DEFAULT_GROUP)
        logger.info("Added new user %s to %s", event["userName"], DEFAULT_GROUP)
    return event  # Cognito requires the event back
