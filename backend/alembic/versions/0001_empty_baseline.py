"""Empty baseline for the Sprint 1 schema foundation.

Revision ID: 0001_empty_baseline
Revises:
Create Date: 2026-11-03
"""

from collections.abc import Sequence

revision: str = "0001_empty_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Establish only Alembic history; no product schema is created."""


def downgrade() -> None:
    """Remove only the baseline revision marker."""
