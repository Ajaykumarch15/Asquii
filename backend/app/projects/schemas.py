"""Request and response schemas for project and milestone management."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ProjectStatus = Literal["In progress", "In review", "Complete"]
ProgressMode = Literal["auto", "manual"]
ProjectRole = Literal["Project Manager", "Project Member"]


def _clean_name(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("Name must not be blank")
    return normalized


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=5000)
    status: ProjectStatus = "In progress"
    progress_mode: ProgressMode = "auto"
    manual_progress: int | None = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return value.strip()


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=5000)
    status: ProjectStatus | None = None
    progress_mode: ProgressMode | None = None
    manual_progress: int | None = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @model_validator(mode="after")
    def validate_patch(self) -> "ProjectUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one supported field is required")
        if any(
            field != "manual_progress" and getattr(self, field) is None
            for field in self.model_fields_set
        ):
            raise ValueError("Only manual_progress may be null")
        return self


class ProjectResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str
    status: ProjectStatus
    progress_mode: ProgressMode
    manual_progress: int | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    current_user_role: ProjectRole | None
    member_count: int
    manager_count: int


class ProjectMemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID
    role: ProjectRole


class ProjectMemberRoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: ProjectRole


class ProjectMemberResponse(BaseModel):
    user_id: UUID
    display_name: str
    job_title: str | None
    role: ProjectRole
    workspace_member_active: bool
    created_at: datetime
    updated_at: datetime


class ManagerTransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_manager_user_id: UUID


class ManagerTransferResponse(BaseModel):
    workspace_id: UUID
    project_id: UUID
    previous_manager_user_id: UUID
    new_manager_user_id: UUID


class MilestoneCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    due_date: date

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return _clean_name(value)


class MilestoneUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    due_date: date | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else value

    @model_validator(mode="after")
    def validate_patch(self) -> "MilestoneUpdate":
        if not self.model_fields_set or any(
            getattr(self, field) is None for field in self.model_fields_set
        ):
            raise ValueError("Provide at least one non-null milestone field")
        return self


class MilestoneResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID
    name: str
    due_date: date
    created_at: datetime
    updated_at: datetime
