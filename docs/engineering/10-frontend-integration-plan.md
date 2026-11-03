# 10 — Frontend integration plan

Keep the existing React + TypeScript + Vite implementation and component/page organization. This is an incremental data/auth integration plan, not a redesign. No router, query cache, Supabase SDK, or schema validator is currently declared.

## Identity and API boundary

React should use the Supabase Auth SDK for session lifecycle and send the access JWT to FastAPI. Replace `personaId` as identity only when auth UI is approved; the current picker is prototype-only. Suggested organization: `src/lib/auth/` for Supabase client/session, `src/lib/api/client.ts` for base URL/token/error handling, and domain `api.ts` modules under existing workspace/project module folders. Keep screen components working through props/callbacks initially.

FastAPI validates the token and derives user identity/roles from PostgreSQL. Client must never submit authoritative role or user identity. API list access includes every active project in the workspace; read-only state for non-project members should be reflected in existing action affordances when integrated. Owner/Admin and Project Manager rules are documented in [08](08-authentication-authorization.md).

## Data migration by page

Workspace overview/projects load all active workspace projects and aggregates. People/settings use member/invitation/settings APIs. Project screens load project details and child rows; non-project workspace members can view all active project content but cannot write. Project settings/membership controls require Owner/Admin or Project Manager. Task assignments, meeting attendees and resource owners are restricted to project members. Resource star state is per-user.

Replace `useAppData` aggregate persistence a domain at a time, preserving page contracts. Decide whether to import, export, or discard `asquii.prototype.v8` data before rollout; do not silently promote seed records into shared production data. Existing local theme/recent navigation may remain client preferences. Notification read/preferences become server-backed only if conditional notification features are approved.

## Loading, errors, forms, lists

Wire current `LoadingState`, `ErrorState`, `EmptyState`, and `StateMessage` to real requests. Show loading on initial fetch, retry network failures, preserve form drafts on recoverable errors, disable duplicate submission, and map Pydantic field errors to inputs. 401 uses SDK refresh/session handling; 403 gives access-denied; concealed cross-tenant misses consistently return 404; 409 identifies duplicates/concurrency; 422 maps validation; 429 gives retry guidance. Never fall back to fixtures silently in production.

Use bounded server pagination for larger collections. Current local sorting/filtering may stay for already loaded small sets; otherwise send allowlisted filters and sort. CSV export can remain client-side for fetched data; bulk import needs a separately scoped endpoint. Board ordering may update optimistically with rollback on failure; invitation, role, archive, and purge operations should wait for server confirmation.

## RLS interaction

Frontend JWT is forwarded to FastAPI, where validated identity is propagated transaction-locally to PostgreSQL for RLS if the direct SQLAlchemy strategy passes staging verification. Frontend never configures DB claims. If direct connection context is unreliable, FastAPI may use Supabase Data API with the end-user JWT for RLS-scoped calls. See [08](08-authentication-authorization.md).
