# Sprint 3 implementation report — Supabase authentication and authorization

Date: 2026-11-04  
Branch: `backend/foundations`

## A. Sprint 3 implementation summary

Implemented a small FastAPI authentication foundation around Supabase-issued access tokens. Supabase remains the identity and credential provider; Asquii provisions only the approved `profiles` row and checks current workspace/project membership in PostgreSQL. No frontend, RLS policy, login flow, or product CRUD API was added.

The existing Sprint 2.1 worktree changes were present before Sprint 3 and have been preserved. No commit or push was made.

## B. JWT verification architecture

- PyJWT with `PyJWT[crypto]` verifies signatures and claims.
- Default `jwks` mode uses the JWKS URL derived from `SUPABASE_URL` or an explicit HTTPS URL constrained to the configured Supabase host. A JWT header cannot supply a key URL.
- Only RS256 and ES256 are allowed in JWKS mode; `kid` must resolve to a signing key whose optional `alg` matches.
- Issuer defaults to `<SUPABASE_URL>/auth/v1`; audience defaults to `authenticated`. `exp`, `sub`, `iss`, and `aud` are required; PyJWT verifies optional `nbf`.
- `sub` must be a UUID. Optional email must be a string. Only user ID and verified email are returned in the identity context; generic role and user metadata claims are ignored.
- JWKS cache is process-local, with a 300-second default TTL configurable from 30 to 3600 seconds. Refreshes triggered by unknown key IDs are limited to one per 30 seconds. Unknown keys fail closed. A fresh cache remains usable during a refresh outage; without a fresh cache, the dependency returns a sanitized 503.
- Legacy HS256 is supported only by explicitly selecting `SUPABASE_JWT_SIGNING_METHOD=hs256` and supplying `SUPABASE_JWT_SECRET`. The verifier accepts HS256 only in that mode; the secret is a `SecretStr` and is never returned or logged by application code.

## C. Authentication endpoints

`GET /api/v1/auth/me` requires a Bearer token verified by `get_current_user`. Missing, malformed, invalid, and expired tokens return 401 in the existing sanitized error envelope. JWKS outage without a usable cache returns 503. The endpoint returns only `user_id`, optional verified `email`, persisted `display_name`, and nullable `job_title`.

The existing `/health`, `/ready`, `/api/v1/`, and docs endpoints remain public.

## D. Profile provisioning

The service uses the verified UUID subject as `profiles.user_id`. It reads existing profile data first and does not overwrite edited fields. A missing profile is inserted with PostgreSQL `ON CONFLICT DO NOTHING` in the request-scoped SQLAlchemy transaction, then re-read, making simultaneous first requests idempotent. Initial display name derives from the verified email local-part when available, otherwise `New user`; no user metadata or credentials are persisted. Auth-user existence and actual FK behavior require PostgreSQL integration verification.

## E. Authorization helpers and role matrix

Authorization is database-backed through current workspace membership and active workspace/project rows. Removed workspace members and archived roots do not receive an access context. Decisions are not cached. JWT role claims and request-body user IDs do not participate.

| Current database context | Read active project | Manage project settings/members | Collaborate on permitted content |
|---|---:|---:|---:|
| Workspace Owner | yes | yes | yes |
| Workspace Admin | yes | yes | yes |
| Workspace Member, no project membership | yes | no | no |
| Project Manager | yes | yes | yes |
| Project Member | yes | no | yes |
| Removed workspace member or cross-workspace user | denied | denied | denied |

Workspace helpers resolve active membership, current workspace role, and Owner/Admin administration permission. Project helpers resolve workspace role plus optional project role; they expose read, settings/member management, and collaboration checks. The helper functions provide reusable checks, not every future business permission.

## F. Test results

Focused tests were added for real RSA signature verification, issuer/audience/expiration/not-before/UUID/email claim validation, wrong signature, unknown `kid`, JWKS outage, explicit HS256, Bearer authentication, `/auth/me`, anonymous rejection, profile creation/idempotence/no-overwrite, and the role decision matrix. PostgreSQL/Supabase integration for profile provisioning and membership queries was not run because no disposable test database or Supabase staging credentials were available.

The full test suite was not run in this turn. The configured Python launcher failed to start in the sandbox, and the previous request to run it with elevated execution was rejected by the approval gate. PyJWT was also not present in the configured virtualenv at inspection time, so the new cryptographic tests could not run until the pinned dependency is installed. Do not interpret existing Sprint 2 test counts as verification of Sprint 3.

## G. Code quality results

`ruff check .` passed with no errors. `ruff format --check .` passed with all 52 Python files formatted. Python-backed verification was not completed for the reasons above.

## H. Supabase and ADR-008 verification status

No live Supabase settings, credentials, network connection, pooler, or disposable PostgreSQL database were available. Supabase issuer/JWKS configuration, key rotation in the deployed project, profile FK behavior, role grants, `BYPASSRLS`, authenticated role assumption, transaction-local claim setup, `auth.uid()`, and connection reuse were not validated against staging.

ADR-008 remains a hard blocker for any RLS-protected tenant API. Sprint 3 deliberately does not set request identity, switch database roles, enable RLS, or use a service-role key. Follow the staging procedure in [08](08-authentication-authorization.md); if direct SQLAlchemy identity propagation cannot be demonstrated, evaluate Supabase Data API calls using the end-user JWT.

## I. Security limitations and remaining blockers

- No database-backed tests have verified active membership queries or concurrent profile creation.
- JWKS outage/key-rotation behavior has unit coverage only; deployment behavior and Supabase's configured signing method must be verified against the project.
- Authenticated dependencies are implemented, but there are no tenant routers using the authorization helpers yet.
- RLS is not enabled, and direct SQL requests do not establish `auth.uid()`.
- Rate limiting, ingress request limits, production OpenAPI exposure, monitoring, and secret-manager deployment remain operational work.
- Sprint 2 lifecycle-trigger PostgreSQL tests remain blocked as recorded in [16](16-sprint-2-implementation-report.md).

## J. Sprint 4 readiness

Ready to continue local API/service design after the Python test suite and Ruff checks pass. Before authenticated tenant APIs rely on PostgreSQL, complete disposable PostgreSQL/Supabase validation for migrations, profile provisioning and membership policies, then prove ADR-008 through the actual pooler or choose the Data API path. Define narrow service transactions and ensure Owner/Manager lifecycle constraints remain satisfied.

## K. Modified and newly created files

- Modified for Sprint 3: `backend/app/core/config.py`, `backend/app/api/router.py`, `backend/requirements.txt`, `backend/.env.example`, `backend/README.md`, `docs/engineering/08-authentication-authorization.md`, `docs/engineering/11-security-review.md`, `docs/engineering/14-architecture-decisions.md`, and `docs/engineering/16-sprint-2-implementation-report.md`.
- Created: `backend/app/auth/__init__.py`, `backend/app/auth/jwt.py`, `backend/app/auth/dependencies.py`, `backend/app/auth/schemas.py`, `backend/app/auth/service.py`, `backend/app/api/routes/__init__.py`, `backend/app/api/routes/auth.py`, `backend/app/authorization/__init__.py`, `backend/app/authorization/service.py`, `backend/tests/test_auth.py`, `backend/tests/test_profile_provisioning.py`, `backend/tests/test_authorization.py`, and this report.
- No frontend files were modified. No `.env`, secrets, or commits were created.
