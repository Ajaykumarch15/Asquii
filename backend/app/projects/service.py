"""Transactional project, membership, and milestone operations."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.authorization.service import ProjectAccess, get_project_access, get_workspace_access
from app.models.activity_log import ActivityLog
from app.models.milestone import Milestone
from app.models.profile import Profile
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember


def _event(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    db.add(
        ActivityLog(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_json=metadata or {},
        )
    )


def _active_workspace(db: Session, workspace_id: UUID, *, lock: bool = False) -> Workspace:
    statement = select(Workspace).where(
        Workspace.id == workspace_id,
        Workspace.archived_at.is_(None),
    )
    if lock:
        statement = statement.with_for_update()
    workspace = db.scalar(statement)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def _project_access(
    db: Session,
    workspace_id: UUID,
    project: Project,
    user_id: UUID,
) -> ProjectAccess:
    if project.archived_at is None:
        access = get_project_access(db, user_id, project.id)
        if access.workspace_id != workspace_id:
            raise HTTPException(status_code=404, detail="Project not found")
        return access

    membership = db.execute(
        select(WorkspaceMember.workspace_id, WorkspaceMember.role, ProjectMember.role)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .outerjoin(
            ProjectMember,
            (ProjectMember.workspace_id == WorkspaceMember.workspace_id)
            & (ProjectMember.project_id == project.id)
            & (ProjectMember.user_id == WorkspaceMember.user_id),
        )
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.removed_at.is_(None),
            Workspace.archived_at.is_(None),
        )
    ).one_or_none()
    if membership is None:
        raise HTTPException(status_code=404, detail="Project not found")
    resolved_workspace_id, workspace_role, project_role = membership
    return ProjectAccess(
        user_id=user_id,
        workspace_id=resolved_workspace_id,
        project_id=project.id,
        workspace_role=workspace_role,
        project_role=project_role,
    )


def _project(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    lock: bool = False,
    include_archived: bool = False,
) -> tuple[Project, ProjectAccess]:
    _active_workspace(db, workspace_id, lock=lock)
    try:
        get_workspace_access(db, user_id, workspace_id)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise HTTPException(status_code=404, detail="Project not found") from exc
        raise
    statement = select(Project).where(
        Project.id == project_id,
        Project.workspace_id == workspace_id,
    )
    if not include_archived:
        statement = statement.where(Project.archived_at.is_(None))
    if lock:
        statement = statement.with_for_update()
    project = db.scalar(statement)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project, _project_access(db, workspace_id, project, user_id)


def get_project_context(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    lock: bool = False,
    include_archived: bool = True,
) -> tuple[Project, ProjectAccess]:
    """Expose the shared, workspace-scoped project authorization context."""

    return _project(
        db,
        workspace_id,
        project_id,
        user_id,
        lock=lock,
        include_archived=include_archived,
    )


def record_project_activity(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    """Add one safe activity event to the caller's existing transaction."""

    _event(db, workspace_id, project_id, actor_id, action, entity_type, entity_id, metadata)


def _require_manager(access: ProjectAccess) -> None:
    if not access.can_manage_settings:
        raise HTTPException(status_code=403, detail="Project management denied")


def _require_collaborator(access: ProjectAccess) -> None:
    if not access.can_collaborate:
        raise HTTPException(status_code=403, detail="Project collaboration denied")


def _project_row(project: Project, role: str | None, member_count: int, manager_count: int):
    return {
        "id": project.id,
        "workspace_id": project.workspace_id,
        "name": project.name,
        "description": project.description,
        "status": project.status,
        "progress_mode": project.progress_mode,
        "manual_progress": project.manual_progress,
        "archived_at": project.archived_at,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "current_user_role": role,
        "member_count": member_count,
        "manager_count": manager_count,
    }


def _counts(db: Session, project_id: UUID, workspace_id: UUID) -> tuple[int, int]:
    member_count = db.scalar(
        select(func.count())
        .select_from(ProjectMember)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.workspace_id == workspace_id,
        )
    )
    manager_count = db.scalar(
        select(func.count())
        .select_from(ProjectMember)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.workspace_id == workspace_id,
            ProjectMember.role == "Project Manager",
        )
    )
    return member_count or 0, manager_count or 0


def _serialize_project(db: Session, project: Project, role: str | None) -> dict[str, object]:
    member_count, manager_count = _counts(db, project.id, project.workspace_id)
    return _project_row(project, role, member_count, manager_count)


def create_project(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    *,
    name: str,
    description: str,
    status: str,
    progress_mode: str,
    manual_progress: int | None,
) -> dict[str, object]:
    with db.begin():
        _active_workspace(db, workspace_id, lock=True)
        workspace_access = get_workspace_access(db, user_id, workspace_id)
        if not workspace_access.can_administer:
            raise HTTPException(status_code=403, detail="Project creation denied")
        project = Project(
            workspace_id=workspace_id,
            name=name,
            description=description,
            status=status,
            progress_mode=progress_mode,
            manual_progress=manual_progress,
        )
        db.add(project)
        db.flush()
        manager = ProjectMember(
            workspace_id=workspace_id,
            project_id=project.id,
            user_id=user_id,
            role="Project Manager",
        )
        db.add(manager)
        db.flush()
        _event(db, workspace_id, project.id, user_id, "project.created", "project", project.id)
        result = _serialize_project(db, project, manager.role)
    return result


def list_projects(
    db: Session,
    workspace_id: UUID,
    user_id: UUID,
    *,
    status_filter: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> list[dict[str, object]]:
    with db.begin():
        _active_workspace(db, workspace_id)
        get_workspace_access(db, user_id, workspace_id)
        member_count = (
            select(func.count())
            .select_from(ProjectMember)
            .where(
                ProjectMember.project_id == Project.id,
                ProjectMember.workspace_id == Project.workspace_id,
            )
            .correlate(Project)
            .scalar_subquery()
        )
        manager_count = (
            select(func.count())
            .select_from(ProjectMember)
            .where(
                ProjectMember.project_id == Project.id,
                ProjectMember.workspace_id == Project.workspace_id,
                ProjectMember.role == "Project Manager",
            )
            .correlate(Project)
            .scalar_subquery()
        )
        statement = (
            select(Project, ProjectMember.role, member_count, manager_count)
            .outerjoin(
                ProjectMember,
                (ProjectMember.project_id == Project.id)
                & (ProjectMember.workspace_id == Project.workspace_id)
                & (ProjectMember.user_id == user_id),
            )
            .where(
                Project.workspace_id == workspace_id,
                Project.archived_at.is_(None),
            )
        )
        if status_filter:
            statement = statement.where(Project.status == status_filter)
        if search:
            statement = statement.where(Project.name.ilike(f"%{search.strip()}%"))
        rows = db.execute(
            statement.order_by(Project.created_at.desc(), Project.id).limit(limit).offset(offset)
        ).all()
        return [
            _project_row(project, role, member_count_value, manager_count_value)
            for project, role, member_count_value, manager_count_value in rows
        ]


def get_project(
    db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        project, access = _project(db, workspace_id, project_id, user_id, include_archived=True)
        return _serialize_project(db, project, access.project_role)


def update_project(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        project, access = _project(db, workspace_id, project_id, user_id, lock=True)
        _require_manager(access)
        changed = {
            field: value for field, value in changes.items() if getattr(project, field) != value
        }
        for field, value in changed.items():
            setattr(project, field, value)
        if changed:
            _event(
                db,
                workspace_id,
                project_id,
                user_id,
                "project.updated",
                "project",
                project_id,
                {"fields": sorted(changed)},
            )
        db.flush()
        result = _serialize_project(db, project, access.project_role)
    return result


def archive_project(db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID) -> None:
    with db.begin():
        project, access = _project(
            db,
            workspace_id,
            project_id,
            user_id,
            lock=True,
            include_archived=True,
        )
        _require_manager(access)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Project is already archived")
        project.archived_at = datetime.now(UTC)
        _event(db, workspace_id, project_id, user_id, "project.archived", "project", project_id)


def list_project_members(
    db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID
) -> list[dict[str, object]]:
    with db.begin():
        _project(db, workspace_id, project_id, user_id, include_archived=True)
        rows = db.execute(
            select(ProjectMember, Profile, WorkspaceMember.removed_at)
            .join(Profile, Profile.user_id == ProjectMember.user_id)
            .outerjoin(
                WorkspaceMember,
                (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
                & (WorkspaceMember.user_id == ProjectMember.user_id),
            )
            .where(
                ProjectMember.workspace_id == workspace_id,
                ProjectMember.project_id == project_id,
            )
            .order_by(ProjectMember.created_at, ProjectMember.user_id)
        ).all()
        return [
            {
                "user_id": member.user_id,
                "display_name": profile.display_name,
                "job_title": profile.job_title,
                "role": member.role,
                "workspace_member_active": removed_at is None,
                "created_at": member.created_at,
                "updated_at": member.updated_at,
            }
            for member, profile, removed_at in rows
        ]


def add_project_member(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    target_id: UUID,
    role: str,
) -> dict[str, object]:
    with db.begin():
        _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
        _require_manager(access)
        target_workspace_member = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == target_id,
                WorkspaceMember.removed_at.is_(None),
            )
            .with_for_update()
        )
        if target_workspace_member is None:
            raise HTTPException(status_code=404, detail="Active workspace member not found")
        target = db.scalar(
            select(ProjectMember)
            .where(
                ProjectMember.workspace_id == workspace_id,
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == target_id,
            )
            .with_for_update()
        )
        if target is not None:
            raise HTTPException(status_code=409, detail="Project membership already exists")
        target = ProjectMember(
            workspace_id=workspace_id,
            project_id=project_id,
            user_id=target_id,
            role=role,
        )
        db.add(target)
        db.flush()
        _event(
            db,
            workspace_id,
            project_id,
            actor_id,
            "project.member_added",
            "project_member",
            target_id,
            {"role": role},
        )
        result = {
            "user_id": target.user_id,
            "display_name": target_workspace_member.profile.display_name,
            "job_title": target_workspace_member.profile.job_title,
            "role": target.role,
            "workspace_member_active": True,
            "created_at": target.created_at,
            "updated_at": target.updated_at,
        }
    return result


def update_project_member_role(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    target_id: UUID,
    role: str,
) -> dict[str, object]:
    try:
        with db.begin():
            _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
            _require_manager(access)
            target = db.scalar(
                select(ProjectMember)
                .join(
                    WorkspaceMember,
                    (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
                    & (WorkspaceMember.user_id == ProjectMember.user_id),
                )
                .where(
                    ProjectMember.workspace_id == workspace_id,
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == target_id,
                    WorkspaceMember.removed_at.is_(None),
                )
                .with_for_update()
            )
            if target is None:
                raise HTTPException(status_code=404, detail="Active project member not found")
            previous_role = target.role
            if previous_role != role:
                target.role = role
                _event(
                    db,
                    workspace_id,
                    project_id,
                    actor_id,
                    "project.member_role_changed",
                    "project_member",
                    target_id,
                    {"from_role": previous_role, "to_role": role},
                )
            db.flush()
            result = {
                "user_id": target.user_id,
                "display_name": target.profile.display_name,
                "job_title": target.profile.job_title,
                "role": target.role,
                "workspace_member_active": True,
                "created_at": target.created_at,
                "updated_at": target.updated_at,
            }
        return result
    except IntegrityError as exc:
        if _sqlstate(exc) == "23514" and _constraint(exc) == "project_at_least_one_active_manager":
            raise HTTPException(
                status_code=409, detail="An active project must retain a Project Manager"
            ) from exc
        raise


def remove_project_member(
    db: Session, workspace_id: UUID, project_id: UUID, actor_id: UUID, target_id: UUID
) -> None:
    try:
        with db.begin():
            _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
            if actor_id != target_id:
                _require_manager(access)
            target = db.scalar(
                select(ProjectMember)
                .where(
                    ProjectMember.workspace_id == workspace_id,
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == target_id,
                )
                .with_for_update()
            )
            if target is None:
                raise HTTPException(status_code=404, detail="Project member not found")
            role = target.role
            db.delete(target)
            db.flush()
            _event(
                db,
                workspace_id,
                project_id,
                actor_id,
                "project.member_removed",
                "project_member",
                target_id,
                {"role": role},
            )
    except IntegrityError as exc:
        if _sqlstate(exc) == "23514" and _constraint(exc) == "project_at_least_one_active_manager":
            raise HTTPException(
                status_code=409, detail="An active project must retain a Project Manager"
            ) from exc
        if _sqlstate(exc) == "23503":
            raise HTTPException(
                status_code=409,
                detail="Reassign or remove project data that references this member first",
            ) from exc
        raise


def transfer_project_manager(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    new_manager_id: UUID,
) -> dict[str, UUID]:
    try:
        with db.begin():
            _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
            _require_manager(access)
            if actor_id == new_manager_id and access.is_project_manager:
                raise HTTPException(
                    status_code=409, detail="Selected user is already a Project Manager"
                )
            new_manager = db.scalar(
                select(ProjectMember)
                .join(
                    WorkspaceMember,
                    (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
                    & (WorkspaceMember.user_id == ProjectMember.user_id),
                )
                .where(
                    ProjectMember.workspace_id == workspace_id,
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == new_manager_id,
                    WorkspaceMember.removed_at.is_(None),
                )
                .with_for_update()
            )
            if new_manager is None:
                raise HTTPException(status_code=404, detail="Active project member not found")
            if new_manager.role == "Project Manager":
                raise HTTPException(
                    status_code=409, detail="Selected user is already a Project Manager"
                )
            managers = db.scalars(
                select(ProjectMember)
                .join(
                    WorkspaceMember,
                    (WorkspaceMember.workspace_id == ProjectMember.workspace_id)
                    & (WorkspaceMember.user_id == ProjectMember.user_id),
                )
                .where(
                    ProjectMember.workspace_id == workspace_id,
                    ProjectMember.project_id == project_id,
                    ProjectMember.role == "Project Manager",
                    WorkspaceMember.removed_at.is_(None),
                )
                .order_by(ProjectMember.user_id)
                .with_for_update()
            ).all()
            previous_manager = next(
                (manager for manager in managers if manager.user_id == actor_id),
                managers[0] if managers else None,
            )
            if previous_manager is None:
                raise HTTPException(
                    status_code=409, detail="Actor is not an active Project Manager"
                )
            previous_manager.role = "Project Member"
            db.flush([previous_manager])
            new_manager.role = "Project Manager"
            db.flush([new_manager])
            _event(
                db,
                workspace_id,
                project_id,
                actor_id,
                "project.manager_transferred",
                "project",
                project_id,
                {
                    "previous_manager_user_id": str(previous_manager.user_id),
                    "new_manager_user_id": str(new_manager_id),
                },
            )
            return {
                "workspace_id": workspace_id,
                "project_id": project_id,
                "previous_manager_user_id": previous_manager.user_id,
                "new_manager_user_id": new_manager_id,
            }
    except IntegrityError as exc:
        if _sqlstate(exc) == "23514" and _constraint(exc) == "project_at_least_one_active_manager":
            raise HTTPException(
                status_code=409, detail="An active project must retain a Project Manager"
            ) from exc
        raise


def _milestone_response(milestone: Milestone) -> dict[str, object]:
    return {
        "id": milestone.id,
        "workspace_id": milestone.workspace_id,
        "project_id": milestone.project_id,
        "name": milestone.name,
        "due_date": milestone.due_date,
        "created_at": milestone.created_at,
        "updated_at": milestone.updated_at,
    }


def create_milestone(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    *,
    name: str,
    due_date: date,
) -> dict[str, object]:
    with db.begin():
        _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
        _require_manager(access)
        milestone = Milestone(
            workspace_id=workspace_id,
            project_id=project_id,
            name=name,
            due_date=due_date,
        )
        db.add(milestone)
        db.flush()
        _event(
            db,
            workspace_id,
            project_id,
            actor_id,
            "project.milestone_created",
            "milestone",
            milestone.id,
        )
        return _milestone_response(milestone)


def list_milestones(
    db: Session, workspace_id: UUID, project_id: UUID, user_id: UUID
) -> list[dict[str, object]]:
    with db.begin():
        _project(db, workspace_id, project_id, user_id, include_archived=True)
        milestones = db.scalars(
            select(Milestone)
            .where(
                Milestone.workspace_id == workspace_id,
                Milestone.project_id == project_id,
            )
            .order_by(Milestone.due_date, Milestone.id)
        ).all()
        return [_milestone_response(milestone) for milestone in milestones]


def get_milestone(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    user_id: UUID,
) -> dict[str, object]:
    with db.begin():
        _project(db, workspace_id, project_id, user_id, include_archived=True)
        milestone = db.scalar(
            select(Milestone).where(
                Milestone.id == milestone_id,
                Milestone.workspace_id == workspace_id,
                Milestone.project_id == project_id,
            )
        )
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")
        return _milestone_response(milestone)


def update_milestone(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    actor_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
        _require_manager(access)
        milestone = db.scalar(
            select(Milestone)
            .where(
                Milestone.id == milestone_id,
                Milestone.workspace_id == workspace_id,
                Milestone.project_id == project_id,
            )
            .with_for_update()
        )
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")
        changed = {
            field: value for field, value in changes.items() if getattr(milestone, field) != value
        }
        for field, value in changed.items():
            setattr(milestone, field, value)
        if changed:
            _event(
                db,
                workspace_id,
                project_id,
                actor_id,
                "project.milestone_updated",
                "milestone",
                milestone.id,
                {"fields": sorted(changed)},
            )
        db.flush()
        return _milestone_response(milestone)


def delete_milestone(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    milestone_id: UUID,
    actor_id: UUID,
) -> None:
    with db.begin():
        _, access = _project(db, workspace_id, project_id, actor_id, lock=True)
        _require_manager(access)
        milestone = db.scalar(
            select(Milestone)
            .where(
                Milestone.id == milestone_id,
                Milestone.workspace_id == workspace_id,
                Milestone.project_id == project_id,
            )
            .with_for_update()
        )
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")
        milestone_id = milestone.id
        db.delete(milestone)
        db.flush()
        _event(
            db,
            workspace_id,
            project_id,
            actor_id,
            "project.milestone_deleted",
            "milestone",
            milestone_id,
        )


def _sqlstate(exc: IntegrityError) -> str | None:
    return getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)


def _constraint(exc: IntegrityError) -> str | None:
    return getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
