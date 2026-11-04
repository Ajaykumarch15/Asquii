# 27 — Sprint 11 implementation report (frontend slice 1: auth + workspace bootstrap)

## Summary

Connected the existing React prototype to the deployed backend for real identity and real workspace data. Signed-in users now authenticate through Supabase Auth, the backend verifies their JWT, and their real workspaces load from PostgreSQL. Without a session the app continues in the untouched offline prototype mode (the "Preview as" persona picker remains available), per the approved integration decision: hide real-identity conflicts for signed-in users, keep demo mode for none.

Branch: `frontend/integration`. Backend branch work (deployed schema `0003_lifecycle_hardening`) predates this slice.

## Runtime verification (live)

Verified in a desktop browser against `http://localhost:5173` with the backend at `http://127.0.0.1:8000`:

1. Demo mode renders unchanged; header shows a Sign-in affordance and persona picker.
2. Sign-in dialog (email + password) signs in `1521ajay@gmail.com` through Supabase Auth (`signInWithPassword`).
3. Supabase issues an access token; the backend verifies it via JWKS and `/auth/me` provisions/returns the profile (`display_name: "1521ajay"`).
4. Header switches to the real account identity with a Sign-out action; the prototype persona picker is hidden while signed in.
5. The connection banner loads `GET /api/v1/workspaces` through CORS (preflight verified: `Allow-Origin: http://localhost:5173`), surfacing the caller's real workspace ("Smoke Workspace …", role `Owner`) from PostgreSQL.
6. First-run path renders a create-workspace flow (`POST /api/v1/workspaces`) when the real list is empty.

## Files changed or added

- `frontend/package.json`, `package-lock.json` — added `@supabase/supabase-js`.
- `frontend/.env.example` (new), plus untracked `frontend/.env` — Vite env contract: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
- `frontend/tsconfig.json` — added `vite/client` types for `import.meta.env`.
- `frontend/src/lib/auth/client.ts` (new) — Supabase client factory from env; degrades to demo mode when unconfigured.
- `frontend/src/lib/auth/AuthContext.tsx` (new) — session lifecycle (`getSession`, `onAuthStateChange`, token refresh), `/auth/me` identity hydration, `signIn`/`signUp`/`signOut`/`getAccessToken`/`retry` actions, epoch guard against stale async writes after sign-out.
- `frontend/src/lib/api/client.ts` (new) — fetch wrapper with Bearer token injection, 15s timeout, error classification (network/auth/forbidden/not_found/conflict/validation/rate_limited/server) per doc 10, and friendly error summaries.
- `frontend/src/lib/api/workspace.ts` (new) — typed workspace list/create calls.
- `frontend/src/components/AuthPanel.tsx` (new) — modal Sign in / Sign up dialog using existing `ui.tsx` primitives; handles the needs-confirmation case.
- `frontend/src/components/RealWorkspaceBanner.tsx` (new) — connected-account banner: real workspace list, retry, and empty-state create flow.
- `frontend/src/components/Header.tsx` — real-account avatar + menu (name, email, sign out) replacing the persona picker when signed in; Sign-in pill in demo mode.
- `frontend/src/components/AppShell.tsx` — account props threading; persona palette results hidden while signed in.
- `frontend/src/App.tsx`, `frontend/src/main.tsx` — `AuthProvider` mount, auth state wiring, banner rendering.
- `backend/app/core/config.py`, `backend/app/database/session.py`, `backend/alembic/env.py`, plus backend `.env` examples — Sprint 10 carry-over items committed earlier on this branch: configurable `DATABASE_CONNECT_TIMEOUT`, Alembic URL `%` escaping.

## Environment requirements for this slice

- Backend: `CORS_ORIGINS=http://localhost:5173` and `DATABASE_CONNECT_TIMEOUT` (dev: 20) set; backend started with the deployed schema.
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key only), `VITE_API_URL=http://127.0.0.1:8000/api/v1`.
- Supabase Auth must be able to confirm users, or users must be created via the Dashboard in dev (email confirmation is currently enabled in this project).

## Known issues and limitations

- The first workspace fetch after sign-in could surface a transient network error during backend restarts; the banner's Retry action recovers it.
- Email confirmation: sign-up returns "needs confirmation" and requires the emailed link; auto-confirm users (Dashboard) sign in directly.
- The a11y snapshot used by tooling does not expose the auth panel's text inputs; browser automation needed DOM evaluation. No user-facing impact observed.
- Workspace/module screens still render prototype data; connecting them is slice 2.
- Two leftover unconfirmed `asquii-smoke-*@gmail.com` users exist in Supabase Auth and can be deleted.

## Deliberately deferred

RLS enablement and policy-mismatch resolution (ADR-008 evidence partially confirmed: live JWKS verification and identity propagation executed successfully), ADR-010 activity writer boundary, a dedicated least-privilege app login (the current `.env` uses the Supabase admin `postgres` role with `BYPASSRLS`), PostgreSQL concurrency test executions on a disposable `_test` database, and prototype data disposal decisions.

## Verification summary

`npm run build` typecheck passes; full flow verified in browser (demo → sign-in → real identity → real workspace list). No backend code changes beyond the earlier committed Sprint 10 items; no fixture fallbacks were introduced.
