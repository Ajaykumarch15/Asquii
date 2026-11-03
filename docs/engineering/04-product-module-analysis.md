# 04 — Product module analysis (validated MVP)

UI status describes source-code evidence; backend status describes required work. Final decisions are in [14](14-architecture-decisions.md).

| Module | UI status in checkout | MVP/backend disposition |
|---|---|---|
| Authentication/identity | Not implemented; persona preview only | Required via Supabase Auth; React SDK + FastAPI JWT validation |
| User profiles | Partial seeded profile fields | `profiles` linked to Auth; minimal profile API |
| Workspace management | Locally implemented create/switch/settings | MVP backend; Owner/Admin settings, archive semantics |
| Workspace members | Local directory/membership and role UI | MVP; fixed Owner/Admin/Member roles, transactional owner invariant |
| Workspace invitations | Local simulation | MVP candidate; Owner/Admin only, normalized email, hashed one-time token, verified matching acceptance |
| Workspace roles | Partial client Admin/Member checks | MVP fixed roles; server + RLS; no Guest/custom role or role-permission tables |
| Workspace overview | Implemented locally/derived | Read all workspace projects for all active members |
| Workspace projects | Local create/edit/import/export/filter | MVP; all active workspace members read; Owner/Admin create |
| Project management/overview/settings | Local project status/progress/milestone/editor flows | MVP project core; archive via timestamp; exact status enum from model |
| Project members | Page and project person IDs; no project roles in UI | MVP join table; Project Manager/Project Member, target must be workspace member |
| Project teams | UI filter/team labels only, no data model | Not MVP; future requirement |
| Activity | No screen/model | `activity_logs` accepted for trusted backend audit; UI feed optional/future |
| Notifications | Derived local feed/read state | Notification tables conditional; no delivery commitment |
| Search | Local list/command palette search | MVP can query bounded API lists; dedicated global search future |
| Task management | Locally implemented board/list/subtasks/comments | UI exists; backend design supports it, delivery order is product-prioritized |
| Comments/collaboration | Local comments embedded in task state | `task_comments` proposed; retention/delete behavior unknown |
| Files/attachments | Resource metadata, URL, placeholder upload, trash/star | Metadata and links; binary storage conditional; stars personal in `user_resource_preferences` |
| Reports/analytics | Derived portfolio stats/health | No separate reporting module committed; define authoritative metrics first |

## Data classification

- **Mock data:** `frontend/src/model.ts` `DEFAULT_DATA`: one workspace, five seeded people, memberships, three projects, six tasks, five meetings, seven resources. Treat as illustrative fixtures unless owner confirms otherwise.
- **Static configuration/UI constants:** exact enums in model: workspace roles currently `Admin|Member` (prototype; backend adds Owner), project status `In progress|In review|Complete`, task status `Backlog|To do|In progress|Dev completed|In review|Complete`, priority `Low|Medium|High`, progress mode `auto|manual`, resource type `Document|Spreadsheet|Design file|Folder|Link`; meeting type options are `Team sync|Review|Planning|Retrospective|Other` in editor.
- **Prototype placeholder:** selected `personaId` (`ava` default) is not authentication; file upload stores metadata, not binary; team filters have no team entity; UI workspace visibility `private|link` is deferred because MVP project reads are workspace-wide.
- **Local-only persisted state:** data aggregate, active workspace/persona/theme, read notification IDs, recent projects. Domain data must migrate to server if retained; prototype-data retention is UNKNOWN.
- **Functional prototype:** local CRUD, filters, exports/import, derived notifications/health, resource soft delete and task ordering are browser functionality, not shared server features.
