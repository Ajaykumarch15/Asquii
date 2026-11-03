# 03 — Screen-to-backend mapping (finalized policy)

The 11 screens remain UI state addresses, not URL routes. Policy: all active workspace members can read active projects and their content; non-project members are read-only. Owner/Admin override; project membership gives collaboration write access, with Project Manager-only controls for project settings and membership. Screen and source facts remain those in [02](02-frontend-screen-inventory.md).

| Screen/source | Data and UI interactions | API/data requirements and authorization |
|---|---|---|
| Workspace overview — `workspace/pages/OverviewPage.tsx` | Workspace portfolio, project health, tasks, milestones, workload; open/edit/create | Read all active workspace projects as Member; Owner/Admin create; only Owner/Admin or Project Manager edit project. |
| Projects — `workspace/pages/ProjectsPage.tsx` | Search/filter/sort/grid/list, CSV import/export, project create/edit/open | All workspace members read active projects. Owner/Admin create, with creator assigned Project Manager. Owner/Admin/Project Manager edit/archive. Team filter has no team entity and remains UI-only/future. |
| People — `workspace/pages/PeoplePage.tsx` | Directory, invitations, role changes, bulk role/export | All active members read directory; Owner/Admin manage roles/invitations. Invite accepts only Admin/Member; Owner transfer is a distinct operation. |
| Workspace settings — `workspace/pages/SettingsPage.tsx` | Workspace settings, member roles, theme, notification toggles | Owner/Admin change workspace settings/members; Member read-only to workspace controls. Theme remains local; preferences conditional/server only if chosen. Visibility control is unresolved/deferred under all-member project visibility. |
| Project overview — `projects/pages/OverviewPage.tsx` | Project metrics, task/milestone/meeting summaries, member display | Any workspace member reads active project; writers follow membership policy. Derived values computed server-side or consistently from child data. |
| Project people — `projects/pages/PeoplePage.tsx` | Project roster and member affordances | All workspace members may read roster; Owner/Admin or Project Manager manage membership; target must already be workspace member; exact project role. Every active project retains at least one Project Manager. |
| Project settings — `projects/pages/SettingsPage.tsx` | Project details/settings navigation | Read workspace-wide; update/archive only Owner/Admin or Project Manager. Archive is timestamp semantics. |
| Kanban — `projects/pages/KanbanPage.tsx` | Task columns, drag/drop and ordering, create/edit | Workspace-wide read; task writes require Owner/Admin or project membership; assignee must be project member; atomic reorder. |
| Tasks — `projects/pages/TasksPage.tsx` | Search/filter/sort/page/bulk status/delete/export | Same project access; validate each bulk task; assignment only project members; bounded server pagination. |
| Meetings — `projects/pages/MeetingsPage.tsx` | Calendar/list, create/edit/delete, attendees | Read all workspace active project meetings; writes Owner/Admin/project member; attendees must be project members. UTC instants; timezone input/display decision in DB design. |
| Resources — `projects/pages/ResourcesPage.tsx` | Metadata/link list, star/trash/restore/purge, upload affordance | Read workspace-wide; content writes Owner/Admin/project member; owner must project member; stars per-user; upload is metadata-only until storage approved. |
| Global shell — `AppShell`, `Header`, `Sidebar` | Switchers, preview persona, command palette, notifications/read state | Replace persona preview with Auth identity; projects list includes all active workspace projects; notification persistence conditional; activity backend-generated. |

Login, recovery and invite acceptance have no screens/routes today. Do not invent UI routes during backend work; frontend auth UX plan is a separate dependency. Teams, private projects, reports and binary uploads are future/conditional.

### Ownership, project-manager and lifecycle invariants

Workspace creation must commit the workspace and its initial Owner together. Ownership transfer locks the workspace, validates an active successor, swaps Owner/Admin roles in one transaction, and is protected by a deferred exactly-one-owner database check plus the partial unique index. Project creation similarly commits the project with its creator as Project Manager. Every active project must have at least one active Project Manager; replacing/removing the last one requires adding a replacement in the same transaction. Tests cover concurrent transfers, attempted owner removal, concurrent manager removals, project create without explicit member selection, and archive/restore.

Workspace archive revokes pending invitations, keeps membership and per-project archive timestamps intact, blocks all access until restore, and retains the slug. See ADR-012. Project archive remains independent. The current UI permits a project with no selected people, so the future API must assign the creator as Project Manager automatically.
