"""Meeting and attendee request/response schemas."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MeetingType = Literal["Team sync", "Review", "Planning", "Retrospective", "Other"]


def _clean_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Value must not be blank")
    return value


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20_000)
    starts_at: datetime
    duration_minutes: int = Field(gt=0, le=1440)
    meeting_type: MeetingType = "Team sync"
    agenda: str = Field(default="", max_length=20_000)
    attendee_user_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        return _clean_text(value)

    @field_validator("description", "agenda")
    @classmethod
    def clean_optional_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("starts_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("starts_at must include a timezone offset")
        return value.astimezone(UTC)

    @field_validator("attendee_user_ids")
    @classmethod
    def unique_attendees(cls, values: list[UUID]) -> list[UUID]:
        if len(set(values)) != len(values):
            raise ValueError("Duplicate attendee IDs are not allowed")
        return values


class MeetingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=1440)
    meeting_type: MeetingType | None = None
    agenda: str | None = Field(default=None, max_length=20_000)
    attendee_user_ids: list[UUID] | None = Field(default=None, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        return _clean_text(value) if value is not None else value

    @field_validator("description", "agenda")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("starts_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("starts_at must include a timezone offset")
        return value.astimezone(UTC)

    @field_validator("attendee_user_ids")
    @classmethod
    def unique_attendees(cls, values: list[UUID] | None) -> list[UUID] | None:
        if values is not None and len(set(values)) != len(values):
            raise ValueError("Duplicate attendee IDs are not allowed")
        return values

    @model_validator(mode="after")
    def validate_patch(self) -> "MeetingUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one supported field is required")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Meeting update fields cannot be null")
        return self


class MeetingAttendeeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID


class MeetingAttendeeResponse(BaseModel):
    user_id: UUID
    display_name: str
    created_at: datetime


class MeetingResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID
    title: str
    description: str
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    meeting_type: MeetingType
    agenda: str
    created_at: datetime
    updated_at: datetime
    organizer_user_id: UUID | None
    organizer_display_name: str | None
    attendee_count: int


class MeetingDetailResponse(MeetingResponse):
    attendees: list[MeetingAttendeeResponse]


class MeetingDeleteResponse(BaseModel):
    deleted: bool
