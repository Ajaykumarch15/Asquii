# 33 — Deployment Environments

Asquii runs two environment pairs on Render: **dev** and **prod**.
Each pair is independent — separate frontend services, backend services, and (ideally) separate Supabase and database projects.

## 1. Service map

| Environment | Frontend (Vite/React) | Backend (FastAPI) |
|---|---|---|
| Dev  | https://asquii-dev.onrender.com   | https://asquii-backend.onrender.com |
| Prod | https://asquii-app-prod.onrender.com | https://asquii.onrender.com |

Health checks (no auth required):

- Backend liveness: `GET {backend}/health`
- Backend readiness: `GET {backend}/ready`
- OpenAPI docs: `{backend}/docs`

## 2. Environment variables

### 2.1 Frontend (each frontend service)

> Vite inlines `VITE_*` variables **at build time**.
> Changing these in the Render dashboard requires triggering a **new deploy** to take effect.

| Variable | Dev value | Prod value |
|---|---|---|
| `VITE_API_URL` | `https://asquii-backend.onrender.com/api/v1` | `https://asquii.onrender.com/api/v1` |
| `VITE_SUPABASE_URL` | dev Supabase project URL (e.g. `https://yovvhkzqlzhfkjwpumxz.supabase.co`) | prod Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | dev project publishable ("anon") key | prod project publishable key |

**The `/api/v1` suffix on `VITE_API_URL` is mandatory.** The frontend client
(`frontend/src/lib/api/client.ts`) appends relative paths such as `/auth/me`
directly onto this base; every backend route is mounted under `/api/v1`
(`backend/app/core/config.py`, `api_v1_prefix`).

### 2.2 Backend (each backend service)

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL URL (psycopg scheme); value must match the environment's Supabase/db project |
| `SUPABASE_URL` | Supabase project URL — must match the **frontend's** `VITE_SUPABASE_URL` project or JWT verification fails with `Invalid or expired access token` |
| `SUPABASE_ANON_KEY` | Supabase anon key for the same project |
| `SUPABASE_JWKS_URL` (optional) | Fixed JWKS endpoint; must share the `SUPABASE_URL` hostname if set |
| `SUPABASE_JWT_SIGNING_METHOD` | `jwks` (default, recommended) or `hs256` (requires `SUPABASE_JWT_SECRET`) |
| `CORS_ORIGINS` | See §3 |
| `APP_ENV` | `staging`/`production` enforce required settings (§2.2 validator in config) |
| `LOG_LEVEL` | Default `INFO` |

## 3. CORS

`CORS_ORIGINS` is a comma-separated list of **exact** origins
(scheme + host; no trailing slash, no wildcards per-origin):

| Env var owner | Dev | Prod |
|---|---|---|
| Backend `asquii-backend` | `https://asquii-dev.onrender.com` | — |
| Backend `asquii` | — | `https://asquii-app-prod.onrender.com` |

Rules:

- The origin must match the browser URL of the frontend **exactly**.
  `https://asquii-dev.onrender.com/` (trailing slash) will NOT match.
- Local dev origins (e.g. `http://localhost:5173`) belong in the **local dev**
  `CORS_ORIGINS`, not in the deployed services.
- Backend env changes only need a redeploy/restart; they are read at startup.

## 4. Auth flow (verified working, Nov 2026)

1. Supabase Auth signs the user in; Supabase issues an RS256 access JWT.
2. The frontend `AuthProvider` (`frontend/src/lib/auth/AuthContext.tsx`) reads the
   session and calls `GET {API_URL}/auth/me` with
   `Authorization: Bearer <access_token>`.
3. The backend verifies the JWT against the Supabase JWKS endpoint
   (`backend/app/auth/jwt.py`), derives identity server-side, and
   idempotently provisions the profile row (`ON CONFLICT DO NOTHING`).
4. Workspaces, projects, tasks, etc. are then fetched per membership.

Session storage key: `asquii.auth.session` (localStorage, per-origin).
Signing in on one origin (e.g. localhost) does **not** sign the user in on
another origin — each deployment must be signed into separately.

## 5. Troubleshooting (field-tested)

| Symptom | Cause | Fix |
|---|---|---|
| `{"error":{"code":"http_error","message":"Not Found"},"request_id":...}` | Calling a route without the `/api/v1` prefix (404) | Use `{backend}/api/v1/...`; check `VITE_API_URL` includes the prefix |
| 401 `Authentication required` | Request arrived **with no** `Authorization` header (e.g. manual browser navigation, or an app call made without a session) | Manual URL checks in the address bar can never send a Bearer token — test with the app UI or `curl.exe -H "Authorization: Bearer <token>" ...` |
| 401 `Invalid or expired access token` | Frontend and backend point at **different Supabase projects** | Align `VITE_SUPABASE_URL` (frontend) and `SUPABASE_URL` (backend) |
| 503 `Authentication service unavailable` | Backend cannot reach the Supabase JWKS endpoint | Check `SUPABASE_URL` / `SUPABASE_JWKS_URL` |
| 503 on `/ready` | Database not reachable | Check `DATABASE_URL` |
| CORS error in browser console (request blocked, no status) | Frontend origin not in backend `CORS_ORIGINS` | Add the exact origin (scheme + host, no trailing slash) |
| Toast "Not available: This item no longer exists..." right after sign-in | A post-auth API call returned 404 — almost always `VITE_API_URL` missing `/api/v1` | Correct the value and **redeploy the frontend** |
| Frontend ignores env var changes | `VITE_*` is baked at build time | Trigger Manual Deploy (rebuild) after changing frontend env vars |
| App shows "Missing frontend configuration: VITE_SUPABASE_URL, ..." | Supabase env vars absent from the built bundle | Set vars on the frontend service and redeploy |
