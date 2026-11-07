"""Project meetings and project-member attendance."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class Meeting(TimestampMixin, Base):
    """Meeting stores an event instant and positive duration in minutes."""

    __tablename__ = "meetings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "workspace_id", "project_id", "id", name="uq_meetings_workspace_project_id"
        ),
        CheckConstraint("duration_minutes > 0", name="duration_positive"),
        CheckConstraint(
            "meeting_type IN ('Team sync', 'Review', 'Planning', 'Retrospective', 'Other')",
            name="meeting_type_allowed",
        ),
        Index("ix_meetings_project_starts_at", "project_id", "starts_at"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    meeting_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Team sync"
    )
    agenda: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    project = relationship("Project", back_populates="meetings", viewonly=True)
    attendees = relationship("MeetingAttendee", back_populates="meeting", viewonly=True)


class MeetingAttendee(Base):
    """Attendee must be a member of the meeting's same project."""

    __tablename__ = "meeting_attendees"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "project_id", "meeting_id"],
            ["meetings.workspace_id", "meetings.project_id", "meetings.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "project_id", "user_id"],
            [
                "project_members.workspace_id",
                "project_members.project_id",
                "project_members.user_id",
            ],
            ondelete="RESTRICT",
        ),
        Index("ix_meeting_attendees_user_meeting", "user_id", "meeting_id"),
    )

    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    meeting_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    meeting = relationship("Meeting", back_populates="attendees", viewonly=True)
