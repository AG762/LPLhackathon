# How to run ShredSafe

Everything runs from the **online VS Code** the hackathon provides (Linux, AWS credentials already set up).
Commands are bash. For what the system is, see [PLAN.md](PLAN.md); for who's working on what, [STATUS.md](STATUS.md).

**Quick version** (shared stack already set up, you just pulled new code):

```bash
cd /workshop/LPLhackathon-<you> && git checkout main && git pull
cd infra && sam build && sam deploy          # type y at "Deploy this changeset?"
cd ../frontend && npm install && npm run online
```

Then open `https://d18wlstpxd4zq5.cloudfront.net/ports/5173/` (with the trailing slash).

---

## 1. One-time setup

1. **Your own clone**, never someone else's folder (switching branches there changes their files):
   ```bash
   cd /workshop && git clone https://github.com/AG762/LPLhackathon.git LPLhackathon-<you>
   ```
   Open that folder in VS Code (**File → Open Folder**).
2. **Check the tools**:
   ```bash
   aws sts get-caller-identity              # prints the account; if not, the workshop session expired
   python3 --version                        # 3.11 (matches the Lambda runtime)
   node --version                           # 20.19+ or 22.12+ (Vite needs it)
   sam --version || pip install --user aws-sam-cli
   ```

## 2. Deploy the backend (stack `shredsafe`)

Settings live in `infra/samconfig.toml`, on the `parameter_overrides` line. **Edit that line; don't pass
`--parameter-overrides` on the command line**, because that replaces the whole line and silently resets the rest.

| Parameter | Demo value | What it does |
|---|---|---|
| `FrontendOrigin` | `https://d18wlstpxd4zq5.cloudfront.net` | Which website may call the API (CORS). The domain only, no path |
| `FrontendBasePath` | `/ports/5173/` | Path of the site; used for the link in invitation emails |
| `DemoControls` | `true` | Enables the audit-log tamper/restore rehearsal |
| `AuthRequired` | `false` → `true` once everyone signs in | `false`: calls without sign-in act as a demo user who sees **everything**. Turn on before real people use it |
| `AllowSignUp` | `false` | `false` = invite-only (first admin from the script, everyone else from Admin → People) |
| `NotifyFrom`, `NotifyFallbackTo` | empty (off) | "Your files are scanned" emails, see §6 |

```bash
cd infra
sam build && sam deploy
```

At **"Deploy this changeset?"** type `y`, **unless** a line says `Delete` next to `FilesBucket` or a table:
answer `n` and ask the team. `sam deploy` alone (without `sam build`) redeploys the old build: always run both.

## 3. First-time data

```bash
python3 scripts/seed.py                                        # retention rules + demo legal holds
python3 scripts/create_user.py admin@yourfirm.com --role admin # the first admin; Cognito emails a temporary password
```

`create_user.py` prints the admin's **workspace** (everyone in a workspace sees the same files).
For a test account without email, add `--password 'Some-long-pass-1'`. To put the demo legal holds into that
workspace (so they apply to signed-in uploads): `python3 scripts/seed.py --workspace ws-...`.

## 4. Run the website

```bash
python3 scripts/frontend_env.py --stack shredsafe > frontend/.env.local   # API address + sign-in settings
cd frontend
npm install
npm run online                                                            # port 5173
```

Open **`https://d18wlstpxd4zq5.cloudfront.net/ports/5173/`** and hard-refresh (**Ctrl+Shift+R**) after a rebuild.

- **Port 5173 taken by someone else?** Use another one. The site reads its `/ports/<port>` prefix from the
  address, so the same build works anywhere:
  ```bash
  npx vite build --base ./ && npx vite preview --host --port 5174 --strictPort
  ```
  Then open `/ports/5174/`. `--strictPort` stops instead of silently moving to the next port.
- **Sample vs Live:** the sidebar switch. **Sample** is an in-browser demo with fake data (no AWS).
  **Live** uses the deployed stack and asks you to sign in. The browser remembers the choice per address.
- **Stop it:** `Ctrl+C` in its terminal. If the terminal is gone:
  `for p in $(pgrep -f vite); do echo "$p $(readlink /proc/$p/cwd)"; done`, then `kill <PID>`
  **only if the path is your clone**.

## 5. People and sign-in (invite-only)

1. The first admin (§3) signs in with the emailed temporary password and chooses their own.
2. **Admin → People → Invite** adds teammates to the **same workspace** with a role (advisor, compliance, admin).
   Cognito emails them **"You're invited to ShredSafe"** from `no-reply@verificationemail.com` (check spam).
3. They sign in at the link, then choose their password. **Forgot password** only works after that first sign-in.

Roles: everyone in a workspace sees the same files. `admin` manages people, `compliance` manages legal holds.
The system-wide `platform` role (demo controls, purge/lock-all) is for the ShredSafe operator only.
Details: [docs/login.md](docs/login.md).

## 6. Optional: "your files are scanned" emails

```bash
python3 scripts/setup_notifications.py --from you@yourmail.com --to teammate@mail.com
```

Everyone listed clicks the link Amazon SES emails them, then `cd infra && sam build && sam deploy`. The email
arrives about 5 minutes after a scan finishes. Sent from a Gmail address it often lands in **Spam**; a sender
on your own domain fixes that. Details: [docs/notifications.md](docs/notifications.md).

## 7. Everyday commands

| Task | Command |
|---|---|
| Update after someone merged | `git pull`, then §2 (`sam build && sam deploy`) and §4 (`npm install && npm run online`) |
| Start the demo from scratch | `python3 scripts/reset_demo.py --yes` (empties files + audit log, re-seeds rules and holds) |
| See why an upload isn't classified | `sam logs -n ProcessFunction --stack-name shredsafe --since 15m` |
| See API errors | `sam logs -n ApiFunction --stack-name shredsafe --since 15m` |
| Stack addresses and table names | `aws cloudformation describe-stacks --stack-name shredsafe --query "Stacks[0].Outputs" --output table` |
| Run the backend tests | `cd backend && python -m pytest -q` |

## 8. When something goes wrong

| Symptom | Fix |
|---|---|
| Blank or black page | Open the address **with the trailing slash** (`/ports/5173/`); hard-refresh |
| "Port already in use" | Someone (maybe you) is on it: §4, use another port or stop yours |
| CORS error in the browser console (F12) | `FrontendOrigin` must be exactly the site's domain, no path; redeploy |
| "There is already a signed in user" | Old session in this browser: sign out from the sidebar, or use a private window |
| "That email and password don't match" | The account is on another stack, or the password is wrong. List accounts: `aws cognito-idp list-users --user-pool-id <UserPoolId>` |
| Invitation / reset email doesn't arrive | Check spam. `--password` accounts get no email by design. Resend: `aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <email> --message-action RESEND --desired-delivery-mediums EMAIL`. Cognito's built-in sender allows ~50 emails a day per account |
| "No changes to deploy" | Run `sam build` before `sam deploy` |
| `UPDATE_FAILED` during deploy | Read the first failed line; it names the resource and the reason |
| `aws` commands fail with credentials errors | Workshop session expired: get fresh credentials from the event page |

## 9. Optional: a separate test stack

To try changes (e.g. a branch) without touching the shared stack, deploy a second copy:

```bash
cd infra && sam build
sam deploy --stack-name shredsafe-<you> --parameter-overrides "DemoControls=true FrontendOrigin=https://d18wlstpxd4zq5.cloudfront.net FrontendBasePath=/ports/5174/ AuthRequired=false AllowSignUp=true"
python3 ../scripts/frontend_env.py --stack shredsafe-<you> > ../frontend/.env.mytest.local
cd ../frontend && npx vite build --base ./ --mode mytest && npx vite preview --host --port 5174 --strictPort
```

Delete it when you're done (it has its own bucket, tables and users):

```bash
python3 scripts/reset_demo.py --stack shredsafe-<you> --yes && sam delete --stack-name shredsafe-<you>
```
