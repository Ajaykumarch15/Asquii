"""Relax UPDATE-policy USING clauses so SELECT ... FOR UPDATE reads work for members.

Revision ID: 0005_rls_lock_read_relaxations
Revises: 0004_enable_rls_and_policies
Create Date: 2026-11-06

PostgreSQL applies the UPDATE policy's USING expression to rows a `SELECT ...
FOR UPDATE` statement reads (row locking requires the update policy path, see
CREATE POLICY docs: "If a query contains FOR UPDATE ... the update policy's
using expressions are applied"). The 0004 policies were written as though FOR
UPDATE only consulted the SELECT policy, which broke legitimate service flows
that lock rows before acting:

- accept_invitation reads the workspace row FOR UPDATE before membership
  exists, and remove_member leaves (`remove_member` self-soft-leave) locks it
  as a non-admin member. The workspaces UPDATE USING (`has_workspace_role`)
  hid the row on those locked reads, so acceptance failed with "Invitation is
  invalid or unavailable" and member self-leave would fail the same way.
- Collaborator flows (create task/meeting/resource and similar) lock the
  project row with _context/_project lock=True. The projects UPDATE USING
  (`can_manage_project`) hid the project for collaborators, so any task the
  "collaborator" role may create would 403 under fresh reads.

Fix: widen only the USING expressions to also allow read-for-lock by the
actors the SELECT policies already trust (workspace members / invitees with a
matching pending invitation, and project readers). WITH CHECK stays
restrictive, so actual update commands still require the original write
authority — a member/invitee still cannot run an UPDATE through RLS; USING is
here only to model row locking, with the service layer remaining the
authoritative check.

Defense-in-depth caveat carried over from 0004: identity comes from a
client-set GUC, so this is defense-in-depth behind the service layer, not
protection against holders of asquii_app credentials.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005_rls_lock_read_relaxations"
down_revision: str | None = "0004_enable_rls_and_policies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RELAXATIONS = (
    (
        "workspaces",
        "asquii_workspaces_update",
        # Old USING (kept as WITH CHECK): only Owner/Admin.
        "private.has_workspace_role(id, ARRAY['Owner', 'Admin'])",
        # New USING: plus members (self-leave locks) and invitees (accept locks).
        "private.has_workspace_role(id, ARRAY['Owner', 'Admin']) "
        "OR private.is_workspace_member(id) "
        "OR private.email_has_pending_invitation(id, NULL)",
    ),
    (
        "projects",
        "asquii_projects_update",
        # Old USING (kept as WITH CHECK): only project managers.
        "private.can_manage_project(workspace_id, id)",
        # New USING: plus anyone who may read the project (collaborator lock reads).
        "private.can_manage_project(workspace_id, id) OR private.can_read_project(workspace_id, id)",
    ),
)


def upgrade() -> None:
    """Widen the two UPDATE USING expressions; keep every WITH CHECK as before."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    op.execute(
        "DO $audit$\n"
        "BEGIN\n"
        "    IF current_user <> 'postgres' THEN\n"
        "        RAISE EXCEPTION 'Migration 0005 must run as the postgres table owner'\n"
        "            USING DETAIL = 'Current migration role: ' || current_user,\n"
        "                  HINT = 'Run alembic with DATABASE_MIGRATE_URL';\n"
        "    END IF;\n"
        "END;\n"
        "$audit$;"
    )
    for table, policy, check_expr, using_expr in RELAXATIONS:
        op.execute(
            f"ALTER POLICY {policy} ON public.{table} "
            f"USING ({using_expr}) WITH CHECK ({check_expr})"
        )


def downgrade() -> None:
    """Restore the 0004 policy expressions (owner/manager-only USING again)."""

    op.execute("SET LOCAL search_path TO public, pg_catalog")
    for table, policy, check_expr, using_expr in RELAXATIONS:
        op.execute(
            f"ALTER POLICY {policy} ON public.{table} "
            f"USING ({check_expr}) WITH CHECK ({check_expr})"
        )
