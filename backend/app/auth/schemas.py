"""Public, non-secret authentication response schemas."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CurrentProfileResponse(BaseModel):
    """Safe profile fields returned for the verified current user."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    email: str | None
    display_name: str
    job_title: str | None


class CurrentProfileUpdate(BaseModel):
    """Self-service profile fields; email and roles stay provider/server owned."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Display name must not be blank")
        return normalized

    @field_validator("job_title")
    @classmethod
    def normalize_job_title(cls, value: str | None) -> str | None:
        # An empty job title clears the field instead of storing whitespace.
        if value is None:
            return None
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def require_editable_field(self) -> "CurrentProfileUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one supported field is required")
        if "display_name" in self.model_fields_set and self.display_name is None:
            raise ValueError("Display name must not be blank")
        return self
