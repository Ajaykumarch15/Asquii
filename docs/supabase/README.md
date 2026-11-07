# Supabase integration and verification runbook

## Status

The SQL files in this directory are review artifacts; **none have been run against Supabase**. At the time of the original Sprint 9 inspection, the listed Supabase settings were absent from that process environment and `backend/.env` did not exist. A later read-only terminal check confirmed `backend/.env` now exists; its contents were not read or printed. The active local branch is `backend/foundations`.

The local Alembic chain is `0001_empty_baseline -> 0002_mvp_schema -> 0003_lifecycle_hardening`; this supersedes the earlier two-revision summary. The last recorded target inspection found no `public.alembic_version` and none of the 15 Asquii tables. Recheck migration state on the confirmed target immediately before deployment.

The operator later created the isolated `public.asquii_db_probe` table. Its read-only catalog inspection found RLS enabled, FORCE RLS disabled, no policies, and no effective SELECT/INSERT/UPDATE/DELETE grants for `anon`, `authenticated`, or `service_role`; `postgres` had those four privileges. No rows or schema were changed by this inspection. This finding applies only to the probe table, not to Asquii application tables.

## Ordered SQL files

1. [`01_inspect_project.sql`](01_inspect_project.sql) — read-only project, role, RLS, migration-marker, and trigger inventory. It intentionally avoids printing the full JWT claims setting.
2. [`02_schema_validation.sql`](02_schema_validation.sql) — read-only table, column, constraint, index, and migration-marker inventory to compare with Alembic revisions 0002/0003 and SQLAlchemy models.
3. [`03_role_privileges.sql`](03_role_privileges.sql) — read-only current-login privilege, ownership, and role-attribute checks. Run using the same login configured for FastAPI; an SQL Editor admin login does not establish the app role's privileges.
4. [`04_enable_rls.sql`](04_enable_rls.sql) — **state-changing, operator approval required**. Enabling RLS without compatible policies denies ordinary access. Only consider in nonproduction after the policy script and grants have been reviewed; do not run alone.
5. [`05_rls_policies.sql`](05_rls_policies.sql) — **draft, state-changing, security review required**. It creates `private` helper functions and policies for the 15 tables. Helpers assume a reviewed owner that can read membership rows with `row_security=off`; inspect ownership/grants first. It is not approved for production and does not solve all existing API/RLS mismatches (listed below).
6. [`06_activity_writer.sql`](06_activity_writer.sql) — **draft, state-changing, security review required**. It creates a candidate constrained `SECURITY DEFINER` writer with no execute grant. It is not integrated with the application helpers and does not resolve ADR-010. Never grant it to PUBLIC, `anon`, `authenticated`, or an unverified shared role just to restore writes.
7. [`07_constraint_validation.sql`](07_constraint_validation.sql) — read-only catalog checks. These do not prove trigger behavior or concurrency safety.
8. [`08_security_verification.sql`](08_security_verification.sql) — catalog checks plus a transaction-local GUC demonstration that rolls back. It does not prove signature verification or pooled connection reuse.

Read-only scripts can be run in Supabase SQL Editor after confirming the project. State-changing scripts are review drafts only. Do not run `04` or `05` directly: enablement, grants, and policies must become one reviewed, versioned migration after known API mismatches are resolved and the policy matrix passes PostgreSQL integration tests. No script drops tables, resets schemas, or rewrites migration history. Production requires a reviewed deployment plan, backup, rollback procedure, and separate explicit operator approval.

## Environment configuration

Copy `backend/.env.example` to `backend/.env` locally (the current `.env.example` contains placeholders only). Keep the real file untracked and out of logs. Configure:

- `DATABASE_URL`: Supabase PostgreSQL URL using `postgresql+psycopg://`. The example port `6543` indicates a transaction pooler convention, but verify the actual endpoint in Project Settings → Database. Use the direct/session endpoint (commonly `5432`) for Alembic maintenance, not application requests.
- `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW`, `DATABASE_POOL_TIMEOUT`: bounded SQLAlchemy pool controls; current defaults are 3, 2, and 5 seconds.
- `SUPABASE_URL`: the project URL from Project Settings → API.
- `SUPABASE_JWT_ISSUER`: optional explicit issuer; by default the verifier derives `<SUPABASE_URL>/auth/v1`.
- `SUPABASE_JWKS_URL`: optional HTTPS JWKS override constrained to the configured Supabase host; default path is `/auth/v1/.well-known/jwks.json`.
- `SUPABASE_JWT_AUDIENCE`: normally `authenticated` for access tokens.
- `SUPABASE_JWT_SIGNING_METHOD`: `jwks` by default. Legacy `hs256` is explicit-only and requires `SUPABASE_JWT_SECRET` out of band.
- `SUPABASE_ANON_KEY`: server configuration currently required in staging/production settings. Never put a service-role key or database password in frontend variables.
- `CORS_ORIGINS`, `APP_ENV`, and logging settings as described in the backend README.

The app validates deployment-required settings at import/startup. It does not log the database URL or key values. For Supabase TLS, use the SSL parameters and certificate guidance shown by the selected project's Dashboard; do not copy credentials into issue reports.

## Migration procedure

1. Identify the target as disposable development, staging, or production. Confirm project ref and database name from the operator's secure configuration, not a pasted credential.
2. Run scripts 01–03 and record the actual connection role, role flags, RLS state, policies, trigger definitions, grants, and `alembic_version`.
3. Compare script 02 output against the committed models and migration files. Do not reset or recreate existing tables.
4. The local Alembic environment pins `public.alembic_version` and sets a transaction-local `public, pg_catalog` search path for migration DDL. Review generated offline SQL and rehearse `alembic upgrade head` from an empty disposable target before any production application.
5. Run PostgreSQL lifecycle and app integration tests against a dedicated disposable database; use two distinct users and workspaces. Never use SQLite as a substitute.

Sprint 9 implementation performed no Supabase migration. Later read-only catalog checks found the probe table described above and previously found no Asquii revision marker; no deployment write has been performed. The existing `0002_mvp_schema` contains PostgreSQL DDL for the 15 application tables and append-only trigger; `0003_lifecycle_hardening` corrects trigger parent handling. Recheck migration state on the confirmed target immediately before deployment.

## Identity propagation

`get_db` now attaches only the verified JWT subject, the fixed `authenticated` audience role, and configured audience to the request Session. SQLAlchemy's `after_begin` hook sets `request.jwt.claims` and `request.jwt.claim.sub` with `set_config(..., true)` for each transaction. Commit/rollback should clear transaction-local values; nested service transactions reapply them when SQLAlchemy emits `after_begin`. No session-level `SET` is used, and the code does not `SET ROLE` because role membership is unknown.

This implementation is **not verified against PostgreSQL or the selected Supabase pooler**. Before enabling RLS, confirm `auth.uid()` equals a test user's verified JWT subject, claims clear after commit and rollback, and the same pooled connection is safe across alternating users. Confirm the app login has the needed table grants, is not a superuser/table owner with bypass behavior, and does not have `BYPASSRLS`. If direct SQL identity cannot be proven, use Supabase Data API requests with the end-user JWT for RLS-scoped work; a significant service-layer adapter may be required.

## RLS policy coverage and known mismatches

The intended policy matrix in script 05 is:

| Table(s) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Self and shared active workspace members | Self | Self | Deny |
| `workspaces` | Active workspace members | Authenticated row insert, but not a usable create flow until an initial Owner can be safely created in the same transaction | Owner/Admin (column-level role restrictions still needed for Owner-only archive) | Deny |
| `workspace_members` | Active workspace members | Owner/Admin only; initial self-Owner is denied pending a restricted atomic creation operation | Owner/Admin only | Deny; membership removal is soft |
| `workspace_invitations` | Owner/Admin or verified invite email, safe columns only | Owner/Admin | Owner/Admin | Deny; revoke is an update |
| `projects` | Active projects for active workspace members in same workspace | Owner/Admin | Owner/Admin or Project Manager | Deny |
| `project_members` | Active workspace members | Owner/Admin or Project Manager | Owner/Admin or Project Manager | Owner/Admin, Project Manager, or self |
| `milestones` | Workspace members | Owner/Admin or Project Manager | Owner/Admin or Project Manager | Owner/Admin or Project Manager |
| `tasks` | Workspace members | Collaborator | Collaborator | Owner/Admin or Project Manager |
| `task_subtasks` | Workspace members with parent task | Collaborator | Collaborator | Collaborator |
| `task_comments` | Workspace members | Collaborator, author is `auth.uid()` | Author or moderator | Deny; API soft-deletes |
| `meetings` | Workspace members | Collaborator | Owner/Admin or Project Manager | Owner/Admin or Project Manager |
| `meeting_attendees` | Workspace members | Owner/Admin or Project Manager in draft | Owner not used | Owner/Admin or Project Manager, or self |
| `resources` | Workspace members, nondeleted rows | Collaborator, owner is `auth.uid()` | Owner or Owner/Admin/Project Manager | Deny; API soft-deletes |
| `user_resource_preferences` | Own row and visible resource | Own row | Own row | Own row |
| `activity_logs` | Active workspace members | Deny direct insert | Deny | Deny |

The policy script is a draft, not a claim of complete RLS coverage. It now scopes each policy and helper grant to `authenticated`, revokes app-table DML from `PUBLIC`, `anon`, `authenticated`, and `service_role` before granting a per-table subset, removes the unscoped membership-existence helper, and checks active project state for reads. These edits are static review only and have not been applied or tested in PostgreSQL. FastAPI currently accepts invitation tokens by querying `token_hash`; under column-level token-hash protection this needs a narrow invitation-acceptance operation. Workspace create/initial Owner and self-leave are denied until restricted atomic database operations are designed. A Project Member may create a meeting with initial attendees in FastAPI, while the draft restricts attendee INSERT to managers; resolving this safely needs a controlled creation path or revised authorization. Role-sensitive changes (for example Owner-only archive/role mutation) require column grants or controlled database functions. Activity inserts remain denied until the writer path is integrated. Do not enable the draft set until these mismatches are resolved and verified.

Supabase RLS cannot by itself hide invitation `token_hash` from a role with table-wide SELECT; pair the policy with column-level grants and a token-acceptance RPC. Default exposed schemas should not include `private`. Verify every `SECURITY DEFINER` helper's owner, fixed `search_path`, execution rights, and `BYPASSRLS` behavior. The app service still performs role/action authorization; RLS policies must match it and not broaden writes.

## Activity writer boundary

Migration `0002` rejects activity UPDATE/DELETE but allows INSERT unless deployment grants say otherwise. Current workspace/project event helpers directly add ORM rows through the ordinary SQLAlchemy Session. Script 06 is only a candidate function design and has no execute grant; it is not wired into those helpers. To proceed, inspect actual role grants, select a dedicated controlled principal/path, adapt the two centralized event helpers, test atomic writes and rejection of forged actor/scope/action, and preserve immutable rows. Do not grant general `activity_logs` INSERT to the ordinary request role or use a service-role secret.

## Dashboard and deployment checklist

Operator actions still required: obtain the correct Supabase project URL and database/JWKS configuration through secure secret management; confirm development/staging/production target; inspect roles, grants, `BYPASSRLS`, table ownership, pooler mode, and migration revision; apply/reconcile migrations only after review; review policy/RPC designs and SQL grants; run JWT/`auth.uid()` reuse and RLS two-user isolation tests; verify owner/manager trigger concurrency and activity immutability; configure production secrets and CORS. No Dashboard access or credentials were available in this implementation run. Production deployment is **not ready** until these gates pass.
