# 07 — MVP database ER diagram

Implemented table names and relationships align with [06](06-database-design.md) and Alembic revision `0002_mvp_schema`. `auth.users` remains external Supabase identity ownership. Conditional notification tables are not part of this schema.

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
  WORKSPACE_MEMBERS o|--o{ ACTIVITY_LOGS : actor
```

The project-member links to task assignee, comment author, meeting attendee, and resource owner represent composite same-project membership FKs. Project and child rows also carry workspace context where needed for composite tenant constraints. Exactly one active workspace Owner is checked transactionally; the relationship is stored in `workspace_members`, and `workspaces` has no `owner_id`. Deferred database triggers enforce the Owner and Project Manager minimum-count invariants at transaction end.
