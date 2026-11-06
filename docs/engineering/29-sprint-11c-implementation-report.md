# 29 — Sprint 11c implementation report (project detail depth, invitations UI, RLS enablement)

## Summary

Sprint 11c completed the user's ordered follow-up to the 11b integration:
project detail surfaces (slice-by-slice), the invitations UI, and row level
security enablement on the live database. All work is on `frontend/integration`,
verified against the running dev stack (`asquii_app` runtime role throughout),
and committed in four feature commits:

1. `c9e4431` — frontend project detail: real tasks, members, milestones on project-scoped APIs
2. `e362e18` — frontend project detail depth: task drawer (subtasks, comments), meetings, resources
3. `a4e9d52` — frontend invitations UI: create/revoke admin flow, token sharing, accept banner, error detail mapping
4. `50302ff` — backend: enable row level security with fail-closed policies for asquii_app

## Step 1 — Project detail core

- `frontend/src/lib/api/projects.ts` grew: `getProject`, `renameProject`,
  `listProjectMembers`, `listMilestones`, `createMilestone`, `listTasks`
  (status/priority/limit filters), `createTask` (title/description/status/
  priority/due/assignee), `updateTask`, `deleteTask`. Types mirror the backend
  contract; Pydantic serializes task `position`/Decimal as JSON strings, so
  `position` is typed `string`.
- `frontend/src/lib/api/client.ts`: new `apiDelete` helper (204 with no body).
- `frontend/src/components/RealProjectDetailPage.tsx` (new): transient drill-down
  reached by clicking a project card. Tabs: Tasks / Members / Milestones.
  Members: any project member ("collaborator") may create tasks and change task
  status; only "Project Manager" (or workspace admin mapped through the API's
  role derivation) may delete tasks and manage milestones — mirroring the
  backend's `can_collaborate` / `_require_manager` gating.
- `frontend/src/App.tsx`: new `realProjectId` App state; clicking a card sets it
  and renders the detail view; it is cleared when `active` changes or the
  workspace selection changes.

## Step 2 — Detail depth (subtasks, comments, meetings, resources)

- `projects.ts` extended with `getTaskDetail` (adds subtask counters),
  subtask CRUD (`listSubtasks`, `createSubtask`, `updateSubtask`,
  `deleteSubtask`), comments (`listComments`, `createComment`,
  `deleteComment`; `body` becomes null on soft delete), meetings
  (`listMeetings`, `createMeeting`, `deleteMeeting`; client sends an ISO
  instant from `datetime-local`), and resources (`listResources`, `createResource`,
  `toggleResourceStar` via PUT, `deleteResource`). `client.ts` gained `apiPut`.
- Task rows expand into a drawer (`TaskDrawer`) showing description, subtasks
  with an optimistic done-toggle and done counter, and comments with post and
  delete. Failed optimistic operations roll back local state (or force a
  refetch on the delete paths).
- `MeetingsPanel`: schedule form (title, start datetime-local → ISO, duration,
  type, description), list sorted by start time, manager/organizer delete via
  the same `RequirePermissionException`-free contract (api returns 204).
- `ResourcesPanel`: create form (name, type, category, optional URL/detail),
  star toggle with optimistic rollback, list sorted starred-first then
  recently-updated, soft delete.

## Step 3 — Invitations UI

- `workspace.ts` grew `listInvitations`, `createInvitation`, `revokeInvitation`,
  `acceptInvitation` (`POST /invitations/accept`).
- `RealWorkspaceHome.tsx`: admin-gated (Owner/Admin) invitations section —
  create form (email + role), status badges (pending/accepted/expired/revoked),
  created/expires dates, per-invitation revoke with optimistic status flip and
  refetch on failure, and a pending-count badge in the identity card.
- Creation response includes the **raw token** (7-day TTL; email delivery is not
  wired), surfaced in a copy box with a Copy button and instructions
  (`?invite=<token>`).
- Accept flow: `readInviteToken()` reads the `?invite=` URL param and renders an
  accept banner; `acceptInvitation` posts the token, clears the param via
  `history.replaceState`, and refreshes workspaces. Additive error messaging
  shows the backend's specific conflicts ("User is already a workspace member",
  "Invitation is invalid or unavailable").
- Client bug fixed: `detailToMessage` in `client.ts` now reads the backend
  middleware shape `{"error": {"code", "message"}}`
  (backend/app/core/exceptions.py) in addition to FastAPI's `{"detail"}`;
  before this all HTTPException-driven errors degraded to the generic
  "Request rejected".

## Step 4 — Row level security enablement

- New revision `backend/alembic/versions/0004_enable_rls_and_policies.py`
  (down_revision `0003_lifecycle_hardening`), run with `DATABASE_MIGRATE_URL`
  (admin `postgres`).
- Deviation from the review drafts (docs/supabase/04, 05), documented in the
  migration docstring:
  - Policies are `TO asquii_app`, keyed on `private.current_actor()` reading
    the `request.jwt.claim.sub` GUC that `get_db` sets per transaction, instead
    of the drafts' Data-API `authenticated` role with `auth.uid()` (this
    runtime cannot read the `auth` schema).
  - `private.current_actor_email()` parses `request.jwt.claims` for `email`.
    To support it, `session.get_db` now includes the verified `email` claim in
    the transaction-local claims dict (omitted entirely when the token has no
    email). One test updated to match (`tests/test_database.py`), plus the
    head-revision assertion in `tests/test_migrations.py`.
  - Helpers are owned by `postgres` (tables are owned by postgres here, not
    `asquii_owner`), all `SECURITY DEFINER` with `SET search_path = ''` and
    `SET row_security = 'off'` to make policy recursion impossible.
  - Enrollment-path adaptations the drafts would have made impossible:
    - `workspace_members` INSERT allows self enrollment only as Owner of a
      workspace with zero members (creation bootstrap, enforced via a
      `SECURITY DEFINER` member count so RLS hiding cannot fake emptiness) or
      through an unexpired/unaccepted/unrevoked invitation matching the
      verified email and role (acceptance).
    - `workspace_members` UPDATE allows admins (draft parity), the actor's own
      soft-leave (`remove_member` sets `removed_at`), and self rejoin from a
      `removed_at` row through a matching pending invitation. `USING` gates the
      pre-update row; `WITH CHECK` the post-update row (PostgreSQL policy
      expressions do not support `OLD.` / `NEW.` qualifiers).
    - `workspaces` SELECT gains an invitation-holder branch (the acceptance
      flow reads the workspace row before membership exists).
    - `workspace_invitations` UPDATE gains the invitee-email branch so
      acceptance can set `accepted_at`.
    - `activity_logs` gains an INSERT policy (`actor_user_id = current_actor()`
      and remaining a member) — every service mutation writes an activity row,
      so the draft's write-denied stance would have failed every API mutation.
  - Members see their own (even `removed_at`) membership rows in SELECT; the
    drafts' deny would have turned rejoin into a silent stale-path.
  - No DELETE policies for comments/resources/invitations (API deletes are
    soft); no table/column grant rework (that remains the drafts' follow-up).
- Enabled RLS on all 15 application tables; 51 policies installed. Downgrade
  drops policies, disables RLS, and removes the `private` schema.

## Runtime verification (live)

- Full browser flow as `1521ajay@gmail.com` / Owner through `asquii_app` with
  RLS on: workspace home (members, invitations list), projects, detail tabs
  Tasks/Meetings/Resources/Members/Milestones, task create 201, subtask create
  201 + toggle 200, comment post 201 + delete 204, meeting create 201, resource
  create 201 + star PUT 200, milestone create 201, invitation create 201,
  invitations revoke 204, invitations accept conflict 409 with the specific
  message after the error-mapping fix.
- Fail-closed check connecting as `asquii_app` (replicated with/without the
  backend GUCs): without GUCs every table returns 0 rows; with the Owner's
  verified claims the member-visible counts match live data
  (workspaces=1, members=1, invitations=2, projects=1, task=1, activities,
  resources, meetings). The scripts used for this were removed before commit.
- Persistence verified across a backend restart (task, subtask 1/1 done,
  comment, meeting, starred resource, milestone) and browser reloads.
- All read/write flows under RLS produced identical status codes to the
  pre-RLS trail; nothing regressed.
- Backend tests: `69 passed, 15 skipped`.

## Known limitations / deferred

- Invitation acceptance via a real second account (fresh email accepting and
  appearing as a Member) remains untested end-to-end; the conflict branch
  already verified proves the token/email path reaches the service.
- RLS is defense-in-depth only: `current_actor()` reads a client-set GUC, so a
  principal holding `asquii_app` credentials could spoof identity with
  `set_config` while bypassing the API. Enforcing the service layer's checks
  would require `FORCE ROW LEVEL SECURITY` plus a trusted identity boundary —
  deferred with the drafts' follow-up list (column grants, token_hash
  tightening, trusted activity writes).
- Attendee management UI (add/remove meeting attendees), member role
  management, workspace rename/archive UI, notifications, and activities pages
  remain prototype-only until later slices.
- `asquii-smoke-2@gmail.com` Supabase Auth user can be deleted; the pending
  invitation for it stays until revoked or expired.
