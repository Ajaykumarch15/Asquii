"""Public, non-secret authentication response schemas."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CurrentProfileResponse(BaseModel):
    """Safe profile fields returned for the verified current user."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str | None
    display_name: str
    job_title: str | None
