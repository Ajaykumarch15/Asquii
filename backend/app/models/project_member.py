"""Project roster; every roster member is a workspace member."""

from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class ProjectMember(TimestampMixin, Base):
    """Project membership role, constrained to manager/member."""

    __tablename__ = "project_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "user_id"],
            ["workspace_members.workspace_id", "workspace_members.user_id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("role IN ('Project Manager', 'Project Member')", name="role_allowed"),
        Index("ix_project_members_user_workspace_project", "user_id", "workspace_id", "project_id"),
        Index("ix_project_members_project_role", "project_id", "role"),
    )

    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    role: Mapped[str] = mapped_column(String(24), nullable=False)

    project = relationship("Project", back_populates="members", viewonly=True)
