"""Cognito post-confirmation trigger: self-signed-up users become advisors."""
import importlib.util
import os

# Loaded by path: the api and process Lambdas also have a module called `handler`
_spec = importlib.util.spec_from_file_location(
    "signup_handler", os.path.join(os.path.dirname(__file__), "..", "signup", "handler.py"))
signup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(signup)


class FakeCognito:
    def __init__(self):
        self.calls = []

    def admin_add_user_to_group(self, **kw):
        self.calls.append(kw)


def event(source):
    return {"triggerSource": source, "userPoolId": "us-east-1_Pool", "userName": "abc-123", "request": {}, "response": {}}


def test_new_sign_up_becomes_advisor(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    ev = event("PostConfirmation_ConfirmSignUp")
    assert signup.main(ev, None) is ev  # Cognito needs the event back
    assert fake.calls == [{"UserPoolId": "us-east-1_Pool", "Username": "abc-123", "GroupName": "advisor"}]


def test_password_reset_does_not_touch_groups(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    signup.main(event("PostConfirmation_ConfirmForgotPassword"), None)
    assert fake.calls == []
