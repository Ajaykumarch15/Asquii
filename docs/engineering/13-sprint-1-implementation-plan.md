# 13 — Sprint 1 implementation plan: foundation only

## Goal and scope boundary

Build a runnable FastAPI foundation and verify connectivity to a **nonproduction** Supabase PostgreSQL project. Sprint 1 does not implement authentication, product tables, workspace/project CRUD, or frontend integration. This is a plan only; no backend work is included in Sprint 0.5.

## Entry criteria

- Python version and dependency/lock tool selected.
- Supabase staging project and credentials supplied through approved secret handling.
- Hosting target, database direct/pooler mode, network path and connection limits known.
- Migration application owner/release mechanism agreed.
- CI conventions/owner known.
- Staging-only verification authorized; no production connection.

## Implementation tasks

1. Create modular `backend/` scaffold: `app/main.py`, typed core config, structured logging, DB engine/session, common health/errors, tests, Alembic config and dependency manifest/lock approach.
2. Validate environment configuration for DB URL, allowed CORS origins, environment and log level. `.env.example` has placeholders only. Fail fast without printing secret values.
3. Add liveness endpoint independent of DB and readiness endpoint with bounded DB connectivity check and sanitized response.
4. Configure SQLAlchemy 2.x session/transaction lifecycle and Alembic metadata/naming conventions. Create empty baseline only; **no product tables**.
5. Add request ID middleware (validate incoming ID or generate, include in response/log context), structured logs with secret/PII redaction, and explicit CORS configuration.
6. Add basic automated tests for config success/failure, health/readiness, request ID, error envelope and DB-session cleanup using isolated test configuration.
7. Verify connectivity and empty Alembic baseline against staging Supabase; inspect actual role grants/attributes for future RLS compatibility and document pool mode. No production testing.
8. Document backend setup/run/verification and CI checks consistent with repository conventions.

## Deliverables and acceptance

- App starts from documented clean setup.
- Typed config names missing fields without exposing values/secrets.
- Liveness remains healthy without DB; readiness reports DB reachability without connection detail.
- SQLAlchemy connections/transactions close or rollback reliably.
- Request ID is consistent in response and logs.
- CORS accepts configured origins and rejects unconfigured browser origins.
- Alembic empty baseline can be checked on staging without product tables.
- Basic automated tests pass; staging connectivity and observed role grants are documented.
- No JWT verification, Auth routes, CRUD, product tables, RLS migrations, or frontend changes.

## Risks and UNKNOWN

Python version, package manager, hosting, pooler behavior, grants/role membership, CI, monitoring, migration executor, network policy and OpenAPI exposure remain UNKNOWN. Resolve before execution. Direct SQLAlchemy RLS identity propagation requires staging proof before later RLS work; if unreliable, use Supabase Data API with end-user JWT for RLS-scoped calls.

## Implementation results — 2026-11-03

- Implemented the local FastAPI foundation under `backend/`: validated settings, JSON logging, request IDs, sanitized errors, explicit CORS, liveness/readiness routes, SQLAlchemy 2.x/Psycopg 3 session support, and Alembic configuration with an empty baseline.
- Added isolated pytest cases for settings, API health, request IDs, error response shape, and session lifecycle. Tests were not executed because Python is unavailable in the implementation environment.
- Added pinned direct dependency versions, Ruff configuration, `.env.example`, and backend setup/operations documentation. Dependencies were not installed because Python is unavailable.
- No Supabase project credentials or staging access were supplied. Live database connectivity and empty migration upgrade/downgrade remain unverified; no production database was contacted.
- Repository work began on the existing `backend/foundations` branch with `docs/` untracked. That user-provided documentation was retained and extended; frontend files were not changed. No branch was created and no commit was made.
- Sprint 1 is not yet acceptance-complete. A Python 3.11/3.12 environment must run pytest and Ruff, and authorized staging access must verify connectivity and the empty baseline. Supabase grants/RLS identity remain future gated work.
