"""Project milestone."""

from datetime import date
from uuid import UUID

from sqlalchemy import Date, ForeignKeyConstraint, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class Milestone(TimestampMixin, Base):
    """Milestone design follows the approved name and due-date scope."""

    __tablename__ = "milestones"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="RESTRICT",
        ),
        Index("ix_milestones_project_due_date", "project_id", "due_date"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)

    project = relationship("Project", back_populates="milestones", viewonly=True)
