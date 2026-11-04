# Sprint 8 — Activity Feed & Integration APIs

## Summary

Added authenticated workspace and project activity feeds and scoped activity detail routes. Reused the existing `activity_logs` table and Sprint 4–7 service-generated activity events. No migration or frontend change was made. Existing worktree changes were preserved; no commit or push was created.

## Endpoints and response

- `GET /api/v1/workspaces/{workspace_id}/activities`
- `GET /api/v1/workspaces/{workspace_id}/activities/{activity_id}`
- `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/activities`
- `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/activities/{activity_id}`

Feed responses contain `{items, total, limit, offset}`. Each item maps the actual table fields into `id`, `workspace_id`, nullable `project_id`, nullable `actor_user_id`, nullable safe `actor_display_name`, `action`, `resource_type` (stored `entity_type`), `resource_id` (stored `entity_id`), structured `metadata`, and `created_at`. Actor profile lookup is a left join so an unavailable profile does not hide history.

Filters are actor ID, action, resource type/entity type, inclusive `starts_after` and `starts_before`; the workspace feed also supports `project_id`. The actor filter is checked against a workspace membership row (historical removed membership rows remain valid). Project IDs are checked through the shared project-context helper before filtering. Dates require offsets and start must not exceed end. `limit` is 1–100, offset is nonnegative, and sorting is allowlisted (`created_at`, `action`, `resource_type`) with a deterministic ID tie-breaker. Newest first is the default.

Workspace feeds include workspace-scoped events (`project_id IS NULL`) and all project events belonging to that workspace. Project feeds and detail endpoints require both workspace and project IDs to match the event; workspace-level events are not presented as project events. Invalid cross-scope detail IDs return 404.

## Authorization, metadata safety, and query behavior

Workspace requests require current active workspace membership. Project requests use the shared project helper, enforce workspace/project association and allow active workspace members to read project activity according to ADR-006, including archived-project reads while the workspace remains active. A separate archived workspace remains unavailable.

Metadata is returned as JSON after recursively omitting keys associated with credentials, invitation tokens/hashes, email, comment/body text, descriptions/agendas/details, URLs, and storage paths. Current event writers also avoid storing those values: workspace invitation events store role only; task comment events store field names, not comment text; meeting/resource events omit descriptions, URLs, and storage paths. Display names are the only actor profile field returned. No avatar column exists.

Queries are scoped in SQL and use a separate SQL count plus bounded page query. Actor names are joined in the page query, avoiding N+1 lookups. Existing descending workspace/project created-time indexes support default ordering. Actor/action/entity filters and alternate sorts have no dedicated index and may scan/sort within the selected tenant scope. No index or migration was added without production volume evidence.

## Event review across Sprints 4–7

All existing event writes use the shared append-only `ActivityLog` ORM model within their domain mutation transaction. Workspace events use `workspace_id` with no project ID; project, task, meeting, and resource events carry both workspace and project scope. Event actors come from the verified request subject. The activity feed does not create or duplicate events.

Observed action groups include:

- Workspace: `workspace.created`, `workspace.updated`, `workspace.archived`, `workspace.member_role_changed`, `workspace.member_removed`, `workspace.ownership_transferred`, `workspace.invitation_created`, `workspace.invitation_revoked`, `workspace.invitation_accepted`.
- Project: `project.created`, `project.updated`, `project.archived`, `project.member_added`, `project.member_role_changed`, `project.member_removed`, `project.manager_transferred`, and milestone create/update/delete actions.
- Tasks: task create/update/delete and assignee-change actions, plus subtask and comment create/update/delete actions.
- Meetings: `meeting.created`, `meeting.updated`, `meeting.deleted`, and attendee add/remove actions.
- Resources: `resource.created`, `resource.updated`, and `resource.deleted`.

Naming remains domain-prefixed and action-specific. Existing nested task action spellings such as `task.subtask_created` are preserved for history compatibility; no historical event rows or prior event producers were rewritten. Metadata remains structured and action-specific rather than pretending to have one fixed shape. Updates generally identify changed fields; creation events include limited type/status/count data; no event stores raw comments or meeting/resource content. Personal resource star changes intentionally create no shared activity.

## Trusted writer boundary and RLS status

Revision `0002_mvp_schema` creates an `activity_logs_immutable` trigger that rejects row UPDATE and DELETE. It does not restrict INSERT. Current services add ORM `ActivityLog` rows through the ordinary SQLAlchemy request session. Repository migrations/config contain no `GRANT`/`REVOKE` setup, no narrow writer function, and no separately scoped activity-writer credential. The deployed database role and its `INSERT`, `UPDATE`, and `DELETE` privileges are unknown. Therefore the application helper path is not a database-enforced trusted-writer boundary, and ADR-010 remains unresolved.

To resolve it, an operator must inspect the actual Supabase role grants and `BYPASSRLS`, revoke ordinary table INSERT/UPDATE/DELETE as appropriate, and deploy a narrowly scoped writer mechanism (for example, a constrained function with fixed `search_path` and narrowly granted execute) or an isolated writer credential. Review its ownership, tenant checks, and RLS behavior, then verify in staging that request roles cannot forge events or mutate history while legitimate domain writes can record atomically. Do not use service-role credentials or weaken RLS/grants as a workaround.

ADR-008 remains a separate blocker: no authenticated JWT identity propagation, `auth.uid()`, RLS, or pooled connection isolation was verified. Application feed authorization is enforced, but it is not proof of database-level tenant isolation.

## Verification and files

`ruff check .` passed and `ruff format --check .` passed (77 files). `git diff --check` passed and the frontend diff is empty. `python -m pytest -q` was attempted but could not start because the local virtual environment targets the unavailable `C:\Users\AJAY\AppData\Local\Programs\Python\Python312\python.exe`; the newly added metadata-sanitization tests therefore remain unexecuted. No live PostgreSQL or Supabase verification was performed.

Added `backend/app/activities/{__init__.py,schemas.py,service.py,router.py}` and focused metadata-sanitization tests in `backend/tests/test_activities.py`; registered both activity routers in `backend/app/api/router.py`; updated `backend/README.md`, `docs/engineering/09-api-specification.md`, `docs/engineering/10-frontend-integration-plan.md`, and `docs/engineering/11-security-review.md`. `docs/engineering/14-architecture-decisions.md` was not changed because no architecture decision was verified or altered.
