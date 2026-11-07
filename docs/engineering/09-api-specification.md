# 09 — Finalized proposed API specification

Sprints 4–8 implement workspace, project, milestone, task, subtask, comment, meeting, resource, and activity endpoints below; other rows remain the approved API target. Prefix `/api/v1`; JSON; every API operation except health/readiness uses validated Supabase Auth bearer JWT. FastAPI resolves membership from DB, never trusts identity/role from payload. Workspace/project checks follow [08](08-authentication-authorization.md).

## Error contract

Stable body: `{"error":{"code":"forbidden","message":"You do not have access to this resource.","request_id":"...","details":[]}}`. Codes include `validation_error` (422), `unauthorized` (401), `forbidden` (403), `not_found` (404; use consistently for concealed tenant misses), `conflict` (409), `rate_limited` (429), `internal_error` (500). Never return SQL, stack traces, tokens, or secrets. Field details are safe and schema-specific.

| Method and URL | Authorization | Input → output / key validation |
|---|---|---|
| Supabase SDK auth operations | Supabase Auth | Registration/login/logout/recovery/refresh remain provider-managed; no FastAPI password proxy |
| `GET /api/v1/auth/me` | Authenticated | — → safe profile fields for verified subject |
| `PATCH /api/v1/me` | Self | display_name/job_title → profile; bounded strings |
| `GET /api/v1/workspaces` | Authenticated | cursor → active memberships/workspaces |
| `POST /api/v1/workspaces` | Authenticated | name → generated unique slug, workspace and initial Owner atomically |
| `GET /api/v1/workspaces/{wid}` | Active member | — → workspace |
| `PATCH /api/v1/workspaces/{wid}` | Owner/Admin | name only; generated slug remains stable |
| `POST /api/v1/workspaces/{wid}/archive` | Owner only | — → archive (`archived_at`), revoke pending invitations and write activity atomically; preserve memberships/project archive state; deny access until restore; never hard delete |
| `POST /api/v1/workspaces/{wid}/transfer-ownership` | Current Owner only | `new_owner_user_id` → former owner becomes Admin; target must be active member; atomic exactly-one-owner transition |
| `GET /api/v1/workspaces/{wid}/members` | Active member | cursor → directory/role; includes only active members |
| `GET /api/v1/workspaces/{wid}/members/{uid}` | Active member | — → safe profile fields, current role, and membership date |
| `PATCH /api/v1/workspaces/{wid}/members/{uid}/role` | Owner only | role `Admin|Member`; cannot demote/remove Owner through this endpoint |
| `DELETE /api/v1/workspaces/{wid}/members/{uid}` | Owner/Admin; non-Owner self-leave allowed | — → set `removed_at`; Owner must transfer first; returns 409 while project roster entries remain |
| `GET /api/v1/workspaces/{wid}/invitations` | Owner/Admin | status/cursor → invitations, never token/hash |
| `POST /api/v1/workspaces/{wid}/invitations` | Owner/Admin | email, role `Admin|Member` → normalized idempotent pending invitation; duplicate active invite returns existing or stable 409; token generated once and sent via approved channel |
| `POST /api/v1/invitations/accept` | Authenticated verified matching email | token in body → membership and invitation acceptance atomically; one-time/expiry checked |
| `DELETE /api/v1/workspaces/{wid}/invitations/{iid}` | Owner/Admin | — → revoke; repeated revoke returns 409 |
| `GET /api/v1/workspaces/{wid}/projects` | Active member | optional status/q, limit/offset → active projects and current-user role |
| `POST /api/v1/workspaces/{wid}/projects` | Owner/Admin | name/description/status/progress → project and creator Project Manager atomically |
| `GET /api/v1/workspaces/{wid}/projects/{pid}` | Active workspace member | — → project summary; archived projects are read-only |
| `PATCH /api/v1/workspaces/{wid}/projects/{pid}` | Owner/Admin or Project Manager | present project fields only; no client IDs/roles/timestamps |
| `POST /api/v1/workspaces/{wid}/projects/{pid}/archive` | Owner/Admin or Project Manager | — → archive (`archived_at`); no hard delete |
| `GET /api/v1/workspaces/{wid}/projects/{pid}/members` | Active workspace member | safe profile, project role, workspace membership state |
| `POST /api/v1/workspaces/{wid}/projects/{pid}/members` | Owner/Admin or Project Manager | user ID and role; target must be active workspace member; duplicates return 409 |
| `PATCH /api/v1/workspaces/{wid}/projects/{pid}/members/{uid}/role` | Owner/Admin or Project Manager | role `Project Manager|Project Member`; deferred invariant rejects last-manager demotion |
| `DELETE /api/v1/workspaces/{wid}/projects/{pid}/members/{uid}` | Owner/Admin, Project Manager, or self | — → delete roster row; last active Manager and dependent FK rows are protected |
| `POST /api/v1/workspaces/{wid}/projects/{pid}/transfer-manager` | Owner/Admin or Project Manager | target active project member; atomic role transfer |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/milestones` | Workspace member read / Owner/Admin or Manager write | milestone name and due date |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/milestones/{mid}` | Workspace member read / Owner/Admin or Manager write | scoped milestone details/update/delete |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/tasks` | Active workspace member read / Owner/Admin or project member write | bounded filters/pagination; create title/description/status/priority/assignee/due/labels; assignee must be active project member |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}` | Active workspace member read / collaborator update / Owner/Admin or Project Manager delete | task fields align to schema; delete is hard delete only without comments; subtasks cascade |
| `PATCH /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}/assignee` | Owner/Admin or project member | `{assignee_user_id}`; null unassigns, otherwise active project member |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}/subtasks` | Active workspace member read / collaborator write | ordered subtasks; `is_done` toggles completion |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}/subtasks/{sid}` | Active workspace member read / collaborator write | scoped item; delete is physical and recorded as activity |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}/comments` | Active workspace member read / project collaborator write | paginated; comment author must have project roster membership per current FK |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}/comments/{cid}` | Active workspace member read / author edit-delete; PM or workspace admin may moderate | delete is soft (`deleted_at`); deleted body is omitted; comment rows remain to preserve FK/history |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/meetings` | Active workspace member read / collaborator create | bounded pagination, title search, offset-aware starts range; positive duration and schema-supported meeting type; optional attendees are active project members |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/meetings/{mid}` | Active workspace member read / Owner/Admin or Project Manager update/delete | detail includes safe attendees; patch supports meeting fields and replaces attendee IDs when supplied; delete is physical because there is no cancellation/status column |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/meetings/{mid}/attendees` | Workspace member read / Owner/Admin or Project Manager add | safe attendee profile; duplicates return 409 |
| `DELETE /api/v1/workspaces/{wid}/projects/{pid}/meetings/{mid}/attendees/{uid}` | Owner/Admin or Project Manager; attendee may remove self | deletes only the scoped attendance row |
| `GET/POST /api/v1/workspaces/{wid}/projects/{pid}/resources` | Active workspace member read / collaborator create | bounded filters/pagination; schema type/category/metadata; creator becomes owner and must be project member |
| `GET/PATCH/DELETE /api/v1/workspaces/{wid}/projects/{pid}/resources/{rid}` | Workspace member read / resource owner update-delete / Owner/Admin or Project Manager override | safe owner details and caller's `is_starred`; delete sets `deleted_at`; no purge endpoint |
| `PUT/DELETE /api/v1/workspaces/{wid}/projects/{pid}/resources/{rid}/star` | Active workspace member | idempotent user-specific upsert/delete; returns current user's star state and writes no shared activity |
| `GET /api/v1/workspaces/{wid}/activities` | Active workspace member | limit/offset/total; optional project, actor, action, resource type, inclusive timestamp bounds; newest-first by default |
| `GET /api/v1/workspaces/{wid}/activities/{aid}` | Active workspace member | scoped detail; actor profile is safe/nullable; metadata is scrubbed for known private keys |
| `GET /api/v1/workspaces/{wid}/projects/{pid}/activities` | Active workspace member | project-only event page with actor/action/resource type/date filters and allowlisted sort |
| `GET /api/v1/workspaces/{wid}/projects/{pid}/activities/{aid}` | Active workspace member | detail only if the event belongs to this workspace and project |
| `GET/PUT /api/v1/workspaces/{wid}/notification-preferences` (conditional) | Self active member | three booleans → own preferences |
| `GET /api/v1/notifications` and `PATCH /api/v1/notifications/{id}` (conditional) | Authenticated recipient | cursor/unread; mark own read; recipient must remain member |

Domain mutation services add their activity rows in the same transaction; personal resource star changes are not shared activity. The database append-only trigger rejects UPDATE/DELETE, but the trusted writer boundary is unresolved: application code inserts through the ordinary SQLAlchemy session, no grant/function configuration exists in the repository, and the deployed role has not been inspected. Do not treat application-layer helper use as a database-enforced writer boundary. Caller cannot submit action, actor, metadata or log rows through these APIs. Composite database constraints enforce same-workspace/project membership even if an API validation path is bypassed. The schema has no task creator or meeting organizer column, so those display fields are inferred from creation activity events when present. Task progress is not computed from subtasks. Teams, global search, reports, file binaries and notification delivery remain conditional/future.

The creation and deletion rows above are governed by these transactional rules: workspace creation always inserts its creator as sole initial Owner; transfer must lock and replace Owner atomically. Project creation assigns its creator as Project Manager, and each active project must retain at least one Manager. Workspace archive revokes pending invitations, keeps memberships and project archive flags, blocks all access, and allows restoration without unarchiving independently archived projects. Project restore requires a Manager. Deferred database invariants and parent-row locks enforce final state, with concurrent transfer/removal tests required. Activity is inserted atomically through a narrow controlled writer path; no ordinary app-role table INSERT is granted.
