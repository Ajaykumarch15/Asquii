# Sprint 6 — Tasks, Subtasks & Comments APIs

## Summary

Implemented authenticated, project-scoped task, subtask, and comment operations on `backend/foundations`. No migration was added. The API uses the existing Sprint 2 schema and Sprint 5 authorization/activity helpers. No frontend source files were changed, and no commit was created.

## Implemented API

All routes are under `/api/v1/workspaces/{workspace_id}/projects/{project_id}/tasks` and require a verified Supabase bearer token.

- Tasks: create, paginated/filterable list, detail, partial update, assignment update, and delete.
- Subtasks: create, list, detail, partial update, delete. `is_done` is the completion state.
- Comments: create, list, detail, edit, and soft-delete. Deleted comment responses suppress body text.

Task list filters include title search, status, priority, assignee/unassigned, due date bounds, allowlisted sort field/direction, and bounded `limit`/`offset`. Task fields and allowed enum values follow the existing database checks. No task state transition policy beyond the schema enum is imposed. Subtask completion does not change project progress.

## Authorization and transactions

Reads require current active workspace membership and are allowed for workspace members even when they are not project members. Task/subtask mutations require the existing collaborator policy (project member/manager or workspace Owner/Admin override). Task deletion is restricted to project managers and the workspace administrative override. Comment edits/deletes are permitted to the author, Project Manager, or workspace Owner/Admin.

Assignee IDs are validated against current project and active workspace membership. Client payloads cannot set actor identity or roles. Each domain mutation and its activity entry run in one SQLAlchemy transaction; activity metadata excludes comment bodies. Project/task rows are locked using the existing parent-first project helper and task lock before child mutations. This establishes application-level transaction ordering, but actual lock behavior, deferred trigger interaction, and activity insert grants have not been verified against PostgreSQL in this sprint.

## Schema constraints and behavior

- `tasks` has no `created_by` column. Creator fields are derived from the first `task.created` activity event and are null if that event is unavailable.
- Task deletion is a physical delete only when no comment rows exist. Otherwise the API returns 409 to preserve comment history. Subtasks cascade when the task is deleted. Other database dependencies can also cause a controlled 409.
- Comments use the existing `deleted_at` field for soft deletion. The record and body remain in the database because the author FK and append-only activity history must be preserved; responses omit the body after deletion.
- The comment author composite FK requires project roster membership. A workspace Owner/Admin who is not a project member may read/administer through the policy override but cannot create a comment. The API returns 409 rather than inventing membership or writing on behalf of another user.
- Project member removal may remain blocked while task assignee or comment references exist. Reassign/unassign tasks first; comments have no author transfer operation.
- Task deletion with comments is intentionally blocked because the comment FK is restrictive. No migration changes this retention rule.

## Verification status

Implementation was checked against the SQLAlchemy models and migration definitions. `ruff check .` passed and `ruff format --check .` passed (64 files). `python -m pytest -q` could not start: the checked-in virtual environment launcher targets `C:\Users\AJAY\AppData\Local\Programs\Python\Python312\python.exe`, which is unavailable in this environment; no tests are claimed as passing for Sprint 6. No PostgreSQL database credentials were available or used; PostgreSQL integration behavior, production grants, RLS identity propagation, deferred lifecycle triggers, pooler behavior, and concurrent requests remain unverified. SQLite is not treated as equivalent. No live Supabase staging verification is claimed.

## Remaining security and operational blockers

1. Verify authenticated request identity and `auth.uid()` behavior through the actual Supabase connection mode before relying on RLS.
2. Verify the application role's `BYPASSRLS` attribute and least-privilege grants.
3. Establish a controlled activity-log insert path compatible with its immutability trigger, then verify it on PostgreSQL.
4. Exercise task/comment FK behavior, deferred lifecycle triggers, transaction rollback, and concurrent task/member changes against a disposable PostgreSQL database.
5. Decide whether product requirements justify a future schema change for task creator attribution or workspace-admin comments without project roster membership.

## Files

Added task schemas, service, and router under `backend/app/tasks/`; registered the router in `backend/app/api/router.py`; exposed small project service wrappers for scoped project context and activity recording; updated the API specification, frontend integration plan, backend README, and this report. No migrations, frontend files, commits, or pushes were added.
