"""Validated workspace, member, and invitation API schemas."""

import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Workspace name must not be blank")
        return normalized


class WorkspaceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Workspace name must not be blank")
        return normalized

    @model_validator(mode="after")
    def require_name(self) -> "WorkspaceUpdate":
        if "name" not in self.model_fields_set or self.name is None:
            raise ValueError("At least one supported field is required")
        return self


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    role: str
    created_at: datetime
    updated_at: datetime


class WorkspaceMemberResponse(BaseModel):
    user_id: UUID
    display_name: str
    job_title: str | None
    role: str
    created_at: datetime


class MemberRoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["Admin", "Member"]


class OwnershipTransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_owner_user_id: UUID


class OwnershipTransferResponse(BaseModel):
    workspace_id: UUID
    new_owner_user_id: UUID


class InvitationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    role: Literal["Admin", "Member"]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("A valid email address is required")
        return normalized


class InvitationAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=32, max_length=512)


class InvitationResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    email: str
    role: str
    invited_by_user_id: UUID
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    status: Literal["pending", "expired", "accepted", "revoked"]


class InvitationCreatedResponse(InvitationResponse):
    token: str


class InvitationAcceptedResponse(BaseModel):
    workspace_id: UUID
    role: str
