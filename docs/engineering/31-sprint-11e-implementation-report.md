# 31 — Sprint 11e implementation report (meeting attendees + activity feed)

## Summary

Sprint 11e added meeting attendee management and made the workspace activity
log live as the app's notification surface. No backend changes were required —
both endpoints already existed — so the sprint is a single frontend commit on
`frontend/integration` (`fb619d7`), verified in the browser against the dev
stack (FastAPI :8000, Vite :5173).

## Backend contract (recon confirmed, no code changes)

- Attendees live under
  `GET/POST/DELETE /workspaces/{wid}/projects/{pid}/meetings/{mid}/attendees[/{user_id}]`:
  - list returns `MeetingAttendeeResponse {user_id, display_name, created_at}`
    for any workspace member (plain read);
  - add expects `{user_id}`, returns 201 with the attendee row; the service
    gates it on `can_manage_settings` (Project Manager **or** workspace
    Owner/Admin), validates the user against active project members via
    `_validate_attendees` (422 "All attendees must be active members of this
    project" otherwise), and rejects duplicates with 409 "User is already an
    attendee";
  - remove (204) allows managers **or the attendee themselves**
    (`actor_id != user_id` requires `_require_manager`).
- Every add/remove writes `meeting.attendee_added` /
  `meeting.attendee_removed` activity records inside the same transaction.
- Activities: `GET /workspaces/{wid}/activities` (and the project-scoped
  equivalent) returns `ActivityPage {items, total, limit, offset}` with
  `ActivityResponse {id, workspace_id, project_id, actor_user_id,
  actor_display_name, action, resource_type (entity_type), resource_id,
  metadata, created_at}`; filters by project/actor/action/resource/date
  windows; sorts by `created_at|action|resource_type` asc|desc.
- **Design note:** the backend has no notifications table. The activity feed
  is the notification surface for now; the UI states this explicitly instead
  of pretending there is a per-person inbox.

## Step 1 — API layers

- `frontend/src/lib/api/projects.ts`: added `ApiMeetingAttendee`,
  `listAttendees` (GET), `addAttendee` (POST, documented 201/409/422 behavior),
  and `removeAttendee` (DELETE, 204, manager-or-self) to `projectsApi`.
- New `frontend/src/lib/api/activities.ts`: paged `listWorkspaceActivities`
  with the same optional filters the router accepts (project_id, actor_user_id,
  action, resource_type, limit, offset), plus `ApiActivity`/`ApiActivityPage`
  types and an `activityText` mapping from the ~39 backend action strings to
  readable copy ("added an attendee to a meeting", "removed a member from the
  workspace", …). Unknown actions fall back to a de-underscored rendering so
  new backend actions never show as empty text.

## Step 2 — Attendee UI (MeetingsPanel)

- Each meeting row gained an "Attendees" expand toggle. The attendee list is
  lazy-loaded on first expand (`attendeesByMeeting` cache keyed by meeting id,
  invalidated on project change, workspace/project reload, or meeting delete),
  with its own loading/error/ready state and a Retry that refetches.
- **Add**: a Select listing active project members not already attending
  (`workspace_member_active && !attendeeIds.has(u)`), visible only when
  `canManageMeetings` — mirroring the backend rule Project Manager OR
  workspace Owner/Admin (parent computes it from
  `project.current_user_role` + `workspace.role`; the old `isManager` alone
  under-counts for workspace Owner/Admin without a project-manager role).
- **Remove**: a per-chip "Leave" (self) or "Remove" (manager on others)
  button; hidden while the project is archived (the backend 409s there).
- Optimistic updates follow the established rollback pattern: add inserts an
  optimistic chip ordered by display name and swaps in the server's row on
  201; remove drops the chip and decrements `attendee_count` immediately, with
  failures resyncing via `listAttendees` re-fetch plus `friendlyError`.
- The placeholder "Attendee management comes in a later slice." footer was
  replaced with the actual rule copy (attendees must be project members;
  managers manage, everyone can leave).
- `identityUserId` is now threaded `App.tsx → RealProjectDetailPage →
  MeetingsPanel` for self-removal detection. The stale file header comment
  ("meetings/resources remain prototype-only") was corrected.

## Step 3 — Activity feed UI (RealWorkspaceHome)

- New "Recent activity" section on the workspace overview, fed by
  `GET /workspaces/{wid}/activities?limit=8` alongside members/invitations in
  the existing single-effect load (with independent error handling, so a feed
  outage degrades to a notice rather than breaking the page).
- Rows: actor display name (falls back to "Someone"), mapped action copy,
  short timestamp, a neutral `resource_type` badge, and a "System" tag for
  actor-less records. A header badge shows "Newest N of total".
- **Load more** paging by explicit button: `offset = items.length`,
  appends the next page, remaining count shown on the button.
- Mutations that emit activities (invite create/revoke, role change, rename)
  now bump the panel-wide `reloadToken` so the feed includes the actor's own
  action right away; self-leave/removal flush already reloads via workspace
  state. An in-panel footnote states the feed is the notification surface and
  there is no separate per-person inbox yet.

## Runtime verification (live browser, owner account 1521ajay)

- Workspace overview: "Recent activity" renders real records (rename, member
  removal, invitation accept/revoke, archive events from sprint 11d) with
  mapped copy; total 35 events, Load more pages 8 → 16 (remaining count
  correct).
- Project detail → Meetings: expand "Sprint check-in" → empty state plus the
  add row (only project member 1521ajay offered). Add → notice `1521ajay
  added to "Sprint check-in"`, attendee chip with "(you)" + Leave, count
  0 → 1, select switches to "No members left to add" (single project member,
  already attending — correct).
- Self-removal: confirm dialog, chip disappears, notice `You left "Sprint
  check-in"`, count back to 0 — DELETE 204 on the self path (no manager
  escalation needed, matching the service rule).
- Activity trail: back on the overview, the feed's two newest entries are
  exactly `added an attendee to a meeting` and `removed an attendee from a
  meeting` (Nov 6 12:48 PM, `meeting` resource badge).
- Backend sanity: `alembic current` = `0005_rls_lock_read_relaxations (head)`
  unchanged; pytest `69 passed, 15 skipped` (baseline intact; only test
  suite unchanged since no backend edits).
- `npx tsc --noEmit` clean (the repo's only static gate; no eslint config).

## Known limitations / deferred

- No per-person inbox, no read state, and no bell integration in real mode —
  the prototype's Header notification dropdown remains demo-mode only. A
  notifications surface beyond the feed needs a backend design (unread
  cursor or notifications table).
- Workspace admins who are neither project members appear in the add
  attendee select only if they are project members — matching
  `_validate_attendees` (backend requires attendee ∈ project members), even
  though a workspace-admin *actor* is allowed to manage meetings.
- Meeting create/update still does not expose `attendee_user_ids` /
  `agenda` in the schedule form (list-first slice update flows remain
  deferred), and the workspace home Projects section is still a stub
  EmptyState; both stay with later slices.
- Project-scoped activity feed client and filters (action/resource/date) are
  typed but not yet surfaced in the UI; only the page-level parameters are
  used today.
