"""Authenticated workspace and project activity feed endpoints."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.activities import service
from app.activities.schemas import ActivityPage, ActivityResponse
from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db

workspace_router = APIRouter(prefix="/workspaces/{workspace_id}/activities", tags=["activities"])
project_router = APIRouter(
    prefix="/workspaces/{workspace_id}/projects/{project_id}/activities", tags=["activities"]
)
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]
SortField = Literal["created_at", "action", "resource_type"]
SortDirection = Literal["asc", "desc"]


def _feed_parameters(
    limit: int,
    offset: int,
    actor_user_id: UUID | None,
    action: str | None,
    resource_type: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
    sort_by: SortField,
    sort_direction: SortDirection,
) -> dict[str, object]:
    return {
        "actor_user_id": actor_user_id,
        "action": action,
        "resource_type": resource_type,
        "starts_after": starts_after,
        "starts_before": starts_before,
        "limit": limit,
        "offset": offset,
        "sort_by": sort_by,
        "sort_direction": sort_direction,
    }


@workspace_router.get("", response_model=ActivityPage)
def workspace_activity_feed(
    workspace_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    project_id: UUID | None = None,
    actor_user_id: UUID | None = None,
    action: Annotated[str | None, Query(max_length=100)] = None,
    resource_type: Annotated[str | None, Query(max_length=100)] = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
    sort_by: SortField = "created_at",
    sort_direction: SortDirection = "desc",
) -> ActivityPage:
    params = _feed_parameters(
        limit,
        offset,
        actor_user_id,
        action,
        resource_type,
        starts_after,
        starts_before,
        sort_by,
        sort_direction,
    )
    return ActivityPage(
        **service.workspace_feed(db, workspace_id, user.user_id, project_id=project_id, **params)
    )


@workspace_router.get("/{activity_id}", response_model=ActivityResponse)
def get_workspace_activity(
    workspace_id: UUID, activity_id: UUID, user: UserDep, db: DBDep
) -> ActivityResponse:
    return ActivityResponse(
        **service.workspace_activity_detail(db, workspace_id, activity_id, user.user_id)
    )


@project_router.get("", response_model=ActivityPage)
def project_activity_feed(
    workspace_id: UUID,
    project_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    actor_user_id: UUID | None = None,
    action: Annotated[str | None, Query(max_length=100)] = None,
    resource_type: Annotated[str | None, Query(max_length=100)] = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
    sort_by: SortField = "created_at",
    sort_direction: SortDirection = "desc",
) -> ActivityPage:
    params = _feed_parameters(
        limit,
        offset,
        actor_user_id,
        action,
        resource_type,
        starts_after,
        starts_before,
        sort_by,
        sort_direction,
    )
    return ActivityPage(
        **service.project_feed(db, workspace_id, project_id, user.user_id, **params)
    )


@project_router.get("/{activity_id}", response_model=ActivityResponse)
def get_project_activity(
    workspace_id: UUID,
    project_id: UUID,
    activity_id: UUID,
    user: UserDep,
    db: DBDep,
) -> ActivityResponse:
    return ActivityResponse(
        **service.project_activity_detail(db, workspace_id, project_id, activity_id, user.user_id)
    )
