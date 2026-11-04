"""Authenticated task, subtask, and comment endpoints."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.database.session import get_db
from app.tasks import service
from app.tasks.schemas import (
    TaskAssigneeUpdate,
    TaskCommentCreate,
    TaskCommentResponse,
    TaskCommentUpdate,
    TaskCreate,
    TaskDetailResponse,
    TaskPriority,
    TaskResponse,
    TaskStatus,
    TaskSubtaskCreate,
    TaskSubtaskResponse,
    TaskSubtaskUpdate,
    TaskUpdate,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/projects/{project_id}/tasks", tags=["tasks"])
UserDep = Annotated[CurrentUser, Depends(get_current_user)]
DBDep = Annotated[Session, Depends(get_db)]


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    workspace_id: UUID, project_id: UUID, body: TaskCreate, user: UserDep, db: DBDep
) -> TaskResponse:
    return TaskResponse(
        **service.create_task(
            db,
            workspace_id,
            project_id,
            user.user_id,
            **body.model_dump(),
        )
    )


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    workspace_id: UUID,
    project_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str | None, Query(max_length=160)] = None,
    status_filter: Annotated[TaskStatus | None, Query(alias="status")] = None,
    priority: TaskPriority | None = None,
    assignee_user_id: UUID | None = None,
    unassigned: bool = False,
    due_date: date | None = None,
    due_before: date | None = None,
    due_after: date | None = None,
    sort_by: Literal[
        "created_at", "updated_at", "due_date", "title", "status", "priority", "position"
    ] = "position",
    sort_direction: Literal["asc", "desc"] = "asc",
) -> list[TaskResponse]:
    return [
        TaskResponse(**row)
        for row in service.list_tasks(
            db,
            workspace_id,
            project_id,
            user.user_id,
            limit=limit,
            offset=offset,
            search=q,
            status=status_filter,
            priority=priority,
            assignee_user_id=assignee_user_id,
            unassigned=unassigned,
            due_date=due_date,
            due_before=due_before,
            due_after=due_after,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    ]


@router.get("/{task_id}", response_model=TaskDetailResponse)
def get_task(
    workspace_id: UUID, project_id: UUID, task_id: UUID, user: UserDep, db: DBDep
) -> TaskDetailResponse:
    return TaskDetailResponse(
        **service.get_task(db, workspace_id, project_id, task_id, user.user_id)
    )


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    body: TaskUpdate,
    user: UserDep,
    db: DBDep,
) -> TaskResponse:
    return TaskResponse(
        **service.update_task(
            db,
            workspace_id,
            project_id,
            task_id,
            user.user_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    workspace_id: UUID, project_id: UUID, task_id: UUID, user: UserDep, db: DBDep
) -> Response:
    service.delete_task(db, workspace_id, project_id, task_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{task_id}/assignee", response_model=TaskResponse)
def update_task_assignee(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    body: TaskAssigneeUpdate,
    user: UserDep,
    db: DBDep,
) -> TaskResponse:
    return TaskResponse(
        **service.update_task(
            db,
            workspace_id,
            project_id,
            task_id,
            user.user_id,
            {"assignee_user_id": body.assignee_user_id},
        )
    )


@router.post(
    "/{task_id}/subtasks",
    response_model=TaskSubtaskResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_subtask(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    body: TaskSubtaskCreate,
    user: UserDep,
    db: DBDep,
) -> TaskSubtaskResponse:
    return TaskSubtaskResponse(
        **service.create_subtask(
            db, workspace_id, project_id, task_id, user.user_id, **body.model_dump()
        )
    )


@router.get("/{task_id}/subtasks", response_model=list[TaskSubtaskResponse])
def list_subtasks(
    workspace_id: UUID, project_id: UUID, task_id: UUID, user: UserDep, db: DBDep
) -> list[TaskSubtaskResponse]:
    return [
        TaskSubtaskResponse(**row)
        for row in service.list_subtasks(db, workspace_id, project_id, task_id, user.user_id)
    ]


@router.get("/{task_id}/subtasks/{subtask_id}", response_model=TaskSubtaskResponse)
def get_subtask(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    user: UserDep,
    db: DBDep,
) -> TaskSubtaskResponse:
    return TaskSubtaskResponse(
        **service.get_subtask(db, workspace_id, project_id, task_id, subtask_id, user.user_id)
    )


@router.patch("/{task_id}/subtasks/{subtask_id}", response_model=TaskSubtaskResponse)
def update_subtask(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    body: TaskSubtaskUpdate,
    user: UserDep,
    db: DBDep,
) -> TaskSubtaskResponse:
    return TaskSubtaskResponse(
        **service.update_subtask(
            db,
            workspace_id,
            project_id,
            task_id,
            subtask_id,
            user.user_id,
            body.model_dump(exclude_unset=True),
        )
    )


@router.delete("/{task_id}/subtasks/{subtask_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subtask(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.delete_subtask(db, workspace_id, project_id, task_id, subtask_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{task_id}/comments",
    response_model=TaskCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    body: TaskCommentCreate,
    user: UserDep,
    db: DBDep,
) -> TaskCommentResponse:
    return TaskCommentResponse(
        **service.create_comment(db, workspace_id, project_id, task_id, user.user_id, body.body)
    )


@router.get("/{task_id}/comments", response_model=list[TaskCommentResponse])
def list_comments(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    user: UserDep,
    db: DBDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TaskCommentResponse]:
    return [
        TaskCommentResponse(**row)
        for row in service.list_comments(
            db, workspace_id, project_id, task_id, user.user_id, limit=limit, offset=offset
        )
    ]


@router.get("/{task_id}/comments/{comment_id}", response_model=TaskCommentResponse)
def get_comment(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    user: UserDep,
    db: DBDep,
) -> TaskCommentResponse:
    return TaskCommentResponse(
        **service.get_comment(db, workspace_id, project_id, task_id, comment_id, user.user_id)
    )


@router.patch("/{task_id}/comments/{comment_id}", response_model=TaskCommentResponse)
def update_comment(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    body: TaskCommentUpdate,
    user: UserDep,
    db: DBDep,
) -> TaskCommentResponse:
    return TaskCommentResponse(
        **service.update_comment(
            db, workspace_id, project_id, task_id, comment_id, user.user_id, body.body
        )
    )


@router.delete("/{task_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    user: UserDep,
    db: DBDep,
) -> Response:
    service.delete_comment(db, workspace_id, project_id, task_id, comment_id, user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
