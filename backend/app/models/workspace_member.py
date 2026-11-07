"""Workspace membership and workspace role."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Index, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class WorkspaceMember(TimestampMixin, Base):
    """A user's workspace membership; Owner is a constrained role on this row."""

    __tablename__ = "workspace_members"
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["user_id"], ["profiles.user_id"], ondelete="RESTRICT"),
        CheckConstraint("role IN ('Owner', 'Admin', 'Member')", name="role_allowed"),
        Index("ix_workspace_members_user_workspace", "user_id", "workspace_id"),
        Index("ix_workspace_members_workspace_role", "workspace_id", "role"),
        Index(
            "uq_workspace_members_active_owner",
            "workspace_id",
            unique=True,
            postgresql_where=text("role = 'Owner' AND removed_at IS NULL"),
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace = relationship("Workspace", back_populates="members")
    profile = relationship("Profile", back_populates="workspace_memberships")
