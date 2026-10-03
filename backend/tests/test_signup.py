"""Cognito post-confirmation trigger: a self-sign-up gets its own workspace and is its admin."""
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

    def admin_update_user_attributes(self, **kw):
        self.calls.append(("attributes", kw["Username"], kw["UserAttributes"]))

    def admin_add_user_to_group(self, **kw):
        self.calls.append(("group", kw["Username"], kw["GroupName"]))


def event(source, attrs=None):
    return {"triggerSource": source, "userPoolId": "us-east-1_Pool", "userName": "abc-123",
            "request": {"userAttributes": attrs or {"email": "new@example.com"}}, "response": {}}


def test_new_sign_up_gets_its_own_workspace_and_runs_it(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    ev = event("PostConfirmation_ConfirmSignUp")
    assert signup.main(ev, None) is ev  # Cognito needs the event back
    (kind, user, attrs), group = fake.calls
    assert (kind, user) == ("attributes", "abc-123")
    assert attrs[0]["Name"] == "custom:workspace" and attrs[0]["Value"].startswith("ws-")
    assert group == ("group", "abc-123", "admin")


def test_each_sign_up_gets_a_different_workspace(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    signup.main(event("PostConfirmation_ConfirmSignUp"), None)
    signup.main(event("PostConfirmation_ConfirmSignUp"), None)
    workspaces = [c[2][0]["Value"] for c in fake.calls if c[0] == "attributes"]
    assert len(set(workspaces)) == 2


def test_account_already_in_a_workspace_keeps_it(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    signup.main(event("PostConfirmation_ConfirmSignUp", {"custom:workspace": "ws-existing"}), None)
    assert fake.calls == []


def test_password_reset_does_not_touch_anything(monkeypatch):
    fake = FakeCognito()
    monkeypatch.setattr(signup, "_client", lambda: fake)
    signup.main(event("PostConfirmation_ConfirmForgotPassword"), None)
    assert fake.calls == []
