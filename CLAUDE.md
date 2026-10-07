@AGENTS.md

# Handoff notes for Claude (state as of 2026-10-07)

Rules and contracts are in AGENTS.md (imported above); how humans run things is README.md; who does what is
STATUS.md. This section is the context those don't hold: decisions made along the way, how our environment
behaves, and what's still open. Update it when any of that changes.

## Environment
- Everything runs in the hackathon's **online VS Code** (Linux, bash, AWS credentials preset), one clone per
  person at `/workshop/LPLhackathon-<name>`. Never switch branches in someone else's folder.
- The site is reached at `https://d18wlstpxd4zq5.cloudfront.net/ports/<port>/`. The proxy strips the
  `/ports/<port>` prefix, so the frontend is built with `--base ./` and served with `vite preview`; the router
  reads the prefix from the address (any port works with one build). `npm run online` = port 5173. Ports are
  shared between people: check who owns a process (`readlink /proc/<pid>/cwd`) before killing it.
- The online VS Code and the site share one origin, so browser storage is shared: clear only
  `CognitoIdentityServiceProvider*` keys, never `localStorage.clear()`.
- Stacks: `shredsafe` (shared demo, deploy from `main` only) and `shredsafe-login` (sign-in test stack; may
  still exist, delete when unused). Deploy params live in `infra/samconfig.toml`; CLI `--parameter-overrides`
  replaces the whole line.

## Decisions (and why)
- **Workspaces, not per-advisor:** people in one workspace (a firm, or a solo advisor) see the same files;
  nobody sees another workspace's. `custom:workspace` on the Cognito user, in the ID token, not writable by
  the web client. Files carry `workspaceId` + `ownerAdvisorId` (signed into the upload URL); legal holds carry
  `workspaceId` and only cover their own workspace, in the API and in `process`.
- **Invite-only on the shared stack:** first admin via `scripts/create_user.py --role admin`, everyone else
  from Admin → People (Aryan's D.8 routes). Invited users finish first sign-in on the "Choose your password"
  step. Self sign-up exists (`AllowSignUp`, creates a new workspace) but is meant to stay off there.
- **API trusts the Cognito ID token** (carries the email for the audit trail), checked once in
  `handler.dispatch`. Roles rank advisor < compliance < admin < **platform**; platform is the operator-only
  role for system-wide routes (demo controls, purge-expired, lock-sensitive).
- **Sign-in UI is Aryan's pages** (`/signin`, `/signup`, `/forgot`) through `src/auth/accountApi.ts`
  (Amplify Auth when `VITE_COGNITO_*` are set in Live mode, preview otherwise). No Cognito-hosted page.
  `RequireSignIn` guards only portal routes; signed out, the home page makes no API calls.
- Classifier is **Amazon Nova Micro** on Bedrock (not Claude), despite PLAN.md.

## Open items
- **Security:** with `AuthRequired=false`, a call with no token acts as the demo user, and `visible_to`
  (and `_hold_in_scope` in `routes/admin.py`) let that user see every workspace. Either set
  `AuthRequired=true` once everyone uses a sign-in build, or change the no-token case to see only data with
  no `workspaceId`. Until then, don't enable sign-up on a stack with `AuthRequired=false`.
- **Unmerged:** `arihant-how-to-run` has `AllowSignUp=false` for the shared stack (commit a779b55) after its
  PR #49 merged; needs a new PR. `arihant-signin-switch` (sign-in replaces a leftover session) was parked by
  the user on purpose.
- **Emails:** Cognito's built-in sender (invites, codes, resets) is ~50/day per account and testing exhausts
  it. Scan emails (SES, D.9) are in the SES sandbox (verified recipients only) and Gmail filters them because
  the sender is a Gmail address; real fix is a domain sender with DKIM + SES production access.
- **Scan email retries:** `notify.py` marks a scan announced even when some sends failed, so failures are
  never retried.
- **Phones:** the site reportedly stopped loading on phones. Not diagnosed; Aryan's PR #47 (WebGL fallback)
  may have fixed it. The proxy address may also need the workshop login on the phone.
- **Audit integrity:** the hash chain is tamper-evident, not tamper-proof (no external anchor); production
  plan is to anchor the head in Object Lock storage.

## Working with this user
- Explain in plain language; they run commands in the online VS Code and paste results back.
- Give exact commands without placeholders they must edit when possible (capture IDs into variables).
- Branch + PR for everything; they merge. Commit messages without Claude co-author lines.
