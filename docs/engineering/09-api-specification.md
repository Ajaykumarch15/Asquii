# 09 — Finalized proposed API specification

No endpoints exist yet. Prefix `/api/v1`; JSON; every API operation except health uses validated Supabase Auth bearer JWT. FastAPI resolves membership from DB, never trusts identity/role from payload. Workspace/project checks follow [08](08-authentication-authorization.md). All list operations have bounded `limit` (default 25, max 100) and opaque cursor; filters/sort fields allowlisted.

## Error contract

Stable body: `{"error":{"code":"forbidden","message":"You do not have access to this resource.","request_id":"...","details":[]}}`. Codes include `validation_error` (422), `unauthorized` (401), `forbidden` (403), `not_found` (404; use consistently for concealed tenant misses), `conflict` (409), `rate_limited` (429), `internal_error` (500). Never return SQL, stack traces, tokens, or secrets. Field details are safe and schema-specific.

| Method and URL | Authorization | Input → output / key validation |
|---|---|---|
| Supabase SDK auth operations | Supabase Auth | Registration/login/logout/recovery/refresh remain provider-managed; no FastAPI password proxy |
| `GET /api/v1/me` | Authenticated | — → profile + memberships from DB |
| `PATCH /api/v1/me` | Self | display_name/job_title → profile; bounded strings |
| `GET /api/v1/workspaces` | Authenticated | cursor → active memberships/workspaces |
| `POST /api/v1/workspaces` | Authenticated | name, slug → workspace and exactly one Owner membership atomically |
| `GET /api/v1/workspaces/{wid}` | Active member | — → workspace |
| `PATCH /api/v1/workspaces/{wid}` | Owner/Admin | name/slug only in MVP; visibility deferred |
| `DELETE /api/v1/workspaces/{wid}` | Owner/Admin | — → archive (`archived_at`), revoke pending invitations and write activity atomically; preserve memberships/project archive state; deny access until restore; never hard delete |
| `POST /api/v1/workspaces/{wid}/ownership-transfer` | Current Owner only | successor_user_id → former owner becomes Admin by default; target must be active member; atomic exactly-one-owner transition |
| `GET /api/v1/workspaces/{wid}/members` | Active member | cursor → directory/role; includes only active members |
| `PATCH /api/v1/workspaces/{wid}/members/{uid}` | Owner/Admin | role `Admin|Member`; cannot demote/remove Owner through this endpoint |
| `DELETE /api/v1/workspaces/{wid}/members/{uid}` | Owner/Admin (self-leave policy deferred) | — → remove membership; Owner must transfer first |
| `GET /api/v1/workspaces/{wid}/invitations` | Owner/Admin | status/cursor → invitations, never token/hash |
| `POST /api/v1/workspaces/{wid}/invitations` | Owner/Admin | email, role `Admin|Member` → normalized idempotent pending invitation; duplicate active invite returns existing or stable 409; token generated once and sent via approved channel |
| `POST /api/v1/invitations/{token}/accept` | Authenticated verified matching email | — → membership atomically; one-time/expiry checked |
| `DELETE /api/v1/workspaces/{wid}/invitations/{iid}` | Owner/Admin | — → revoke; repeated revoke idempotent 204 |
| `GET /api/v1/workspaces/{wid}/projects` | Active member | q/status/member/cursor → all active projects (including non-member read-only) |
| `POST /api/v1/workspaces/{wid}/projects` | Owner/Admin | name/description/status/progress/milestones/member assignments → project; creator becomes Project Manager atomically; validate status/member IDs |
| `GET /api/v1/projects/{pid}` | Active workspace member | — → active project; read permitted whether project member or not |
| `PATCH /api/v1/projects/{pid}` | Owner/Admin or Project Manager | allowed project fields; no client owner/role fields |
| `DELETE /api/v1/projects/{pid}` | Owner/Admin or Project Manager | — → archive (`archived_at`); descendants become inaccessible through active-project policy; no hard delete |
| `GET /api/v1/projects/{pid}/members` | Active workspace member | cursor → project roster and role |
| `PUT /api/v1/projects/{pid}/members/{uid}` | Owner/Admin or Project Manager | role `Project Manager|Project Member`; target active workspace member; upsert idempotently |
| `DELETE /api/v1/projects/{pid}/members/{uid}` | Owner/Admin or Project Manager | — → remove only if another Project Manager remains or is added in the same transaction; otherwise reject |
| `GET /api/v1/projects/{pid}/tasks` | Active workspace member | filters/cursor → task page, including read-only for non-project member |
| `POST /api/v1/projects/{pid}/tasks` | Owner/Admin or project member | title/description/status/priority/assignee/due/labels → task; assignee null or active project member |
| `GET /api/v1/tasks/{tid}` | Active workspace member for active project | — → task/subtasks/comments |
| `PATCH /api/v1/tasks/{tid}` | Owner/Admin or project member | permitted task fields; assignee validated against project member |
| `DELETE /api/v1/tasks/{tid}` | Owner/Admin or project member | — → defined task removal; soft vs hard behavior remains retention decision |
| `POST /api/v1/projects/{pid}/tasks/reorder` | Owner/Admin or project member | ordered IDs/status → atomically reorder only tasks of same project/status |
| `GET/POST /api/v1/projects/{pid}/meetings` | Workspace member read / project writer create | date range or meeting fields; ISO-8601 offset; attendees must be active project members |
| `PATCH/DELETE /api/v1/meetings/{mid}` | Owner/Admin or project member | fields / remove; attendee membership validated; deletion behavior retention decision |
| `GET/POST /api/v1/projects/{pid}/resources` | Workspace member read / project writer create | metadata and optional URL; owner must be project member; signed storage flow conditional |
| `PATCH/DELETE /api/v1/resources/{rid}` | Owner/Admin or project member | metadata / soft-trash via `deleted_at`; purge endpoint deferred until retention agreed |
| `PUT/DELETE /api/v1/resources/{rid}/star` | Authenticated active workspace member | own star preference idempotent upsert/delete in `user_resource_preferences` |
| `GET /api/v1/workspaces/{wid}/activity` | Active workspace member | cursor/project/entity filters → append-only events; project events visible workspace-wide |
| `GET/PUT /api/v1/workspaces/{wid}/notification-preferences` (conditional) | Self active member | three booleans → own preferences |
| `GET /api/v1/notifications` and `PATCH /api/v1/notifications/{id}` (conditional) | Authenticated recipient | cursor/unread; mark own read; recipient must remain member |

Every successful domain mutation writes its activity record within the same transaction via trusted backend code; caller cannot submit action, actor, metadata or log rows. Composite database constraints enforce same-workspace/project membership even if an API validation path is bypassed. Teams, global search, reports, file binaries and notification delivery remain conditional/future.

The creation and deletion rows above are governed by these transactional rules: workspace creation always inserts its creator as sole initial Owner; transfer must lock and replace Owner atomically. Project creation assigns its creator as Project Manager, and each active project must retain at least one Manager. Workspace archive revokes pending invitations, keeps memberships and project archive flags, blocks all access, and allows restoration without unarchiving independently archived projects. Project restore requires a Manager. Deferred database invariants and parent-row locks enforce final state, with concurrent transfer/removal tests required. Activity is inserted atomically through a narrow controlled writer path; no ordinary app-role table INSERT is granted.
