# Asquii

**Asquii** is a workspace and project management platform — create workspaces, invite members by role, manage projects with milestones, run Kanban boards and task lists, schedule meetings with attendees, and organize resources with stars and a recycle bin. Identity and authorization are handled server-side: Supabase Auth issues the session, and the FastAPI backend verifies the JWT cryptographically and derives every permission from live database rows.

| Layer | Stack |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, `@supabase/supabase-js`, Lucide icons |
| Backend | Python 3.11/3.12, FastAPI, SQLAlchemy 2.x, Psycopg 3, PyJWT (JWKS), Alembic |
| Database | PostgreSQL 14+ (Supabase), 15-table MVP schema, RLS policies, append-only activity log |
| Auth | Supabase Auth (RS256 JWT) verified against the Supabase JWKS endpoint |

---

## Architecture at a glance

```
┌─────────────────┐   1. sign in     ┌──────────────────┐
│ React frontend  │ ───────────────► │ Supabase Auth    │  issues RS256 JWT
│ (Vite / TS)     │                  └──────────────────┘
│                 │   2. Bearer <jwt>
│ AuthContext ────┼─────────────────────────┐
└─────────────────┘                         ▼
                                   ┌──────────────────┐   3. verify via JWKS   ┌────────────┐
      GET /api/v1/workspaces ────► │ FastAPI backend  │ ─────────────────────► │ Supabase   │
                                   │ (SQLAlchemy)     │                        │ JWKS       │
                                   └────────┬─────────┘                        └────────────┘
                                            │  4. tenant-scoped SQL
                                            ▼
                                   ┌──────────────────┐
                                   │ PostgreSQL       │  15 tables, RLS,
                                   │ (Supabase)       │  append-only activity log
                                   └──────────────────┘
```

Key security stance:

- The backend **never trusts client-submitted identity or roles** — identity comes from the verified JWT subject (`sub`), authorization from per-request membership queries.
- Frontend env vars carry only the **publishable** Supabase key; service-role keys never reach the browser.
- Every deploy requires an explicit CORS origin allowlist, and staging/production settings validate required values at startup.
- `/auth/me` idempotently provisions the user's profile row; profile data shown in the UI is persisted, not parsed from the token.

See [docs/engineering/05-system-architecture.md](docs/engineering/05-system-architecture.md) and [docs/engineering/14-architecture-decisions.md](docs/engineering/14-architecture-decisions.md) for the full decision record.

---

## Repository layout

```
ASQUII/
├── backend/          FastAPI service (app/, alembic/, tests/), own README + requirements.txt
├── frontend/         React + Vite client with its own README and .env.example
└── docs/
    ├── engineering/  Numbered doc index: architecture, DB design, API spec, sprint reports
    └── supabase/     Supabase runbook
```

Each sub-project has its own detailed README:

- [backend/README.md](backend/README.md) — auth verification internals, per-module endpoint semantics, Alembic guidance, operations notes
- [frontend/README.md](frontend/README.md) — full feature inventory and prototype behavior
- [docs/engineering/README.md](docs/engineering/README.md) — index of 30+ design and sprint documents

---

## Quickstart (local development)

### 1. Backend — from `backend/`

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
copy .env.example .env    # then fill in local/nonproduction values
uvicorn app.main:app --reload
```

- Swagger UI: `http://127.0.0.1:8000/docs`
- `GET /health` — liveness (no DB access) · `GET /ready` — runs a bounded `SELECT 1`

The backend starts even without `DATABASE_URL` (`/ready` then returns 503). Staging/production additionally require `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `CORS_ORIGINS`.

### 2. Frontend — from `frontend/`

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run dev
```

```bash
# frontend/.env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable "anon" key — safe for browsers, never the service key>
VITE_API_URL=http://127.0.0.1:8000/api/v1   # note the mandatory /api/v1 suffix
```

> **Why `/api/v1` matters:** the frontend client appends relative paths like `/auth/me` onto `VITE_API_URL`, and every backend route is mounted under the `/api/v1` prefix. Missing the suffix is the #1 cause of mysterious 404s.

### 3. Database schema — from `backend/` (against a nonproduction database)

```powershell
alembic upgrade head      # apply the 15-table MVP schema + RLS policies
```

Run Alembic against the **direct/session** database endpoint (typically port 5432), not the transaction pooler. Application startup never runs migrations. Never point verification commands at production.

---

## Testing

```powershell
# backend — from backend/
python -m pytest          # isolated settings; no Supabase credentials needed
ruff check app tests
ruff format --check app tests

# frontend — from frontend/
npm run build             # tsc -b && vite build (typecheck + production build)
```

`tests/test_lifecycle_postgres.py` is opt-in: set `TEST_DATABASE_URL` to a disposable PostgreSQL database whose name ends in `_test` (see [backend/README.md](backend/README.md)).

---

## Deployment (Render)

Two independent environment pairs — frontend and backend services, at minimum per environment:

| Environment | Frontend | Backend |
|---|---|---|
| Dev | https://asquii-dev.onrender.com | https://asquii-backend.onrender.com |
| Prod | https://asquii-app-prod.onrender.com | https://asquii.onrender.com |

Harness checks (no auth required): `GET {backend}/health`, `GET {backend}/ready`.

| Owner | Required variables | Notes |
|---|---|---|
| Frontend | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vite inlines these **at build time** — dashboard changes need a fresh deploy |
| Backend | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGINS` | `CORS_ORIGINS` is an exact-origin, comma-separated allowlist (no trailing slashes) |

Full per-environment variable reference, CORS rules, auth flow, and a field-tested troubleshooting table live in [docs/engineering/33-deployment-environments.md](docs/engineering/33-deployment-environments.md).

---

## Authentication flow (verified working)

1. Supabase Auth signs the user in and issues an RS256 access token.
2. `AuthProvider` (`frontend/src/lib/auth/AuthContext.tsx`) reads the session and calls `GET /api/v1/auth/me` with `Authorization: Bearer <token>`.
3. The backend verifies `kid`, issuer, audience (`authenticated`), expiry, and UUID subject against the Supabase JWKS endpoint — with a bounded process-local key cache.
4. The verified subject is propagated into the SQLAlchemy transaction; `/auth/me` provisions or returns the profile.
5. Workspaces, projects, tasks, meetings, and resources are then fetched per live membership rows.

Sign-ins are **per-origin**: you must sign in separately on localhost, the dev deployment, and the prod deployment.

---

## Documentation map

| # | Topic | Document |
|---|---|---|
| 02 | Screen inventory | [docs/engineering/02-frontend-screen-inventory.md](docs/engineering/02-frontend-screen-inventory.md) |
| 05 | System architecture | [docs/engineering/05-system-architecture.md](docs/engineering/05-system-architecture.md) |
| 06 | Database design | [docs/engineering/06-database-design.md](docs/engineering/06-database-design.md) |
| 08 | Authentication & authorization | [docs/engineering/08-authentication-authorization.md](docs/engineering/08-authentication-authorization.md) |
| 09 | API specification | [docs/engineering/09-api-specification.md](docs/engineering/09-api-specification.md) |
| 11 | Security review | [docs/engineering/11-security-review.md](docs/engineering/11-security-review.md) |
| 12 | Development roadmap (Sprint 0–9) | [docs/engineering/12-development-roadmap.md](docs/engineering/12-development-roadmap.md) |
| 24–26 | Supabase migration prep | [docs/engineering/24-supabase-target-assessment.md](docs/engineering/24-supabase-target-assessment.md), [25](docs/engineering/25-database-access-security-plan.md), [26](docs/engineering/26-supabase-schema-migration-preparation-report.md) |
| 27–31 | Frontend–backend integration sprints (11, 11b–11e) | [docs/engineering/27-sprint-11-implementation-report.md](docs/engineering/27-sprint-11-implementation-report.md) onward |
| 32 | Manual test cases | [docs/engineering/32-manual-testcase-document.md](docs/engineering/32-manual-testcase-document.md) |
| 33 | Deployment environments | [docs/engineering/33-deployment-environments.md](docs/engineering/33-deployment-environments.md) |

---

## Security & operational notes

- CORS has **no wildcard origin** — configure explicit browser origins.
- Production/staging configuration fails fast when required settings are missing.
- Error responses omit exception and database details; logs are structured JSON with per-request IDs (`X-Request-ID`).
- Invitation tokens are random, stored as SHA-256 hashes, expire after 7 days, and are shown only once.
- Requests arriving with no Bearer token get `401 Authentication required`; invalid/expired tokens get `401 Invalid or expired access token`; JWKS outages degrade to `503` rather than failing open.
- Body size limits, rate limits, and other ingress controls should be configured at the edge before public production use.

For backend operational detail, see [backend/README.md](backend/README.md); for the Supabase runbook, see [docs/supabase/README.md](docs/supabase/README.md).
