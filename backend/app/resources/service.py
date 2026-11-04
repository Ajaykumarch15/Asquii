"""Transactional resource metadata and per-user star operations."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, aliased

from app.models.profile import Profile
from app.models.project_member import ProjectMember
from app.models.resource import Resource, UserResourcePreference
from app.models.workspace_member import WorkspaceMember
from app.projects.service import get_project_context, record_project_activity


def _context(db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID, *, lock: bool):
    project, access = get_project_context(
        db, workspace_id, project_id, user_id, lock=lock, include_archived=True
    )
    if lock and project.archived_at is not None:
        raise HTTPException(status_code=409, detail="Archived projects are read-only")
    return project, access


def _require_collaborator(access) -> None:
    if not access.can_collaborate:
        raise HTTPException(status_code=403, detail="Project collaboration denied")


def _validate_owner(db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID) -> None:
    valid = db.scalar(
        select(ProjectMember.user_id)
        .join(
            WorkspaceMember,
            (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
            & (WorkspaceMember.user_id == ProjectMember.user_id),
        )
        .where(
            ProjectMember.workspace_id == workspace_id,
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            WorkspaceMember.removed_at.is_(None),
        )
    )
    if valid is None:
        raise HTTPException(
            status_code=422, detail="Resource owner must be an active project member"
        )


def _resource_statement(user_id: UUID):
    owner = aliased(Profile)
    return (
        select(Resource, owner.display_name, UserResourcePreference.starred)
        .join(owner, owner.user_id == Resource.owner_user_id)
        .outerjoin(
            UserResourcePreference,
            (UserResourcePreference.resource_id == Resource.id)
            & (UserResourcePreference.user_id == user_id),
        )
    )


def _resource_row(row) -> dict[str, object]:
    resource, owner_name, starred = row
    return {
        "id": resource.id,
        "workspace_id": resource.workspace_id,
        "project_id": resource.project_id,
        "owner_user_id": resource.owner_user_id,
        "owner_display_name": owner_name,
        "name": resource.name,
        "type": resource.type,
        "category": resource.category,
        "detail": resource.detail,
        "external_url": resource.external_url,
        "storage_object_path": resource.storage_object_path,
        "size_bytes": resource.size_bytes,
        "tags": resource.tags,
        "deleted_at": resource.deleted_at,
        "created_at": resource.created_at,
        "updated_at": resource.updated_at,
        "is_starred": bool(starred),
    }


def _get_resource(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    user_id: UUID,
    *,
    lock: bool = False,
) -> Resource:
    statement = select(Resource).where(
        Resource.id == resource_id,
        Resource.workspace_id == workspace_id,
        Resource.project_id == project_id,
        Resource.deleted_at.is_(None),
    )
    if lock:
        statement = statement.with_for_update()
    resource = db.scalar(statement)
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    return resource


def _get_resource_response(
    db: Session, workspace_id: UUID, project_id: UUID, resource_id: UUID, user_id: UUID
) -> dict[str, object]:
    row = db.execute(
        _resource_statement(user_id).where(
            Resource.id == resource_id,
            Resource.workspace_id == workspace_id,
            Resource.project_id == project_id,
            Resource.deleted_at.is_(None),
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    return _resource_row(row)


def create_resource(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    *,
    name: str,
    type: str,
    category: str,
    detail: str,
    external_url: str | None,
    storage_object_path: str | None,
    size_bytes: int | None,
    tags: list[str],
) -> dict[str, object]:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _require_collaborator(access)
        # The schema requires resource owners to be project members; never forge membership.
        try:
            _validate_owner(db, workspace_id, project_id, actor_id)
        except HTTPException as exc:
            if access.can_administer_workspace:
                raise HTTPException(
                    status_code=409,
                    detail="The current schema requires resource owners to be project members",
                ) from exc
            raise
        resource = Resource(
            workspace_id=workspace_id,
            project_id=project_id,
            owner_user_id=actor_id,
            name=name,
            type=type,
            category=category,
            detail=detail,
            external_url=external_url,
            storage_object_path=storage_object_path,
            size_bytes=size_bytes,
            tags=tags,
        )
        db.add(resource)
        db.flush()
        record_project_activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "resource.created",
            "resource",
            resource.id,
            {"type": type, "category": category},
        )
        db.flush()
        return _get_resource_response(db, workspace_id, project_id, resource.id, actor_id)


def list_resources(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    limit: int,
    offset: int,
    search: str | None,
    resource_type: str | None,
    category: str | None,
    owner_user_id: UUID | None,
    starred: bool | None,
    sort_by: str,
    sort_direction: str,
) -> list[dict[str, object]]:
    with db.begin():
        _context(db, workspace_id, project_id, user_id, lock=False)
        statement = _resource_statement(user_id).where(
            Resource.workspace_id == workspace_id,
            Resource.project_id == project_id,
            Resource.deleted_at.is_(None),
        )
        if search:
            escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            statement = statement.where(Resource.name.ilike(f"%{escaped}%", escape="\\"))
        if resource_type:
            statement = statement.where(Resource.type == resource_type)
        if category:
            statement = statement.where(Resource.category == category)
        if owner_user_id is not None:
            statement = statement.where(Resource.owner_user_id == owner_user_id)
        if starred is not None:
            if starred:
                statement = statement.where(UserResourcePreference.starred.is_(True))
            else:
                statement = statement.where(
                    or_(
                        UserResourcePreference.user_id.is_(None),
                        UserResourcePreference.starred.is_(False),
                    )
                )
        sort_column = {
            "created_at": Resource.created_at,
            "updated_at": Resource.updated_at,
            "name": Resource.name,
            "type": Resource.type,
            "category": Resource.category,
            "size_bytes": Resource.size_bytes,
        }[sort_by]
        order = sort_column.asc() if sort_direction == "asc" else sort_column.desc()
        if sort_by == "size_bytes":
            order = order.nulls_last()
        rows = db.execute(statement.order_by(order, Resource.id).limit(limit).offset(offset)).all()
        return [_resource_row(row) for row in rows]


def get_resource(
    db: Session, workspace_id: UUID, project_id: UUID, resource_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        _context(db, workspace_id, project_id, user_id, lock=False)
        return _get_resource_response(db, workspace_id, project_id, resource_id, user_id)


def update_resource(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    actor_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        resource = _get_resource(db, workspace_id, project_id, resource_id, actor_id, lock=True)
        if not access.can_administer_workspace and not access.is_project_manager:
            if resource.owner_user_id != actor_id:
                raise HTTPException(status_code=403, detail="Resource update denied")
        if "owner_user_id" in changes:
            owner_id = changes["owner_user_id"]
            if owner_id is None:
                raise HTTPException(status_code=422, detail="Resource owner cannot be null")
            if not (
                access.can_administer_workspace
                or access.is_project_manager
                or resource.owner_user_id == actor_id
            ):
                raise HTTPException(status_code=403, detail="Resource ownership change denied")
            _validate_owner(db, workspace_id, project_id, owner_id)
        if "external_url" in changes and changes["external_url"] is not None:
            changes["external_url"] = str(changes["external_url"])
        changed = {key: value for key, value in changes.items() if getattr(resource, key) != value}
        for key, value in changed.items():
            setattr(resource, key, value)
        if changed:
            db.flush()
            record_project_activity(
                db,
                workspace_id,
                project_id,
                actor_id,
                "resource.updated",
                "resource",
                resource_id,
                {"fields": sorted(changed)},
            )
            db.flush()
        return _get_resource_response(db, workspace_id, project_id, resource_id, actor_id)


def delete_resource(
    db: Session, workspace_id: UUID, project_id: UUID, resource_id: UUID, actor_id: UUID
) -> None:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        resource = _get_resource(db, workspace_id, project_id, resource_id, actor_id, lock=True)
        if not (
            access.can_administer_workspace
            or access.is_project_manager
            or resource.owner_user_id == actor_id
        ):
            raise HTTPException(status_code=403, detail="Resource deletion denied")
        resource.deleted_at = datetime.now(UTC)
        db.flush()
        record_project_activity(
            db, workspace_id, project_id, actor_id, "resource.deleted", "resource", resource_id
        )


def set_starred(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    resource_id: UUID,
    user_id: UUID,
    starred: bool,
) -> dict[str, object]:
    with db.begin():
        project, _access = _context(db, workspace_id, project_id, user_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _get_resource(db, workspace_id, project_id, resource_id, user_id, lock=True)
        if starred:
            statement = insert(UserResourcePreference).values(
                user_id=user_id, resource_id=resource_id, starred=True
            )
            db.execute(
                statement.on_conflict_do_update(
                    index_elements=[
                        UserResourcePreference.user_id,
                        UserResourcePreference.resource_id,
                    ],
                    set_={"starred": True},
                )
            )
        else:
            db.execute(
                UserResourcePreference.__table__.delete().where(
                    UserResourcePreference.user_id == user_id,
                    UserResourcePreference.resource_id == resource_id,
                )
            )
        return {"resource_id": resource_id, "starred": starred}
