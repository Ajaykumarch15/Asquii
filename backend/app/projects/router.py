"""Authenticated project and milestone endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db
from app.projects import service
from app.projects.schemas import (
    ManagerTransferRequest,
    ManagerTransferResponse,
    MilestoneCreate,
    MilestoneResponse,
    MilestoneUpdate,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberResponse,
    ProjectMemberRoleUpdate,
    ProjectResponse,
    ProjectStatus,
    ProjectUpdate,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/projects", tags=["projects"])
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    workspace_id: UUID,
    body: ProjectCreate,
    user: UserDep,
    db: DBDep,
) -> ProjectResponse:
    result = service.create_project(
        db,
        workspace_id,
        user.user_id,
        name=body.name,
        description=body.description,
        status=body.status,
        progress_mode=body.progress_mode,
        manual_progress=body.manual_progress,
    )
    return ProjectResponse(**result)


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    workspace_id: UUID,
    user: UserDep,
    db: DBDep,
    status_filter: Annotated[ProjectStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=160)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ProjectResponse]:
    return [
        ProjectResponse(**row)
        for row in service.list_projects(
            db,
            workspace_id,
            user.user_id,
            status_filter=status_filter,
            search=q,
            limit=limit,
            offset=offset,
        )
    ]


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(workspace_id: UUID, project_id: UUID, user: UserDep, db: DBDep) -> ProjectResponse:
    return ProjectResponse(**service.get_project(db, workspace_id, project_id, user.user_id))


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    workspace_id: UUID,
    project_id: UUID,
    body: ProjectUpdate,
    user: UserDep,
    db: DBDep,
) -> ProjectResponse:
    return ProjectResponse(
        **service.update_project(
            db,
            workspace_id,
            project_id,
            user.user_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.post(
    "/{project_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive a project",
)
def archive_project(workspace_id: UUID, project_id: UUID, user: UserDep, db: DBDep) -> Response:
    service.archive_project(db, workspace_id, project_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
def list_project_members(
    workspace_id: UUID, project_id: UUID, user: UserDep, db: DBDep
) -> list[ProjectMemberResponse]:
    return [
        ProjectMemberResponse(**row)
        for row in service.list_project_members(db, workspace_id, project_id, user.user_id)
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_project_member(
    workspace_id: UUID,
    project_id: UUID,
    body: ProjectMemberCreate,
    user: UserDep,
    db: DBDep,
) -> ProjectMemberResponse:
    return ProjectMemberResponse(
        **service.add_project_member(
            db, workspace_id, project_id, user.user_id, body.user_id, body.role
        )
    )


@router.patch("/{project_id}/members/{user_id}/role", response_model=ProjectMemberResponse)
def update_project_member_role(
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    body: ProjectMemberRoleUpdate,
    user: UserDep,
    db: DBDep,
) -> ProjectMemberResponse:
    return ProjectMemberResponse(
        **service.update_project_member_role(
            db, workspace_id, project_id, user.user_id, user_id, body.role
        )
    )


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(
    workspace_id: UUID, project_id: UUID, user_id: UUID, user: UserDep, db: DBDep
) -> Response:
    service.remove_project_member(db, workspace_id, project_id, user.user_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/transfer-manager", response_model=ManagerTransferResponse)
def transfer_project_manager(
    workspace_id: UUID,
    project_id: UUID,
    body: ManagerTransferRequest,
    user: UserDep,
    db: DBDep,
) -> ManagerTransferResponse:
    return ManagerTransferResponse(
        **service.transfer_project_manager(
            db,
            workspace_id,
            project_id,
            user.user_id,
            body.new_manager_user_id,
        )
    )


@router.post(
    "/{project_id}/milestones",
    response_model=MilestoneResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_milestone(
    workspace_id: UUID,
    project_id: UUID,
    body: MilestoneCreate,
    user: UserDep,
    db: DBDep,
) -> MilestoneResponse:
    return MilestoneResponse(
        **service.create_milestone(
            db,
            workspace_id,
            project_id,
            user.user_id,
            name=body.name,
            due_date=body.due_date,
        )
    )


@router.get("/{project_id}/milestones", response_model=list[MilestoneResponse])
def list_milestones(
    workspace_id: UUID, project_id: UUID, user: UserDep, db: DBDep
) -> list[MilestoneResponse]:
    return [
        MilestoneResponse(**row)
        for row in service.list_milestones(db, workspace_id, project_id, user.user_id)
    ]


@router.get("/{project_id}/milestones/{milestone_id}", response_model=MilestoneResponse)
def get_milestone(
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    user: UserDep,
    db: DBDep,
) -> MilestoneResponse:
    return MilestoneResponse(
        **service.get_milestone(db, workspace_id, project_id, milestone_id, user.user_id)
    )


@router.patch("/{project_id}/milestones/{milestone_id}", response_model=MilestoneResponse)
def update_milestone(
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    body: MilestoneUpdate,
    user: UserDep,
    db: DBDep,
) -> MilestoneResponse:
    return MilestoneResponse(
        **service.update_milestone(
            db,
            workspace_id,
            project_id,
            milestone_id,
            user.user_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.delete(
    "/{project_id}/milestones/{milestone_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_milestone(
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.delete_milestone(db, workspace_id, project_id, milestone_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
