"""Create the approved MVP relational schema and lifecycle guards.

Revision ID: 0002_mvp_schema
Revises: 0001_empty_baseline
Create Date: 2026-11-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_mvp_schema"
down_revision: str | None = "0001_empty_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create only approved application tables; Supabase Auth remains external."""

    # Preserve a controlled target in online and offline Alembic execution.
    op.execute("SET LOCAL search_path TO public, pg_catalog")
    op.execute(
        """
        CREATE TABLE profiles (
            user_id uuid NOT NULL,
            display_name varchar(120) NOT NULL,
            job_title varchar(120),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_profiles PRIMARY KEY (user_id),
            CONSTRAINT fk_profiles_user_id_users FOREIGN KEY (user_id)
                REFERENCES auth.users (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE TABLE workspaces (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            name varchar(160) NOT NULL,
            slug varchar(120) NOT NULL,
            archived_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_workspaces PRIMARY KEY (id),
            CONSTRAINT uq_workspaces_slug UNIQUE (slug)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE workspace_members (
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            role varchar(16) NOT NULL,
            removed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_workspace_members PRIMARY KEY (workspace_id, user_id),
            CONSTRAINT fk_workspace_members_workspace_id_workspaces FOREIGN KEY (workspace_id)
                REFERENCES workspaces (id) ON DELETE RESTRICT,
            CONSTRAINT fk_workspace_members_user_id_profiles FOREIGN KEY (user_id)
                REFERENCES profiles (user_id) ON DELETE RESTRICT,
            CONSTRAINT ck_workspace_members_role_allowed
                CHECK (role IN ('Owner', 'Admin', 'Member'))
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_workspace_members_user_workspace
        ON workspace_members (user_id, workspace_id)"""
    )
    op.execute(
        "CREATE INDEX ix_workspace_members_workspace_role ON workspace_members (workspace_id, role)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_workspace_members_active_owner
        ON workspace_members (workspace_id)
        WHERE role = 'Owner' AND removed_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE workspace_invitations (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            email_normalized varchar(320) NOT NULL,
            role varchar(16) NOT NULL,
            token_hash varchar(128) NOT NULL,
            invited_by_user_id uuid NOT NULL,
            expires_at timestamptz NOT NULL,
            accepted_at timestamptz,
            revoked_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_workspace_invitations PRIMARY KEY (id),
            CONSTRAINT fk_workspace_invitations_workspace_id_workspaces FOREIGN KEY (workspace_id)
                REFERENCES workspaces (id) ON DELETE RESTRICT,
            CONSTRAINT fk_workspace_invitations_workspace_id_workspace_members
                FOREIGN KEY (workspace_id, invited_by_user_id)
                REFERENCES workspace_members (workspace_id, user_id) ON DELETE RESTRICT,
            CONSTRAINT ck_workspace_invitations_role_allowed
                CHECK (role IN ('Admin', 'Member')),
            CONSTRAINT ck_workspace_invitations_email_normalized
                CHECK (email_normalized = lower(btrim(email_normalized))),
            CONSTRAINT ck_workspace_invitations_terminal_state_exclusive
                CHECK (accepted_at IS NULL OR revoked_at IS NULL),
            CONSTRAINT ck_workspace_invitations_expires_after_creation
                CHECK (expires_at > created_at)
        )
        """
    )
    op.execute(
        """CREATE UNIQUE INDEX uq_workspace_invitations_token_hash
        ON workspace_invitations (token_hash)"""
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_workspace_invitations_workspace_email_pending
        ON workspace_invitations (workspace_id, email_normalized)
        WHERE accepted_at IS NULL AND revoked_at IS NULL
        """
    )
    op.execute(
        """CREATE INDEX ix_workspace_invitations_workspace_expires_at
        ON workspace_invitations (workspace_id, expires_at)"""
    )
    op.execute(
        """
        CREATE TABLE projects (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            name varchar(160) NOT NULL,
            description text NOT NULL DEFAULT '',
            status varchar(24) NOT NULL DEFAULT 'In progress',
            progress_mode varchar(8) NOT NULL DEFAULT 'auto',
            manual_progress smallint,
            archived_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_projects PRIMARY KEY (id),
            CONSTRAINT uq_projects_id_workspace_id UNIQUE (id, workspace_id),
            CONSTRAINT fk_projects_workspace_id_workspaces FOREIGN KEY (workspace_id)
                REFERENCES workspaces (id) ON DELETE RESTRICT,
            CONSTRAINT ck_projects_status_allowed
                CHECK (status IN ('In progress', 'In review', 'Complete')),
            CONSTRAINT ck_projects_progress_mode_allowed
                CHECK (progress_mode IN ('auto', 'manual')),
            CONSTRAINT ck_projects_manual_progress_range
                CHECK (manual_progress IS NULL OR manual_progress BETWEEN 0 AND 100)
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_projects_workspace_archived_name
        ON projects (workspace_id, archived_at, name)"""
    )
    op.execute("CREATE INDEX ix_projects_workspace_status ON projects (workspace_id, status)")
    op.execute(
        """
        CREATE TABLE project_members (
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            user_id uuid NOT NULL,
            role varchar(24) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_project_members PRIMARY KEY (workspace_id, project_id, user_id),
            CONSTRAINT fk_project_members_project_id_projects
                FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT,
            CONSTRAINT fk_project_members_workspace_id_workspace_members
                FOREIGN KEY (workspace_id, user_id)
                REFERENCES workspace_members (workspace_id, user_id) ON DELETE RESTRICT,
            CONSTRAINT ck_project_members_role_allowed
                CHECK (role IN ('Project Manager', 'Project Member'))
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_project_members_user_workspace_project
        ON project_members (user_id, workspace_id, project_id)"""
    )
    op.execute("CREATE INDEX ix_project_members_project_role ON project_members (project_id, role)")
    op.execute(
        """
        CREATE TABLE milestones (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            name varchar(160) NOT NULL,
            due_date date NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_milestones PRIMARY KEY (id),
            CONSTRAINT fk_milestones_project_id_projects
                FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX ix_milestones_project_due_date ON milestones (project_id, due_date)")
    op.execute(
        """
        CREATE TABLE tasks (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            title varchar(240) NOT NULL,
            description text NOT NULL DEFAULT '',
            labels text[] NOT NULL DEFAULT '{}'::text[],
            status varchar(24) NOT NULL DEFAULT 'To do',
            due_date date,
            assignee_user_id uuid,
            priority varchar(8) NOT NULL DEFAULT 'Medium',
            position numeric NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_tasks PRIMARY KEY (id),
            CONSTRAINT uq_tasks_id_workspace_project UNIQUE (id, workspace_id, project_id),
            CONSTRAINT fk_tasks_project_id_projects FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT,
            CONSTRAINT fk_tasks_workspace_id_project_members
                FOREIGN KEY (workspace_id, project_id, assignee_user_id)
                REFERENCES project_members (workspace_id, project_id, user_id) ON DELETE RESTRICT,
            CONSTRAINT ck_tasks_status_allowed CHECK (
                status IN (
                    'Backlog', 'To do', 'In progress', 'Dev completed',
                    'In review', 'Complete'
                )
            ),
            CONSTRAINT ck_tasks_priority_allowed CHECK (priority IN ('Low', 'Medium', 'High'))
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_tasks_project_status_position ON tasks (project_id, status, position)"
    )
    op.execute("CREATE INDEX ix_tasks_assignee_due_date ON tasks (assignee_user_id, due_date)")
    op.execute(
        """CREATE INDEX ix_tasks_workspace_project_updated
        ON tasks (workspace_id, project_id, updated_at DESC)"""
    )
    op.execute(
        """
        CREATE TABLE task_subtasks (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            task_id uuid NOT NULL,
            title varchar(240) NOT NULL,
            is_done boolean NOT NULL DEFAULT false,
            position numeric NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_task_subtasks PRIMARY KEY (id),
            CONSTRAINT fk_task_subtasks_task_id_tasks FOREIGN KEY (task_id)
                REFERENCES tasks (id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE INDEX ix_task_subtasks_task_position ON task_subtasks (task_id, position)")
    op.execute(
        """
        CREATE TABLE task_comments (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            task_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            author_user_id uuid NOT NULL,
            body text NOT NULL,
            deleted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_task_comments PRIMARY KEY (id),
            CONSTRAINT fk_task_comments_task_id_tasks
                FOREIGN KEY (task_id, workspace_id, project_id)
                REFERENCES tasks (id, workspace_id, project_id) ON DELETE RESTRICT,
            CONSTRAINT fk_task_comments_workspace_id_project_members
                FOREIGN KEY (workspace_id, project_id, author_user_id)
                REFERENCES project_members (workspace_id, project_id, user_id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX ix_task_comments_task_created ON task_comments (task_id, created_at)")
    op.execute(
        """
        CREATE TABLE meetings (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            title varchar(200) NOT NULL,
            description text NOT NULL DEFAULT '',
            starts_at timestamptz NOT NULL,
            duration_minutes integer NOT NULL,
            meeting_type varchar(20) NOT NULL DEFAULT 'Team sync',
            agenda text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_meetings PRIMARY KEY (id),
            CONSTRAINT uq_meetings_workspace_project_id UNIQUE (workspace_id, project_id, id),
            CONSTRAINT fk_meetings_project_id_projects FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT,
            CONSTRAINT ck_meetings_duration_positive CHECK (duration_minutes > 0),
            CONSTRAINT ck_meetings_meeting_type_allowed CHECK (
                meeting_type IN (
                    'Team sync', 'Review', 'Planning', 'Retrospective', 'Other'
                )
            )
        )
        """
    )
    op.execute("CREATE INDEX ix_meetings_project_starts_at ON meetings (project_id, starts_at)")
    op.execute(
        """
        CREATE TABLE meeting_attendees (
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            meeting_id uuid NOT NULL,
            user_id uuid NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_meeting_attendees
                PRIMARY KEY (workspace_id, project_id, meeting_id, user_id),
            CONSTRAINT fk_meeting_attendees_workspace_id_meetings
                FOREIGN KEY (workspace_id, project_id, meeting_id)
                REFERENCES meetings (workspace_id, project_id, id) ON DELETE CASCADE,
            CONSTRAINT fk_meeting_attendees_workspace_id_project_members
                FOREIGN KEY (workspace_id, project_id, user_id)
                REFERENCES project_members (workspace_id, project_id, user_id) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_meeting_attendees_user_meeting ON meeting_attendees (user_id, meeting_id)"
    )
    op.execute(
        """
        CREATE TABLE resources (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            owner_user_id uuid NOT NULL,
            name varchar(240) NOT NULL,
            type varchar(32) NOT NULL,
            category varchar(100) NOT NULL,
            detail text NOT NULL,
            external_url text,
            storage_object_path text,
            size_bytes bigint,
            tags text[] NOT NULL DEFAULT '{}'::text[],
            deleted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_resources PRIMARY KEY (id),
            CONSTRAINT fk_resources_project_id_projects FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT,
            CONSTRAINT fk_resources_workspace_id_project_members
                FOREIGN KEY (workspace_id, project_id, owner_user_id)
                REFERENCES project_members (workspace_id, project_id, user_id) ON DELETE RESTRICT,
            CONSTRAINT ck_resources_type_allowed
                CHECK (type IN ('Document', 'Spreadsheet', 'Design file', 'Folder', 'Link')),
            CONSTRAINT ck_resources_size_nonnegative CHECK (size_bytes IS NULL OR size_bytes >= 0)
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_resources_project_deleted_updated
        ON resources (project_id, deleted_at, updated_at DESC)"""
    )
    op.execute("CREATE INDEX ix_resources_owner_project ON resources (owner_user_id, project_id)")
    op.execute(
        """
        CREATE TABLE user_resource_preferences (
            user_id uuid NOT NULL,
            resource_id uuid NOT NULL,
            starred boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_user_resource_preferences PRIMARY KEY (user_id, resource_id),
            CONSTRAINT fk_user_resource_preferences_user_id_profiles FOREIGN KEY (user_id)
                REFERENCES profiles (user_id) ON DELETE RESTRICT,
            CONSTRAINT fk_user_resource_preferences_resource_id_resources FOREIGN KEY (resource_id)
                REFERENCES resources (id) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_user_resource_preferences_resource_user
        ON user_resource_preferences (resource_id, user_id)"""
    )
    op.execute(
        """
        CREATE TABLE activity_logs (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            project_id uuid,
            actor_user_id uuid,
            action varchar(100) NOT NULL,
            entity_type varchar(100) NOT NULL,
            entity_id uuid NOT NULL,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_activity_logs PRIMARY KEY (id),
            CONSTRAINT fk_activity_logs_workspace_id_workspaces FOREIGN KEY (workspace_id)
                REFERENCES workspaces (id) ON DELETE RESTRICT,
            CONSTRAINT fk_activity_logs_project_id_projects FOREIGN KEY (project_id, workspace_id)
                REFERENCES projects (id, workspace_id) ON DELETE RESTRICT,
            CONSTRAINT fk_activity_logs_workspace_id_workspace_members
                FOREIGN KEY (workspace_id, actor_user_id)
                REFERENCES workspace_members (workspace_id, user_id) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """CREATE INDEX ix_activity_logs_workspace_created
        ON activity_logs (workspace_id, created_at DESC)"""
    )
    op.execute(
        """CREATE INDEX ix_activity_logs_project_created
        ON activity_logs (project_id, created_at DESC)"""
    )
    op.execute(
        """CREATE INDEX ix_activity_logs_entity_created
        ON activity_logs (entity_type, entity_id, created_at DESC)"""
    )

    op.execute(
        """
        CREATE FUNCTION public.assert_workspace_has_owner(p_workspace_id uuid)
        RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
            PERFORM 1 FROM public.workspaces
            WHERE id = p_workspace_id FOR UPDATE;
            IF EXISTS (
                SELECT 1 FROM public.workspaces w
                WHERE w.id = p_workspace_id AND w.archived_at IS NULL
            ) AND NOT EXISTS (
                SELECT 1 FROM public.workspace_members wm
                WHERE wm.workspace_id = p_workspace_id
                  AND wm.role = 'Owner' AND wm.removed_at IS NULL
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'workspace_exactly_one_active_owner',
                    MESSAGE = 'An active workspace must have exactly one active Owner';
            END IF;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.lock_workspace_owner_parent()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_workspace_id uuid;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                target_workspace_id := OLD.workspace_id;
            ELSE
                target_workspace_id := NEW.workspace_id;
            END IF;
            PERFORM 1 FROM public.workspaces
            WHERE id = target_workspace_id FOR UPDATE;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER workspace_members_lock_owner_parent
        BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
        FOR EACH ROW EXECUTE FUNCTION public.lock_workspace_owner_parent()
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.enforce_workspace_owner_invariant()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_workspace_id uuid;
        BEGIN
            IF TG_TABLE_NAME = 'workspaces' THEN
                target_workspace_id := COALESCE(NEW.id, OLD.id);
            ELSE
                target_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
            END IF;
            PERFORM public.assert_workspace_has_owner(target_workspace_id);
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER workspace_owner_invariant_workspace
        AFTER INSERT OR UPDATE ON public.workspaces
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION public.enforce_workspace_owner_invariant()
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER workspace_owner_invariant_member
        AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION public.enforce_workspace_owner_invariant()
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.lock_project_manager_parent()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_project_id uuid;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                target_project_id := OLD.project_id;
            ELSE
                target_project_id := NEW.project_id;
            END IF;
            PERFORM 1 FROM public.projects
            WHERE id = target_project_id FOR UPDATE;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER project_members_lock_manager_parent
        BEFORE INSERT OR UPDATE OR DELETE ON public.project_members
        FOR EACH ROW EXECUTE FUNCTION public.lock_project_manager_parent()
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.assert_project_has_manager(p_project_id uuid)
        RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
            PERFORM 1 FROM public.projects
            WHERE id = p_project_id FOR UPDATE;
            IF EXISTS (
                SELECT 1 FROM public.projects p
                WHERE p.id = p_project_id AND p.archived_at IS NULL
            ) AND NOT EXISTS (
                SELECT 1
                FROM public.project_members pm
                JOIN public.workspace_members wm
                  ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id
                WHERE pm.project_id = p_project_id
                  AND pm.role = 'Project Manager'
                  AND wm.removed_at IS NULL
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'project_at_least_one_active_manager',
                    MESSAGE = 'An active project must have an active Project Manager';
            END IF;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.enforce_project_manager_invariant()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_project_id uuid;
        affected_project record;
        BEGIN
            IF TG_TABLE_NAME = 'projects' THEN
                target_project_id := COALESCE(NEW.id, OLD.id);
                PERFORM public.assert_project_has_manager(target_project_id);
            ELSIF TG_TABLE_NAME = 'workspace_members' THEN
                FOR affected_project IN
                    SELECT DISTINCT pm.project_id
                    FROM public.project_members pm
                    WHERE pm.workspace_id IN (
                        COALESCE(NEW.workspace_id, OLD.workspace_id),
                        COALESCE(OLD.workspace_id, NEW.workspace_id)
                    ) AND pm.user_id IN (
                        COALESCE(NEW.user_id, OLD.user_id),
                        COALESCE(OLD.user_id, NEW.user_id)
                    ) AND pm.role = 'Project Manager'
                LOOP
                    PERFORM public.assert_project_has_manager(affected_project.project_id);
                END LOOP;
            ELSE
                target_project_id := COALESCE(NEW.project_id, OLD.project_id);
                PERFORM public.assert_project_has_manager(target_project_id);
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER project_manager_invariant_project
        AFTER INSERT OR UPDATE ON public.projects
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION public.enforce_project_manager_invariant()
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER project_manager_invariant_member
        AFTER INSERT OR UPDATE OR DELETE ON public.project_members
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION public.enforce_project_manager_invariant()
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER project_manager_invariant_workspace_member
        AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION public.enforce_project_manager_invariant()
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.reject_activity_log_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'activity_logs are append-only';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER activity_logs_immutable
        BEFORE UPDATE OR DELETE ON public.activity_logs
        FOR EACH ROW EXECUTE FUNCTION public.reject_activity_log_mutation()
        """
    )


def downgrade() -> None:
    """Remove the Sprint 2 schema and its database-side invariant guards."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    op.execute("DROP TRIGGER IF EXISTS activity_logs_immutable ON public.activity_logs")
    op.execute("DROP FUNCTION IF EXISTS public.reject_activity_log_mutation()")
    op.execute(
        "DROP TRIGGER IF EXISTS project_members_lock_manager_parent ON public.project_members"
    )
    op.execute("DROP FUNCTION IF EXISTS public.lock_project_manager_parent()")
    op.execute(
        "DROP TRIGGER IF EXISTS project_manager_invariant_workspace_member "
        "ON public.workspace_members"
    )
    op.execute("DROP TRIGGER IF EXISTS project_manager_invariant_member ON public.project_members")
    op.execute("DROP TRIGGER IF EXISTS project_manager_invariant_project ON public.projects")
    op.execute("DROP FUNCTION IF EXISTS public.enforce_project_manager_invariant()")
    op.execute("DROP FUNCTION IF EXISTS public.assert_project_has_manager(uuid)")
    op.execute(
        "DROP TRIGGER IF EXISTS workspace_owner_invariant_member ON public.workspace_members"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS workspace_members_lock_owner_parent ON public.workspace_members"
    )
    op.execute("DROP FUNCTION IF EXISTS public.lock_workspace_owner_parent()")
    op.execute("DROP TRIGGER IF EXISTS workspace_owner_invariant_workspace ON public.workspaces")
    op.execute("DROP FUNCTION IF EXISTS public.enforce_workspace_owner_invariant()")
    op.execute("DROP FUNCTION IF EXISTS public.assert_workspace_has_owner(uuid)")
    for table in (
        "activity_logs",
        "user_resource_preferences",
        "resources",
        "meeting_attendees",
        "meetings",
        "task_comments",
        "task_subtasks",
        "tasks",
        "milestones",
        "project_members",
        "projects",
        "workspace_invitations",
        "workspace_members",
        "workspaces",
        "profiles",
    ):
        op.execute(f"DROP TABLE IF EXISTS public.{table} CASCADE")
