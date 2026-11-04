"""Application profile linked to a Supabase Auth user."""

from uuid import UUID

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.external import auth_users
from app.models.mixins import TimestampMixin


class Profile(TimestampMixin, Base):
    """Non-secret profile attributes; credentials remain owned by Supabase Auth."""

    __tablename__ = "profiles"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(auth_users.c.id, ondelete="CASCADE"),
        primary_key=True,
    )
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    job_title: Mapped[str | None] = mapped_column(String(120))

    workspace_memberships = relationship("WorkspaceMember", back_populates="profile")
