"""Who is calling: Cognito ID-token check (docs/login.md).

The Function URL is public (AuthType NONE), so the check happens here, once, in handler.dispatch.

- AUTH_REQUIRED=true: every request needs `Authorization: Bearer <Cognito ID token>`.
  ID token, not access token: with email sign-in the access token has no email and its username is a
  random id, so audit entries would read "3f9c...". The ID token is signed the same way, is issued to
  our app client (aud), and is what API Gateway's Cognito authorizer checks by default.
- AUTH_REQUIRED off (the default, and the demo): requests without a token act as the demo advisor
  with every role, exactly like before login existed. A token that *is* sent is still verified, so
  the real user is recorded once the frontend starts sending one.
"""
import os

import jwt

from http_utils import HttpError

DEMO_USER = {"id": "demo-advisor", "groups": ["advisor", "compliance", "admin", "platform"], "signedIn": False,
             "workspace": None}
# Ranked: each role can do everything the ones before it can. A user in no group can do nothing.
# advisor / compliance / admin are roles *within a workspace* and never reach another workspace's data
# (visibility is per workspace: routes/files.visible_to). platform is the ShredSafe operator: the
# system-wide routes (demo controls, purge-expired, lock-sensitive) that act across every workspace.
RANK = {"advisor": 1, "compliance": 2, "admin": 3, "platform": 4}

_jwks = None


def _issuer():
    region = os.environ.get("AWS_REGION", "us-east-1")
    return f"https://cognito-idp.{region}.amazonaws.com/{os.environ.get('USER_POOL_ID', '')}"


def _jwks_client():
    global _jwks
    if _jwks is None:
        # Caches the pool's signing keys across warm invocations
        _jwks = jwt.PyJWKClient(f"{_issuer()}/.well-known/jwks.json")
    return _jwks


def auth_required():
    return os.environ.get("AUTH_REQUIRED") == "true"


def _bearer(headers):
    value = (headers or {}).get("authorization") or ""
    scheme, _, token = value.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def verify(token):
    """ID token -> {"id", "groups", "signedIn", "workspace"}. Raises HttpError(401) on anything wrong."""
    client_id = os.environ.get("USER_POOL_CLIENT_ID")
    if not os.environ.get("USER_POOL_ID") or not client_id:
        raise HttpError(401, "Sign-in is not configured on this stack")
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=_issuer(), audience=client_id,
                            options={"require": ["exp", "iat", "sub", "aud"]})
    except jwt.ExpiredSignatureError:
        raise HttpError(401, "Your session expired. Sign in again.")
    except jwt.PyJWTError:
        raise HttpError(401, "Invalid sign-in token. Sign in again.")
    if claims.get("token_use") != "id":
        raise HttpError(401, "Invalid sign-in token. Sign in again.")
    groups = [g for g in claims.get("cognito:groups", []) if g in RANK]
    user_id = claims.get("email") or claims["sub"]
    # custom:workspace is set by the sign-up trigger or scripts/create_user.py; users can't write it
    # (the app client's WriteAttributes leave it out). Accounts without one get a workspace of their own.
    workspace = claims.get("custom:workspace") or f"user:{claims['sub']}"
    return {"id": user_id, "groups": groups, "signedIn": True, "workspace": workspace}


def current_user(headers):
    token = _bearer(headers)
    if token:
        return verify(token)
    if auth_required():
        raise HttpError(401, "Sign in required")
    return DEMO_USER


def _level(user):
    return max((RANK[g] for g in user["groups"]), default=0)


def require_role(user, role):
    if _level(user) < RANK[role]:
        raise HttpError(403, f"This needs the {role} role")


def reset():
    """Drop the cached key client (tests)."""
    global _jwks
    _jwks = None
