"""Workspace invitations store only a one-way token hash."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class WorkspaceInvitation(TimestampMixin, Base):
    """Invitation lifecycle uses accepted/revoked timestamps and expiry."""

    __tablename__ = "workspace_invitations"
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(
            ["workspace_id", "invited_by_user_id"],
            ["workspace_members.workspace_id", "workspace_members.user_id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("role IN ('Admin', 'Member')", name="role_allowed"),
        CheckConstraint(
            "email_normalized = lower(btrim(email_normalized))", name="email_normalized"
        ),
        CheckConstraint(
            "accepted_at IS NULL OR revoked_at IS NULL", name="terminal_state_exclusive"
        ),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        Index("uq_workspace_invitations_token_hash", "token_hash", unique=True),
        Index(
            "uq_workspace_invitations_workspace_email_pending",
            "workspace_id",
            "email_normalized",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
        Index("ix_workspace_invitations_workspace_expires_at", "workspace_id", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    email_normalized: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    invited_by_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace = relationship("Workspace", back_populates="invitations", foreign_keys=[workspace_id])
