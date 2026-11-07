"""Project resources and user-specific resource preferences."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import TimestampMixin


class Resource(TimestampMixin, Base):
    """Metadata-only resource owned by a project member."""

    __tablename__ = "resources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id"],
            ["projects.id", "projects.workspace_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["workspace_id", "project_id", "owner_user_id"],
            [
                "project_members.workspace_id",
                "project_members.project_id",
                "project_members.user_id",
            ],
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "type IN ('Document', 'Spreadsheet', 'Design file', 'Folder', 'Link')",
            name="type_allowed",
        ),
        CheckConstraint("size_bytes IS NULL OR size_bytes >= 0", name="size_nonnegative"),
        Index(
            "ix_resources_project_deleted_updated",
            "project_id",
            "deleted_at",
            text("updated_at DESC"),
        ),
        Index("ix_resources_owner_project", "owner_user_id", "project_id"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    external_url: Mapped[str | None] = mapped_column(Text)
    storage_object_path: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project = relationship("Project", back_populates="resources", viewonly=True)
    preferences = relationship("UserResourcePreference", back_populates="resource")


class UserResourcePreference(TimestampMixin, Base):
    """Per-user resource state; starred is never stored on resources."""

    __tablename__ = "user_resource_preferences"
    __table_args__ = (
        ForeignKeyConstraint(["user_id"], ["profiles.user_id"], ondelete="RESTRICT"),
        ForeignKeyConstraint(["resource_id"], ["resources.id"], ondelete="RESTRICT"),
        Index("ix_user_resource_preferences_resource_user", "resource_id", "user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    resource_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    resource = relationship("Resource", back_populates="preferences")
