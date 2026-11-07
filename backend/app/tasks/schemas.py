"""Request and response schemas for tasks, subtasks, and comments."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TaskStatus = Literal[
    "Backlog",
    "To do",
    "In progress",
    "Dev completed",
    "In review",
    "Complete",
]
TaskPriority = Literal["Low", "Medium", "High"]


def _normalize_title(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("Title must not be blank")
    return normalized


def _validate_position(value: Decimal | None) -> Decimal | None:
    if value is not None and not value.is_finite():
        raise ValueError("Position must be a finite number")
    return value


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20_000)
    labels: list[str] = Field(default_factory=list, max_length=100)
    status: TaskStatus = "To do"
    due_date: date | None = None
    assignee_user_id: UUID | None = None
    priority: TaskPriority = "Medium"
    position: Decimal = Decimal("0")

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_title(value)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("labels")
    @classmethod
    def normalize_labels(cls, values: list[str]) -> list[str]:
        labels = [label.strip() for label in values]
        if any(not label for label in labels):
            raise ValueError("Labels must not be blank")
        return labels

    @field_validator("position")
    @classmethod
    def finite_position(cls, value: Decimal) -> Decimal:
        return _validate_position(value)  # type: ignore[return-value]


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=20_000)
    labels: list[str] | None = Field(default=None, max_length=100)
    status: TaskStatus | None = None
    due_date: date | None = None
    assignee_user_id: UUID | None = None
    priority: TaskPriority | None = None
    position: Decimal | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        return _normalize_title(value) if value is not None else value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("labels")
    @classmethod
    def normalize_labels(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return values
        labels = [label.strip() for label in values]
        if any(not label for label in labels):
            raise ValueError("Labels must not be blank")
        return labels

    @field_validator("position")
    @classmethod
    def finite_position(cls, value: Decimal | None) -> Decimal | None:
        return _validate_position(value)

    @model_validator(mode="after")
    def validate_patch(self) -> "TaskUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one supported field is required")
        nullable = {"due_date", "assignee_user_id"}
        if any(
            field not in nullable and getattr(self, field) is None
            for field in self.model_fields_set
        ):
            raise ValueError("Only due_date and assignee_user_id may be null")
        return self


class TaskAssigneeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignee_user_id: UUID | None


class TaskResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID
    title: str
    description: str
    labels: list[str]
    status: TaskStatus
    due_date: date | None
    assignee_user_id: UUID | None
    assignee_display_name: str | None
    priority: TaskPriority
    position: Decimal
    created_at: datetime
    updated_at: datetime
    creator_user_id: UUID | None
    creator_display_name: str | None


class TaskDetailResponse(TaskResponse):
    subtask_count: int
    completed_subtask_count: int


class TaskSubtaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=240)
    is_done: bool = False
    position: Decimal = Decimal("0")

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_title(value)

    @field_validator("position")
    @classmethod
    def finite_position(cls, value: Decimal) -> Decimal:
        return _validate_position(value)  # type: ignore[return-value]


class TaskSubtaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=240)
    is_done: bool | None = None
    position: Decimal | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        return _normalize_title(value) if value is not None else value

    @field_validator("position")
    @classmethod
    def finite_position(cls, value: Decimal | None) -> Decimal | None:
        return _validate_position(value)

    @model_validator(mode="after")
    def validate_patch(self) -> "TaskSubtaskUpdate":
        if not self.model_fields_set or any(
            getattr(self, field) is None for field in self.model_fields_set
        ):
            raise ValueError("Provide at least one non-null subtask field")
        return self


class TaskSubtaskResponse(BaseModel):
    id: UUID
    task_id: UUID
    title: str
    is_done: bool
    position: Decimal
    created_at: datetime
    updated_at: datetime


class TaskCommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Comment must not be blank")
        return normalized


class TaskCommentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=20_000)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Comment must not be blank")
        return normalized


class TaskCommentResponse(BaseModel):
    id: UUID
    task_id: UUID
    workspace_id: UUID
    project_id: UUID
    author_user_id: UUID
    author_display_name: str
    body: str | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
