# Sprint 4 implementation report — workspace management APIs

Date: 2026-11-04  
Branch: `backend/foundations`

## A. Implementation summary

Added the first business API module for workspace management. The module uses the existing FastAPI router, verified Supabase identity, SQLAlchemy models, PostgreSQL schema, and sanitized exception envelope. Workspace state is soft-archived; memberships and invitation history are retained. No frontend, project API, new migration, authentication mechanism, or privileged credential was added.

## B. Workspace API endpoints

All routes require `get_current_user` and use the verified subject as the actor.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | `/api/v1/workspaces` | Normalize name, generate slug, provision profile, create workspace and initial Owner, and log event atomically. Returns 201. |
| GET | `/api/v1/workspaces` | List active workspaces with current membership role and timestamps. |
| GET | `/api/v1/workspaces/{workspace_id}` | Read active workspace for an active member. |
| PATCH | `/api/v1/workspaces/{workspace_id}` | Owner/Admin may update the name; slug stays stable. |
| POST | `/api/v1/workspaces/{workspace_id}/archive` | Owner-only archive; pending invitations are revoked, memberships/projects retained. Returns 204. |
| GET | `/api/v1/workspaces/{workspace_id}/members` | List active members with safe profile fields. |
| GET | `/api/v1/workspaces/{workspace_id}/members/{user_id}` | Get active member role and safe profile. |
| PATCH | `/api/v1/workspaces/{workspace_id}/members/{user_id}/role` | Owner-only assignment of Admin or Member. |
| DELETE | `/api/v1/workspaces/{workspace_id}/members/{user_id}` | Remove or self-leave by setting `removed_at`; returns 409 if project roster rows remain. |
| POST | `/api/v1/workspaces/{workspace_id}/transfer-ownership` | Owner-only atomic transfer to an active member. |
| POST | `/api/v1/workspaces/{workspace_id}/invitations` | Owner/Admin creates invitation; one-time plaintext token is returned in this response only. |
| GET | `/api/v1/workspaces/{workspace_id}/invitations` | Owner/Admin lists current and historical invitation data without token/hash. |
| DELETE | `/api/v1/workspaces/{workspace_id}/invitations/{invitation_id}` | Owner/Admin revokes an open invitation. Returns 204. |
| POST | `/api/v1/invitations/accept` | Authenticated user accepts with a token and verified matching email. |

Workspace lists include only active memberships and non-archived workspaces. Member and invitation responses expose no Supabase Auth metadata, token hash, or credential data. Static route registration for health, readiness, API info, and `/auth/me` remains in the existing router tree.

## C. Membership and role behavior

- Active membership is always loaded from `workspace_members`; JWT role and body-supplied actor IDs are ignored.
- Any active member can read workspace details and active member directory entries.
- Owner/Admin can update workspace name and manage invitations. Only Owner can archive, change member roles, and transfer ownership.
- Owner/Admin may remove ordinary Members. Only Owner may remove another Admin. Non-Owner users may leave themselves. The active Owner must transfer ownership first.
- A member with any `project_members` row cannot currently be removed or leave: the API returns 409 and preserves both membership and project roster records. Sprint 5 must implement an explicit project-roster cleanup/transfer operation before retrying removal.

## D. Ownership transfer behavior

The service locks the active workspace and verifies the current Owner and active successor from database rows. It demotes the current Owner to Admin and flushes that change before promoting the successor, because the active-Owner partial unique index is immediate. Both changes, the ownership activity event, and the deferred exactly-one-Owner check occur in one transaction. The successor cannot be supplied as an Owner role through the role-change endpoint.

## E. Invitation lifecycle

Creation accepts normalized email and only Admin/Member roles. It generates a cryptographically random URL-safe token, stores only its SHA-256 hash, and sets a seven-day expiry. Duplicate pending email/workspace pairs return 409 from the existing partial unique index. The plaintext token is included only in the successful creation response for manual sharing; it is never written to activity metadata or returned later. Email delivery is not implemented.

List reports pending, expired, accepted, or revoked state and omits hashes. Revoke locks the invitation and rejects terminal records. Accept hashes the supplied token, locks workspace then invitation, verifies active workspace, status, expiry, and the verified JWT email, then provisions profile, adds/reactivates membership, marks accepted, and records activity in one transaction. Unknown, expired, revoked, accepted, and email-mismatched tokens share a generic 404 response. Concurrent acceptance is serialized by workspace and invitation locks; an existing conflicting membership returns 409.

## F. Activity logging

Service code adds `ActivityLog` rows for workspace creation/update/archive, member role changes/removal, ownership transfer, and invitation create/revoke/accept. Each event includes workspace, actor, action, entity type/ID, and limited structured metadata. Invitation plaintext/hash and secret values are excluded. Activity insertion is in the same transaction as each mutation and uses the existing append-only model/trigger.

The deployed DB role's ability to write activity events safely is unknown. No grant or privileged writer was added. ADR-010 requires a narrow trusted writer boundary and prohibits general activity INSERT for the ordinary request role; that boundary must be resolved before production use. If the configured role lacks permission, the transaction will fail and the application will not bypass the trigger.

## G. Transaction boundaries

Every workspace service operation uses an explicit SQLAlchemy `Session.begin()` scope. Workspace creation and initial Owner, ownership transfer, archive plus pending-invitation revocation, role/removal changes plus activity, invitation creation/revocation, and invitation acceptance plus membership/profile/activity are atomic. Mutating workspace routes lock the workspace row before checking current membership; transfer demotes before promotion. The request-scoped session dependency closes the session after the service transaction ends.

## H. Known limitations

- Member removal is blocked while any project roster entry exists; no project API is in scope to resolve those entries.
- Invitation expiry is currently a fixed seven days; no email delivery exists. Expired-but-unrevoked invitations continue to reserve the existing partial-unique email slot until revoked.
- Slugs include a random suffix and are protected by the database unique constraint; slug editing is not exposed.
- The activity writer privilege model is not confirmed and remains an ADR-010 deployment blocker.
- Existing Sprint 3 Python verification was incomplete; this report does not assert runtime verification of this module.
- Workspace list/member/invitation endpoints do not yet paginate.

## I. Supabase/RLS status

All API authorization uses current SQLAlchemy membership queries. No role switching, JWT claim settings, fake `auth.uid()`, service-role credential, or RLS policy was added. ADR-008 remains unverified; direct SQLAlchemy operations must not be treated as RLS-scoped until role grants, `BYPASSRLS`, transaction-local identity, `auth.uid()`, and pooled connection reset are proven against staging. Supabase Data API with the end-user JWT remains the fallback to evaluate if direct propagation cannot be proven.

Schema/triggers and actual role grants are deployment assumptions because no staging database was provided. In particular, deferred Owner/Manager triggers and activity-log privileges must be validated against the deployed PostgreSQL revision before production.

## J. Sprint 5 readiness

The workspace route/service foundation is ready for integration review. Before production or project APIs, resolve the trusted activity writer, validate the current schema and lifecycle triggers on disposable PostgreSQL, prove ADR-008 or choose the Data API path, and define project-roster cleanup/transfer semantics required for member departure. Frontend integration can target the endpoint shapes above without changing the existing UI in this sprint.

## K. Modified and newly created files

- Modified: `backend/app/api/router.py`, `backend/README.md`, `docs/engineering/08-authentication-authorization.md`, `docs/engineering/09-api-specification.md`, `docs/engineering/10-frontend-integration-plan.md`.
- Created: `backend/app/workspaces/__init__.py`, `backend/app/workspaces/schemas.py`, `backend/app/workspaces/service.py`, `backend/app/workspaces/router.py`, and this report.
- No frontend files, `.env`, credentials, commits, or pushes were added.
