# Asquii API backend

Sprint 3 adds verified Supabase access-token authentication and authorization foundations. Sprint 4 adds workspace, membership, and invitation APIs. Sprint 5 adds project and milestone APIs. Sprint 6 adds task, subtask, and comment APIs. Sprint 7 adds meeting, attendee, resource, and personal resource-star APIs. Sprint 8 adds scoped workspace/project activity feeds and detail endpoints. No frontend source files are part of this setup.

## Prerequisites

- Python 3.11 or 3.12
- PostgreSQL 14+ for a local or nonproduction Supabase database
- The pinned Python dependencies in `requirements.txt`

Create and activate a virtual environment from this directory, then install dependencies:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set appropriate local/nonproduction values. Never commit `.env` or place credentials in frontend configuration. Development can start without a database URL; `/ready` then returns 503. Staging and production require database, Supabase URL/key, and an explicit CORS allowlist.

## Run locally

```powershell
uvicorn app.main:app --reload
```

The default API docs are at `http://127.0.0.1:8000/docs`. `GET /health` is a process liveness check and never accesses PostgreSQL. `GET /ready` runs a bounded `SELECT 1` and returns only a safe status. `GET /api/v1/` returns basic API metadata. Every response includes an `X-Request-ID`; a safe incoming ID is propagated, otherwise one is generated.

## Database and Supabase

The engine uses SQLAlchemy 2.x with synchronous Psycopg 3, `pool_pre_ping`, configurable bounded pool settings (`DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW`, `DATABASE_POOL_TIMEOUT`; defaults 3/2/5 seconds), a 5-second connection wait, and disabled Psycopg prepared statement caching for transaction pooler compatibility. The sample URL uses a transaction pooler convention (commonly port 6543); confirm the actual project's mode in Supabase Dashboard → Project Settings → Database. Keep Alembic maintenance on the direct/session endpoint (commonly port 5432) and run it as a controlled operator/release step. No actual project URL or connection mode was available during Sprint 9.

No Supabase credentials or Dashboard access were configured during Sprint 9, so live connectivity, migration state, grants, RLS, and tenant isolation remain unverified. The verified JWT subject is now propagated by SQLAlchemy `after_begin` to transaction-local `request.jwt.claims` and `request.jwt.claim.sub`; this does not prove `auth.uid()` or pooled connection reset behavior and does not enable RLS. Confirm the actual database role, `BYPASSRLS`, role membership, and pooler behavior before using RLS. If checks fail, use Supabase Data API with the end-user JWT for RLS-scoped work. Never use a service-role credential for request handling. See [the Supabase runbook](../docs/supabase/README.md) and [Sprint 9 report](../docs/engineering/23-sprint-9-implementation-report.md).

Access tokens are verified with PyJWT. The default mode accepts only RS256/ES256 keys obtained from the configured Supabase project's fixed JWKS endpoint, checks `kid`, issuer, `authenticated` audience, expiration, optional not-before, and UUID subject, and uses a bounded process-local key cache. Legacy HS256 is available only when `SUPABASE_JWT_SIGNING_METHOD=hs256` and a secret is supplied out of band. `/api/v1/auth/me` reads or idempotently provisions the profile tied to the verified subject. User metadata and the generic JWT role claim are not authorization inputs. Membership policies query current database rows per request. No tenant API currently sets PostgreSQL request identity; ADR-008 remains a staging gate.

Workspace endpoints are under `/api/v1/workspaces`. Workspace creation adds the authenticated user as Owner in the same transaction. Ownership transfer demotes the previous Owner before promoting the successor to respect the partial unique index. Member removal returns 409 if project roster rows remain; project membership cleanup is not silently performed. Invitation tokens are random, stored only as SHA-256 hashes, expire after seven days, and are shown only in the creation response. Activity entries are inserted in the same transaction, but the deployed application's safe activity INSERT privilege/writer boundary is unverified and remains an operational blocker.

Project and milestone endpoints are nested under `/api/v1/workspaces/{workspace_id}/projects`. Workspace Owner/Admin or Project Manager manages project settings, roster, and milestones; active workspace members can read active projects, project rosters, and milestones. Project list filters are `status` and `q`, with `limit`/`offset` pagination. Archived projects remain readable but all project and milestone mutations are rejected. Project roster deletion is blocked by existing task/comment/attendee/resource references through the database constraints. Each project is created with its creator as Project Manager; deferred database invariants protect the final manager state.

Task, subtask, and comment endpoints are nested below `/api/v1/workspaces/{workspace_id}/projects/{project_id}/tasks`. Active workspace members may read project tasks; project collaborators and the workspace administrative override may create/update tasks and subtasks. Assignees must be active project members. Task deletion is available to workspace Owner/Admin or Project Manager only and returns 409 if comments remain; subtasks cascade with task deletion. Comments are soft-deleted by setting `deleted_at`, retaining their author reference and history. The database requires comment authors to be project roster members, so a workspace Owner/Admin outside that roster receives 409 if attempting to create one. The schema has no task creator field; creator is shown only when a `task.created` activity event is present. All mutations write activity in the same transaction. Activity-log insert privileges and request identity propagation into RLS remain unverified; see [20](../docs/engineering/20-sprint-6-implementation-report.md).

Meeting and resource endpoints use `/api/v1/workspaces/{workspace_id}/projects/{project_id}/meetings` and `/resources`. Meeting times are timezone-aware `starts_at` plus positive `duration_minutes`; attendees must be active project members. Meetings have no status/cancellation or organizer columns, so authorized cancellation is a hard delete (attendees cascade), and organizer display is inferred from `meeting.created` activity when available. Only Owner/Admin or Project Manager may edit/delete meetings and manage other attendees; an attendee can remove themself. Resources use schema-supported type/category/metadata fields, and the authenticated project member is the owner on create. Resource deletion is soft via `deleted_at`; preference rows remain. Star state is stored per user in `user_resource_preferences`, returned as `is_starred`, and changed idempotently without shared activity. Workspace Owner/Admin who is not a project member cannot become resource owner under the existing FK and receives a conflict. Activity-log writer permissions and PostgreSQL behavior remain unverified; see [21](../docs/engineering/21-sprint-7-implementation-report.md).

Activity feeds are available at `/api/v1/workspaces/{workspace_id}/activities` and `/api/v1/workspaces/{workspace_id}/projects/{project_id}/activities`, with scoped detail routes. They return bounded `items`, `total`, `limit`, and `offset`, with actor/action/resource type/date filters and allowlisted sorting. Actor profiles use a left join, and known private keys are recursively removed from JSON metadata. The workspace feed includes workspace and project events; the project feed includes only events with that project ID. Existing workspace/project created-time indexes support the default order; less common filters may scan within that scope. The append-only trigger rejects UPDATE/DELETE, but activity INSERT uses ORM writes through the regular application session. No grant configuration or narrow writer function is defined here, and the deployed DB role is unknown; ADR-010 remains unresolved. See [22](../docs/engineering/22-sprint-8-implementation-report.md) and the Sprint 9 writer assessment in [23](../docs/engineering/23-sprint-9-implementation-report.md).

## Alembic

ORM models are organized under `app/models/`; `app.models` imports every model for Alembic metadata discovery. Revision `0001_empty_baseline` remains unchanged. Revision `0002_mvp_schema` creates the approved 15-table schema. Revision `0003_lifecycle_hardening` replaces the Owner/Project Manager triggers with explicit old/new parent handling and sorted locks. The revisions do not create Supabase Auth objects, RLS policies, or notification tables. The schema includes an activity-log trigger that rejects row updates/deletes, but database role grants and trusted insert access must still be configured separately.

Set a nonproduction `DATABASE_URL` before running commands from this directory:

```powershell
alembic upgrade head
alembic downgrade base
alembic revision --autogenerate -m "describe schema change"
```

Review autogenerated migrations before applying them. The external `auth.users` table is referenced but filtered from application autogeneration. Never run migration verification against production. The migration connection should be direct/session mode, not the transaction pooler. Downgrading through `0002_mvp_schema` drops all 15 application tables; use it only in a disposable database or as an explicitly reviewed recovery operation. Application startup never runs migrations.

The database schema is PostgreSQL-specific (`auth.users`, arrays, JSONB, partial indexes, and deferred constraint triggers). SQLite is not an equivalent integrity test target.

### PostgreSQL lifecycle integration tests

`tests/test_lifecycle_postgres.py` is skipped unless `TEST_DATABASE_URL` points to a dedicated PostgreSQL database whose name ends in `_test`. Prepare a fresh disposable database with the minimal external identity stub `auth.users(id uuid primary key)`, apply `alembic upgrade head`, then set `TEST_DATABASE_URL` and run:

```powershell
python -m pytest tests/test_lifecycle_postgres.py -q
```

The fixture requires Alembic revision `0003_lifecycle_hardening` and the minimal Auth stub. Ordinary cases roll back. Concurrent cases commit only uniquely identified test rows and remove only those rows afterward. The tests do not create/reset schemas or migrate a database for you. Do not point this variable at staging or production.

## Tests and code quality

Tests use isolated settings and mocked database readiness, so they do not need Supabase credentials:

```powershell
python -m pytest
ruff check app tests
ruff format --check app tests
```

Direct dependency versions are pinned in `requirements.txt`; install it in a clean virtual environment for consistent direct package versions. No lockfile has been generated in this environment.

## Security and operational notes

- CORS has no wildcard origin; configure explicit browser origins.
- Production/staging configuration fails when required settings are missing.
- Error responses omit exception details and database information.
- Logs are structured JSON and do not log configuration values or request bodies.
- Configure request body size limits, rate limits, and invitation creation controls at the ingress/server before production use.
- No trusted proxy headers are enabled. Add them only for a known, controlled proxy topology.
- OpenAPI is enabled by FastAPI defaults; restrict it at deployment if public exposure is not intended.
- No app startup migration execution or RLS policy is included. Authentication details are tracked in [17](../docs/engineering/17-sprint-3-implementation-report.md), workspace APIs in [18](../docs/engineering/18-sprint-4-implementation-report.md), project APIs in [19](../docs/engineering/19-sprint-5-implementation-report.md), task APIs in [20](../docs/engineering/20-sprint-6-implementation-report.md), and meetings/resources in [21](../docs/engineering/21-sprint-7-implementation-report.md).

## Troubleshooting

- `ModuleNotFoundError`: activate the virtual environment and install `requirements.txt`.
- `/ready` returns 503: check `DATABASE_URL`, network access, database availability, and connection mode; the response intentionally hides driver details.
- Alembic cannot connect: use the staging direct/session URL and check allowlisting; never paste credentials into logs or source.
- Production settings validation fails: set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `CORS_ORIGINS` in the deployment secret/configuration system. Pool settings are optional and bounded.
