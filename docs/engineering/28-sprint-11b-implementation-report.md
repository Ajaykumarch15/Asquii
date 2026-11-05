# 28 — Sprint 11b implementation report (real workspace + projects modules, least-privilege app role)

## Summary

Sprint 11b connected the workspace and projects modules to the live backend APIs
  (steps 1–2) and removed the unbounded `postgres` admin connection from the
  application runtime (step 3). All work is on `frontend/integration`, verified
  against the running dev stack, and committed in three feature commits:
  1. `3f0fa15` — frontend workspace module: real workspaces, members, invitations, and create flow
  2. `a5a853f` — frontend projects slice: real project list, create, and Projects nav wiring
  3. `1b34fb9` — backend least-privilege app role: asquii_app grants, admin-only migrate URL

## Step 1 — Workspace module on real APIs

- `frontend/src/lib/api/workspace.ts` grew typed `listMembers`, `listInvitations`,
  `renameWorkspace` calls matching the backend contracts (`WorkspaceMemberResponse`,
  `InvitationResponse` with lifecycle `status`).
- `frontend/src/lib/real/useRealWorkspaces.ts` (new): shared signed-in workspace state —
  load phase machine (idle/loading/ready/error), selection persisted to
  `asquii.real-workspace` (localStorage-only preference, never mixed with prototype
  data under `asquii.prototype.v8`), explicit `reload`, and local `applyWorkspace` for
  create/rename round-trips without a refetch.
- `frontend/src/components/RealWorkspaceHome.tsx` (new): real workspace body — identity
  card (name, slug, role badge), members grid (`GET /workspaces/{id}/members`),
  pending-invitations badge (`GET .../invitations`), first-run create form
  (`POST /workspaces`), and projects EmptyState placeholder (filled by step 2).
- `frontend/src/components/RealWorkspaceBanner.tsx`: removed; superseded by
  RealWorkspaceHome.
- `frontend/src/App.tsx`: render-block split. While signed in the AppShell is driven by
  mapped real workspaces (`prototypeWorkspace` shim for display strings only; roles
  map Owner/Admin→Admin, Member→Member; projects list `[]` so the prototype sidebar
  shows only workspace-level items; prototype notifications disabled). Demo branch
  (unauthenticated) renders the untouched prototype screens. `WorkspaceEditor` save
  is now dual-mode: real path `POST /workspaces` + `applyWorkspace`; demo path keeps
  mutating prototype data only. An in-page success/error notice reports the real
  create outcome.
- `frontend/src/lib/auth/AuthContext.tsx`: identity fetch (`/auth/me`) now uses a
  30 s timeout (cold backend starts verify the JWT against a remote JWKS and can
  exceed the previous 15 s default), and `App.tsx` renders a recoverable banner for
  `auth.status === "error"` with a Retry action instead of silently looking signed-out.

## Step 2 — Projects slice on real APIs

- `frontend/src/lib/api/projects.ts` (new): `listProjects` (plain-array response,
  optional `status`/`q`/`limit`/`offset` filters), `createProject`
  (name + optional description/status/progress fields), `getProject`, `renameProject`.
- `frontend/src/components/RealProjectsPage.tsx` (new): Projects nav view for signed-in
  users — filtered list rendering (name, status badge, description, member count,
  caller project role, updated date, manual progress), admin-only create form, loading/
  error/empty states, per-project retry.
- Sidebar "Projects" navigates to the real view while signed in (`active === "Projects"`
  branch in App.tsx); Overview keeps RealWorkspaceHome. Demo mode unchanged.

## Step 3 — Least-privilege application role

- `backend/db/roles/app_least_privilege.sql` (new): defines `asquii_app` (LOGIN,
  NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB) with CONNECT + `USAGE` on
  `public`, SELECT/INSERT/UPDATE/DELETE on the 15 application tables, and
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` so future migrated tables are granted
  automatically. Supabase-owned `auth` schema, `alembic_version` (migration-only), and
  the legacy `asquii_db_probe` table are intentionally NOT granted. No sequences are
  used by application primary keys.
- `backend/scripts/apply_app_role.py` (new): idempotent applier — role existence check
  (CREATE or password-refresh ALTER), charset-validated password literal, post-check
  verifying zero BypassRLS/Superuser flags and exactly 15 granted tables.
- `backend/app/core/config.py`: new `database_migrate_url` setting (same validation as
  `database_url`) so migrations can keep the admin `postgres` role while the runtime
  `DATABASE_URL` binds to the app role.
- `backend/alembic/env.py`: Alembic prefers `DATABASE_MIGRATE_URL`, falling back to
  `DATABASE_URL`. Verified: `alembic current` → `0003_lifecycle_hardening (head)`.
- `backend/.env.example` documents the split, including the Supavisor tenant-suffix
  username format (`asquii_app.<PROJECT_REF>`) required on the shared pooler for
  custom (non-builtin) roles.

## Runtime verification (live)

Executed against dev (backend :8000, Vite :5173, Supabase ap-northeast-1):

- Signed in `1521ajay@gmail.com`; workspace card showed the real workspace
  ("Smoke Workspace …", Owner), members list (1521ajay, Owner), "No pending
  invitations", and the projects section.
- Sidebar Projects → real list (200 from `GET .../projects?limit=100`), then
  `POST .../projects` → 201 Created ("Integration Test Project"); card rendered with
  status, description, member count, "You: Project Manager", and updated date.
- Backend restarted on the app role: `/ready` 200; full browser flow (identity,
  workspaces, members, projects) repeated successfully through `asquii_app`.
- Least privilege confirmed in-database: `current_user = asquii_app`, only 15 of 17
  public tables visible (no `alembic_version`, no `asquii_db_probe`).
- Backend tests: `69 passed, 15 skipped` (skips remain the intentionally deferred
  Postgres lifecycle tests requiring a disposable `_test` database).

## Notes on the investigation during verification

- A "silent demo" regression during browser checks was traced to the Supabase
  session **expiring overnight** (2026-11-04 → 2026-11-05); `INITIAL_SESSION`
  reports no session, so demo mode is the correct response. Temporary bootstrap and
  fetch logging added for diagnosis was removed before commit; the permanent fixes
  this produced are the 30 s identity timeout and the visible auth-error Retry banner.
- Browser automation quirk (unchanged): the a11y snapshot does not expose auth dialog
  text inputs; driving them requires `browser.evaluate` DOM scripts with native
  setters + input events.

## Known limitations / deferred

- Project detail pages, task/meeting/resource modules, invitations UI (list/accept/
  create), member role management, and workspace rename/archive remain prototype-only
  until later slices.
- RLS enablement and the known policy/API mismatches remain open (ADR-008 follow-up);
  with `asquii_app` in place the runtime blast radius is bounded even before RLS.
- Prototype persona data disposal decisions still pending.
- Two unconfirmed `asquii-smoke-*@gmail.com` Supabase Auth users can be deleted.
- The test project "Integration Test Project" remains in the dev workspace as data;
  delete from Supabase UI/DB if undesired.
