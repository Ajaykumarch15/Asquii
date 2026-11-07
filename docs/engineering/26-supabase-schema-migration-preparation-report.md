# Supabase Schema Migration Preparation Report

Date: 2026-11-04

## Summary

Repository-side preparation for the Asquii Supabase schema and access-control deployment was performed on `backend/foundations`. The worktree already contained extensive uncommitted Sprint 1–9 changes; those changes were preserved. No commit, push, branch switch, frontend edit, Supabase write, role change, grant change, or migration was performed.

The user identifies the connected Supabase project's `main` branch as production and its empty application schema as intentional. The latest read-only check found only `public.asquii_db_probe` among queried app tables. It has RLS enabled, FORCE RLS disabled, no policies, no effective table DML grants for `anon`, `authenticated`, or `service_role`, and DML privileges for `postgres`. A previous catalog inspection found no Asquii application tables and no `public.alembic_version`. These are scoped catalog findings, not a test of application identity propagation or tenant isolation.

## Changes prepared

- Alembic now configures `public.alembic_version` for online and offline operation.
- Online Alembic migrations set transaction-local `search_path` to `public, pg_catalog` and fail closed if `current_schema()` is not `public`.
- Existing revisions 0002 and 0003 set the same path at upgrade and downgrade entry points, preserving their revision IDs and downgrade implementations.
- The RLS review draft scopes policies and helper execution to `authenticated`, revokes app-table privileges before applying a per-table grant subset, limits workspace and workspace-member update columns, requires the proposed `asquii_owner` execution role for helper creation, removes the unscoped membership-existence helper, and limits project reads to active projects.
- The RLS enablement and policy SQL files are explicitly marked as review drafts that must not be run independently.
- Static tests cover Alembic schema targeting and policy-role/grant guardrails.

## Verification status

Ruff checks: `ruff check .` passed; `ruff format --check .` passed (78 files already formatted). `git diff --check` passed, with Git line-ending notices only. `git diff -- frontend/` was empty.

Pytest and Alembic command-line checks were not run: the configured Python 3.12 interpreter is outside the writable workspace, and the required execution approval was rejected. Static regression tests were added but are therefore not reported as passing.

PostgreSQL lifecycle tests, RLS behavior tests, role-membership tests, `auth.uid()` propagation, and pooled-connection identity-isolation tests: **blocked**. No disposable Supabase test database was supplied or used, and SQLite is not treated as equivalent.

Supabase schema migration and RLS/grant changes: **not applied**. No production deployment approval was exercised. The policy draft still has known API mismatches and is not an executable migration.

## Remaining production gates

- Rotate the database password and Supabase secret key previously shared in chat before the next deployment connection. Secret values were not printed or changed during this work.
- Confirm target project, branch, database, migration marker, and object state immediately before deployment.
- Rehearse on a disposable non-production Supabase database from empty through Alembic head.
- Complete the initial workspace/Owner creation path, invitation token acceptance, workspace self-leave, role-sensitive updates, meeting-attendee creation, and trusted activity writes without broadening RLS.
- Validate the proposed owner/migrator/runtime roles and `SET LOCAL ROLE authenticated` membership on the chosen Supabase connection mode.
- Run PostgreSQL RLS tests with anon and two end-user identities, plus JWT-to-`auth.uid()` and same-connection reuse tests across commit, rollback, and exceptions.
- Obtain separate explicit approval before any production DDL, grant, role, or RLS change.

No RLS, tenant isolation, production readiness, or PostgreSQL trigger concurrency safety is claimed by this report.
