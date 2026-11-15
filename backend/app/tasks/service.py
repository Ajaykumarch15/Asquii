"""Transactional task, subtask, and comment operations."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models.activity_log import ActivityLog
from app.models.profile import Profile
from app.models.project_member import ProjectMember
from app.models.task import Task, TaskAssignee, TaskComment, TaskSubtask
from app.models.workspace_member import WorkspaceMember
from app.projects.service import get_project_context, record_project_activity


def _task_context(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    user_id: UUID,
    *,
    lock: bool = False,
) -> tuple[Task, object, object]:
    project, access = get_project_context(
        db,
        workspace_id,
        project_id,
        user_id,
        lock=lock,
        include_archived=True,
    )
    statement = select(Task).where(
        Task.id == task_id,
        Task.workspace_id == workspace_id,
        Task.project_id == project_id,
    )
    if lock:
        statement = statement.with_for_update()
    task = db.scalar(statement)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task, project, access


def _require_active_project(project) -> None:
    if project.archived_at is not None:
        raise HTTPException(status_code=409, detail="Archived projects are read-only")


def _require_collaborator(access) -> None:
    if not access.can_collaborate:
        raise HTTPException(status_code=403, detail="Project collaboration denied")


def _require_task_moderator(access) -> None:
    if not access.can_manage_settings:
        raise HTTPException(status_code=403, detail="Task deletion denied")


def _validate_assignees(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    assignee_user_ids: list[UUID],
) -> list[UUID]:
    """Return the de-duplicated assignee ids after checking project membership."""

    unique_ids = list(dict.fromkeys(assignee_user_ids))
    if not unique_ids:
        return []
    member_ids = set(
        db.scalars(
            select(ProjectMember.user_id)
            .join(
                WorkspaceMember,
                (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
                & (WorkspaceMember.user_id == ProjectMember.user_id),
            )
            .where(
                ProjectMember.workspace_id == workspace_id,
                ProjectMember.project_id == project_id,
                ProjectMember.user_id.in_(unique_ids),
                WorkspaceMember.removed_at.is_(None),
            )
        ).all()
    )
    if member_ids != set(unique_ids):
        raise HTTPException(
            status_code=422,
            detail="Assignees must be active members of this project",
        )
    return unique_ids


def _task_projection():
    creator_profile = aliased(Profile)
    creator_id = (
        select(ActivityLog.actor_user_id)
        .where(
            ActivityLog.project_id == Task.project_id,
            ActivityLog.entity_type == "task",
            ActivityLog.entity_id == Task.id,
            ActivityLog.action == "task.created",
        )
        .order_by(ActivityLog.created_at)
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )
    statement = (
        select(
            Task,
            creator_id,
            creator_profile.display_name,
        )
        .outerjoin(creator_profile, creator_profile.user_id == creator_id)
    )
    return statement


def _assignees_by_task(
    db: Session, task_ids: list[UUID]
) -> dict[UUID, list[dict[str, object]]]:
    if not task_ids:
        return {}
    rows = db.execute(
        select(TaskAssignee.task_id, TaskAssignee.user_id, Profile.display_name)
        .outerjoin(Profile, Profile.user_id == TaskAssignee.user_id)
        .where(TaskAssignee.task_id.in_(task_ids))
        .order_by(TaskAssignee.task_id, Profile.display_name, TaskAssignee.user_id)
    ).all()
    grouped: dict[UUID, list[dict[str, object]]] = {}
    for task_id, user_id, display_name in rows:
        grouped.setdefault(task_id, []).append(
            {"user_id": user_id, "display_name": display_name or "Unknown user"}
        )
    return grouped


def _task_response_row(row, assignees: list[dict[str, object]]) -> dict[str, object]:
    task, creator_id, creator_name = row
    return {
        "id": task.id,
        "workspace_id": task.workspace_id,
        "project_id": task.project_id,
        "title": task.title,
        "description": task.description,
        "labels": task.labels,
        "status": task.status,
        "due_date": task.due_date,
        "assignee_user_ids": [item["user_id"] for item in assignees],
        "assignees": assignees,
        "priority": task.priority,
        "position": task.position,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "creator_user_id": creator_id,
        "creator_display_name": creator_name,
    }


def _get_task_response(db: Session, task_id: UUID) -> dict[str, object]:
    row = db.execute(_task_projection().where(Task.id == task_id)).one()
    assignees = _assignees_by_task(db, [task_id]).get(task_id, [])
    return _task_response_row(row, assignees)


def _activity(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    record_project_activity(
        db,
        workspace_id,
        project_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        metadata,
    )


def create_task(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    *,
    title: str,
    description: str,
    labels: list[str],
    status: str,
    due_date: date | None,
    assignee_user_ids: list[UUID],
    priority: str,
    position: Decimal,
) -> dict[str, object]:
    with db.begin():
        project, access = get_project_context(
            db, workspace_id, project_id, actor_id, lock=True, include_archived=True
        )
        _require_active_project(project)
        _require_collaborator(access)
        validated_ids = _validate_assignees(db, workspace_id, project_id, assignee_user_ids)
        task = Task(
            workspace_id=workspace_id,
            project_id=project_id,
            title=title,
            description=description,
            labels=labels,
            status=status,
            due_date=due_date,
            priority=priority,
            position=position,
        )
        db.add(task)
        db.flush()
        for user_id in validated_ids:
            db.add(
                TaskAssignee(
                    task_id=task.id,
                    user_id=user_id,
                    workspace_id=workspace_id,
                    project_id=project_id,
                )
            )
        metadata: dict[str, object] = {"status": status, "priority": priority}
        if validated_ids:
            metadata["assignee_user_ids"] = [str(user_id) for user_id in validated_ids]
        _activity(db, workspace_id, project_id, actor_id, "task.created", "task", task.id, metadata)
        db.flush()
        result = _get_task_response(db, task.id)
    return result


def list_tasks(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    limit: int,
    offset: int,
    search: str | None,
    status: str | None,
    priority: str | None,
    assignee_user_id: UUID | None,
    unassigned: bool,
    due_date: date | None,
    due_before: date | None,
    due_after: date | None,
    sort_by: str,
    sort_direction: str,
) -> list[dict[str, object]]:
    with db.begin():
        get_project_context(db, workspace_id, project_id, user_id, include_archived=True)
        statement = _task_projection().where(
            Task.workspace_id == workspace_id,
            Task.project_id == project_id,
        )
        if search:
            escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            statement = statement.where(Task.title.ilike(f"%{escaped}%", escape="\\"))
        if status:
            statement = statement.where(Task.status == status)
        if priority:
            statement = statement.where(Task.priority == priority)
        if unassigned:
            statement = statement.where(
                ~select(TaskAssignee.task_id)
                .where(TaskAssignee.task_id == Task.id)
                .exists()
            )
        elif assignee_user_id is not None:
            statement = statement.where(
                select(TaskAssignee.task_id)
                .where(
                    TaskAssignee.task_id == Task.id,
                    TaskAssignee.user_id == assignee_user_id,
                )
                .exists()
            )
        if due_date is not None:
            statement = statement.where(Task.due_date == due_date)
        if due_before is not None:
            statement = statement.where(Task.due_date <= due_before)
        if due_after is not None:
            statement = statement.where(Task.due_date >= due_after)
        sort_column = {
            "created_at": Task.created_at,
            "updated_at": Task.updated_at,
            "due_date": Task.due_date,
            "title": Task.title,
            "status": Task.status,
            "priority": Task.priority,
            "position": Task.position,
        }[sort_by]
        order = sort_column.asc() if sort_direction == "asc" else sort_column.desc()
        if sort_by == "due_date":
            order = order.nulls_last()
        rows = db.execute(statement.order_by(order, Task.id).limit(limit).offset(offset)).all()
        assignees = _assignees_by_task(db, [row[0].id for row in rows])
        return [
            _task_response_row(row, assignees.get(row[0].id, []))
            for row in rows
        ]


def get_task(
    db: Session, workspace_id: UUID, project_id: UUID, task_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        _task_context(db, workspace_id, project_id, task_id, user_id)
        response = _get_task_response(db, task_id)
        response["subtask_count"] = (
            db.scalar(
                select(func.count()).select_from(TaskSubtask).where(TaskSubtask.task_id == task_id)
            )
            or 0
        )
        response["completed_subtask_count"] = (
            db.scalar(
                select(func.count())
                .select_from(TaskSubtask)
                .where(TaskSubtask.task_id == task_id, TaskSubtask.is_done.is_(True))
            )
            or 0
        )
        return response


def update_task(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    actor_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        task, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        _require_collaborator(access)

        assignee_user_ids = changes.pop("assignee_user_ids", None)
        previous_assignee_ids: list[UUID] = []
        if assignee_user_ids is not None:
            assignee_user_ids = _validate_assignees(
                db, workspace_id, project_id, assignee_user_ids
            )
            previous_assignee_ids = list(
                db.scalars(
                    select(TaskAssignee.user_id).where(TaskAssignee.task_id == task_id)
                ).all()
            )

        changed = {
            field: value for field, value in changes.items() if getattr(task, field) != value
        }
        for field, value in changed.items():
            setattr(task, field, value)

        assignees_changed = assignee_user_ids is not None and set(assignee_user_ids) != set(
            previous_assignee_ids
        )
        if assignees_changed:
            current_ids = set(previous_assignee_ids)
            target_ids = set(assignee_user_ids or [])
            for user_id in current_ids - target_ids:
                db.execute(
                    delete(TaskAssignee).where(
                        TaskAssignee.task_id == task_id,
                        TaskAssignee.user_id == user_id,
                    )
                )
            for user_id in target_ids - current_ids:
                db.add(
                    TaskAssignee(
                        task_id=task_id,
                        user_id=user_id,
                        workspace_id=workspace_id,
                        project_id=project_id,
                    )
                )

        if changed or assignees_changed:
            if assignees_changed:
                action = "task.assignee_changed"
                metadata: dict[str, object] = {
                    "previous_assignee_user_ids": [
                        str(user_id) for user_id in sorted(previous_assignee_ids, key=str)
                    ],
                    "new_assignee_user_ids": [
                        str(user_id) for user_id in sorted(assignee_user_ids or [], key=str)
                    ],
                    "fields": sorted(
                        set(changed) | ({"assignee_user_ids"} if assignees_changed else set())
                    ),
                }
            else:
                action = "task.updated"
                metadata = {"fields": sorted(changed)}
            db.flush()
            _activity(db, workspace_id, project_id, actor_id, action, "task", task_id, metadata)
        else:
            db.flush()
        return _get_task_response(db, task_id)


def delete_task(
    db: Session, workspace_id: UUID, project_id: UUID, task_id: UUID, actor_id: UUID
) -> None:
    try:
        with db.begin():
            task, project, access = _task_context(
                db, workspace_id, project_id, task_id, actor_id, lock=True
            )
            _require_active_project(project)
            _require_task_moderator(access)
            has_comments = db.scalar(
                select(TaskComment.id).where(TaskComment.task_id == task_id).limit(1)
            )
            if has_comments is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Task has comments and cannot be deleted without losing comment history",
                )
            db.delete(task)
            db.flush()
            _activity(db, workspace_id, project_id, actor_id, "task.deleted", "task", task_id)
    except IntegrityError as exc:
        if _sqlstate(exc) == "23503":
            raise HTTPException(
                status_code=409, detail="Task has dependent records and cannot be deleted"
            ) from exc
        raise


def create_subtask(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    actor_id: UUID,
    *,
    title: str,
    is_done: bool,
    position: Decimal,
) -> dict[str, object]:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        _require_collaborator(access)
        subtask = TaskSubtask(task_id=task_id, title=title, is_done=is_done, position=position)
        db.add(subtask)
        db.flush()
        _activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "task.subtask_created",
            "task_subtask",
            subtask.id,
        )
        return _subtask_response(subtask)


def list_subtasks(
    db: Session, workspace_id: UUID, project_id: UUID, task_id: UUID, user_id: UUID
) -> list[dict[str, object]]:
    with db.begin():
        _task_context(db, workspace_id, project_id, task_id, user_id)
        subtasks = db.scalars(
            select(TaskSubtask)
            .where(TaskSubtask.task_id == task_id)
            .order_by(TaskSubtask.position, TaskSubtask.created_at, TaskSubtask.id)
        ).all()
        return [_subtask_response(subtask) for subtask in subtasks]


def get_subtask(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    user_id: UUID,
) -> dict[str, object]:
    with db.begin():
        _task_context(db, workspace_id, project_id, task_id, user_id)
        subtask = db.scalar(
            select(TaskSubtask).where(
                TaskSubtask.id == subtask_id,
                TaskSubtask.task_id == task_id,
            )
        )
        if subtask is None:
            raise HTTPException(status_code=404, detail="Subtask not found")
        return _subtask_response(subtask)


def update_subtask(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    actor_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        _require_collaborator(access)
        subtask = db.scalar(
            select(TaskSubtask)
            .where(TaskSubtask.id == subtask_id, TaskSubtask.task_id == task_id)
            .with_for_update()
        )
        if subtask is None:
            raise HTTPException(status_code=404, detail="Subtask not found")
        changed = {
            field: value for field, value in changes.items() if getattr(subtask, field) != value
        }
        for field, value in changed.items():
            setattr(subtask, field, value)
        if changed:
            db.flush()
            _activity(
                db,
                workspace_id,
                project_id,
                actor_id,
                "task.subtask_updated",
                "task_subtask",
                subtask_id,
                {"fields": sorted(changed)},
            )
        return _subtask_response(subtask)


def delete_subtask(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    subtask_id: UUID,
    actor_id: UUID,
) -> None:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        _require_collaborator(access)
        subtask = db.scalar(
            select(TaskSubtask)
            .where(TaskSubtask.id == subtask_id, TaskSubtask.task_id == task_id)
            .with_for_update()
        )
        if subtask is None:
            raise HTTPException(status_code=404, detail="Subtask not found")
        db.delete(subtask)
        db.flush()
        _activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "task.subtask_deleted",
            "task_subtask",
            subtask_id,
        )


def _subtask_response(subtask: TaskSubtask) -> dict[str, object]:
    return {
        "id": subtask.id,
        "task_id": subtask.task_id,
        "title": subtask.title,
        "is_done": subtask.is_done,
        "position": subtask.position,
        "created_at": subtask.created_at,
        "updated_at": subtask.updated_at,
    }


def _comment_response(comment: TaskComment, author_name: str) -> dict[str, object]:
    return {
        "id": comment.id,
        "task_id": comment.task_id,
        "workspace_id": comment.workspace_id,
        "project_id": comment.project_id,
        "author_user_id": comment.author_user_id,
        "author_display_name": author_name,
        "body": None if comment.deleted_at is not None else comment.body,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
        "deleted_at": comment.deleted_at,
    }


def create_comment(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    actor_id: UUID,
    body: str,
) -> dict[str, object]:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        _require_collaborator(access)
        is_project_member = db.scalar(
            select(ProjectMember.user_id).where(
                ProjectMember.workspace_id == workspace_id,
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == actor_id,
            )
        )
        if is_project_member is None:
            raise HTTPException(
                status_code=409,
                detail="The current schema requires comment authors to be project members",
            )
        comment = TaskComment(
            task_id=task_id,
            workspace_id=workspace_id,
            project_id=project_id,
            author_user_id=actor_id,
            body=body,
        )
        db.add(comment)
        db.flush()
        _activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "task.comment_created",
            "task_comment",
            comment.id,
        )
        author_name = db.scalar(select(Profile.display_name).where(Profile.user_id == actor_id))
        return _comment_response(comment, author_name or "Unknown user")


def list_comments(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    user_id: UUID,
    *,
    limit: int,
    offset: int,
) -> list[dict[str, object]]:
    with db.begin():
        _task_context(db, workspace_id, project_id, task_id, user_id)
        rows = db.execute(
            select(TaskComment, Profile.display_name)
            .join(Profile, Profile.user_id == TaskComment.author_user_id)
            .where(
                TaskComment.task_id == task_id,
                TaskComment.workspace_id == workspace_id,
                TaskComment.project_id == project_id,
            )
            .order_by(TaskComment.created_at, TaskComment.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return [_comment_response(comment, name) for comment, name in rows]


def get_comment(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    user_id: UUID,
) -> dict[str, object]:
    with db.begin():
        _task_context(db, workspace_id, project_id, task_id, user_id)
        row = db.execute(
            select(TaskComment, Profile.display_name)
            .join(Profile, Profile.user_id == TaskComment.author_user_id)
            .where(
                TaskComment.id == comment_id,
                TaskComment.task_id == task_id,
                TaskComment.workspace_id == workspace_id,
                TaskComment.project_id == project_id,
            )
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        return _comment_response(*row)


def _require_comment_editor(access, actor_id: UUID, author_id: UUID) -> None:
    if actor_id != author_id and not (access.can_administer_workspace or access.is_project_manager):
        raise HTTPException(status_code=403, detail="Comment moderation denied")


def update_comment(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    actor_id: UUID,
    body: str,
) -> dict[str, object]:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        comment = db.scalar(
            select(TaskComment)
            .where(
                TaskComment.id == comment_id,
                TaskComment.task_id == task_id,
                TaskComment.workspace_id == workspace_id,
                TaskComment.project_id == project_id,
            )
            .with_for_update()
        )
        if comment is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        _require_comment_editor(access, actor_id, comment.author_user_id)
        if comment.deleted_at is not None:
            raise HTTPException(status_code=409, detail="Deleted comments cannot be edited")
        if comment.body != body:
            comment.body = body
            comment.updated_at = datetime.now(UTC)
            db.flush()
            _activity(
                db,
                workspace_id,
                project_id,
                actor_id,
                "task.comment_updated",
                "task_comment",
                comment.id,
                {"fields": ["body"]},
            )
        author_name = db.scalar(
            select(Profile.display_name).where(Profile.user_id == comment.author_user_id)
        )
        return _comment_response(comment, author_name or "Unknown user")


def delete_comment(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID,
    comment_id: UUID,
    actor_id: UUID,
) -> None:
    with db.begin():
        _, project, access = _task_context(
            db, workspace_id, project_id, task_id, actor_id, lock=True
        )
        _require_active_project(project)
        comment = db.scalar(
            select(TaskComment)
            .where(
                TaskComment.id == comment_id,
                TaskComment.task_id == task_id,
                TaskComment.workspace_id == workspace_id,
                TaskComment.project_id == project_id,
            )
            .with_for_update()
        )
        if comment is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        _require_comment_editor(access, actor_id, comment.author_user_id)
        if comment.deleted_at is not None:
            raise HTTPException(status_code=409, detail="Comment is already deleted")
        now = datetime.now(UTC)
        comment.deleted_at = now
        comment.updated_at = now
        _activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "task.comment_deleted",
            "task_comment",
            comment.id,
        )


def _sqlstate(exc: IntegrityError) -> str | None:
    return getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
