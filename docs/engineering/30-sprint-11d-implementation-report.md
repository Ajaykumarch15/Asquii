# 30 — Sprint 11d implementation report (people management + workspace settings, RLS lock-read fix)

## Summary

Sprint 11d added people management (member role change, member removal,
self-leave) and workspace settings (rename, archive) to the signed-in
workspace home, and fixed a real row-level-security regression discovered live
during verification. All work is on `frontend/integration`, verified in the
browser against the dev stack, and committed in three commits:

1. `3770ec6` — backend: relax RLS lock-read policies so member/invitee FOR UPDATE reads work
2. `1b55b29` — frontend people + workspace settings: role change, remove/leave, rename, archive
3. `38bf424` — frontend workspace settings: correct slug-stability copy

## Step 1 — API layer

- `frontend/src/lib/api/workspace.ts`: new `updateMemberRole`
  (`PATCH /workspaces/{wid}/members/{uid}/role`, body role `Admin|Member`),
  `removeMember` (`DELETE …/members/{uid}`, soft remove), and
  `archiveWorkspace`. The backend contract for archive is **POST**
  (`…/archive`, 204) — not DELETE — implemented with `apiPost`. A new
  `EditableWorkspaceRole` type documents that the endpoint only accepts
  Admin/Member; ownership moves through a separate transfer endpoint (UI
  deferred).

## Step 2 — Workspace home UI

- **People section** now follows the backend's exact gating, since the
  role endpoint is Owner-only server-side:
  - the Owner sees an inline role Select on Admin/Member rows (never on the
    Owner row) with optimistic update and rollback on failure;
  - the actor's own row shows "(you)" and a Leave action for Admin/Member
    roles — the Owner's own row shows neither (the service rejects leaving a
    workspace you own with 409);
  - non-owner remove buttons appear per service rules: the Owner may remove
    Admins and Members; an Admin may remove Members only.
  - Confirms state the exact consequence before acting; failures surface the
    backend's specific conflicts ("Remove this member from project rosters
    before workspace removal", "Transfer ownership before leaving the
    workspace") through `friendlyError`.
- **Workspace settings card**: rename form (Owner/Admin) and an
  Owner-only archive row. After archiving, `workspaceState.reload()` runs and
  the workspace drops out of the account's workspace list (there is no resume
  endpoint). Success and error notices also render on the first-run "create
  your first workspace" screen now, because that screen is shown right after
  archiving the only workspace or when an invite banner exists.
- Fixed a first-run-path crash/render gap found in verification: the invite
  accept banner and the notice now render for accounts with zero workspaces
  (previously only the workspace-selected view showed them). Derived
  constants were hoisted above the early returns to avoid a TDZ render crash
  (blank page caught as `document.body.innerText.length === 0`).
- Copy correction after live testing: the backend's rename endpoint
  (`update_workspace`) does **not** regenerate the workspace slug — the slug
  is set at creation (`_slug` with a uuid suffix) and stays stable. The hint
  and the rename success notice were corrected accordingly.

## Step 3 — RLS fix: UPDATE-policy USING on SELECT … FOR UPDATE

- Live verification of the invitation accept flow as a fresh invitee hit a
  404 ("Invitation is invalid or unavailable") even though every condition of
  that raise passed under a raw SQL replication as `asquii_app` with the
  invitee's claims. Root cause: **PostgreSQL applies the UPDATE policy's
  USING expression to the rows a `SELECT … FOR UPDATE` statement reads**
  (locking requires the update policy path). The 0004 UPDATE policies were
  written as if locking consulted only the SELECT policy.
- Consequences in real flows: the invitee's locked `Workspace` read in
  `accept_invitation` returned no row (bug found); a Member's self-leave
  (`remove_member` → `_get_workspace(lock=True)`) would have failed the same
  way; and every collaborator flow that locks the project row
  (`_project/_context lock=True` — create task/meeting/resource and friends)
  would 403 under the fresh-read path.
- New revision `0005_rls_lock_read_relaxations.py` (down_revision
  `0004_enable_rls_and_policies`, run with `DATABASE_MIGRATE_URL`):
  - `asquii_workspaces_update` USING widened to
    `has_workspace_role(Owner|Admin) OR is_workspace_member(id) OR
    email_has_pending_invitation(id, NULL)` — exactly the actors the SELECT
    policy already trusts, purely to model row locking;
  - `asquii_projects_update` USING widened to
    `can_manage_project(...) OR can_read_project(...)`;
  - **WITH CHECK is unchanged everywhere**, so actual UPDATE commands still
    require the original write authority: a member/invitee still cannot issue
    an UPDATE through RLS; the service layer remains the authoritative check.
  - Downgrade restores the 0004 expressions.
- Verified post-fix: the invitee's ORM `Workspace` read returned the row
  (previously `None`), and the live accept POST moved from 404 to 200.

## Runtime verification (live)

A real second Supabase account enabled true two-party flows:

- **Account bootstrap**: signed up `asquii-smoke-2@gmail.com` through the UI;
  Supabase email confirmation is enabled and no service key is available, so
  the user was confirmed directly via the admin connection
  (`auth.users.email_confirmed_at`, temp script, removed before commit). The
  ORM login then succeeded.
- **Invitation acceptance end-to-end** (previously an untested path):
  `POST /invitations/accept` 200 as the invitee — first-time join and, later,
  the removed-then-re-invited rejoin both succeeded, exercising the RLS
  rejoin UPDATE branch for a `removed_at` member in a real browser flow.
- **Member view** (`asquii-smoke-2@gmail.com`, Member): role select hidden,
  no Remove on others, Leave visible on the self row, workspace settings
  section absent, `GET …/invitations` 403 (Members are not admins).
- **Negative API checks as Member**: role change → 403 "Workspace Owner
  permission required"; DELETE targeting the Owner row → 404 "Workspace
  member not found" (concealed by RLS on the locked read — correct.
  documented below).
- **Role change as Owner**: select swap Member→Admin→Member, two `PATCH
  …/role` requests 200 with optimistic UI and success notices.
- **Self-leave**: confirm with exact wording, `DELETE …/members/{self}`
  204, workspace vanished from the account list, first-run screen with "You
  left …" notice.
- **Owner removal**: confirm, `DELETE …/members/{smoke-2}` 204, People (1).
- **Rename**: PATCH 200, name applied everywhere; renamed and renamed back.
- **Archive**: confirm with no-resume warning, POST 204, workspace left the
  list, "archived. Pending invitations were revoked." notice on the create
  screen. Restored via admin SQL (dev-only; no resume API), then the reload
  showed the workspace again with People (1).
- Backend tests: `69 passed, 15 skipped` (head-revision assertion updated to
  0005 plus structural assertions on the relaxation file).

## Known limitations / deferred

- The Member-side "Remove other member" negative path returns 404 rather
  than 403 because RLS hides the target's row on the locked read; the UI
  never offers that action, so this is a conservative (concealed) deny.
- Ownership transfer UI remains deferred (backend endpoint exists).
- Attendee management, notifications, and activities remain prototype-only
  until later slices.
- Dev-only operations used during verification: confirming the smoke-2 auth
  user via SQL (email confirmation is enabled; no service key), and
  un-archiving the smoke workspace via SQL (no resume endpoint). Both were
  one-off scripts, removed before commit.
