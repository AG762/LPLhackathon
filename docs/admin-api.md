# Admin API (proposed, for the `/admin` screen)

Status: **built (D.8, `backend/api/routes/admin.py`, tests in `backend/tests/test_admin.py`); live after the next
deploy.** The admin screen (F.15, `frontend/src/pages/Admin.tsx`) calls these routes on the live stack and the
in-browser backend (`frontend/src/api/mock.ts`) in Sample mode. On a stack deployed before D.8 each tab says it
isn't switched on yet instead of failing.

Everything is scoped to the caller's **workspace** (docs/login.md): holds carry `workspaceId` and only cover that
workspace's files; admins only see and change people whose `custom:workspace` matches theirs (others are 404).
Without sign-in (AuthRequired off) holds and rules work as before with no workspace; People needs a signed-in admin.
Changing a role removes the person's other workspace roles, so nobody keeps an old, higher one.

All routes need sign-in ([login.md](login.md)). Every change appends an audit entry, so the hash chain covers who
changed access and holds, not just who deleted files.

## People (`admin` only)

Backed by the Cognito user pool, not a table. Roles are the Cognito groups `advisor`, `compliance` and `admin`.

| Route | Body | Returns | Does |
|---|---|---|---|
| `GET /admin/users` | | `Member[]` | `ListUsers` + `AdminListGroupsForUser` |
| `POST /admin/users` | `{email, role}` | `Member` | `AdminCreateUser` (Cognito emails a temporary password) + `AdminAddUserToGroup`. 409 if the email exists |
| `POST /admin/users/{id}/role` | `{role}` | `Member` | Remove from the old group, add to the new one. 409 if it would leave no active admin |
| `POST /admin/users/{id}/disable` | | `Member` | `AdminDisableUser` + `AdminUserGlobalSignOut`. 409 for your own account or the last admin |
| `POST /admin/users/{id}/enable` | | `Member` | `AdminEnableUser` |

`Member` = `{userId, email, name?, role, status: "ACTIVE"|"INVITED"|"DISABLED", branchId?, invitedAt?, lastActiveAt?}`
(`frontend/src/types.ts`). `INVITED` = Cognito status `FORCE_CHANGE_PASSWORD`.

Audit actions: `USER_INVITED`, `ROLE_CHANGED`, `USER_DISABLED`, `USER_ENABLED` (detail such as `email to role` in `ruleApplied`).

IAM for `ApiFunction`: `cognito-idp:ListUsers, AdminListGroupsForUser, AdminCreateUser, AdminAddUserToGroup,
AdminRemoveUserFromGroup, AdminDisableUser, AdminEnableUser, AdminUserGlobalSignOut` on the user pool.

## Legal holds (`compliance` and `admin`)

Uses the existing `LegalHolds` table and matching in `backend/api/holds.py` (AGENTS.md Rule 2), so the approve guard
and `GET /files` pick up a new hold on the next request.

| Route | Body | Returns | Does |
|---|---|---|---|
| `GET /holds` | | `LegalHold[]` | Scan the table; add `matchedFiles` (how many `Files` rows match now) |
| `POST /holds` | `{scopeType, scopeValue, reason}` | `LegalHold` | `put_item` with `active: true`, `createdBy`, `createdAt`. 400 if value or reason is empty |
| `POST /holds/{holdId}/release` | `{reason}` | `LegalHold` | Set `active: false`, `releasedBy`, `releasedAt`, `releaseReason`. 409 if already released |

Holds are never deleted, only released, so the history stays. Audit actions: `HOLD_PLACED`, `HOLD_RELEASED`.

**After a release:** a file the rules engine parked under `LEGAL_HOLD_OVERRIDE` needs a fresh decision. Demo mode
sets it to `REVIEW` with rule `HOLD_RELEASED`. Live should do the same (or re-run `evaluate_retention` for that file).

## Retention rules (any signed-in user)

| Route | Returns | Does |
|---|---|---|
| `GET /rules` | `RetentionRule[]` | Scan the `RetentionRules` table (seeded from `config/retention_rules.json`) |

Read-only on purpose: rule changes go through compliance review and the repo, so every recommendation traces to a
versioned rule.

## Effort

About half a day for the routes and tests (`moto` mocks `cognito-idp` and DynamoDB), on top of the login work.
