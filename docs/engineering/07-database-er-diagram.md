# 07 — Finalized proposed database ER diagram

Planning diagram; table names and relationships align with [06](06-database-design.md). `auth.users` is external Supabase identity ownership. Notification tables are conditional.

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : identifies
  WORKSPACES ||--|{ WORKSPACE_MEMBERS : includes_active_owner
  PROFILES ||--o{ WORKSPACE_MEMBERS : joins
  WORKSPACES ||--o{ WORKSPACE_INVITATIONS : invites
  WORKSPACE_MEMBERS ||--o{ WORKSPACE_INVITATIONS : invited_by
  WORKSPACES ||--o{ PROJECTS : contains
  PROJECTS ||--o{ PROJECT_MEMBERS : includes
  WORKSPACE_MEMBERS ||--o{ PROJECT_MEMBERS : eligible_member
  PROJECTS ||--o{ MILESTONES : tracks
  PROJECTS ||--o{ TASKS : contains
  PROJECT_MEMBERS o|--o{ TASKS : assignee
  TASKS ||--o{ TASK_SUBTASKS : breaks_down
  TASKS ||--o{ TASK_COMMENTS : discusses
  PROJECT_MEMBERS ||--o{ TASK_COMMENTS : author
  PROJECTS ||--o{ MEETINGS : schedules
  MEETINGS ||--o{ MEETING_ATTENDEES : includes
  PROJECT_MEMBERS ||--o{ MEETING_ATTENDEES : attendee
  PROJECTS ||--o{ RESOURCES : contains
  PROJECT_MEMBERS ||--o{ RESOURCES : owner
  PROFILES ||--o{ USER_RESOURCE_PREFERENCES : configures
  RESOURCES ||--o{ USER_RESOURCE_PREFERENCES : starred_by
  WORKSPACES ||--o{ ACTIVITY_LOGS : records
  PROFILES o|--o{ ACTIVITY_LOGS : actor
  WORKSPACE_MEMBERS ||--o{ NOTIFICATION_PREFERENCES : owns
  WORKSPACE_MEMBERS ||--o{ NOTIFICATIONS : receives
```

The project-member links to task assignee, comment author, meeting attendee, and resource owner all represent composite same-project membership FKs. Exactly one active workspace Owner is enforced transactionally; the relationship is stored in workspace_members and no owner_id exists on workspaces.
