"""Workspace-scoped project."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class Project(TimestampMixin, Base):
    """Project visibility is workspace-wide; membership grants collaboration."""

    __tablename__ = "projects"
    __table_args__ = (
        ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        UniqueConstraint("id", "workspace_id", name="uq_projects_id_workspace_id"),
        CheckConstraint(
            "status IN ('In progress', 'In review', 'Complete')", name="status_allowed"
        ),
        CheckConstraint("progress_mode IN ('auto', 'manual')", name="progress_mode_allowed"),
        CheckConstraint(
            "manual_progress IS NULL OR manual_progress BETWEEN 0 AND 100",
            name="manual_progress_range",
        ),
        Index("ix_projects_workspace_archived_name", "workspace_id", "archived_at", "name"),
        Index("ix_projects_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    status: Mapped[str] = mapped_column(String(24), nullable=False, server_default="In progress")
    progress_mode: Mapped[str] = mapped_column(String(8), nullable=False, server_default="auto")
    manual_progress: Mapped[int | None] = mapped_column(SmallInteger)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace = relationship("Workspace", back_populates="projects")
    members = relationship("ProjectMember", back_populates="project", viewonly=True)
    milestones = relationship("Milestone", back_populates="project", viewonly=True)
    tasks = relationship("Task", back_populates="project", viewonly=True)
    meetings = relationship("Meeting", back_populates="project", viewonly=True)
    resources = relationship("Resource", back_populates="project", viewonly=True)
