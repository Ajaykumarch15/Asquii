"""Authenticated project resource and personal star endpoints."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db
from app.resources import service
from app.resources.schemas import (
    ResourceCreate,
    ResourceResponse,
    ResourceStarResponse,
    ResourceUpdate,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/projects/{project_id}/resources", tags=["resources"]
)
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]
ResourceTypeFilter = Literal["Document", "Spreadsheet", "Design file", "Folder", "Link"]


@router.post("", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
def create_resource(
    workspace_id: UUID,
    project_id: UUID,
    body: ResourceCreate,
    user: UserDep,
    db: DBDep,
) -> ResourceResponse:
    values = body.model_dump()
    if values["external_url"] is not None:
        values["external_url"] = str(values["external_url"])
    return ResourceResponse(
        **service.create_resource(db, workspace_id, project_id, user.user_id, **values)
    )


@router.get("", response_model=list[ResourceResponse])
def list_resources(
    workspace_id: UUID,
    project_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str | None, Query(max_length=160)] = None,
    type_filter: Annotated[ResourceTypeFilter | None, Query(alias="type")] = None,
    category: Annotated[str | None, Query(max_length=100)] = None,
    owner_user_id: UUID | None = None,
    starred: bool | None = None,
    sort_by: Literal[
        "created_at",
        "updated_at",
        "name",
        "type",
        "category",
        "size_bytes",
    ] = "updated_at",
    sort_direction: Literal["asc", "desc"] = "desc",
) -> list[ResourceResponse]:
    return [
        ResourceResponse(**row)
        for row in service.list_resources(
            db,
            workspace_id,
            project_id,
            user.user_id,
            limit=limit,
            offset=offset,
            search=q,
            resource_type=type_filter,
            category=category,
            owner_user_id=owner_user_id,
            starred=starred,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    ]


@router.get("/{resource_id}", response_model=ResourceResponse)
def get_resource(
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    user: UserDep,
    db: DBDep,
) -> ResourceResponse:
    return ResourceResponse(
        **service.get_resource(db, workspace_id, project_id, resource_id, user.user_id)
    )


@router.patch("/{resource_id}", response_model=ResourceResponse)
def update_resource(
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    body: ResourceUpdate,
    user: UserDep,
    db: DBDep,
) -> ResourceResponse:
    changes = body.model_dump(exclude_unset=True)
    if changes.get("external_url") is not None:
        changes["external_url"] = str(changes["external_url"])
    return ResourceResponse(
        **service.update_resource(db, workspace_id, project_id, resource_id, user.user_id, changes)
    )


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.delete_resource(db, workspace_id, project_id, resource_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{resource_id}/star", response_model=ResourceStarResponse)
def star_resource(
    workspace_id: UUID, project_id: UUID, resource_id: UUID, user: UserDep, db: DBDep
) -> ResourceStarResponse:
    return ResourceStarResponse(
        **service.set_starred(db, workspace_id, project_id, resource_id, user.user_id, True)
    )


@router.delete(
    "/{resource_id}/star", response_model=ResourceStarResponse, status_code=status.HTTP_200_OK
)
def unstar_resource(
    workspace_id: UUID, project_id: UUID, resource_id: UUID, user: UserDep, db: DBDep
) -> ResourceStarResponse:
    return ResourceStarResponse(
        **service.set_starred(db, workspace_id, project_id, resource_id, user.user_id, False)
    )
