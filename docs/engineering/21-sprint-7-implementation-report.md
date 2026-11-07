# Sprint 7 — Meetings & Resources APIs

## Summary

Implemented authenticated, project-scoped meeting, attendee, resource, and resource-star APIs on `backend/foundations`. The implementation uses the existing Sprint 2 PostgreSQL schema and project authorization/activity helpers. No migration was added. No frontend source files were modified, and no commit or push was made.

## Endpoints

All endpoints require a verified Supabase bearer token and are nested under `/api/v1/workspaces/{workspace_id}/projects/{project_id}`.

### Meetings

- `POST /meetings` creates a meeting and its initial attendee rows atomically.
- `GET /meetings` lists with `limit`, `offset`, `q`, `starts_after`, `starts_before`, `sort_by`, and `sort_direction`.
- `GET /meetings/{meeting_id}` returns meeting details and safe attendee summaries.
- `PATCH /meetings/{meeting_id}` updates explicitly supplied meeting fields. Supplying `attendee_user_ids` replaces the attendee set.
- `DELETE /meetings/{meeting_id}` physically deletes the meeting; attendee rows cascade under the schema FK.
- `GET /meetings/{meeting_id}/attendees` lists attendees.
- `POST /meetings/{meeting_id}/attendees` adds one attendee.
- `DELETE /meetings/{meeting_id}/attendees/{user_id}` removes an attendee; that attendee may remove themself.

Start times and date filters must include a timezone offset. Meeting types follow the database check constraint (`Team sync`, `Review`, `Planning`, `Retrospective`, `Other`); duration is positive and capped at one day by request validation. The stored end is computed as `starts_at + duration_minutes`.

### Resources

- `POST /resources` creates a resource owned by the authenticated user.
- `GET /resources` lists with pagination, name search, type/category/owner/starred filters, and allowlisted sorting.
- `GET /resources/{resource_id}` returns safe owner details and the caller's `is_starred` state.
- `PATCH /resources/{resource_id}` updates only provided metadata/ownership fields.
- `DELETE /resources/{resource_id}` sets `deleted_at`; it does not delete preferences or physical data.
- `PUT /resources/{resource_id}/star` idempotently stars for the authenticated user.
- `DELETE /resources/{resource_id}/star` idempotently unstars for the authenticated user and returns `starred: false`.

Resource types follow the database check constraint (`Document`, `Spreadsheet`, `Design file`, `Folder`, `Link`). Star state is held only in `user_resource_preferences`, is scoped to the verified user, and does not create shared activity.

## Authorization

Every operation verifies active workspace membership and workspace/project relationship using the current database rows. Active workspace members can read meetings and resources in active or archived projects under the existing project read policy. All writes, including attendee changes and star updates, are rejected for archived projects.

| Action | Workspace Owner/Admin | Project Manager | Project Member | Other active workspace member |
|---|---|---|---|---|
| Read meetings/resources | Yes | Yes | Yes | Yes |
| Create meetings/resources | Collaborator policy; resource owner must be project member | Yes | Yes | No |
| Update/delete meetings | Yes | Yes | No (no organizer column/policy) | No |
| Add/remove other attendees | Yes | Yes | No | No |
| Remove self as attendee | Yes | Yes | Yes | Only if attendee |
| Update/delete own resource | Yes | Yes | Yes | No |
| Update/delete another user's resource | Yes | Yes | No | No |
| Star/unstar visible resource | Yes | Yes | Yes | Yes |

## Schema-driven behavior and limitations

- `meetings` has no status/cancellation field and no organizer/creator column. DELETE is therefore a hard delete; the FK cascades attendee rows. Creation events identify the organizer for display when the event is readable and present. No cancellation endpoint or status is fabricated.
- Meeting duration is stored as positive minutes, not an end timestamp. The response derives `ends_at`.
- Attendees must match the same project and workspace through the composite FK and are validated as active project members before writes. Initial attendee IDs must be unique. Meeting row locks serialize the service's attendee management operations.
- `resources.owner_user_id` references a project member. The API always assigns the authenticated user on create and does not accept an owner in the create body. A workspace Owner/Admin who is not a project member cannot satisfy this schema FK and receives a controlled conflict.
- Resource removal is soft delete (`deleted_at`) because the schema provides it and preferences have restrictive resource FKs. Deleted resources are hidden from list/detail and cannot be starred; existing user preference rows remain. There is no restore/purge endpoint.
- An owning Project Member may update or delete their resource; Project Manager and workspace Owner/Admin may administer any resource. Owner changes require an active project member target.
- Workspace Owner/Admin is not stored as meeting organizer or resource owner unless also represented in project membership.

## Transactions and activity

Mutation operations acquire the project lock through the shared project context before locking a meeting or resource, preserving workspace → project → child ordering. Business changes and activity rows are in the same SQLAlchemy transaction. Activity actions include meeting create/update/delete, attendee add/remove, and resource create/update/delete. Metadata contains field names, type/category, counts, or attendee IDs, not meeting descriptions, agendas, resource details, URLs, tokens, or credentials. Star/unstar is personal preference and intentionally has no shared activity event.

These are application-level transaction choices only. PostgreSQL lock behavior, FK/trigger behavior under concurrent requests, activity-log insert grants, RLS identity propagation, `auth.uid()`, and pooler behavior remain unverified; no staging credentials or disposable PostgreSQL database were used.

## Verification and remaining blockers

- `ruff check .` passed; `ruff format --check .` passed (72 files).
- `git diff --check` passed; frontend diff is empty.
- `python -m pytest -q` was attempted but could not start because the local virtual environment launcher references the unavailable `C:\Users\AJAY\AppData\Local\Programs\Python\Python312\python.exe`. No tests are represented as passing for Sprint 7.
- PostgreSQL integration and Supabase staging checks remain unverified. SQLite is not claimed as an equivalent substitute.
- ADR-008 RLS identity and ADR-010 trusted activity insert boundary remain deployment gates.
- The existing schema's admin-not-in-project ownership constraints and missing meeting organizer/cancellation fields are product/schema limitations, not silently altered by this sprint.

## Files

Added `backend/app/meetings/{__init__.py,schemas.py,service.py,router.py}` and `backend/app/resources/{__init__.py,schemas.py,service.py,router.py}`; registered both routers in `backend/app/api/router.py`; updated `backend/README.md`, `docs/engineering/09-api-specification.md`, `docs/engineering/10-frontend-integration-plan.md`; and added this report. No migration, frontend change, commit, or push was made.
