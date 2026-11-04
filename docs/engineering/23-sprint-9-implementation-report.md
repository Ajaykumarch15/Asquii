# Sprint 9 — Supabase Integration, Database Validation & Security Hardening

## Summary

Sprint 9 added bounded database-pool configuration, a transaction-local propagation hook for the verified JWT identity, a staged Supabase inspection/validation runbook, and draft RLS/activity-writer SQL for security review. No Supabase database was configured or contacted. The SQL deliverables are not evidence that database settings, grants, RLS, or policies have been applied.

The implementation remains on `backend/foundations`. No migration was added, no existing migration was rewritten, no frontend file was modified, and no commit or push was made. Existing uncommitted work from earlier sprints was preserved.

## JWT verification approach

The existing Sprint 3 verifier remains the application's authentication boundary. It supports fixed-project JWKS verification with RS256/ES256 and explicit legacy HS256 configuration only. It validates `kid`, signature, issuer, `authenticated` audience, expiration, optional not-before, and UUID subject. The JWKS endpoint is server-configured and cache/refresh behavior is bounded. No Supabase URL, key, or database credential was available, so no live token or key-rotation test was performed.

## Database connection and request identity

The SQLAlchemy pool remains synchronous Psycopg. Pool size, overflow, and timeout are now environment settings with bounded defaults (3, 2, and 5 seconds). Existing connect timeout, statement timeout, and disabled prepared-statement cache remain in place. The example URL uses a transaction-pooler convention, but the actual project's connection mode is unknown; use a direct/session connection for controlled Alembic operations.

For authenticated database requests, `get_db` stores the verified subject and fixed/configured JWT context on the request Session. SQLAlchemy's `after_begin` hook sets `request.jwt.claims` and `request.jwt.claim.sub` with transaction-local `set_config(..., true)`. It does not issue session-level `SET`, does not `SET ROLE`, and does not use a service-role credential. Focused unit tests exercise the hook's constructed SQL and claim values, but do not emulate PostgreSQL.

## Migrations, schema, and constraints

The local history remains `0001_empty_baseline -> 0002_mvp_schema -> 0003_lifecycle_hardening`. Migration 0002 contains the approved 15-table schema; 0003 preserves that history and corrects lifecycle-trigger parent handling. The database's actual `alembic_version`, migration state, catalog constraints, indexes, and trigger definitions were not queried. No migration was applied, upgraded, downgraded, or rewritten during this sprint.

Read-only inspection scripts cover Supabase project/role/RLS state, schema objects, grants, constraints, and activity privileges. The role/grant script is intended to run under the same database login as the application. Catalog output alone cannot prove trigger correctness, RLS behavior, or race safety.

## RLS and activity writer artifacts

`docs/supabase/04_enable_rls.sql` and `05_rls_policies.sql` are operator-reviewed drafts, not executed. The enable script does not force RLS. The policy design uses fixed-search-path `SECURITY DEFINER` helpers and is contingent on reviewed ownership, grants, `auth.uid()` propagation, and test results. It has known application mismatches documented in `docs/supabase/README.md`, including invitation token acceptance, workspace self-leave, initial meeting attendees, role-sensitive column changes, and activity writes. Do not enable this policy set as-is.

The candidate activity writer in `06_activity_writer.sql` is not wired to the existing ORM event helpers and has no execute grant. Existing activity-log append-only behavior comes from migration trigger definitions, but deployed INSERT/UPDATE/DELETE/TRUNCATE privileges are unknown. ADR-010 remains unresolved. Do not grant ordinary request-role activity insertion based on this artifact.

## Supabase staging and ADR-008 status

**Blocked / unverified:** no `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, or `SUPABASE_JWKS_URL` was available in the process environment, and `backend/.env` was absent. No credentials were read or created. Therefore the following remain unverified:

- Actual connection mode/pooler, database login, role membership, table ownership, and `BYPASSRLS`.
- Whether the authenticated PostgreSQL role can be assumed or should not be assumed.
- Whether `auth.uid()` reads the transaction-local settings set by this application.
- Whether transaction-local identity clears on commit/rollback and remains isolated on reused pooled connections.
- Applied migration revision, RLS/policy state, grants, and behavior of constraints/triggers under RLS.
- Two-user tenant-isolation behavior and activity privilege boundaries.

ADR-008 is **not verified**. No RLS strategy is enabled by application migrations. If direct SQLAlchemy identity propagation cannot be proven on the actual Supabase pooler, investigate the Supabase Data API with the end-user JWT for RLS-scoped operations. Do not substitute a service-role key or claim a fake `auth.uid()` implementation.

## Tests and verification

Two unit tests were added for the transaction identity hook. The full pytest suite could not be executed in this environment: the checked-in/local `.venv` launcher points to `C:\Users\AJAY\AppData\Local\Programs\Python\Python312\python.exe`, which is unavailable, and `py -0p` reports no installed Python runtimes. No PostgreSQL integration tests were run; they are blocked by both the absent PostgreSQL URL and Python runtime launcher.

`ruff check .` passed, `ruff format --check .` passed (78 files), `git diff --check` passed, and `git diff -- frontend/` was empty. `alembic history` could not be run because the same missing Python 3.12 runtime prevents launching the environment's Alembic entry point. PostgreSQL lifecycle cases from prior sprints remain unverified against a real PostgreSQL database; Sprint 9 did not substitute SQLite.

## Security limitations and operational steps

Before any staging RLS rollout, an operator must identify the intended project and environment, run the read-only scripts using the application login, confirm migration state and role privileges, review and reconcile the policy/API mismatches, configure secrets outside source control, and test with real end-user JWTs across alternating pooled connections. Then validate all relevant API flows and activity behavior in a disposable staging database with rollback/backup plans. The SQL scripts in `docs/supabase/` provide the ordered inspection and verification steps.

Production is not ready for RLS-dependent tenant access. Database-enforced authorization, transaction identity propagation, migration deployment, activity writer trust, and PostgreSQL concurrency behavior remain explicit blockers.

## Sprint 4 prerequisites

Before treating Supabase integration as complete: provision a disposable staging database and Supabase Auth test users; run scripts 01–03 and 07–08; verify the actual role, `auth.uid()`, transaction reset, pooler reuse, and grants; resolve the policy/API mismatches; integrate a constrained activity writer if database-enforced append-only insertion is required; run tenant-isolation and lifecycle tests on PostgreSQL; then update ADR-008/ADR-010 status based on evidence.

## Files created or changed in Sprint 9

- Added pool configuration and transaction-local identity propagation in `backend/app/core/config.py` and `backend/app/database/session.py`.
- Added placeholder configuration in `backend/.env.example`.
- Added focused identity-hook unit tests in `backend/tests/test_database_identity.py`.
- Added SQL review/validation artifacts and the operator runbook under `docs/supabase/`.
- Updated `backend/README.md`, `docs/engineering/08-authentication-authorization.md`, and `docs/engineering/11-security-review.md`.
- Added this report.

These files coexist with pre-existing uncommitted work from earlier sprints; the list identifies Sprint 9 additions and edits only.
