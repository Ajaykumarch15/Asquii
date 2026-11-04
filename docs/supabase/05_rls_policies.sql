-- REVIEW DRAFT ONLY. NOT APPROVED OR EXECUTED.
-- Do not run this file directly. API/database mismatches, helper ownership,
-- grants, runtime role assumption, and PostgreSQL behavior remain unverified.
-- Convert to a versioned migration only after disposable Supabase tests pass.
-- Do not expose schema "private" through the Supabase Data API.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER helpers must be owned by the reviewed non-login table owner.
-- Fail closed when this script is run as an arbitrary SQL Editor/admin role.
DO $$
DECLARE
    owner_is_superuser boolean;
    owner_bypasses_rls boolean;
    owner_can_login boolean;
    app_table_count integer;
BEGIN
    IF current_user <> 'asquii_owner' THEN
        RAISE EXCEPTION 'Policy draft requires reviewed SET ROLE asquii_owner; current role is %',
            current_user;
    END IF;

    SELECT rolsuper, rolbypassrls, rolcanlogin
    INTO owner_is_superuser, owner_bypasses_rls, owner_can_login
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user;
    IF owner_is_superuser OR owner_bypasses_rls OR owner_can_login THEN
        RAISE EXCEPTION 'asquii_owner must be NOLOGIN, NOSUPERUSER, and NOBYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = m.roleid
        WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
          AND granted_role.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role')
    ) THEN
        RAISE EXCEPTION 'asquii_owner must not be a member of Supabase API roles';
    END IF;

    SELECT count(*) INTO app_table_count
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname::text = ANY (ARRAY[
          'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
          'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
          'task_comments', 'meetings', 'meeting_attendees', 'resources',
          'user_resource_preferences', 'activity_logs'
      ]);
    IF app_table_count <> 15 OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname::text = ANY (ARRAY[
              'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
              'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
              'task_comments', 'meetings', 'meeting_attendees', 'resources',
              'user_resource_preferences', 'activity_logs'
          ])
          AND c.relowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
    ) THEN
        RAISE EXCEPTION 'All 15 Asquii tables must exist in public and be owned by asquii_owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace n
        WHERE n.nspname = 'private'
          AND n.nspowner <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
    ) THEN
        RAISE EXCEPTION 'Existing private schema must be owned by asquii_owner';
    END IF;
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated;

-- asquii_owner must own these tables; it must not be the runtime login, a
-- superuser, or a role with BYPASSRLS. Keep FORCE ROW LEVEL SECURITY disabled
-- until trigger/helper behavior is reviewed for that mode.
CREATE OR REPLACE FUNCTION private.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.removed_at IS NULL
          AND w.archived_at IS NULL
    )
$$;

CREATE OR REPLACE FUNCTION private.is_active_project(p_workspace_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.projects p
        JOIN public.workspaces w ON w.id = p.workspace_id
        WHERE p.id = p_project_id
          AND p.workspace_id = p_workspace_id
          AND p.archived_at IS NULL
          AND w.archived_at IS NULL
          AND private.is_workspace_member(p_workspace_id)
    )
$$;

CREATE OR REPLACE FUNCTION private.has_workspace_role(p_workspace_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.removed_at IS NULL
          AND w.archived_at IS NULL
          AND wm.role = ANY(p_roles)
    )
$$;

CREATE OR REPLACE FUNCTION private.can_read_project(p_workspace_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.projects p
        JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE p.id = p_project_id
          AND p.workspace_id = p_workspace_id
          AND p.archived_at IS NULL
          AND wm.user_id = auth.uid()
          AND wm.removed_at IS NULL
          AND w.archived_at IS NULL
    )
$$;

CREATE OR REPLACE FUNCTION private.can_collaborate(p_workspace_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT private.is_active_project(p_workspace_id, p_project_id)
       AND (
        private.has_workspace_role(p_workspace_id, ARRAY['Owner', 'Admin'])
        OR EXISTS (
            SELECT 1 FROM public.project_members pm
            JOIN public.workspace_members wm
              ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id
            WHERE pm.workspace_id = p_workspace_id
              AND pm.project_id = p_project_id
              AND pm.user_id = auth.uid()
              AND wm.removed_at IS NULL
        ))
$$;

CREATE OR REPLACE FUNCTION private.can_manage_project(p_workspace_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT private.is_active_project(p_workspace_id, p_project_id)
       AND (
        private.has_workspace_role(p_workspace_id, ARRAY['Owner', 'Admin'])
        OR EXISTS (
            SELECT 1 FROM public.project_members pm
            JOIN public.workspace_members wm
              ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id
            WHERE pm.workspace_id = p_workspace_id
              AND pm.project_id = p_project_id
              AND pm.user_id = auth.uid()
              AND pm.role = 'Project Manager'
              AND wm.removed_at IS NULL
        ))
$$;

CREATE OR REPLACE FUNCTION private.shares_workspace(p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members mine
        JOIN public.workspace_members theirs
          ON theirs.workspace_id = mine.workspace_id
        JOIN public.workspaces w ON w.id = mine.workspace_id
        WHERE mine.user_id = auth.uid()
          AND mine.removed_at IS NULL
          AND theirs.user_id = p_other_user_id
          AND theirs.removed_at IS NULL
          AND w.archived_at IS NULL
    )
$$;

CREATE OR REPLACE FUNCTION private.can_read_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = p_task_id
          AND private.can_read_project(t.workspace_id, t.project_id)
    )
$$;

CREATE OR REPLACE FUNCTION private.can_read_resource(p_resource_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = 'off'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.resources r
        WHERE r.id = p_resource_id
          AND r.deleted_at IS NULL
          AND private.can_read_project(r.workspace_id, r.project_id)
    )
$$;

REVOKE ALL ON FUNCTION private.is_workspace_member(uuid),
    private.is_active_project(uuid, uuid),
    private.has_workspace_role(uuid, text[]),
    private.can_read_project(uuid, uuid),
    private.can_collaborate(uuid, uuid),
    private.can_manage_project(uuid, uuid),
    private.shares_workspace(uuid),
    private.can_read_task(uuid),
    private.can_read_resource(uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid),
    private.is_active_project(uuid, uuid),
    private.has_workspace_role(uuid, text[]),
    private.can_read_project(uuid, uuid),
    private.can_collaborate(uuid, uuid),
    private.can_manage_project(uuid, uuid),
    private.shares_workspace(uuid),
    private.can_read_task(uuid),
    private.can_read_resource(uuid)
TO authenticated;

-- Reconcile default table privileges for these application tables. RLS does
-- not grant SQL privileges. Activity writes stay denied until the trusted
-- writer boundary is implemented and verified.
REVOKE ALL ON TABLE
    public.profiles, public.workspaces, public.workspace_members,
    public.workspace_invitations, public.projects, public.project_members,
    public.milestones, public.tasks, public.task_subtasks, public.task_comments,
    public.meetings, public.meeting_attendees, public.resources,
    public.user_resource_preferences, public.activity_logs
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE
    public.profiles, public.workspaces, public.workspace_members,
    public.projects, public.workspace_invitations, public.resources,
    public.task_comments
TO authenticated;
GRANT UPDATE ON TABLE
    public.profiles, public.projects, public.workspace_invitations,
    public.resources, public.task_comments
TO authenticated;
-- Do not grant policy-only admins lifecycle or role columns until a narrow
-- operation for those changes is implemented and verified.
GRANT UPDATE (name, slug, updated_at) ON TABLE public.workspaces TO authenticated;
GRANT UPDATE (removed_at, updated_at) ON TABLE public.workspace_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.project_members, public.meetings
TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.milestones, public.tasks, public.task_subtasks,
    public.meeting_attendees, public.user_resource_preferences
TO authenticated;
GRANT SELECT ON TABLE public.activity_logs TO authenticated;

-- Profiles: only self or people sharing an active workspace are visible.
CREATE POLICY asquii_profiles_select ON public.profiles
FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.shares_workspace(user_id));
CREATE POLICY asquii_profiles_insert ON public.profiles
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY asquii_profiles_update ON public.profiles
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Workspace and membership tenant boundary.
CREATE POLICY asquii_workspaces_select ON public.workspaces
FOR SELECT TO authenticated USING (private.is_workspace_member(id));
CREATE POLICY asquii_workspaces_insert ON public.workspaces
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY asquii_workspaces_update ON public.workspaces
FOR UPDATE TO authenticated USING (private.has_workspace_role(id, ARRAY['Owner', 'Admin']))
WITH CHECK (private.has_workspace_role(id, ARRAY['Owner', 'Admin']));

CREATE POLICY asquii_workspace_members_select ON public.workspace_members
FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id));
CREATE POLICY asquii_workspace_members_insert ON public.workspace_members
FOR INSERT TO authenticated WITH CHECK (
    private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin'])
);
CREATE POLICY asquii_workspace_members_update ON public.workspace_members
FOR UPDATE TO authenticated USING (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']))
WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']));
-- Initial workspace/Owner creation and self-leave require a restricted,
-- transaction-safe database operation; these draft policies deny them until
-- that operation is implemented. Do not add a global membership-existence
-- helper, which creates an avoidable workspace membership-existence oracle.

-- Invitation reads are limited to administrators and the verified invitee email.
-- Column-level grants/RPC are required so invitees cannot read token_hash; see 06/README.
CREATE POLICY asquii_invitations_select ON public.workspace_invitations
FOR SELECT TO authenticated USING (
    private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin'])
    OR lower(email_normalized) = lower(coalesce(auth.jwt() ->> 'email', ''))
);
-- Prevent invitees from selecting token_hash through Supabase Data API.
REVOKE SELECT ON public.workspace_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT (
    id, workspace_id, email_normalized, role, invited_by_user_id,
    expires_at, accepted_at, revoked_at, created_at, updated_at
) ON public.workspace_invitations TO authenticated;
CREATE POLICY asquii_invitations_insert ON public.workspace_invitations
FOR INSERT TO authenticated WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']));
CREATE POLICY asquii_invitations_update ON public.workspace_invitations
FOR UPDATE TO authenticated USING (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']))
WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']));
-- Invitation acceptance needs a token-checking RPC; do not broaden this UPDATE
-- policy or restore token_hash SELECT to unblock the current ORM implementation.

-- Projects are workspace-visible; settings are manager/admin controlled.
CREATE POLICY asquii_projects_select ON public.projects
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, id));
CREATE POLICY asquii_projects_insert ON public.projects
FOR INSERT TO authenticated WITH CHECK (private.has_workspace_role(workspace_id, ARRAY['Owner', 'Admin']));
CREATE POLICY asquii_projects_update ON public.projects
FOR UPDATE TO authenticated USING (private.can_manage_project(workspace_id, id))
WITH CHECK (private.can_manage_project(workspace_id, id));

CREATE POLICY asquii_project_members_select ON public.project_members
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_project_members_insert ON public.project_members
FOR INSERT TO authenticated WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_project_members_update ON public.project_members
FOR UPDATE TO authenticated USING (private.can_manage_project(workspace_id, project_id))
WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_project_members_delete ON public.project_members
FOR DELETE TO authenticated USING (
    private.can_manage_project(workspace_id, project_id)
    OR (user_id = auth.uid() AND private.can_collaborate(workspace_id, project_id))
);

-- Milestones retain manager-only write permissions.
CREATE POLICY asquii_milestones_select ON public.milestones
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_milestones_insert ON public.milestones
FOR INSERT TO authenticated WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_milestones_update ON public.milestones
FOR UPDATE TO authenticated USING (private.can_manage_project(workspace_id, project_id))
WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_milestones_delete ON public.milestones
FOR DELETE TO authenticated USING (private.can_manage_project(workspace_id, project_id));

-- Tasks and collaboration children are visible to active workspace members.
CREATE POLICY asquii_tasks_select ON public.tasks
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_tasks_insert ON public.tasks
FOR INSERT TO authenticated WITH CHECK (private.can_collaborate(workspace_id, project_id));
CREATE POLICY asquii_tasks_update ON public.tasks
FOR UPDATE TO authenticated USING (private.can_collaborate(workspace_id, project_id))
WITH CHECK (private.can_collaborate(workspace_id, project_id));
CREATE POLICY asquii_tasks_delete ON public.tasks
FOR DELETE TO authenticated USING (private.can_manage_project(workspace_id, project_id));

CREATE POLICY asquii_task_subtasks_select ON public.task_subtasks
FOR SELECT TO authenticated USING (private.can_read_task(task_id));
CREATE POLICY asquii_task_subtasks_insert ON public.task_subtasks
FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
            AND private.can_collaborate(t.workspace_id, t.project_id))
);
CREATE POLICY asquii_task_subtasks_update ON public.task_subtasks
FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
            AND private.can_collaborate(t.workspace_id, t.project_id))
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
            AND private.can_collaborate(t.workspace_id, t.project_id))
);
CREATE POLICY asquii_task_subtasks_delete ON public.task_subtasks
FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id
            AND private.can_collaborate(t.workspace_id, t.project_id))
);

CREATE POLICY asquii_task_comments_select ON public.task_comments
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_task_comments_insert ON public.task_comments
FOR INSERT TO authenticated WITH CHECK (
    author_user_id = auth.uid() AND private.can_collaborate(workspace_id, project_id)
);
CREATE POLICY asquii_task_comments_update ON public.task_comments
FOR UPDATE TO authenticated USING (
    private.can_collaborate(workspace_id, project_id)
    AND (author_user_id = auth.uid() OR private.can_manage_project(workspace_id, project_id))
)
WITH CHECK (
    private.can_collaborate(workspace_id, project_id)
    AND (author_user_id = auth.uid() OR private.can_manage_project(workspace_id, project_id))
);
-- No DELETE policy: API comment deletion is a soft-delete update.

-- Meetings and attendee rows are project-scoped; attendees are project members by FK.
CREATE POLICY asquii_meetings_select ON public.meetings
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_meetings_insert ON public.meetings
FOR INSERT TO authenticated WITH CHECK (private.can_collaborate(workspace_id, project_id));
CREATE POLICY asquii_meetings_update ON public.meetings
FOR UPDATE TO authenticated USING (private.can_manage_project(workspace_id, project_id))
WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_meetings_delete ON public.meetings
FOR DELETE TO authenticated USING (private.can_manage_project(workspace_id, project_id));

CREATE POLICY asquii_meeting_attendees_select ON public.meeting_attendees
FOR SELECT TO authenticated USING (private.can_read_project(workspace_id, project_id));
CREATE POLICY asquii_meeting_attendees_insert ON public.meeting_attendees
FOR INSERT TO authenticated WITH CHECK (private.can_manage_project(workspace_id, project_id));
CREATE POLICY asquii_meeting_attendees_delete ON public.meeting_attendees
FOR DELETE TO authenticated USING (
    private.can_manage_project(workspace_id, project_id)
    OR (user_id = auth.uid() AND private.can_collaborate(workspace_id, project_id))
);

-- Resources are workspace-visible. Owner/Admin and Project Manager have overrides.
CREATE POLICY asquii_resources_select ON public.resources
FOR SELECT TO authenticated USING (
    deleted_at IS NULL AND private.can_read_project(workspace_id, project_id)
);
CREATE POLICY asquii_resources_insert ON public.resources
FOR INSERT TO authenticated WITH CHECK (
    owner_user_id = auth.uid() AND private.can_collaborate(workspace_id, project_id)
);
CREATE POLICY asquii_resources_update ON public.resources
FOR UPDATE TO authenticated USING (
    owner_user_id = auth.uid() OR private.can_manage_project(workspace_id, project_id)
)
WITH CHECK (private.can_collaborate(workspace_id, project_id));
-- No DELETE policy: API resource deletion uses deleted_at.

CREATE POLICY asquii_resource_preferences_select ON public.user_resource_preferences
FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.can_read_resource(resource_id));
CREATE POLICY asquii_resource_preferences_insert ON public.user_resource_preferences
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND private.can_read_resource(resource_id));
CREATE POLICY asquii_resource_preferences_update ON public.user_resource_preferences
FOR UPDATE TO authenticated USING (user_id = auth.uid() AND private.can_read_resource(resource_id))
WITH CHECK (user_id = auth.uid() AND private.can_read_resource(resource_id));
CREATE POLICY asquii_resource_preferences_delete ON public.user_resource_preferences
FOR DELETE TO authenticated USING (user_id = auth.uid() AND private.can_read_resource(resource_id));

-- Activity is workspace-visible and intentionally has no INSERT/UPDATE/DELETE policy.
CREATE POLICY asquii_activity_logs_select ON public.activity_logs
FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id));

COMMIT;

-- Required follow-up: review column grants, invitation acceptance, trusted activity
-- writes, function owners, and direct app-role behavior before considering deployment.
