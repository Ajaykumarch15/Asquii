# 02 — Frontend screen inventory

## Routing model

Verified: no URL router or named URL routes. `App.tsx` keeps `scope` (`workspace`/`project`) and `active` page strings in React state. Navigation is provided by `Sidebar`, `Header`, command palette and callbacks. A reload returns to initial page state; selected workspace/persona/theme have local persistence. Thus route column below is a UI state address, not a URL.

| Screen | Source | UI route/state | Major components and data |
|---|---|---|---|
| Workspace overview | `frontend/src/modules/workspace/pages/OverviewPage.tsx` | workspace / Overview | Portfolio/project health, milestones, tasks, people; role/personalized view |
| Workspace projects | `.../workspace/pages/ProjectsPage.tsx` | workspace / Projects | Search, filters, sorting, grid/list, CSV import/export, project cards/rows |
| Workspace people | `.../workspace/pages/PeoplePage.tsx` | workspace / People | Members, invitations, roles, filtering, bulk role updates, CSV export |
| Workspace settings | `.../workspace/pages/SettingsPage.tsx` | workspace / Settings | General details, member roles, appearance, notification preferences |
| Project overview | `.../projects/pages/OverviewPage.tsx` | project / Overview | Project progress, tasks, meetings, milestones, members |
| Project people | `.../projects/pages/PeoplePage.tsx` | project / People | Project member listing/management affordances |
| Project settings | `.../projects/pages/SettingsPage.tsx` | project / Settings | Project summary and navigation/settings affordances |
| Kanban | `.../projects/pages/KanbanPage.tsx` | project / Kanban | Status columns, drag/drop/reorder, task edits and creation |
| Tasks | `.../projects/pages/TasksPage.tsx` | project / Tasks | Search/filter/sort/pagination, bulk edits, CSV export, task editor |
| Meetings | `.../projects/pages/MeetingsPage.tsx` | project / Meetings | Calendar/upcoming/history/my meetings, create/edit/delete, CSV export |
| Resources | `.../projects/pages/ResourcesPage.tsx` | project / Resources | Search/filter/grid-list/sort/pages, star/trash/restore/purge, metadata links |

## Shell and navigation

`AppShell.tsx` composes `Header.tsx` and `Sidebar.tsx`. Workspace and project navigation are separate scopes. Header provides workspace/project/persona switchers, quick create, command palette, notification feed/read state, and theme toggle. Persona switcher is a preview tool. `WorkspaceEditor.tsx` handles workspace creation. `ProjectEditors.tsx` contains modal forms for project, task, meeting, and resource operations; modal is a local form/dialog component. Project settings/member editing is mediated by page callbacks and app state.

## Forms and inputs

Observed forms include workspace editor; project editor (name, description, status, progress mode/value, milestone dates, member IDs); task editor (title, description, labels, status, priority, assignee, project, due date, subtasks, comments); meeting editor (title, description, date/time/duration/type, project, participants, agenda); resource editor (name, type/category, owner/details/URL/size/tags); workspace settings (name, URL, visibility); invitations (email/role); role selectors; search/filter controls; CSV file input. Input validation is primarily HTML required fields and local checks. No shared schema validation package exists.

## UI states and caveats

Reusable `EmptyState`, `LoadingState`, `ErrorState`, and `StateMessage` exist. Network loading/error states are not evidence of a network integration. Data mostly renders immediately from localStorage/default fixtures. CSV import can fail or duplicate-filter locally; no server pagination or server search. No login, password reset, email verification, or session screen exists. Do not invent URL paths from page labels.
