"""Workspace- and project-scoped activity feed queries."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.authorization.service import get_workspace_access
from app.models.activity_log import ActivityLog
from app.models.profile import Profile
from app.models.workspace_member import WorkspaceMember
from app.projects.service import get_project_context

_PRIVATE_METADATA_KEYS = {
    "token",
    "token_hash",
    "password",
    "secret",
    "authorization",
    "email",
    "body",
    "comment",
    "description",
    "agenda",
    "detail",
    "url",
    "external_url",
    "storage_object_path",
}
_PRIVATE_METADATA_FRAGMENTS = (
    "token",
    "password",
    "secret",
    "credential",
    "email",
    "body",
    "comment",
    "description",
    "agenda",
    "detail",
    "url",
    "path",
)


def _safe_metadata(value: Any) -> Any:
    """Copy JSON metadata while removing known private content fields recursively."""

    if isinstance(value, dict):
        safe: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in _PRIVATE_METADATA_KEYS or any(
                part in normalized for part in _PRIVATE_METADATA_FRAGMENTS
            ):
                continue
            safe[str(key)] = _safe_metadata(item)
        return safe
    if isinstance(value, list):
        return [_safe_metadata(item) for item in value]
    return value


def _filters(
    workspace_id: UUID,
    *,
    project_id: UUID | None,
    actor_user_id: UUID | None,
    action: str | None,
    resource_type: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
):
    conditions = [ActivityLog.workspace_id == workspace_id]
    if project_id is not None:
        conditions.append(ActivityLog.project_id == project_id)
    if actor_user_id is not None:
        conditions.append(ActivityLog.actor_user_id == actor_user_id)
    if action is not None:
        conditions.append(ActivityLog.action == action)
    if resource_type is not None:
        conditions.append(ActivityLog.entity_type == resource_type)
    if starts_after is not None:
        conditions.append(ActivityLog.created_at >= starts_after)
    if starts_before is not None:
        conditions.append(ActivityLog.created_at <= starts_before)
    return conditions


def _activity_statement(conditions, *, sort_by: str, sort_direction: str):
    statement = (
        select(ActivityLog, Profile.display_name)
        .outerjoin(Profile, Profile.user_id == ActivityLog.actor_user_id)
        .where(*conditions)
    )
    columns = {
        "created_at": ActivityLog.created_at,
        "action": ActivityLog.action,
        "resource_type": ActivityLog.entity_type,
    }
    column = columns[sort_by]
    order = column.asc() if sort_direction == "asc" else column.desc()
    tie_break = ActivityLog.id.asc() if sort_direction == "asc" else ActivityLog.id.desc()
    return statement.order_by(order, tie_break)


def _response(row) -> dict[str, object]:
    activity, actor_name = row
    return {
        "id": activity.id,
        "workspace_id": activity.workspace_id,
        "project_id": activity.project_id,
        "actor_user_id": activity.actor_user_id,
        "actor_display_name": actor_name,
        "action": activity.action,
        "resource_type": activity.entity_type,
        "resource_id": activity.entity_id,
        "metadata": _safe_metadata(activity.metadata_json or {}),
        "created_at": activity.created_at,
    }


def _page(
    db: Session,
    workspace_id: UUID,
    *,
    project_id: UUID | None,
    actor_user_id: UUID | None,
    action: str | None,
    resource_type: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
    limit: int,
    offset: int,
    sort_by: str,
    sort_direction: str,
) -> dict[str, object]:
    conditions = _filters(
        workspace_id,
        project_id=project_id,
        actor_user_id=actor_user_id,
        action=action,
        resource_type=resource_type,
        starts_after=starts_after,
        starts_before=starts_before,
    )
    total = db.scalar(select(func.count(ActivityLog.id)).where(*conditions)) or 0
    rows = db.execute(
        _activity_statement(conditions, sort_by=sort_by, sort_direction=sort_direction)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        "items": [_response(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _validate_range(starts_after: datetime | None, starts_before: datetime | None) -> None:
    for value in (starts_after, starts_before):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise HTTPException(
                status_code=422, detail="Date filters must include a timezone offset"
            )
    if starts_after is not None and starts_before is not None:
        if starts_after.astimezone(UTC) > starts_before.astimezone(UTC):
            raise HTTPException(
                status_code=422, detail="starts_after must not exceed starts_before"
            )


def _validate_actor_scope(db: Session, workspace_id: UUID, actor_user_id: UUID | None) -> None:
    if actor_user_id is None:
        return
    exists = db.scalar(
        select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == actor_user_id,
        )
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="Activity actor not found")


def workspace_feed(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    *,
    project_id: UUID | None,
    actor_user_id: UUID | None,
    action: str | None,
    resource_type: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
    limit: int,
    offset: int,
    sort_by: str,
    sort_direction: str,
) -> dict[str, object]:
    _validate_range(starts_after, starts_before)
    with db.begin():
        get_workspace_access(db, user_id, workspace_id)
        _validate_actor_scope(db, workspace_id, actor_user_id)
        if project_id is not None:
            get_project_context(db, workspace_id, project_id, user_id, include_archived=True)
        return _page(
            db,
            workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            starts_after=starts_after,
            starts_before=starts_before,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )


def project_feed(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    actor_user_id: UUID | None,
    action: str | None,
    resource_type: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
    limit: int,
    offset: int,
    sort_by: str,
    sort_direction: str,
) -> dict[str, object]:
    _validate_range(starts_after, starts_before)
    with db.begin():
        get_project_context(db, workspace_id, project_id, user_id, include_archived=True)
        _validate_actor_scope(db, workspace_id, actor_user_id)
        return _page(
            db,
            workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            starts_after=starts_after,
            starts_before=starts_before,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )


def workspace_activity_detail(
    db: Session, workspace_id: UUID, activity_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        get_workspace_access(db, user_id, workspace_id)
        row = db.execute(
            select(ActivityLog, Profile.display_name)
            .outerjoin(Profile, Profile.user_id == ActivityLog.actor_user_id)
            .where(ActivityLog.workspace_id == workspace_id, ActivityLog.id == activity_id)
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Activity not found")
        return _response(row)


def project_activity_detail(
    db: Session, workspace_id: UUID, project_id: UUID, activity_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        get_project_context(db, workspace_id, project_id, user_id, include_archived=True)
        row = db.execute(
            select(ActivityLog, Profile.display_name)
            .outerjoin(Profile, Profile.user_id == ActivityLog.actor_user_id)
            .where(
                ActivityLog.workspace_id == workspace_id,
                ActivityLog.project_id == project_id,
                ActivityLog.id == activity_id,
            )
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Activity not found")
        return _response(row)
