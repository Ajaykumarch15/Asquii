"""Resource and star preference request/response schemas."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

ResourceType = Literal["Document", "Spreadsheet", "Design file", "Folder", "Link"]


def _clean(value: str, label: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{label} must not be blank")
    return value


class ResourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=240)
    type: ResourceType
    category: str = Field(min_length=1, max_length=100)
    detail: str = Field(max_length=20_000)
    external_url: HttpUrl | None = None
    storage_object_path: str | None = Field(default=None, max_length=1024)
    size_bytes: int | None = Field(default=None, ge=0)
    tags: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return _clean(value, "Name")

    @field_validator("category")
    @classmethod
    def clean_category(cls, value: str) -> str:
        return _clean(value, "Category")

    @field_validator("detail", "storage_object_path")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values: list[str]) -> list[str]:
        result = [tag.strip() for tag in values]
        if any(not tag for tag in result):
            raise ValueError("Tags must not be blank")
        return result


class ResourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=240)
    type: ResourceType | None = None
    category: str | None = Field(default=None, min_length=1, max_length=100)
    detail: str | None = Field(default=None, max_length=20_000)
    external_url: HttpUrl | None = None
    storage_object_path: str | None = Field(default=None, max_length=1024)
    size_bytes: int | None = Field(default=None, ge=0)
    tags: list[str] | None = Field(default=None, max_length=100)
    owner_user_id: UUID | None = None

    @field_validator("name", "category")
    @classmethod
    def clean_required_text(cls, value: str | None) -> str | None:
        return _clean(value, "Value") if value is not None else value

    @field_validator("detail", "storage_object_path")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else value

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return values
        result = [tag.strip() for tag in values]
        if any(not tag for tag in result):
            raise ValueError("Tags must not be blank")
        return result

    @model_validator(mode="after")
    def validate_patch(self) -> "ResourceUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one supported field is required")
        nullable = {"external_url", "storage_object_path", "size_bytes", "owner_user_id"}
        if any(
            field not in nullable and getattr(self, field) is None
            for field in self.model_fields_set
        ):
            raise ValueError("Only optional resource fields may be null")
        return self


class ResourceResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID
    owner_user_id: UUID
    owner_display_name: str
    name: str
    type: ResourceType
    category: str
    detail: str
    external_url: str | None
    storage_object_path: str | None
    size_bytes: int | None
    tags: list[str]
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    is_starred: bool


class ResourceStarResponse(BaseModel):
    resource_id: UUID
    starred: bool
