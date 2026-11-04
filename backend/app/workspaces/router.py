"""Authenticated workspace management endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db
from app.workspaces import service
from app.workspaces.schemas import (
    InvitationAccept,
    InvitationAcceptedResponse,
    InvitationCreate,
    InvitationCreatedResponse,
    InvitationResponse,
    MemberRoleUpdate,
    OwnershipTransferRequest,
    OwnershipTransferResponse,
    WorkspaceCreate,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)

workspace_router = APIRouter(prefix="/workspaces", tags=["workspaces"])
invitation_router = APIRouter(prefix="/invitations", tags=["invitations"])
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]


@workspace_router.post(
    "",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace",
)
def create_workspace(body: WorkspaceCreate, user: UserDep, db: DBDep) -> WorkspaceResponse:
    workspace, role = service.create_workspace(db, user, body.name)
    return WorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        role=role,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


@workspace_router.get("", response_model=list[WorkspaceResponse], summary="List my workspaces")
def list_workspaces(user: UserDep, db: DBDep) -> list[WorkspaceResponse]:
    return [WorkspaceResponse(**row) for row in service.list_workspaces(db, user.user_id)]


@workspace_router.get(
    "/{workspace_id}", response_model=WorkspaceResponse, summary="Get a workspace"
)
def get_workspace(workspace_id: UUID, user: UserDep, db: DBDep) -> WorkspaceResponse:
    return WorkspaceResponse(**service.get_workspace(db, workspace_id, user.user_id))


@workspace_router.patch(
    "/{workspace_id}", response_model=WorkspaceResponse, summary="Update workspace details"
)
def update_workspace(
    workspace_id: UUID,
    body: WorkspaceUpdate,
    user: UserDep,
    db: DBDep,
) -> WorkspaceResponse:
    return WorkspaceResponse(
        **service.update_workspace(db, workspace_id, user.user_id, name=body.name)
    )


@workspace_router.post(
    "/{workspace_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive a workspace",
)
def archive_workspace(workspace_id: UUID, user: UserDep, db: DBDep) -> Response:
    service.archive_workspace(db, workspace_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@workspace_router.get(
    "/{workspace_id}/members",
    response_model=list[WorkspaceMemberResponse],
    summary="List active workspace members",
)
def list_members(workspace_id: UUID, user: UserDep, db: DBDep) -> list[WorkspaceMemberResponse]:
    return [
        WorkspaceMemberResponse(**row)
        for row in service.list_members(db, workspace_id, user.user_id)
    ]


@workspace_router.get(
    "/{workspace_id}/members/{user_id}",
    response_model=WorkspaceMemberResponse,
    summary="Get a workspace member",
)
def get_member(
    workspace_id: UUID, user_id: UUID, user: UserDep, db: DBDep
) -> WorkspaceMemberResponse:
    return WorkspaceMemberResponse(**service.get_member(db, workspace_id, user.user_id, user_id))


@workspace_router.patch(
    "/{workspace_id}/members/{user_id}/role",
    response_model=WorkspaceMemberResponse,
    summary="Change a member role",
)
def update_member_role(
    workspace_id: UUID,
    user_id: UUID,
    body: MemberRoleUpdate,
    user: UserDep,
    db: DBDep,
) -> WorkspaceMemberResponse:
    return WorkspaceMemberResponse(
        **service.update_member_role(db, workspace_id, user.user_id, user_id, body.role)
    )


@workspace_router.delete(
    "/{workspace_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove or leave a workspace",
)
def remove_member(workspace_id: UUID, user_id: UUID, user: UserDep, db: DBDep) -> Response:
    service.remove_member(db, workspace_id, user.user_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@workspace_router.post(
    "/{workspace_id}/transfer-ownership",
    response_model=OwnershipTransferResponse,
    summary="Transfer workspace ownership",
)
def transfer_ownership(
    workspace_id: UUID,
    body: OwnershipTransferRequest,
    user: UserDep,
    db: DBDep,
) -> OwnershipTransferResponse:
    return OwnershipTransferResponse(
        **service.transfer_ownership(db, workspace_id, user.user_id, body.new_owner_user_id)
    )


@workspace_router.post(
    "/{workspace_id}/invitations",
    response_model=InvitationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace invitation",
)
def create_invitation(
    workspace_id: UUID,
    body: InvitationCreate,
    user: UserDep,
    db: DBDep,
) -> InvitationCreatedResponse:
    result = service.create_invitation(db, workspace_id, user.user_id, body.email, body.role)
    return InvitationCreatedResponse(**result)


@workspace_router.get(
    "/{workspace_id}/invitations",
    response_model=list[InvitationResponse],
    summary="List workspace invitations",
)
def list_invitations(workspace_id: UUID, user: UserDep, db: DBDep) -> list[InvitationResponse]:
    return [
        InvitationResponse(**row)
        for row in service.list_invitations(db, workspace_id, user.user_id)
    ]


@workspace_router.delete(
    "/{workspace_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an invitation",
)
def revoke_invitation(
    workspace_id: UUID, invitation_id: UUID, user: UserDep, db: DBDep
) -> Response:
    service.revoke_invitation(db, workspace_id, user.user_id, invitation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@invitation_router.post(
    "/accept",
    response_model=InvitationAcceptedResponse,
    summary="Accept a workspace invitation",
)
def accept_invitation(
    body: InvitationAccept, user: UserDep, db: DBDep
) -> InvitationAcceptedResponse:
    return InvitationAcceptedResponse(**service.accept_invitation(db, user, body.token))
