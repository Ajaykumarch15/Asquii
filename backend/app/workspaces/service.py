"""Transactional workspace, membership, and invitation operations."""

from __future__ import annotations

import hashlib
import re
import secrets
import unicodedata
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.jwt import CurrentUser
from app.auth.service import provision_profile
from app.models.activity_log import ActivityLog
from app.models.profile import Profile
from app.models.project_member import ProjectMember
from app.models.workspace import Workspace
from app.models.workspace_invitation import WorkspaceInvitation
from app.models.workspace_member import WorkspaceMember

INVITATION_TTL = timedelta(days=7)
INVITATION_INVALID = "Invitation is invalid or unavailable"


def _event(
    db: Session,
    workspace_id: UUID,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict[str, object] | None = None,
) -> None:
    db.add(
        ActivityLog(
            workspace_id=workspace_id,
            actor_user_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_json=metadata or {},
        )
    )


def _slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "workspace"
    suffix = uuid4().hex[:12]
    return f"{base[:107].rstrip('-')}-{suffix}"


def _get_workspace(
    db: Session,
    workspace_id: UUID,
    *,
    lock: bool = False,
    allow_archived: bool = False,
) -> Workspace:
    statement = select(Workspace).where(Workspace.id == workspace_id)
    if not allow_archived:
        statement = statement.where(Workspace.archived_at.is_(None))
    if lock:
        statement = statement.with_for_update()
    workspace = db.scalar(statement)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def _require_member(db: Session, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.removed_at.is_(None),
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return member


def _require_admin(db: Session, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = _require_member(db, workspace_id, user_id)
    if member.role not in {"Owner", "Admin"}:
        raise HTTPException(status_code=403, detail="Workspace administration denied")
    return member


def _require_owner(db: Session, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
    member = _require_member(db, workspace_id, user_id)
    if member.role != "Owner":
        raise HTTPException(status_code=403, detail="Workspace Owner permission required")
    return member


def _invitation_status(invitation: WorkspaceInvitation) -> str:
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if invitation.expires_at <= datetime.now(UTC):
        return "expired"
    return "pending"


def _invitation_response(invitation: WorkspaceInvitation) -> dict[str, object]:
    return {
        "id": invitation.id,
        "workspace_id": invitation.workspace_id,
        "email": invitation.email_normalized,
        "role": invitation.role,
        "invited_by_user_id": invitation.invited_by_user_id,
        "expires_at": invitation.expires_at,
        "accepted_at": invitation.accepted_at,
        "revoked_at": invitation.revoked_at,
        "created_at": invitation.created_at,
        "status": _invitation_status(invitation),
    }


def create_workspace(db: Session, user: CurrentUser, name: str) -> tuple[Workspace, str]:
    with db.begin():
        provision_profile(db, user)
        # RLS note: INSERT ... RETURNING is checked against the workspaces
        # SELECT policy, and the creator is not a member until the membership
        # row below is written. Supplying the id and timestamps keeps this
        # INSERT from needing RETURNING; the membership then makes the
        # workspace readable for the rest of the transaction.
        now = datetime.now(UTC)
        workspace = Workspace(
            id=uuid4(),
            name=name,
            slug=_slug(name),
            created_at=now,
            updated_at=now,
        )
        db.add(workspace)
        db.flush()
        membership = WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.user_id,
            role="Owner",
        )
        db.add(membership)
        db.flush()
        _event(db, workspace.id, user.user_id, "workspace.created", "workspace", workspace.id)
    return workspace, "Owner"


def list_workspaces(db: Session, user_id: UUID) -> list[dict[str, object]]:
    with db.begin():
        rows = db.execute(
            select(Workspace, WorkspaceMember.role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.removed_at.is_(None),
                Workspace.archived_at.is_(None),
            )
            .order_by(Workspace.created_at.desc(), Workspace.id)
        ).all()
        return [
            {
                "id": workspace.id,
                "name": workspace.name,
                "slug": workspace.slug,
                "role": role,
                "created_at": workspace.created_at,
                "updated_at": workspace.updated_at,
            }
            for workspace, role in rows
        ]


def get_workspace(db: Session, workspace_id: UUID, user_id: UUID) -> dict[str, object]:
    with db.begin():
        workspace = _get_workspace(db, workspace_id)
        member = _require_member(db, workspace_id, user_id)
        return {
            "id": workspace.id,
            "name": workspace.name,
            "slug": workspace.slug,
            "role": member.role,
            "created_at": workspace.created_at,
            "updated_at": workspace.updated_at,
        }


def update_workspace(
    db: Session, workspace_id: UUID, user_id: UUID, *, name: str
) -> dict[str, object]:
    with db.begin():
        workspace = _get_workspace(db, workspace_id, lock=True)
        member = _require_member(db, workspace_id, user_id)
        if member.role not in {"Owner", "Admin"}:
            raise HTTPException(status_code=403, detail="Workspace administration denied")
        changed = workspace.name != name
        workspace.name = name
        if changed:
            _event(
                db,
                workspace.id,
                user_id,
                "workspace.updated",
                "workspace",
                workspace.id,
                {"name_changed": True},
            )
        db.flush()
        result = {
            "id": workspace.id,
            "name": workspace.name,
            "slug": workspace.slug,
            "role": member.role,
            "created_at": workspace.created_at,
            "updated_at": workspace.updated_at,
        }
    return result


def archive_workspace(db: Session, workspace_id: UUID, user_id: UUID) -> None:
    with db.begin():
        workspace = _get_workspace(db, workspace_id, lock=True)
        _require_owner(db, workspace_id, user_id)
        now = datetime.now(UTC)
        workspace.archived_at = now
        db.execute(
            update(WorkspaceInvitation)
            .where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.accepted_at.is_(None),
                WorkspaceInvitation.revoked_at.is_(None),
            )
            .values(revoked_at=now, updated_at=now)
        )
        _event(db, workspace_id, user_id, "workspace.archived", "workspace", workspace_id)


def list_members(db: Session, workspace_id: UUID, user_id: UUID) -> list[dict[str, object]]:
    with db.begin():
        _get_workspace(db, workspace_id)
        _require_member(db, workspace_id, user_id)
        rows = db.execute(
            select(WorkspaceMember, Profile)
            .join(Profile, Profile.user_id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.removed_at.is_(None),
            )
            .order_by(WorkspaceMember.created_at, WorkspaceMember.user_id)
        ).all()
        return [
            {
                "user_id": member.user_id,
                "display_name": profile.display_name,
                "job_title": profile.job_title,
                "role": member.role,
                "created_at": member.created_at,
            }
            for member, profile in rows
        ]


def get_member(
    db: Session, workspace_id: UUID, actor_id: UUID, target_id: UUID
) -> dict[str, object]:
    with db.begin():
        _get_workspace(db, workspace_id)
        _require_member(db, workspace_id, actor_id)
        row = db.execute(
            select(WorkspaceMember, Profile)
            .join(Profile, Profile.user_id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == target_id,
                WorkspaceMember.removed_at.is_(None),
            )
        ).one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Workspace member not found")
        member, profile = row
        return {
            "user_id": member.user_id,
            "display_name": profile.display_name,
            "job_title": profile.job_title,
            "role": member.role,
            "created_at": member.created_at,
        }


def update_member_role(
    db: Session, workspace_id: UUID, actor_id: UUID, target_id: UUID, role: str
) -> dict[str, object]:
    with db.begin():
        _get_workspace(db, workspace_id, lock=True)
        _require_owner(db, workspace_id, actor_id)
        target = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == target_id,
                WorkspaceMember.removed_at.is_(None),
            )
            .with_for_update()
        )
        if target is None:
            raise HTTPException(status_code=404, detail="Workspace member not found")
        if target.role == "Owner":
            raise HTTPException(
                status_code=409, detail="Transfer ownership before changing this role"
            )
        previous_role = target.role
        if previous_role != role:
            target.role = role
            target.updated_at = datetime.now(UTC)
            _event(
                db,
                workspace_id,
                actor_id,
                "workspace.member_role_changed",
                "workspace_member",
                target_id,
                {"from_role": previous_role, "to_role": role},
            )
        db.flush()
        return {
            "user_id": target.user_id,
            "display_name": target.profile.display_name,
            "job_title": target.profile.job_title,
            "role": target.role,
            "created_at": target.created_at,
        }


def remove_member(db: Session, workspace_id: UUID, actor_id: UUID, target_id: UUID) -> None:
    with db.begin():
        _get_workspace(db, workspace_id, lock=True)
        actor = _require_member(db, workspace_id, actor_id)
        target = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == target_id,
                WorkspaceMember.removed_at.is_(None),
            )
            .with_for_update()
        )
        if target is None:
            raise HTTPException(status_code=404, detail="Workspace member not found")
        self_removal = actor_id == target_id
        if not self_removal and actor.role not in {"Owner", "Admin"}:
            raise HTTPException(status_code=403, detail="Workspace member removal denied")
        if target.role == "Owner":
            raise HTTPException(
                status_code=409, detail="Transfer ownership before leaving the workspace"
            )
        if target.role == "Admin" and not self_removal and actor.role != "Owner":
            raise HTTPException(status_code=403, detail="Only the Owner can remove an Admin")
        project_membership = db.scalar(
            select(ProjectMember.project_id)
            .where(
                ProjectMember.workspace_id == workspace_id,
                ProjectMember.user_id == target_id,
            )
            .limit(1)
        )
        if project_membership is not None:
            raise HTTPException(
                status_code=409,
                detail="Remove this member from project rosters before workspace removal",
            )
        now = datetime.now(UTC)
        target.removed_at = now
        target.updated_at = now
        _event(
            db, workspace_id, actor_id, "workspace.member_removed", "workspace_member", target_id
        )


def transfer_ownership(
    db: Session, workspace_id: UUID, actor_id: UUID, new_owner_id: UUID
) -> dict[str, object]:
    with db.begin():
        _get_workspace(db, workspace_id, lock=True)
        _require_owner(db, workspace_id, actor_id)
        if actor_id == new_owner_id:
            raise HTTPException(status_code=409, detail="The selected user is already the Owner")
        new_owner = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == new_owner_id,
                WorkspaceMember.removed_at.is_(None),
            )
            .with_for_update()
        )
        if new_owner is None:
            raise HTTPException(status_code=404, detail="Active workspace member not found")
        previous_owner = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == actor_id,
                WorkspaceMember.role == "Owner",
                WorkspaceMember.removed_at.is_(None),
            )
            .with_for_update()
        )
        if previous_owner is None:
            raise HTTPException(status_code=409, detail="Workspace Owner state is unavailable")
        now = datetime.now(UTC)
        # The partial unique Owner index is immediate; demote before promotion.
        previous_owner.role = "Admin"
        previous_owner.updated_at = now
        db.flush([previous_owner])
        new_owner.role = "Owner"
        new_owner.updated_at = now
        db.flush([new_owner])
        _event(
            db,
            workspace_id,
            actor_id,
            "workspace.ownership_transferred",
            "workspace",
            workspace_id,
            {"previous_owner_user_id": str(actor_id), "new_owner_user_id": str(new_owner_id)},
        )
        return {"workspace_id": workspace_id, "new_owner_user_id": new_owner_id}


def create_invitation(
    db: Session, workspace_id: UUID, actor_id: UUID, email: str, role: str
) -> dict[str, object]:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    try:
        with db.begin():
            _get_workspace(db, workspace_id, lock=True)
            _require_admin(db, workspace_id, actor_id)
            invitation = WorkspaceInvitation(
                workspace_id=workspace_id,
                email_normalized=email,
                role=role,
                token_hash=token_hash,
                invited_by_user_id=actor_id,
                expires_at=datetime.now(UTC) + INVITATION_TTL,
            )
            db.add(invitation)
            db.flush()
            _event(
                db,
                workspace_id,
                actor_id,
                "workspace.invitation_created",
                "workspace_invitation",
                invitation.id,
                {"role": role},
            )
            result = _invitation_response(invitation)
            result["token"] = token
        return result
    except IntegrityError as exc:
        diagnostic = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if diagnostic == "uq_workspace_invitations_workspace_email_pending":
            raise HTTPException(
                status_code=409, detail="A pending invitation already exists"
            ) from exc
        raise


def list_invitations(db: Session, workspace_id: UUID, actor_id: UUID) -> list[dict[str, object]]:
    with db.begin():
        _get_workspace(db, workspace_id)
        _require_admin(db, workspace_id, actor_id)
        invitations = db.scalars(
            select(WorkspaceInvitation)
            .where(WorkspaceInvitation.workspace_id == workspace_id)
            .order_by(WorkspaceInvitation.created_at.desc(), WorkspaceInvitation.id)
        ).all()
        return [_invitation_response(invitation) for invitation in invitations]


def revoke_invitation(db: Session, workspace_id: UUID, actor_id: UUID, invitation_id: UUID) -> None:
    with db.begin():
        _get_workspace(db, workspace_id, lock=True)
        _require_admin(db, workspace_id, actor_id)
        invitation = db.scalar(
            select(WorkspaceInvitation)
            .where(
                WorkspaceInvitation.id == invitation_id,
                WorkspaceInvitation.workspace_id == workspace_id,
            )
            .with_for_update()
        )
        if invitation is None:
            raise HTTPException(status_code=404, detail="Invitation not found")
        if invitation.accepted_at is not None or invitation.revoked_at is not None:
            raise HTTPException(status_code=409, detail="Invitation is already closed")
        invitation.revoked_at = datetime.now(UTC)
        invitation.updated_at = invitation.revoked_at
        _event(
            db,
            workspace_id,
            actor_id,
            "workspace.invitation_revoked",
            "workspace_invitation",
            invitation.id,
        )


def accept_invitation(db: Session, user: CurrentUser, token: str) -> dict[str, object]:
    if not user.email:
        raise HTTPException(status_code=404, detail=INVITATION_INVALID)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    try:
        with db.begin():
            workspace_id = db.scalar(
                select(WorkspaceInvitation.workspace_id).where(
                    WorkspaceInvitation.token_hash == token_hash
                )
            )
            if workspace_id is None:
                raise HTTPException(status_code=404, detail=INVITATION_INVALID)
            workspace = db.scalar(
                select(Workspace).where(Workspace.id == workspace_id).with_for_update()
            )
            invitation = db.scalar(
                select(WorkspaceInvitation)
                .where(
                    WorkspaceInvitation.workspace_id == workspace_id,
                    WorkspaceInvitation.token_hash == token_hash,
                )
                .with_for_update()
            )
            if (
                workspace is None
                or workspace.archived_at is not None
                or invitation is None
                or invitation.accepted_at is not None
                or invitation.revoked_at is not None
                or invitation.expires_at <= datetime.now(UTC)
                or invitation.email_normalized != user.email.strip().lower()
            ):
                raise HTTPException(status_code=404, detail=INVITATION_INVALID)

            profile = provision_profile(db, user)
            existing_member = db.scalar(
                select(WorkspaceMember)
                .where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == user.user_id,
                )
                .with_for_update()
            )
            if existing_member is not None and existing_member.removed_at is None:
                raise HTTPException(status_code=409, detail="User is already a workspace member")
            if existing_member is not None:
                stale_project_member = db.scalar(
                    select(ProjectMember.project_id)
                    .where(
                        ProjectMember.workspace_id == workspace_id,
                        ProjectMember.user_id == user.user_id,
                    )
                    .limit(1)
                )
                if stale_project_member is not None:
                    raise HTTPException(
                        status_code=409,
                        detail="Existing project roster entries must be resolved before rejoining",
                    )
                existing_member.role = invitation.role
                existing_member.removed_at = None
                existing_member.updated_at = datetime.now(UTC)
                member = existing_member
            else:
                member = WorkspaceMember(
                    workspace_id=workspace_id,
                    user_id=profile.user_id,
                    role=invitation.role,
                )
                db.add(member)
            db.flush()
            now = datetime.now(UTC)
            invitation.accepted_at = now
            invitation.updated_at = now
            _event(
                db,
                workspace_id,
                user.user_id,
                "workspace.invitation_accepted",
                "workspace_member",
                user.user_id,
                {"role": member.role},
            )
            result = {"workspace_id": workspace_id, "role": member.role}
        return result
    except IntegrityError as exc:
        diagnostic = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if diagnostic in {"pk_workspace_members", "uq_workspace_members_active_owner"}:
            raise HTTPException(
                status_code=409, detail="Workspace membership changed concurrently"
            ) from exc
        raise
