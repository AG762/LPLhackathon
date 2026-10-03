# Notes for coding agents (ShredSafe hackathon repo)

Read this before changing code. It covers the rules that have already broken the deployed app once. Start with Rule 0.
How to deploy and run it: [HOW_TO_RUN.md](HOW_TO_RUN.md). Product and plan: [PLAN.md](PLAN.md). Work breakdown: [STORIES.md](STORIES.md). Who is doing what: [STATUS.md](STATUS.md).

## Layout

| Path | What it is | Deployed as |
|---|---|---|
| `backend/api/` | HTTP API (router in `handler.py`, routes in `routes/`) | Lambda `ApiFunction`, handler `handler.main`, behind a Function URL |
| `backend/process/` | Classifies each upload (Bedrock) and writes the `Files` row | Lambda `ProcessFunction`, handler `handler.process_file_event`, triggered by S3 `uploads/` |
| `backend/signup/` | Cognito post-confirmation trigger: new self-signed-up users join `advisor` | Lambda `SignUpFunction`, handler `handler.main` |
| `backend/shared/` | Rules engine (`rules.py`) | **Not deployed.** Neither Lambda's code folder includes it |
| `backend/tests/` | pytest suite (moto fakes S3/DynamoDB) | n/a |
| `infra/` | SAM template + `samconfig.toml` (stack `shredsafe`, `us-east-1`) | `sam build && sam deploy` |
| `config/` | Retention rules + demo legal holds (seeded by `scripts/seed.py`) | n/a |
| `scripts/` | `seed.py` (A.7), `reset_demo.py` (A.8) | Run by hand against the stack |
| `data/` | Synthetic demo dataset generators + `samples/` (no real client data, ever) | n/a |
| `frontend/` | React + TypeScript + Vite | Dev server / preview only |

## Rule 0: check who is doing what before you start

Three people (and their agents) push to one repo. To avoid duplicate work, overwriting each other's code,
and breaking `main`, do this for **every task, every time**:

1. **Get the latest state.** `git fetch --all --prune`, update from `main`, then read [STATUS.md](STATUS.md),
   `git log origin/main -15`, and the open PRs (`gh pr list`).
2. **Claim one task at a time, before writing code.** Add it to your own STATUS.md section as 🟡 and push that
   edit to `main` right away, so the others see it. Don't claim several tasks at once.
3. **Leave it if someone already has it.** If a task is claimed by someone else, or is already done (code on
   `main` or in an open PR, even if nobody claimed it), don't redo it. Pick something else, or ask the owner.
4. **Don't edit files someone else is working on.** If a teammate's open PR or recent commit touches the same
   files, coordinate first instead of changing them in parallel.
5. **Fetch again before you push.** If `main` moved, merge it into your branch, resolve conflicts keeping
   both sides' intent (never silently drop someone else's change), and rerun the tests (Rule 4).
6. **Never overwrite a teammate's work.** No force-pushes to shared branches, and no rewriting someone else's
   code to make yours fit. If two versions of the same task collide, stop, tell your user, and let the owners
   decide which one stays.
7. **Close the loop.** When your PR merges, mark the task ✅ in your STATUS.md section with the PR number.

This happened once: two people wired the rules engine into `backend/process/handler.py` at the same time
(commit `356dec7` and PR #10). The version that reached `main` first crashed the Lambda, and the two
versions conflicted.

## Rule 1: Lambda imports never start with `backend.`

SAM zips **only the contents** of each function's folder (`CodeUri`), and Lambda imports `handler` from the top of that zip. There is no `backend/` package inside it.

```python
from classify import classify_text                  # correct (backend/process)
from routes import files                            # correct (backend/api)
from backend.process.classify import classify_text  # WRONG: crashes every invocation in Lambda
```

A wrong import works from the repo root on a laptop, so local runs look fine while the deployed Lambda fails with
`Runtime.ImportModuleError: No module named 'backend'`. This happened once already (merge `b640268`): every upload
silently went unclassified.

- To check imports locally, run them from inside the folder: `cd backend/process && python3 -c "import handler"`.
- Tests must load Lambda code the same way. See the loader at the top of `backend/tests/test_process.py`.
- Code in `backend/shared/` is **not available** to either Lambda. If a Lambda needs it, copy it into that Lambda's folder
  or change `infra/template.yaml` (e.g. a layer). Don't just import it.
- **Resolving a merge conflict** in `backend/api/` or `backend/process/`: keep `main`'s import lines.

## Rule 2: contracts other parts depend on

Change these only with the owners' agreement (see STATUS.md), and update every side in the same PR.

- **Upload key:** `uploads/<fileId>/<filename>`. `/upload-url` creates the `fileId`, and `process` must read it back from
  the key (`parts[1]`), **not** use the filename. Same filename uploaded twice must not collide.
- **`Files` row (written by `process`, read by the API and UI):** `fileId`, `s3Key`, `status` (`PENDING` on creation),
  `recommendation` (`DELETE|RETAIN|REVIEW`), `keepUntil` (`YYYY-MM-DD`), `ruleApplied`, `rationale`, `docType`,
  `sha256`, `sizeBytes`, `uploadedAt`, and when known `clientName` / `clientId` / `accountId` / `branchId`.
  **Omit** unknown fields; don't write `"N/A"` (the UI shows it literally).
- **Workspaces:** files carry `workspaceId` (and `ownerAdvisorId`); signed-in users see only their workspace's files (`routes/files.visible_to`). Any new route that returns or changes files, holds or audit data must filter through it. See docs/login.md.
- **`LegalHolds` item:** `{holdId, scopeType, scopeValue, reason, active, workspaceId?}` (a hold only covers its own workspace's files), `scopeType` one of
  `CLIENT_NAME` (case-insensitive substring of `clientName`; use the full name), `CLIENT_ID`, `ACCOUNT_ID`, `BRANCH_ID`, `KEYWORD`.
  Matching lives in `backend/api/holds.py`. The approve guard and `GET /files` (`legalHold`, `holdId`, `holdReason`) both use it.
- **Approve guard:** the API refuses (409) files that are held, `RETAIN`, within `keepUntil`, or not `PENDING`.
  Never weaken this to make a demo step pass. Fix the data instead.
- **API responses:** errors are `{"error": "..."}`. `POST /files/bulk-approve` returns `{approved: [...], blocked: [{fileId, status, error}]}`.
  The frontend's copy of the types is `frontend/src/types.ts`; keep it in sync.
- **Doc types:** the classifier's list is in `backend/process/prompt.py`; `config/retention_rules.json` must cover each one
  (`backend/tests/test_seed.py` checks a copy of the list, so update it too when adding a type).

## Rule 3: git and deploys

- Branch from `main`, open a PR, and Arihant merges it. Don't push code straight to `main`.
  (Edits to your own section of STATUS.md are the exception.)
- Branch names: use dashes (`arihant-seed`, `anwesh-keep-until`). `arihant/...` fails on Windows because a branch `Arihant` exists.
- **Never commit build output:** `infra/.aws-sam/`, `frontend/node_modules/`, `frontend/dist/`, `frontend/.env.local`,
  `__pycache__/`. Don't use `git add .` / `git commit -a` blindly. Check `git status` first.
- **Only Arihant deploys, and only from `main`.** Everyone shares one stack (`shredsafe`), so a deploy from a branch
  overwrites everyone else's Lambda code.
- Deploy parameters live in `infra/samconfig.toml` (`parameter_overrides`). A CLI `--parameter-overrides` **replaces** that
  whole line, silently resetting the others (e.g. `DemoControls`, `FrontendOrigin`). Edit the file instead.
- After changing `config/`, run `python3 scripts/seed.py` (safe to re-run; `--dry-run` to preview).

## Rule 4: tests before a PR

```bash
cd backend && python -m pytest -q        # all tests must pass
cd frontend && npx tsc -b                # if you touched the frontend
```

New API routes need tests in `backend/tests/` using the `aws` fixture from `conftest.py` (mocked bucket + tables).

## Online VS Code (AWS workshop environment)

- Each person works in their **own clone** (`/workshop/LPLhackathon-<name>`), not someone else's folder.
- It's Linux/bash; AWS credentials come from the environment (no `aws configure`). Python there is 3.11, matching the Lambda runtime.
- The frontend is reached at `https://<host>/ports/5173/`. The proxy strips `/ports/5173`, so `npm run dev` shows a blank page there.
  What works is a build + preview with relative asset paths and the router told about the prefix
  (`npx vite build --base ./`, `npx vite preview --host --port 5173`, `BrowserRouter basename="/ports/5173"`), plus
  `server.allowedHosts: true` in `vite.config.ts`. **Not on `main` yet:** these edits (and an `npm run online` script) are pending
  a PR from Arihant. Check `frontend/package.json` before relying on them.
- The API only accepts browser calls from `FrontendOrigin` (CORS), which must be the page's origin with no path,
  e.g. `https://d18wlstpxd4zq5.cloudfront.net`.

## Debugging the deployed stack

```bash
sam logs -n ProcessFunction --stack-name shredsafe --tail   # uploads not appearing in the queue
sam logs -n ApiFunction --stack-name shredsafe --tail       # API 500s
aws cloudformation describe-stacks --stack-name shredsafe --query "Stacks[0].Outputs" --output table
```
