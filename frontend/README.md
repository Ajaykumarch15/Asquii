# Asquii — Interactive Prototype

React + TypeScript + Vite + Tailwind prototype for the Asquii workspace and project UI.

## Run locally

```bash
npm install
npm run dev
```

## Included

- Responsive workspace and project navigation
- Workspace overview, projects, people, settings, project overview, Kanban, tasks, meetings, and resources screens
- Create and edit projects and tasks; assign project members and task owners; update task status across views
- Project and task search and status filters
- Global ⌘K / Ctrl+K command palette: search projects, tasks, and people, navigate to any page, run quick actions (create project/task/meeting/resource, switch theme, persona, or workspace), and jump to recently visited projects
- Notification menu with due-soon and overdue tasks for the signed-in persona plus pending invitations
- Expanded notification feed: overdue/due-soon tasks, meetings this week, milestones at risk or near, and fresh resources — each with kind icons, tone colors, unread dots, and deep links into the right project page
- Read/unread notification state kept per browser; mark individual items or everything read with one click
- Settings notification toggles actually filter the feed (task assignments, project updates, upcoming deadlines)
- Drag and drop tasks between Kanban columns, with overdue highlighting across task views
- Task ordering within Kanban columns; subtask checklists and comments on every task; inline due-date editing
- Project progress computed automatically from completed tasks, or set manually per project
- Multiple milestones per project with derived urgency (At risk / Near / Upcoming) and a portfolio milestone calendar
- Portfolio health rollup (on track / needs attention / at risk) computed from real due dates and review status
- Redesigned project Kanban page: one-line header with List/Board toggle and Add task, one-row search + All assignees / All labels / All priorities filters, columns with colored status dots and live counts, and reference-style cards with stable task keys, label chips, subtask progress, priority flags and assignee avatars (Done cards show a strikethrough title with a green completion check)
- Redesigned project Tasks page: one-line header with List/Board toggle, Export CSV and Add task buttons, five status KPI cards in one row, one-row search + Status / Priority / Assignee / Labels filters, per-row status pills with priority flags, avatar assignees, label chips and stable task keys (e.g. FF-118), bulk assign / status / priority / delete bar, and a numbered pager
- Redesigned meetings: schedule, edit, and delete meetings per project, with agenda, description, duration, type, participant chips, time, and attendee pick; upcoming and past views derived from real dates
- Redesigned Meetings page: one-line header with Export CSV + Schedule meeting, Calendar / Upcoming / History / My meetings tabs, a navigable month calendar with meeting chips and today highlight, colored upcoming-row rail with date chips and participant counts, and a Recent Meetings panel; card views for list tabs
- Redesigned Schedule meeting modal: title, description, date / time / duration row, participant chips with add/remove, and an optional agenda textarea
- Project overview's "Next meeting" card and meeting KPIs feed from live meeting data
- Editable project library: add, edit, and delete resources with type, category, owner, details, and optional links; relative last-updated dates
- Task list with sortable columns, pagination, multi-select bulk status updates, and CSV export
- Redesigned People page: KPI stat cards, member/invitations/roles tabs, workspace-role and project filters, multi-select bulk role changes, member CSV export, pagination, and a per-role access guide
- Redesigned project Resources page: one-line header with New folder / Add link / Upload / Add resource buttons, All resources / Files / Folders / Links / Starred / Trash tabs, one-row search + Category / Tags / Shared by / Type / Last modified filters with grid/list toggle, sortable name column, star pinning, size and tags fields, pagination, and a soft-delete Trash with restore or delete-forever, one-row search + Category / Tags / Shared by / Type / Last modified filters with grid/list toggle, sortable name column, star pinning, size and tags fields, pagination, and a soft-delete Trash with restore or delete-forever
- Invite with role, accept, or revoke preview invitations; guardrails stop demoting the last workspace admin
- Project health that is computed from overdue and in-review work instead of hardcoded copy
- Light and dark themes with a saved browser preference, including a visual theme picker in settings
- Browser-local persistence for prototype projects, tasks, people, and workspace settings
- Shared buttons, inputs, badges, avatars, dialogs, and empty, loading, and error state patterns

Project and task data is local to the browser and is not shared or synchronized. Meetings and the project resource library are stored and editable the same way. Authentication, backend APIs, and Figma integration are outside the current milestone.
