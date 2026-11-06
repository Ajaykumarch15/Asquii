"""Enable row level security with fail-closed policies for the runtime role.

Revision ID: 0004_enable_rls_and_policies
Revises: 0003_lifecycle_hardening
Create Date: 2026-11-05

Adapted from the review drafts docs/supabase/04_enable_rls.sql and
05_rls_policies.sql. Deviations from the drafts are intentional and
documented below.

Runtime identity: the drafts target the Supabase Data API role
"authenticated" with auth.uid(). This deployment connects as "asquii_app",
which cannot read the auth schema, so policies are TO asquii_app and
identity comes from the transaction-local GUCs the backend sets in
app.database.session (request.jwt.claim.sub plus request.jwt.claims with an
email entry, both verified JWT claims only).

Helper ownership: the drafts require helpers owned by "asquii_owner". All 15
tables are owned by postgres on this deployment, so the SECURITY DEFINER
helpers are owned by postgres (the migration role) instead. They set
row_security = off to avoid policy recursion and always qualify public.

Known enrollment-path adaptations (service flows in
app.workspaces.service that the drafts would make impossible):

- workspace_members INSERT allows the actor to bootstrap themselves as the
  Owner of a workspace that has zero members (workspace creation), and to
  enroll themselves through an unexpired, unrevoked, unaccepted invitation
  matching their verified email and role (invitation acceptance).
- workspace_members UPDATE allows admins (draft parity), the actor's own
  soft-leave (remove_member sets removed_at), and self rejoin from a
  removed_at row through a matching pending invitation.
- workspaces SELECT is additionally allowed while a pending unexpired
  invitation matches the actor email, which is the row read the acceptance
  flow performs before membership exists.
- workspace_invitations UPDATE additionally allows the invitee whose
  verified email matches email_normalized, so acceptance can set
  accepted_at.
- activity_logs gains an INSERT policy (actor_user_id equals the verified
  actor and remains a workspace member); every service mutation writes an
  activity row, so the draft's write-denied stance would fail every API
  mutation.

Deliberately omitted: DELETE policies for task_comments, resources, and
workspace_invitations (API deletes are soft updates setting a timestamp).
Also omitted: table/column grant rework; asquii_app holds full DML grants
from 0002_mvp_schema and the ORM reads token_hash, matching the draft's
follow-up stance (a future revision should narrow those grants).

Defense-in-depth caveat: current_actor() reads a client-set GUC. A
credentialed DB principal could spoof identity via set_config; RLS here is
defense-in-depth behind the service layer's checks (fail-closed when the
backend does not propagate identity), not protection against holders of
asquii_app credentials.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004_enable_rls_and_policies"
down_revision: str | None = "0003_lifecycle_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_TABLES = (
    "profiles",
    "workspaces",
    "workspace_members",
    "workspace_invitations",
    "projects",
    "project_members",
    "milestones",
    "tasks",
    "task_subtasks",
    "task_comments",
    "meetings",
    "meeting_attendees",
    "resources",
    "user_resource_preferences",
    "activity_logs",
)

HELPER_KEYS = (
    "current_actor",
    "current_actor_email",
    "workspace_member_count",
    "is_workspace_member",
    "is_active_project",
    "has_workspace_role",
    "can_read_project",
    "can_collaborate",
    "can_manage_project",
    "shares_workspace",
    "can_read_task",
    "can_read_resource",
    "email_has_pending_invitation",
)

HELPER_BODIES = {
    "current_actor": """
        CREATE OR REPLACE FUNCTION private.current_actor()
        RETURNS uuid
        LANGUAGE sql STABLE
        AS $body$
            SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $body$;
    """,
    "current_actor_email": """
        CREATE OR REPLACE FUNCTION private.current_actor_email()
        RETURNS text
        LANGUAGE sql STABLE
        AS $body$
            SELECT lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
        $body$;
    """,
    "workspace_member_count": """
        CREATE OR REPLACE FUNCTION private.workspace_member_count(p_workspace_id uuid)
        RETURNS integer
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT count(*)::integer FROM public.workspace_members wm
            WHERE wm.workspace_id = p_workspace_id
        $body$;
    """,
    "is_workspace_member": """
        CREATE OR REPLACE FUNCTION private.is_workspace_member(p_workspace_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.workspace_members wm
                JOIN public.workspaces w ON w.id = wm.workspace_id
                WHERE wm.workspace_id = p_workspace_id
                  AND wm.user_id = private.current_actor()
                  AND wm.removed_at IS NULL
                  AND w.archived_at IS NULL
            )
        $body$;
    """,
    "is_active_project": """
        CREATE OR REPLACE FUNCTION private.is_active_project(p_workspace_id uuid, p_project_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.projects p
                JOIN public.workspaces w ON w.id = p.workspace_id
                WHERE p.id = p_project_id
                  AND p.workspace_id = p_workspace_id
                  AND p.archived_at IS NULL
                  AND w.archived_at IS NULL
                  AND private.is_workspace_member(p_workspace_id)
            )
        $body$;
    """,
    "has_workspace_role": """
        CREATE OR REPLACE FUNCTION private.has_workspace_role(p_workspace_id uuid, p_roles text[])
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.workspace_members wm
                JOIN public.workspaces w ON w.id = wm.workspace_id
                WHERE wm.workspace_id = p_workspace_id
                  AND wm.user_id = private.current_actor()
                  AND wm.removed_at IS NULL
                  AND w.archived_at IS NULL
                  AND wm.role = ANY (p_roles)
            )
        $body$;
    """,
    "can_read_project": """
        CREATE OR REPLACE FUNCTION private.can_read_project(p_workspace_id uuid, p_project_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.projects p
                JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
                JOIN public.workspaces w ON w.id = wm.workspace_id
                WHERE p.id = p_project_id
                  AND p.workspace_id = p_workspace_id
                  AND p.archived_at IS NULL
                  AND wm.user_id = private.current_actor()
                  AND wm.removed_at IS NULL
                  AND w.archived_at IS NULL
            )
        $body$;
    """,
    "can_collaborate": """
        CREATE OR REPLACE FUNCTION private.can_collaborate(p_workspace_id uuid, p_project_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT private.is_active_project(p_workspace_id, p_project_id)
               AND (
                private.has_workspace_role(p_workspace_id, ARRAY['Owner', 'Admin'])
                OR EXISTS (
                    SELECT 1 FROM public.project_members pm
                    JOIN public.workspace_members wm
                      ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id
                    WHERE pm.workspace_id = p_workspace_id
                      AND pm.project_id = p_project_id
                      AND pm.user_id = private.current_actor()
                      AND wm.removed_at IS NULL
                ))
        $body$;
    """,
    "can_manage_project": """
        CREATE OR REPLACE FUNCTION private.can_manage_project(p_workspace_id uuid, p_project_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT private.is_active_project(p_workspace_id, p_project_id)
               AND (
                private.has_workspace_role(p_workspace_id, ARRAY['Owner', 'Admin'])
                OR EXISTS (
                    SELECT 1 FROM public.project_members pm
                    JOIN public.workspace_members wm
                      ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id
                    WHERE pm.workspace_id = p_workspace_id
                      AND pm.project_id = p_project_id
                      AND pm.user_id = private.current_actor()
                      AND pm.role = 'Project Manager'
                      AND wm.removed_at IS NULL
                ))
        $body$;
    """,
    "shares_workspace": """
        CREATE OR REPLACE FUNCTION private.shares_workspace(p_other_user_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1
                FROM public.workspace_members mine
                JOIN public.workspace_members theirs
                  ON theirs.workspace_id = mine.workspace_id
                JOIN public.workspaces w ON w.id = mine.workspace_id
                WHERE mine.user_id = private.current_actor()
                  AND mine.removed_at IS NULL
                  AND theirs.user_id = p_other_user_id
                  AND theirs.removed_at IS NULL
                  AND w.archived_at IS NULL
            )
        $body$;
    """,
    "can_read_task": """
        CREATE OR REPLACE FUNCTION private.can_read_task(p_task_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.tasks t
                WHERE t.id = p_task_id
                  AND private.can_read_project(t.workspace_id, t.project_id)
            )
        $body$;
    """,
    "can_read_resource": """
        CREATE OR REPLACE FUNCTION private.can_read_resource(p_resource_id uuid)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.resources r
                WHERE r.id = p_resource_id
                  AND r.deleted_at IS NULL
                  AND private.can_read_project(r.workspace_id, r.project_id)
            )
        $body$;
    """,
    "email_has_pending_invitation": """
        CREATE OR REPLACE FUNCTION private.email_has_pending_invitation(p_workspace_id uuid, p_role text)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = '' SET row_security = 'off'
        AS $body$
            SELECT EXISTS (
                SELECT 1 FROM public.workspace_invitations inv
                WHERE inv.workspace_id = p_workspace_id
                  AND lower(inv.email_normalized) = private.current_actor_email()
                  AND inv.accepted_at IS NULL
                  AND inv.revoked_at IS NULL
                  AND inv.expires_at > now()
                  AND (p_role IS NULL OR inv.role = p_role)
            )
        $body$;
    """,
}

POLICIES = {
    "profiles": (
        ("asquii_profiles_select", "SELECT",
         "user_id = private.current_actor() OR private.shares_workspace(user_id)", None),
        ("asquii_profiles_insert", "INSERT", None,
         "user_id = private.current_actor()"),
        ("asquii_profiles_update", "UPDATE",
         "user_id = private.current_actor()", "user_id = private.current_actor()"),
    ),
    "workspaces": (
        ("asquii_workspaces_select", "SELECT",
         "private.is_workspace_member(id) OR private.email_has_pending_invitation(id, NULL)", None),
        ("asquii_workspaces_insert", "INSERT", None,
         "private.current_actor() IS NOT NULL"),
        ("asquii_workspaces_update", "UPDATE",
         "private.has_workspace_role(id, ARRAY['Owner', 'Admin'])",
         "private.has_workspace_role(id, ARRAY['Owner', 'Admin'])"),
    ),
    "workspace_members": (
        ("asquii_workspace_members_select", "SELECT",
         "private.is_workspace_member(workspace_id) OR user_id = private.current_actor()", None),
        ("asquii_workspace_members_insert", "INSERT", None,
         "user_id = private.current_actor() AND ((role = 'Owner' AND private.workspace_member_count(workspace_id) = 0) OR private.email_has_pending_invitation(workspace_id, role))"),
        ("asquii_workspace_members_update", "UPDATE",
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']) OR (user_id = private.current_actor() AND (removed_at IS NULL OR private.email_has_pending_invitation(workspace_id, NULL)))",
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']) OR (user_id = private.current_actor() AND (removed_at IS NOT NULL OR (removed_at IS NULL AND private.email_has_pending_invitation(workspace_id, role))))"),
    ),
    "workspace_invitations": (
        ("asquii_invitations_select", "SELECT",
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']) OR lower(email_normalized) = private.current_actor_email()", None),
        ("asquii_invitations_insert", "INSERT", None,
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin'])"),
        ("asquii_invitations_update", "UPDATE",
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']) OR lower(email_normalized) = private.current_actor_email()",
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']) OR lower(email_normalized) = private.current_actor_email()"),
    ),
    "projects": (
        ("asquii_projects_select", "SELECT",
         "private.can_read_project(workspace_id, id)", None),
        ("asquii_projects_insert", "INSERT", None,
         "private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin'])"),
        ("asquii_projects_update", "UPDATE",
         "private.can_manage_project(workspace_id, id)",
         "private.can_manage_project(workspace_id, id)"),
    ),
    "project_members": (
        ("asquii_project_members_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_project_members_insert", "INSERT", None,
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_project_members_update", "UPDATE",
         "private.can_manage_project(workspace_id, project_id)",
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_project_members_delete", "DELETE",
         "private.can_manage_project(workspace_id, project_id) OR (user_id = private.current_actor() AND private.can_collaborate(workspace_id, project_id))", None),
    ),
    "milestones": (
        ("asquii_milestones_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_milestones_insert", "INSERT", None,
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_milestones_update", "UPDATE",
         "private.can_manage_project(workspace_id, project_id)",
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_milestones_delete", "DELETE",
         "private.can_manage_project(workspace_id, project_id)", None),
    ),
    "tasks": (
        ("asquii_tasks_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_tasks_insert", "INSERT", None,
         "private.can_collaborate(workspace_id, project_id)"),
        ("asquii_tasks_update", "UPDATE",
         "private.can_collaborate(workspace_id, project_id)",
         "private.can_collaborate(workspace_id, project_id)"),
        ("asquii_tasks_delete", "DELETE",
         "private.can_manage_project(workspace_id, project_id)", None),
    ),
    "task_subtasks": (
        ("asquii_task_subtasks_select", "SELECT",
         "private.can_read_task(task_id)", None),
        ("asquii_task_subtasks_insert", "INSERT", None,
         "EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND private.can_collaborate(t.workspace_id, t.project_id))"),
        ("asquii_task_subtasks_update", "UPDATE",
         "EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND private.can_collaborate(t.workspace_id, t.project_id))",
         "EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND private.can_collaborate(t.workspace_id, t.project_id))"),
        ("asquii_task_subtasks_delete", "DELETE",
         "EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND private.can_collaborate(t.workspace_id, t.project_id))", None),
    ),
    "task_comments": (
        ("asquii_task_comments_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_task_comments_insert", "INSERT", None,
         "author_user_id = private.current_actor() AND private.can_collaborate(workspace_id, project_id)"),
        ("asquii_task_comments_update", "UPDATE",
         "private.can_collaborate(workspace_id, project_id) AND (author_user_id = private.current_actor() OR private.can_manage_project(workspace_id, project_id))",
         "private.can_collaborate(workspace_id, project_id) AND (author_user_id = private.current_actor() OR private.can_manage_project(workspace_id, project_id))"),
    ),
    "meetings": (
        ("asquii_meetings_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_meetings_insert", "INSERT", None,
         "private.can_collaborate(workspace_id, project_id)"),
        ("asquii_meetings_update", "UPDATE",
         "private.can_manage_project(workspace_id, project_id)",
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_meetings_delete", "DELETE",
         "private.can_manage_project(workspace_id, project_id)", None),
    ),
    "meeting_attendees": (
        ("asquii_meeting_attendees_select", "SELECT",
         "private.can_read_project(workspace_id, project_id)", None),
        ("asquii_meeting_attendees_insert", "INSERT", None,
         "private.can_manage_project(workspace_id, project_id)"),
        ("asquii_meeting_attendees_delete", "DELETE",
         "private.can_manage_project(workspace_id, project_id) OR (user_id = private.current_actor() AND private.can_collaborate(workspace_id, project_id))", None),
    ),
    "resources": (
        ("asquii_resources_select", "SELECT",
         "deleted_at IS NULL AND private.can_read_project(workspace_id, project_id)", None),
        ("asquii_resources_insert", "INSERT", None,
         "owner_user_id = private.current_actor() AND private.can_collaborate(workspace_id, project_id)"),
        ("asquii_resources_update", "UPDATE",
         "owner_user_id = private.current_actor() OR private.can_manage_project(workspace_id, project_id)",
         "private.can_collaborate(workspace_id, project_id)"),
    ),
    "user_resource_preferences": (
        ("asquii_resource_preferences_select", "SELECT",
         "user_id = private.current_actor() AND private.can_read_resource(resource_id)", None),
        ("asquii_resource_preferences_insert", "INSERT", None,
         "user_id = private.current_actor() AND private.can_read_resource(resource_id)"),
        ("asquii_resource_preferences_update", "UPDATE",
         "user_id = private.current_actor() AND private.can_read_resource(resource_id)",
         "user_id = private.current_actor() AND private.can_read_resource(resource_id)"),
        ("asquii_resource_preferences_delete", "DELETE",
         "user_id = private.current_actor() AND private.can_read_resource(resource_id)", None),
    ),
    "activity_logs": (
        ("asquii_activity_logs_select", "SELECT",
         "private.is_workspace_member(workspace_id)", None),
        ("asquii_activity_logs_insert", "INSERT", None,
         "actor_user_id = private.current_actor() AND private.is_workspace_member(workspace_id)"),
    ),
}


def _build_policy_sql(table: str, entry: tuple[str, str, str | None, str | None]) -> str:
    name, action, using, check = entry
    command = f"CREATE POLICY {name} ON public.{table} FOR {action} TO asquii_app "
    if using is not None:
        command += f"USING ({using}) "
    if check is not None:
        command += f"WITH CHECK ({check})"
    return command.rstrip()


def upgrade() -> None:
    """Create helpers, enable RLS, and install fail-closed policies."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    op.execute(
        "DO $audit$\n"
        "BEGIN\n"
        "    IF current_user <> 'postgres' THEN\n"
        "        RAISE EXCEPTION 'Migration 0004 must run as the postgres table owner'\n"
        "            USING DETAIL = 'Current migration role: ' || current_user,\n"
        "                  HINT = 'Run alembic with DATABASE_MIGRATE_URL';\n"
        "    END IF;\n"
        "    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'asquii_app') THEN\n"
        "        RAISE EXCEPTION 'Runtime role asquii_app does not exist';\n"
        "    END IF;\n"
        "END;\n"
        "$audit$;"
    )

    op.execute("CREATE SCHEMA IF NOT EXISTS private")
    op.execute("REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role")

    for key in HELPER_KEYS:
        op.execute(HELPER_BODIES[key])

    op.execute(
        "REVOKE ALL ON FUNCTION\n"
        + ",\n".join(f"private.{key}" for key in HELPER_KEYS)
        + "\nFROM PUBLIC, anon, authenticated, service_role"
    )
    op.execute("GRANT USAGE ON SCHEMA private TO asquii_app")
    op.execute(
        "GRANT EXECUTE ON FUNCTION\n"
        + ",\n".join(f"private.{key}" for key in HELPER_KEYS)
        + "\nTO asquii_app"
    )

    for table in APP_TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")

    for table, entries in POLICIES.items():
        for entry in entries:
            op.execute(_build_policy_sql(table, entry))


def downgrade() -> None:
    """Remove policies, disable RLS, and drop the helpers."""

    for table, entries in POLICIES.items():
        for entry in entries:
            op.execute(f"DROP POLICY IF EXISTS {entry[0]} ON public.{table}")

    for table in APP_TABLES:
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")

    op.execute(
        "REVOKE ALL ON FUNCTION\n"
        + ",\n".join(f"private.{key}" for key in HELPER_KEYS)
        + "\nFROM asquii_app, PUBLIC"
    )
    for key in HELPER_KEYS:
        op.execute(f"DROP FUNCTION IF EXISTS private.{key}")
    op.execute("DROP SCHEMA IF EXISTS private")
