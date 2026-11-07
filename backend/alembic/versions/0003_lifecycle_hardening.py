"""Harden old/new parent handling and lock ordering in lifecycle triggers.

Revision ID: 0003_lifecycle_hardening
Revises: 0002_mvp_schema
Create Date: 2026-11-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_lifecycle_hardening"
down_revision: str | None = "0002_mvp_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace Sprint 2 trigger functions without rewriting its revision."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    for trigger, table in (
        ("workspace_owner_invariant_workspace", "workspaces"),
        ("workspace_owner_invariant_member", "workspace_members"),
        ("workspace_members_lock_owner_parent", "workspace_members"),
        ("project_manager_invariant_project", "projects"),
        ("project_manager_invariant_member", "project_members"),
        ("project_manager_invariant_workspace_member", "workspace_members"),
        ("project_members_lock_manager_parent", "project_members"),
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON public.{table}")

    for function in (
        "lock_workspace_owner_parent",
        "assert_workspace_has_owner",
        "enforce_workspace_owner_invariant",
        "lock_project_manager_parent",
        "assert_project_has_manager",
        "enforce_project_manager_invariant",
    ):
        op.execute(
            f"ALTER FUNCTION public.{function}() RENAME TO {function}_sprint2"
            if function.startswith("lock_") or function.startswith("enforce_")
            else f"ALTER FUNCTION public.{function}(uuid) RENAME TO {function}_sprint2"
        )

    op.execute(
        """
        CREATE FUNCTION public.lock_workspace_owner_parent()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE affected_ids uuid[];
        parent_id uuid;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                affected_ids := ARRAY[NEW.workspace_id];
            ELSIF TG_OP = 'DELETE' THEN
                affected_ids := ARRAY[OLD.workspace_id];
            ELSE
                affected_ids := ARRAY[OLD.workspace_id, NEW.workspace_id];
            END IF;

            FOR parent_id IN
                SELECT DISTINCT ids.workspace_id
                FROM unnest(affected_ids) AS ids(workspace_id)
                WHERE ids.workspace_id IS NOT NULL
                ORDER BY ids.workspace_id
            LOOP
                PERFORM 1 FROM public.workspaces
                WHERE id = parent_id FOR UPDATE;
            END LOOP;

            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.lock_workspace_member_project_parents()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE affected_projects record;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                FOR affected_projects IN
                    SELECT DISTINCT pm.project_id
                    FROM public.project_members pm
                    WHERE pm.workspace_id = NEW.workspace_id
                      AND pm.user_id = NEW.user_id
                      AND pm.role = 'Project Manager'
                    ORDER BY pm.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            ELSIF TG_OP = 'DELETE' THEN
                FOR affected_projects IN
                    SELECT DISTINCT pm.project_id
                    FROM public.project_members pm
                    WHERE pm.workspace_id = OLD.workspace_id
                      AND pm.user_id = OLD.user_id
                      AND pm.role = 'Project Manager'
                    ORDER BY pm.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            ELSE
                FOR affected_projects IN
                    SELECT affected.project_id
                    FROM (
                        SELECT pm.project_id
                        FROM public.project_members pm
                        WHERE pm.workspace_id = OLD.workspace_id
                          AND pm.user_id = OLD.user_id
                          AND pm.role = 'Project Manager'
                        UNION
                        SELECT pm.project_id
                        FROM public.project_members pm
                        WHERE pm.workspace_id = NEW.workspace_id
                          AND pm.user_id = NEW.user_id
                          AND pm.role = 'Project Manager'
                    ) AS affected
                    ORDER BY affected.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            END IF;

            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$
        """
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
        CREATE FUNCTION public.enforce_workspace_owner_invariant()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE affected_ids uuid[];
        workspace_id uuid;
        BEGIN
            IF TG_TABLE_NAME = 'workspaces' THEN
                IF TG_OP = 'INSERT' THEN
                    affected_ids := ARRAY[NEW.id];
                ELSIF TG_OP = 'DELETE' THEN
                    affected_ids := ARRAY[OLD.id];
                ELSE
                    affected_ids := ARRAY[OLD.id, NEW.id];
                END IF;
            ELSE
                IF TG_OP = 'INSERT' THEN
                    affected_ids := ARRAY[NEW.workspace_id];
                ELSIF TG_OP = 'DELETE' THEN
                    affected_ids := ARRAY[OLD.workspace_id];
                ELSE
                    affected_ids := ARRAY[OLD.workspace_id, NEW.workspace_id];
                END IF;
            END IF;

            FOR workspace_id IN
                SELECT DISTINCT ids.workspace_id
                FROM unnest(affected_ids) AS ids(workspace_id)
                WHERE ids.workspace_id IS NOT NULL
                ORDER BY ids.workspace_id
            LOOP
                PERFORM public.assert_workspace_has_owner(workspace_id);
            END LOOP;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.lock_project_manager_parent()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE affected_workspaces record;
        affected_projects record;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                FOR affected_workspaces IN
                    SELECT DISTINCT ids.workspace_id
                    FROM unnest(ARRAY[NEW.workspace_id]) AS ids(workspace_id)
                    ORDER BY ids.workspace_id
                LOOP
                    PERFORM 1 FROM public.workspaces
                    WHERE id = affected_workspaces.workspace_id FOR UPDATE;
                END LOOP;
                FOR affected_projects IN
                    SELECT DISTINCT ids.project_id
                    FROM unnest(ARRAY[NEW.project_id]) AS ids(project_id)
                    ORDER BY ids.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            ELSIF TG_OP = 'DELETE' THEN
                FOR affected_workspaces IN
                    SELECT DISTINCT ids.workspace_id
                    FROM unnest(ARRAY[OLD.workspace_id]) AS ids(workspace_id)
                    ORDER BY ids.workspace_id
                LOOP
                    PERFORM 1 FROM public.workspaces
                    WHERE id = affected_workspaces.workspace_id FOR UPDATE;
                END LOOP;
                FOR affected_projects IN
                    SELECT DISTINCT ids.project_id
                    FROM unnest(ARRAY[OLD.project_id]) AS ids(project_id)
                    ORDER BY ids.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            ELSE
                FOR affected_workspaces IN
                    SELECT DISTINCT ids.workspace_id
                    FROM unnest(ARRAY[OLD.workspace_id, NEW.workspace_id]) AS ids(workspace_id)
                    ORDER BY ids.workspace_id
                LOOP
                    PERFORM 1 FROM public.workspaces
                    WHERE id = affected_workspaces.workspace_id FOR UPDATE;
                END LOOP;
                FOR affected_projects IN
                    SELECT DISTINCT ids.project_id
                    FROM unnest(ARRAY[OLD.project_id, NEW.project_id]) AS ids(project_id)
                    ORDER BY ids.project_id
                LOOP
                    PERFORM 1 FROM public.projects
                    WHERE id = affected_projects.project_id FOR UPDATE;
                END LOOP;
            END IF;

            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$
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
        DECLARE affected_projects record;
        BEGIN
            IF TG_TABLE_NAME = 'projects' THEN
                IF TG_OP = 'INSERT' THEN
                    PERFORM public.assert_project_has_manager(NEW.id);
                ELSIF TG_OP = 'DELETE' THEN
                    PERFORM public.assert_project_has_manager(OLD.id);
                ELSE
                    FOR affected_projects IN
                        SELECT DISTINCT ids.project_id
                        FROM unnest(ARRAY[OLD.id, NEW.id]) AS ids(project_id)
                        ORDER BY ids.project_id
                    LOOP
                        PERFORM public.assert_project_has_manager(affected_projects.project_id);
                    END LOOP;
                END IF;
            ELSIF TG_TABLE_NAME = 'project_members' THEN
                IF TG_OP = 'INSERT' THEN
                    PERFORM public.assert_project_has_manager(NEW.project_id);
                ELSIF TG_OP = 'DELETE' THEN
                    PERFORM public.assert_project_has_manager(OLD.project_id);
                ELSE
                    FOR affected_projects IN
                        SELECT DISTINCT ids.project_id
                        FROM unnest(ARRAY[OLD.project_id, NEW.project_id]) AS ids(project_id)
                        ORDER BY ids.project_id
                    LOOP
                        PERFORM public.assert_project_has_manager(affected_projects.project_id);
                    END LOOP;
                END IF;
            ELSE
                IF TG_OP = 'INSERT' THEN
                    FOR affected_projects IN
                        SELECT DISTINCT pm.project_id
                        FROM public.project_members pm
                        WHERE pm.workspace_id = NEW.workspace_id
                          AND pm.user_id = NEW.user_id
                          AND pm.role = 'Project Manager'
                        ORDER BY pm.project_id
                    LOOP
                        PERFORM public.assert_project_has_manager(affected_projects.project_id);
                    END LOOP;
                ELSIF TG_OP = 'DELETE' THEN
                    FOR affected_projects IN
                        SELECT DISTINCT pm.project_id
                        FROM public.project_members pm
                        WHERE pm.workspace_id = OLD.workspace_id
                          AND pm.user_id = OLD.user_id
                          AND pm.role = 'Project Manager'
                        ORDER BY pm.project_id
                    LOOP
                        PERFORM public.assert_project_has_manager(affected_projects.project_id);
                    END LOOP;
                ELSE
                    FOR affected_projects IN
                        SELECT affected.project_id
                        FROM (
                            SELECT pm.project_id
                            FROM public.project_members pm
                            WHERE pm.workspace_id = OLD.workspace_id
                              AND pm.user_id = OLD.user_id
                              AND pm.role = 'Project Manager'
                            UNION
                            SELECT pm.project_id
                            FROM public.project_members pm
                            WHERE pm.workspace_id = NEW.workspace_id
                              AND pm.user_id = NEW.user_id
                              AND pm.role = 'Project Manager'
                        ) AS affected
                        ORDER BY affected.project_id
                    LOOP
                        PERFORM public.assert_project_has_manager(affected_projects.project_id);
                    END LOOP;
                END IF;
            END IF;
            RETURN NULL;
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
        CREATE TRIGGER workspace_members_lock_project_parents
        BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members
        FOR EACH ROW EXECUTE FUNCTION public.lock_workspace_member_project_parents()
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
        CREATE CONSTRAINT TRIGGER workspace_owner_invariant_workspace
        AFTER INSERT OR UPDATE OR DELETE ON public.workspaces
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
        CREATE CONSTRAINT TRIGGER project_manager_invariant_project
        AFTER INSERT OR UPDATE OR DELETE ON public.projects
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
        DO $$
        DECLARE affected_id uuid;
        BEGIN
            FOR affected_id IN
                SELECT id FROM public.workspaces WHERE archived_at IS NULL ORDER BY id
            LOOP
                PERFORM public.assert_workspace_has_owner(affected_id);
            END LOOP;
            FOR affected_id IN
                SELECT id FROM public.projects WHERE archived_at IS NULL ORDER BY id
            LOOP
                PERFORM public.assert_project_has_manager(affected_id);
            END LOOP;
        END;
        $$
        """
    )


def downgrade() -> None:
    """Restore the exact Sprint 2 trigger set and definitions."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    for trigger, table in (
        ("workspace_owner_invariant_workspace", "workspaces"),
        ("workspace_owner_invariant_member", "workspace_members"),
        ("workspace_members_lock_owner_parent", "workspace_members"),
        ("workspace_members_lock_project_parents", "workspace_members"),
        ("project_manager_invariant_project", "projects"),
        ("project_manager_invariant_member", "project_members"),
        ("project_manager_invariant_workspace_member", "workspace_members"),
        ("project_members_lock_manager_parent", "project_members"),
    ):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON public.{table}")

    for function in (
        "lock_workspace_member_project_parents",
        "lock_workspace_owner_parent",
        "assert_workspace_has_owner",
        "enforce_workspace_owner_invariant",
        "lock_project_manager_parent",
        "assert_project_has_manager",
        "enforce_project_manager_invariant",
    ):
        is_trigger = function.startswith("lock_") or function.startswith("enforce_")
        signature = "()" if is_trigger else "(uuid)"
        op.execute(f"DROP FUNCTION public.{function}{signature}")

    for function in (
        "lock_workspace_owner_parent",
        "assert_workspace_has_owner",
        "enforce_workspace_owner_invariant",
        "lock_project_manager_parent",
        "assert_project_has_manager",
        "enforce_project_manager_invariant",
    ):
        op.execute(
            f"ALTER FUNCTION public.{function}_sprint2() RENAME TO {function}"
            if function.startswith("lock_") or function.startswith("enforce_")
            else f"ALTER FUNCTION public.{function}_sprint2(uuid) RENAME TO {function}"
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
        CREATE TRIGGER workspace_owner_invariant_workspace
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
        CREATE TRIGGER project_members_lock_manager_parent
        BEFORE INSERT OR UPDATE OR DELETE ON public.project_members
        FOR EACH ROW EXECUTE FUNCTION public.lock_project_manager_parent()
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
