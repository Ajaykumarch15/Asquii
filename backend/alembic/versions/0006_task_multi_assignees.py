"""Allow multiple assignees per task via a task_assignees junction table.

Revision ID: 0006_task_multi_assignees
Revises: 0005_rls_lock_read_relaxations
Create Date: 2026-11-09

The single `tasks.assignee_user_id` column is replaced by the
`task_assignees` junction table (one row per task/project-member pair). The
project-member foreign key moves with it, so every assignee is still required
to be an active member of the task's project. Existing single assignees are
backfilled before the old column and its index are dropped.

The downgrade restores the single-assignee column and keeps the
lexicographically first assignee per task (the original column could only
hold one), so a downgrade is intentionally lossy when a task has several.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006_task_multi_assignees"
down_revision: str | None = "0005_rls_lock_read_relaxations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the junction table, backfill assignees, and drop the old column."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    op.execute(
        "DO $audit$\n"
        "BEGIN\n"
        "    IF current_user <> 'postgres' THEN\n"
        "        RAISE EXCEPTION 'Migration 0006 must run as the postgres table owner'\n"
        "            USING DETAIL = 'Current migration role: ' || current_user,\n"
        "                  HINT = 'Run alembic with DATABASE_MIGRATE_URL';\n"
        "    END IF;\n"
        "END;\n"
        "$audit$;"
    )

    op.execute(
        """
        CREATE TABLE task_assignees (
            task_id uuid NOT NULL,
            user_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            CONSTRAINT pk_task_assignees PRIMARY KEY (task_id, user_id),
            CONSTRAINT fk_task_assignees_task_id_tasks
                FOREIGN KEY (task_id, workspace_id, project_id)
                REFERENCES tasks (id, workspace_id, project_id) ON DELETE CASCADE,
            CONSTRAINT fk_task_assignees_workspace_id_project_members
                FOREIGN KEY (workspace_id, project_id, user_id)
                REFERENCES project_members (workspace_id, project_id, user_id)
                ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_task_assignees_user_id ON task_assignees (user_id)"
    )
    op.execute(
        "CREATE INDEX ix_task_assignees_workspace_project_user "
        "ON task_assignees (workspace_id, project_id, user_id)"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_assignees TO asquii_app"
    )

    op.execute(
        """
        INSERT INTO task_assignees (task_id, user_id, workspace_id, project_id)
        SELECT id, assignee_user_id, workspace_id, project_id
        FROM tasks
        WHERE assignee_user_id IS NOT NULL
        """
    )

    op.execute("DROP INDEX IF EXISTS ix_tasks_assignee_due_date")
    op.execute("ALTER TABLE tasks DROP COLUMN assignee_user_id")

    op.execute("ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY asquii_task_assignees_select ON public.task_assignees "
        "FOR SELECT TO asquii_app "
        "USING (private.can_read_project(workspace_id, project_id))"
    )
    op.execute(
        "CREATE POLICY asquii_task_assignees_insert ON public.task_assignees "
        "FOR INSERT TO asquii_app "
        "WITH CHECK (private.can_collaborate(workspace_id, project_id))"
    )
    op.execute(
        "CREATE POLICY asquii_task_assignees_update ON public.task_assignees "
        "FOR UPDATE TO asquii_app "
        "USING (private.can_collaborate(workspace_id, project_id)) "
        "WITH CHECK (private.can_collaborate(workspace_id, project_id))"
    )
    op.execute(
        "CREATE POLICY asquii_task_assignees_delete ON public.task_assignees "
        "FOR DELETE TO asquii_app "
        "USING (private.can_collaborate(workspace_id, project_id))"
    )


def downgrade() -> None:
    """Restore the single-assignee column (keeping one assignee per task)."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")

    op.execute("ALTER TABLE tasks ADD COLUMN assignee_user_id uuid")
    op.execute(
        """
        UPDATE tasks
        SET assignee_user_id = picked.user_id
        FROM (
            SELECT DISTINCT ON (task_id) task_id, user_id
            FROM task_assignees
            ORDER BY task_id, user_id
        ) AS picked
        WHERE tasks.id = picked.task_id
        """
    )
    op.execute(
        "ALTER TABLE tasks "
        "ADD CONSTRAINT fk_tasks_workspace_id_project_members "
        "FOREIGN KEY (workspace_id, project_id, assignee_user_id) "
        "REFERENCES project_members (workspace_id, project_id, user_id) "
        "ON DELETE RESTRICT"
    )
    op.execute(
        "CREATE INDEX ix_tasks_assignee_due_date ON tasks (assignee_user_id, due_date)"
    )

    for policy in (
        "asquii_task_assignees_select",
        "asquii_task_assignees_insert",
        "asquii_task_assignees_update",
        "asquii_task_assignees_delete",
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON public.task_assignees")

    op.execute("ALTER TABLE task_assignees DISABLE ROW LEVEL SECURITY")
    op.execute("DROP TABLE task_assignees")
