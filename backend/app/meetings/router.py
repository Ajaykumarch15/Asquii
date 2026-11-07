"""Authenticated meeting and attendee endpoints."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db
from app.meetings import service
from app.meetings.schemas import (
    MeetingAttendeeCreate,
    MeetingAttendeeResponse,
    MeetingCreate,
    MeetingDetailResponse,
    MeetingResponse,
    MeetingUpdate,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/projects/{project_id}/meetings", tags=["meetings"]
)
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]


def _offset_required(value: datetime | None) -> datetime | None:
    if value is not None:
        if value.tzinfo is None or value.utcoffset() is None:
            raise HTTPException(
                status_code=422,
                detail="Date filters must include a timezone offset",
            )
        return value
    return None


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
def create_meeting(
    workspace_id: UUID,
    project_id: UUID,
    body: MeetingCreate,
    user: UserDep,
    db: DBDep,
) -> MeetingResponse:
    return MeetingResponse(
        **service.create_meeting(db, workspace_id, project_id, user.user_id, **body.model_dump())
    )


@router.get("", response_model=list[MeetingResponse])
def list_meetings(
    workspace_id: UUID,
    project_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str | None, Query(max_length=160)] = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
    sort_by: Literal[
        "starts_at",
        "created_at",
        "updated_at",
        "title",
        "meeting_type",
    ] = "starts_at",
    sort_direction: Literal["asc", "desc"] = "asc",
) -> list[MeetingResponse]:
    starts_after = _offset_required(starts_after)
    starts_before = _offset_required(starts_before)
    if starts_after and starts_before and starts_after > starts_before:
        raise HTTPException(status_code=422, detail="starts_after must not exceed starts_before")
    return [
        MeetingResponse(**row)
        for row in service.list_meetings(
            db,
            workspace_id,
            project_id,
            user.user_id,
            limit=limit,
            offset=offset,
            search=q,
            starts_after=starts_after,
            starts_before=starts_before,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    ]


@router.get("/{meeting_id}", response_model=MeetingDetailResponse)
def get_meeting(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    user: UserDep,
    db: DBDep,
) -> MeetingDetailResponse:
    return MeetingDetailResponse(
        **service.get_meeting(db, workspace_id, project_id, meeting_id, user.user_id)
    )


@router.patch("/{meeting_id}", response_model=MeetingResponse)
def update_meeting(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    body: MeetingUpdate,
    user: UserDep,
    db: DBDep,
) -> MeetingResponse:
    return MeetingResponse(
        **service.update_meeting(
            db,
            workspace_id,
            project_id,
            meeting_id,
            user.user_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.delete_meeting(db, workspace_id, project_id, meeting_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{meeting_id}/attendees", response_model=list[MeetingAttendeeResponse])
def list_attendees(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    user: UserDep,
    db: DBDep,
) -> list[MeetingAttendeeResponse]:
    return [
        MeetingAttendeeResponse(**row)
        for row in service.list_attendees(db, workspace_id, project_id, meeting_id, user.user_id)
    ]


@router.post(
    "/{meeting_id}/attendees",
    response_model=MeetingAttendeeResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_attendee(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    body: MeetingAttendeeCreate,
    user: UserDep,
    db: DBDep,
) -> MeetingAttendeeResponse:
    return MeetingAttendeeResponse(
        **service.add_attendee(db, workspace_id, project_id, meeting_id, user.user_id, body.user_id)
    )


@router.delete("/{meeting_id}/attendees/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_attendee(
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    user_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.remove_attendee(db, workspace_id, project_id, meeting_id, user.user_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
