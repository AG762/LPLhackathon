"""Who is calling: Cognito access-token check (docs/login.md, steps 1-2).

The Function URL is public (AuthType NONE), so the check happens here, once, in handler.dispatch.

- AUTH_REQUIRED=true: every request needs `Authorization: Bearer <Cognito access token>`.
- AUTH_REQUIRED off (the default, and the demo): requests without a token act as the demo advisor
  with every role, exactly like before login existed. A token that *is* sent is still verified, so
  the real user is recorded once the frontend starts sending one.
"""
import os

import jwt

from http_utils import HttpError

DEMO_USER = {"id": "demo-advisor", "groups": ["advisor", "compliance", "admin"]}
# Ranked: each role can do everything the ones before it can. A user in no group can do nothing.
RANK = {"advisor": 1, "compliance": 2, "admin": 3}

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
    """Access token -> {"id", "groups"}. Raises HttpError(401) on anything wrong."""
    if not os.environ.get("USER_POOL_ID") or not os.environ.get("USER_POOL_CLIENT_ID"):
        raise HttpError(401, "Sign-in is not configured on this stack")
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        # Access tokens carry client_id instead of aud, so aud is checked by hand below
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=_issuer(),
                            options={"verify_aud": False, "require": ["exp", "iat", "sub"]})
    except jwt.ExpiredSignatureError:
        raise HttpError(401, "Your session expired. Sign in again.")
    except jwt.PyJWTError:
        raise HttpError(401, "Invalid sign-in token. Sign in again.")
    if claims.get("token_use") != "access" or claims.get("client_id") != os.environ["USER_POOL_CLIENT_ID"]:
        raise HttpError(401, "Invalid sign-in token. Sign in again.")
    groups = [g for g in claims.get("cognito:groups", []) if g in RANK]
    return {"id": claims.get("username") or claims["sub"], "groups": groups}


def current_user(headers):
    token = _bearer(headers)
    if token:
        return verify(token)
    if auth_required():
        raise HttpError(401, "Sign in required")
    return DEMO_USER


def require_role(user, role):
    level = max((RANK[g] for g in user["groups"]), default=0)
    if level < RANK[role]:
        raise HttpError(403, f"This needs the {role} role")


def reset():
    """Drop the cached key client (tests)."""
    global _jwks
    _jwks = None
