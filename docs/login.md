# Adding user login

Status: **built, switched off.** `AuthRequired=false` keeps today's behaviour: requests without a token act as the
demo advisor with every role, and the frontend only shows sign-in when the Cognito settings are configured.
This doc is also the answer to "how would users log in?" on stage.

### What's built

- `infra/template.yaml`: user pool (email sign-in, admin-created users only, optional TOTP MFA, 12+ char passwords),
  sign-in domain, `web` app client (code + PKCE, no secret, 1 h tokens), groups `advisor` / `compliance` / `admin`,
  `ALLOW_USER_SRP_AUTH` + refresh for the app's own forms, `PreventUserExistenceErrors`, `Authorization` allowed by CORS, parameters `AuthRequired` and `FrontendBasePath`, outputs `UserPoolId`,
  `UserPoolClientId`, `CognitoAuthority`, `CognitoDomain`.
- `backend/api/auth.py` + `handler.dispatch`: every route checks the caller before running. The API takes the Cognito
  **ID token** (it carries the email; with email sign-in the access token's username is a random id), checked for
  signature, issuer, audience (our app client), expiry and `token_use`. Roles are **ranked**
  (admin ⊇ compliance ⊇ advisor); a signed-in user in no group gets 403. Route roles are the 4th item in `ROUTES`.
- Approve, reject, restore and blocked approvals record the signed-in user's email (`approvedBy`, audit `actor`, ...).
- **Ownership:** for signed-in users `/upload-url` signs `x-amz-meta-owner` into the upload URL and returns it in
  `headers`; the frontend sends it; `process` saves it as `ownerAdvisorId`. Advisors only see and act on their own
  files (others' files are 404) whatever their role; dashboard, audit list, certificate and scan results cover only
  their files. `/audit/verify` still checks the whole chain but only answers ok / broken-at.
  Uploads without sign-in carry no owner, so the demo and older frontends work unchanged.
- Frontend: Aryan's pages at `/signin`, `/signup`, `/forgot` (`src/pages/Auth.tsx`) call `src/auth/accountApi.ts`,
  which uses Amazon Cognito through Amplify Auth (SRP) when `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`
  are set in Live mode, and pretends otherwise (Sample mode). `RequireSignIn` guards the portal routes (`/queue`,
  `/upload`, `/dashboard`, `/audit`, `/admin`) and returns you to the page you wanted; the home page and the sign-in
  pages stay public and, while signed out, make no API calls (no other advisor's file names or audit entries).
  The ID token goes on every API call (refreshed automatically); "Keep me signed in" picks persistent or tab-only
  token storage; the sidebar shows the name or email, role and **Sign out**. Sign-up stores `name` and `custom:firm`.
  Not handled on these pages yet: the new-password step for invited accounts and authenticator (MFA) codes; the
  page explains instead.
- **Self sign-up** (`AllowSignUp`, default on): any independent advisor can create an account from the sign-in page and
  confirms their email with a code. `backend/signup/` (post-confirmation trigger) adds every new account to `advisor`,
  so it can use the app straight away; per-advisor visibility means it starts with an empty queue.
  `AllowSignUp=false` makes a stack invite-only.
- Scripts: `create_user.py` (accounts, `--password` for test accounts), `frontend_env.py` (frontend settings from a stack).
- Tests: `backend/tests/test_auth.py`.

### Not built yet

- The Audit page labels the last entry *it shows* as the chain head; for a filtered (per-advisor) list that's the
  advisor's latest entry, not the true head. Cosmetic; the integrity check itself uses the whole chain.
- Files uploaded before sign-in have no owner, so no signed-in user sees them.
- **Open sign-up limits before real use:** Cognito's built-in email sender allows about 50 emails a day (sign-up codes,
  password resets); production needs Amazon SES. Anyone can sign up and upload, so add per-account upload quotas
  and bot protection (e.g. Cognito threat protection or a CAPTCHA) before opening it to the public.

## Today

- The API is a Lambda **Function URL with `AuthType: NONE`** (`infra/template.yaml`). Anyone with the URL can call
  every route, including approve and the demo tamper controls.
- Every action is recorded as the same person: `DEMO_ADVISOR = "demo-advisor"` in `backend/api/routes/disposal.py`
  (`approvedBy`, `rejectedBy`, `restoredBy`, audit `actor`). The UI shows a fixed advisor from `frontend/src/lib/format.ts`.
- Files have no owner: `ownerAdvisorId` exists in `frontend/src/types.ts` but nothing on the backend sets it.

So login has two jobs: **authentication** (who is calling) and **authorization** (what they may do and see), plus
recording the real person in the audit trail, which is the point of "who approved it" in defensible disposal.

## Recommended approach: Amazon Cognito + JWT check in the API Lambda

```
Browser ──(1) redirect──► Cognito managed login page (email + password, optional MFA)
   ◄──(2) code ──────────┘
   ──(3) code + PKCE ───► Cognito token endpoint ──► ID + access tokens (JWT)
   ──(4) API call, header  Authorization: Bearer <access token> ──► Function URL ──► ApiFunction
                                                                     verifies the JWT, then routes
```

- **Cognito User Pool** stores users and passwords and serves the login page (no password handling in our code).
- **Authorization code flow with PKCE**: the standard for single-page apps; no client secret in the browser.
- **The API Lambda verifies the token itself**, in one place (`handler.dispatch`), before any route runs.
  This keeps the Function URL (no API Gateway, matching the plan's "fewest services" choice).
- **Cognito groups** carry roles: `advisor`, `compliance`, `admin`.

### Alternatives considered

| Option | Why not (for now) |
|---|---|
| API Gateway HTTP API + built-in JWT authorizer | Cleanest for production (rejects bad tokens before Lambda runs), but adds a service and a new URL the frontend must switch to. Good follow-up |
| Function URL `AuthType: AWS_IAM` + Cognito Identity Pool | Browser must SigV4-sign every request; much more frontend work |
| A shared demo password | Gives no per-person identity, so the audit trail still can't say who approved |

## Roles and rules

**Each signed-in user is one advisor and sees only their own files, whatever their role.** Nobody can see or act on
another advisor's files, audit entries or certificate lines. Roles only gate *actions*:

| Role (Cognito group) | Can |
|---|---|
| `advisor` | Upload; see and act on their own files; run Macie scans; their own dashboard, audit entries and certificate |
| `compliance` | Same as advisor today (reserved for future firm-wide features, which would need an explicit decision to share data) |
| `admin` | Also: demo controls (`/audit/demo/*`), `purge-expired`, `lock-sensitive` (system actions across the bucket) |

The disposal guards don't change: a held or still-retained file is refused for **every** role, including admin.
Without sign-in (`AuthRequired=false`, no token) the demo user still sees everything, as before.

## Implementation steps

### 1. Infra (`infra/template.yaml`)

```yaml
  UserPool:
    Type: AWS::Cognito::UserPool
    Properties:
      UserPoolName: !Sub "${AWS::StackName}-users"
      UsernameAttributes: [email]
      AutoVerifiedAttributes: [email]
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false }  # self sign-up (AllowSignUp parameter)
      MfaConfiguration: OPTIONAL
      EnabledMfas: [SOFTWARE_TOKEN_MFA]
      Policies:
        PasswordPolicy: { MinimumLength: 12 }

  UserPoolDomain:
    Type: AWS::Cognito::UserPoolDomain
    Properties:
      Domain: !Sub "${AWS::StackName}-${AWS::AccountId}"   # login page host prefix; must be globally unique
      UserPoolId: !Ref UserPool

  WebClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      UserPoolId: !Ref UserPool
      GenerateSecret: false                    # browser app: PKCE instead of a secret
      AllowedOAuthFlowsUserPoolClient: true
      AllowedOAuthFlows: [code]
      AllowedOAuthScopes: [openid, email, profile]
      SupportedIdentityProviders: [COGNITO]
      CallbackURLs: [!Sub "${FrontendOrigin}/", "http://localhost:5173/"]
      LogoutURLs: [!Sub "${FrontendOrigin}/", "http://localhost:5173/"]

  AdvisorGroup:    { Type: AWS::Cognito::UserPoolGroup, Properties: { GroupName: advisor,    UserPoolId: !Ref UserPool } }
  ComplianceGroup: { Type: AWS::Cognito::UserPoolGroup, Properties: { GroupName: compliance, UserPoolId: !Ref UserPool } }
  AdminGroup:      { Type: AWS::Cognito::UserPoolGroup, Properties: { GroupName: admin,      UserPoolId: !Ref UserPool } }
```

Also:
- `ApiFunction` env: `USER_POOL_ID: !Ref UserPool`, `USER_POOL_CLIENT_ID: !Ref WebClient`, `AUTH_REQUIRED: !Ref AuthRequired`
  (new parameter, default `"false"`, so turning login on is a samconfig change, not a code change).
- Function URL CORS: `AllowHeaders: [content-type, authorization]` (the browser won't send the token otherwise).
- Outputs: `UserPoolId`, `UserPoolClientId`, and the login domain `https://<prefix>.auth.<region>.amazoncognito.com`.
- **Callback URLs** must match exactly, including the online VS Code path: if the app is served at
  `https://<host>/ports/5173/`, that full URL (with `/ports/5173/`) is the callback, not just the origin.

### 2. API (`backend/api/`)

New `auth.py`, called once from `handler.dispatch` before routing:

```python
import os
import jwt  # PyJWT[crypto]; add "PyJWT[crypto]" to backend/api/requirements.txt

from http_utils import HttpError

REGION = os.environ.get("AWS_REGION", "us-east-1")
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{os.environ.get('USER_POOL_ID', '')}"
_jwks = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json")  # caches keys across warm invocations


def current_user(headers):
    """-> {"id", "groups"} or raises HttpError(401)."""
    token = (headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if not token:
        raise HttpError(401, "Sign in required")
    try:
        key = _jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER,
                            options={"verify_aud": False})  # access tokens carry client_id, not aud
    except jwt.PyJWTError:
        raise HttpError(401, "Session expired or invalid; sign in again")
    if claims.get("token_use") != "access" or claims.get("client_id") != os.environ["USER_POOL_CLIENT_ID"]:
        raise HttpError(401, "Wrong token type")
    return {"id": claims["username"], "groups": claims.get("cognito:groups", [])}
```

Then:
- `Request` gets `headers` and a `user` field; `dispatch` sets `req.user` (or a fixed demo user when `AUTH_REQUIRED` is off,
  so today's demo keeps working).
- Each route table entry declares the role it needs (e.g. `("POST", "/audit/demo/tamper", audit.demo_tamper, "admin")`);
  `dispatch` returns **403** when the user lacks it. Checking in one place means a new route can't forget it.
- Replace `DEMO_ADVISOR` with `req.user["id"]` everywhere it's used (`approvedBy`, `rejectedBy`, `restoredBy`, audit `actor`).
  System actions keep `"system:api"`.
- **File ownership:** `/upload-url` signs `Metadata={"owner": user id}` into the presigned PUT (the browser must send the
  matching `x-amz-meta-owner` header, and the signature stops it being changed). `process` reads it with `head_object`
  and saves `ownerAdvisorId` on the row. The upload key format `uploads/<fileId>/<filename>` stays the same.
- `GET /files`, `/files/{id}`, `/dashboard`, `/audit`: advisors see only rows with their `ownerAdvisorId`
  (404, not 403, for someone else's file, so ids can't be probed); `compliance`/`admin` see all.

### 3. Frontend (`frontend/`)

- Add `react-oidc-context` (wraps `oidc-client-ts`); wrap the app in `<AuthProvider>` with
  `authority = ISSUER`, `client_id`, `redirect_uri = window.location.origin + import.meta.env.BASE_URL`,
  `response_type: "code"`, `scope: "openid email profile"`.
- In `api/client.ts` `request()`, add `Authorization: Bearer ${auth.user.access_token}`; on **401**, call `signinRedirect()`.
- Show the signed-in user's email (from the ID token) instead of `DEMO_ADVISOR`; add **Sign out**. Cognito's logout is
  `https://<domain>/logout?client_id=<id>&logout_uri=<url-encoded app URL>`, not the generic OIDC end-session URL.
- New env vars in `.env.local`: `VITE_COGNITO_AUTHORITY`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`.
- Mock mode stays login-free.

### 4. Users

```bash
POOL=$(aws cloudformation describe-stacks --stack-name shredsafe --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
aws cognito-idp admin-create-user --user-pool-id $POOL --username advisor@example.com --user-attributes Name=email,Value=advisor@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username advisor@example.com --group-name advisor
```
Cognito emails a temporary password; the first login forces a new one. A small `scripts/create_user.py` can wrap this.

## Rollout order (nothing breaks along the way)

1. Infra: user pool, client, groups, CORS header, `AuthRequired=false`. Deploy. Nothing changes for users yet.
2. API: verify tokens **when present**, record the real user, enforce roles; still allow anonymous while the flag is off.
3. Frontend: login screen + token on requests.
4. Create the team's users, test, then set `AuthRequired=true` in `infra/samconfig.toml` and deploy.

## Testing

- Unit tests generate an RSA key pair, sign tokens with it, and monkeypatch `auth._jwks` to return the public key.
  Cover: missing token → 401, expired → 401, wrong `client_id` / `token_use` → 401, advisor on admin route → 403,
  advisor reading another advisor's file → 404, approve records the real user as `approvedBy` and audit `actor`.
- Live: log in as an advisor and a compliance user in two browsers; check each sees the right files and the audit
  log shows the right names.

## Effort and recommendation

About **a day** for one person across infra, API, frontend and tests. **Don't build it before the demo**: it touches
every route and the login redirect is one more thing that can fail on stage Wi-Fi. For the pitch, say:

> "The demo runs as one advisor. In production, advisors sign in through Amazon Cognito with MFA; every API call carries
> their token, the audit trail records the real person, and advisors only see their own branch's files while compliance
> sees the whole firm."

## Security notes

- With login on, the Function URL is still publicly reachable; **every** request is checked in code. That's why the
  check lives in `dispatch`, not in individual routes.
- Function URLs can't sit behind AWS WAF directly; production should add CloudFront + WAF, or move to API Gateway
  (throttling, JWT authorizer).
- Keep `DemoControls=false` on any stack real users can reach, even with the `admin` role check.
