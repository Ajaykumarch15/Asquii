"""Safe activity feed response schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ActivityResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None
    actor_user_id: UUID | None
    actor_display_name: str | None
    action: str
    resource_type: str
    resource_id: UUID
    metadata: dict[str, object]
    created_at: datetime


class ActivityPage(BaseModel):
    items: list[ActivityResponse]
    total: int
    limit: int
    offset: int
