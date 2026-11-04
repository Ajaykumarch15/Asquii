"""Current-database membership lookup and reusable authorization decisions."""

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember


@dataclass(frozen=True)
class WorkspaceAccess:
    """A currently active workspace membership and its database role."""

    user_id: UUID
    workspace_id: UUID
    role: str

    @property
    def can_administer(self) -> bool:
        return self.role in {"Owner", "Admin"}


@dataclass(frozen=True)
class ProjectAccess:
    """Current workspace and optional project role for an active project."""

    user_id: UUID
    workspace_id: UUID
    project_id: UUID
    workspace_role: str
    project_role: str | None

    @property
    def can_administer_workspace(self) -> bool:
        return self.workspace_role in {"Owner", "Admin"}

    @property
    def is_project_manager(self) -> bool:
        return self.project_role == "Project Manager"

    @property
    def can_read(self) -> bool:
        # ADR-006 grants active workspace members read access to active projects.
        return True

    @property
    def can_manage_settings(self) -> bool:
        return self.can_administer_workspace or self.is_project_manager

    @property
    def can_manage_members(self) -> bool:
        return self.can_manage_settings

    @property
    def can_collaborate(self) -> bool:
        return self.can_administer_workspace or self.project_role in {
            "Project Manager",
            "Project Member",
        }


def get_workspace_access(db: Session, user_id: UUID, workspace_id: UUID) -> WorkspaceAccess:
    """Load current role and reject removed, archived, or cross-tenant access."""

    role = db.scalar(
        select(WorkspaceMember.role)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.removed_at.is_(None),
            Workspace.archived_at.is_(None),
        )
    )
    if role is None:
        raise HTTPException(status_code=403, detail="Workspace access denied")
    return WorkspaceAccess(user_id=user_id, workspace_id=workspace_id, role=role)


def get_project_access(db: Session, user_id: UUID, project_id: UUID) -> ProjectAccess:
    """Load active workspace and project membership roles directly from PostgreSQL."""

    membership = db.execute(
        select(WorkspaceMember.workspace_id, WorkspaceMember.role, ProjectMember.role)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .join(Project, Project.workspace_id == Workspace.id)
        .outerjoin(
            ProjectMember,
            (ProjectMember.project_id == Project.id)
            & (ProjectMember.workspace_id == WorkspaceMember.workspace_id)
            & (ProjectMember.user_id == WorkspaceMember.user_id),
        )
        .where(
            Project.id == project_id,
            Project.archived_at.is_(None),
            Workspace.archived_at.is_(None),
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.removed_at.is_(None),
        )
    ).one_or_none()
    if membership is None:
        raise HTTPException(status_code=403, detail="Project access denied")
    workspace_id, workspace_role, project_role = membership
    return ProjectAccess(
        user_id=user_id,
        workspace_id=workspace_id,
        project_id=project_id,
        workspace_role=workspace_role,
        project_role=project_role,
    )


def require_workspace_admin(db: Session, user_id: UUID, workspace_id: UUID) -> WorkspaceAccess:
    """Require the current Owner or Admin role for workspace administration."""

    access = get_workspace_access(db, user_id, workspace_id)
    if not access.can_administer:
        raise HTTPException(status_code=403, detail="Workspace administration denied")
    return access


def require_project_manager(db: Session, user_id: UUID, project_id: UUID) -> ProjectAccess:
    """Require the current Project Manager or workspace Owner/Admin override."""

    access = get_project_access(db, user_id, project_id)
    if not access.can_manage_settings:
        raise HTTPException(status_code=403, detail="Project management denied")
    return access


def require_project_collaborator(db: Session, user_id: UUID, project_id: UUID) -> ProjectAccess:
    """Require project membership or the approved workspace administrative override."""

    access = get_project_access(db, user_id, project_id)
    if not access.can_collaborate:
        raise HTTPException(status_code=403, detail="Project collaboration denied")
    return access
