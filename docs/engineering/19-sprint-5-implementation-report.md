# Sprint 5 implementation report — project management APIs

Date: 2026-11-04  
Branch: `backend/foundations`

## Implementation summary

Added workspace-scoped project, project membership, manager-transfer, and milestone APIs using the existing synchronous SQLAlchemy models and FastAPI conventions. No schema migration or frontend change was needed. Existing Sprint 1–4 files and uncommitted worktree changes were preserved.

## Implemented endpoints

All endpoints require `get_current_user` and use the verified subject as actor.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | `/api/v1/workspaces/{workspace_id}/projects` | Owner/Admin creates project; creator is initial Project Manager. |
| GET | `/api/v1/workspaces/{workspace_id}/projects` | Active workspace member lists active projects; supports `status`, `q`, `limit`, and `offset`. |
| GET | `/api/v1/workspaces/{workspace_id}/projects/{project_id}` | Read project details and membership counts; archived projects are read-only. |
| PATCH | `/api/v1/workspaces/{workspace_id}/projects/{project_id}` | Owner/Admin or Project Manager updates present fields only. |
| POST | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/archive` | Owner/Admin or Project Manager archives; repeated requests return 409. |
| GET | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/members` | Active workspace member lists safe profile, role, timestamps, and workspace membership state. |
| POST | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/members` | Owner/Admin or Project Manager adds an active workspace member with an approved role. |
| PATCH | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/members/{user_id}/role` | Owner/Admin or Project Manager changes an active roster member's role. |
| DELETE | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/members/{user_id}` | Authorized administrator/manager removes; a user may remove their own roster entry. |
| POST | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/transfer-manager` | Owner/Admin or Project Manager transfers the manager role to an active project member. |
| POST/GET | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/milestones` | Create milestone or list milestones. |
| GET/PATCH/DELETE | `/api/v1/workspaces/{workspace_id}/projects/{project_id}/milestones/{milestone_id}` | Read, update, or delete a milestone scoped to its workspace/project. |

## Authorization and lifecycle behavior

Workspace Owner/Admin can create projects and retain the approved project administration override. Project Manager can update/archive projects and manage project membership and milestones. Any active workspace member can read active projects, rosters, and milestones; project members do not gain workspace-wide administrative access. Workspace/project IDs are always checked together, and archived workspaces/projects cannot receive mutations.

Project create and initial Manager assignment are atomic. Membership roles are limited to `Project Manager` and `Project Member`, and targets must have active membership in the same workspace. Role changes and removals rely on the deferred database Project Manager invariant; the service converts the named last-manager violation into a safe 409. Manager transfer locks workspace/project parents, demotes the previous Manager before promoting the successor, and records one transfer event. A Workspace Owner/Admin initiating transfer may designate an existing active Project Manager as the previous Manager; otherwise a stable existing Manager is demoted.

Project-member removal deletes only the roster row and preserves other records. Existing task assignments, comment authors, meeting attendees, or resource owners may reference that row; PostgreSQL RESTRICT constraints prevent deletion, and the API returns 409 asking for those references to be reassigned or removed first. This permits Sprint 4 workspace-member departure after all project roster entries are resolved, without cascading unrelated project data.

Milestone names are normalized and bounded; due dates use the existing `date` field. No completion fields or schema changes were introduced. Archived project details, members, and milestones remain readable, while all project and milestone mutations are blocked.

## Transactions and activity

All service operations use explicit `Session.begin()` scopes. Mutations lock the workspace row before the project row, then perform membership checks and writes. Business writes and activity rows share one transaction. Events cover project create/update/archive, member add/remove/role change, manager transfer, and milestone create/update/delete. Metadata contains only field names, roles, or manager IDs; no credentials or token data is used.

The app inserts activity records through its request-scoped SQLAlchemy session. The deployed database role's safe activity INSERT capability remains unverified; no grants, trigger bypass, or privileged credential was introduced. ADR-010's trusted-writer boundary must be resolved before production use.

## Known limitations and infrastructure dependencies

- PostgreSQL migration/triggers and actual `project_at_least_one_active_manager` behavior have not been verified against a live database.
- ADR-008 identity propagation, RLS, database role grants, and `auth.uid()` remain unverified. These APIs rely on server-side SQLAlchemy membership checks and must not be represented as RLS-protected.
- Activity-log writer privileges are unverified and may prevent mutations from committing under a least-privilege deployment role.
- Project roster deletion remains blocked while dependent rows reference the member; clients must resolve those records first.
- Project list pagination is offset-based. Lists do not yet provide cursor pagination.
- Existing Sprint 3 Python verification limitations remain unchanged.

## Sprint 6 prerequisites

Resolve the trusted activity writer, validate the existing database revision and deferred Manager invariant on disposable PostgreSQL, and prove ADR-008 or choose Supabase Data API with the end-user JWT before relying on RLS. Define project-dependent-record reassignment flows and then use these services as the base for task, meeting, and resource APIs.

## Files created and modified

- Created: `backend/app/projects/__init__.py`, `backend/app/projects/schemas.py`, `backend/app/projects/service.py`, `backend/app/projects/router.py`, and this report.
- Modified: `backend/app/api/router.py`, `backend/README.md`, `docs/engineering/09-api-specification.md`, and `docs/engineering/10-frontend-integration-plan.md`.
- No frontend source, migration, `.env`, credential, commit, or push was added.
