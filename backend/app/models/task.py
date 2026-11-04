"""Tasks, task subtasks, and task comments."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class Task(TimestampMixin, Base):
    """Project task with an optional project-member assignee."""

    __tablename__ = "tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "project_id", "assignee_user_id"],
            [
                "project_members.workspace_id",
                "project_members.project_id",
                "project_members.user_id",
            ],
            ondelete="RESTRICT",
        ),
        UniqueConstraint("id", "workspace_id", "project_id", name="uq_tasks_id_workspace_project"),
        CheckConstraint(
            "status IN ('Backlog', 'To do', 'In progress', 'Dev completed', "
            "'In review', 'Complete')",
            name="status_allowed",
        ),
        CheckConstraint("priority IN ('Low', 'Medium', 'High')", name="priority_allowed"),
        Index("ix_tasks_project_status_position", "project_id", "status", "position"),
        Index("ix_tasks_assignee_due_date", "assignee_user_id", "due_date"),
        Index(
            "ix_tasks_workspace_project_updated",
            "workspace_id",
            "project_id",
            text("updated_at DESC"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    labels: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, server_default="To do")
    due_date: Mapped[date | None] = mapped_column(Date)
    assignee_user_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    priority: Mapped[str] = mapped_column(String(8), nullable=False, server_default="Medium")
    position: Mapped[Decimal] = mapped_column(Numeric, nullable=False, server_default="0")

    project = relationship("Project", back_populates="tasks", viewonly=True)
    subtasks = relationship("TaskSubtask", back_populates="task", passive_deletes=True)
    comments = relationship("TaskComment", back_populates="task", viewonly=True)


class TaskSubtask(TimestampMixin, Base):
    """Ordered child item for a task."""

    __tablename__ = "task_subtasks"
    __table_args__ = (Index("ix_task_subtasks_task_position", "task_id", "position"),)

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    task_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    is_done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    position: Mapped[Decimal] = mapped_column(Numeric, nullable=False, server_default="0")

    task = relationship("Task", back_populates="subtasks")


class TaskComment(TimestampMixin, Base):
    """Comment associated with a task and its project author membership."""

    __tablename__ = "task_comments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id", "project_id"],
            ["tasks.id", "tasks.workspace_id", "tasks.project_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "project_id", "author_user_id"],
            [
                "project_members.workspace_id",
                "project_members.project_id",
                "project_members.user_id",
            ],
            ondelete="RESTRICT",
        ),
        Index("ix_task_comments_task_created", "task_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    task_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    author_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    task = relationship("Task", back_populates="comments", viewonly=True)
