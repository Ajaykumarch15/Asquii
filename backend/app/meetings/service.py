"""Transactional meeting and attendee operations."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models.activity_log import ActivityLog
from app.models.meeting import Meeting, MeetingAttendee
from app.models.profile import Profile
from app.models.project_member import ProjectMember
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


def _require_manager(access) -> None:
    if not access.can_manage_settings:
        raise HTTPException(status_code=403, detail="Meeting administration denied")


def _validate_attendees(
    db: Session, workspace_id: UUID, project_id: UUID, user_ids: list[UUID]
) -> None:
    if not user_ids:
        return
    valid = set(
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
                ProjectMember.user_id.in_(user_ids),
                WorkspaceMember.removed_at.is_(None),
            )
        ).all()
    )
    if valid != set(user_ids):
        raise HTTPException(
            status_code=422, detail="All attendees must be active members of this project"
        )


def _meeting_statement():
    organizer_id = (
        select(ActivityLog.actor_user_id)
        .where(
            ActivityLog.entity_type == "meeting",
            ActivityLog.entity_id == Meeting.id,
            ActivityLog.action == "meeting.created",
        )
        .order_by(ActivityLog.created_at)
        .limit(1)
        .correlate(Meeting)
        .scalar_subquery()
    )
    organizer = aliased(Profile)
    attendee_count = (
        select(func.count())
        .select_from(MeetingAttendee)
        .where(
            MeetingAttendee.workspace_id == Meeting.workspace_id,
            MeetingAttendee.project_id == Meeting.project_id,
            MeetingAttendee.meeting_id == Meeting.id,
        )
        .correlate(Meeting)
        .scalar_subquery()
    )
    return select(Meeting, organizer_id, organizer.display_name, attendee_count).outerjoin(
        organizer, organizer.user_id == organizer_id
    )


def _meeting_row(row) -> dict[str, object]:
    meeting, organizer_id, organizer_name, attendee_count = row
    return {
        "id": meeting.id,
        "workspace_id": meeting.workspace_id,
        "project_id": meeting.project_id,
        "title": meeting.title,
        "description": meeting.description,
        "starts_at": meeting.starts_at,
        "ends_at": meeting.starts_at + timedelta(minutes=meeting.duration_minutes),
        "duration_minutes": meeting.duration_minutes,
        "meeting_type": meeting.meeting_type,
        "agenda": meeting.agenda,
        "created_at": meeting.created_at,
        "updated_at": meeting.updated_at,
        "organizer_user_id": organizer_id,
        "organizer_display_name": organizer_name,
        "attendee_count": attendee_count,
    }


def _get_meeting(db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID):
    row = db.execute(
        _meeting_statement().where(
            Meeting.id == meeting_id,
            Meeting.workspace_id == workspace_id,
            Meeting.project_id == project_id,
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _meeting_row(row)


def _get_meeting_for_update(
    db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID
) -> Meeting:
    meeting = db.scalar(
        select(Meeting)
        .where(
            Meeting.id == meeting_id,
            Meeting.workspace_id == workspace_id,
            Meeting.project_id == project_id,
        )
        .with_for_update()
    )
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def _attendee_rows(db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID):
    return db.execute(
        select(MeetingAttendee.user_id, Profile.display_name, MeetingAttendee.created_at)
        .join(Profile, Profile.user_id == MeetingAttendee.user_id)
        .where(
            MeetingAttendee.workspace_id == workspace_id,
            MeetingAttendee.project_id == project_id,
            MeetingAttendee.meeting_id == meeting_id,
        )
        .order_by(Profile.display_name, MeetingAttendee.user_id)
    ).all()


def _attendee_response(row) -> dict[str, object]:
    return {"user_id": row.user_id, "display_name": row.display_name, "created_at": row.created_at}


def create_meeting(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    *,
    title: str,
    description: str,
    starts_at: datetime,
    duration_minutes: int,
    meeting_type: str,
    agenda: str,
    attendee_user_ids: list[UUID],
) -> dict[str, object]:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _require_collaborator(access)
        _validate_attendees(db, workspace_id, project_id, attendee_user_ids)
        meeting = Meeting(
            workspace_id=workspace_id,
            project_id=project_id,
            title=title,
            description=description,
            starts_at=starts_at,
            duration_minutes=duration_minutes,
            meeting_type=meeting_type,
            agenda=agenda,
        )
        db.add(meeting)
        db.flush()
        for user_id in attendee_user_ids:
            db.add(
                MeetingAttendee(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    meeting_id=meeting.id,
                    user_id=user_id,
                )
            )
        db.flush()
        record_project_activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "meeting.created",
            "meeting",
            meeting.id,
            {"meeting_type": meeting_type, "attendee_count": len(attendee_user_ids)},
        )
        for attendee_id in attendee_user_ids:
            record_project_activity(
                db,
                workspace_id,
                project_id,
                actor_id,
                "meeting.attendee_added",
                "meeting",
                meeting.id,
                {"user_id": str(attendee_id)},
            )
        db.flush()
        return _get_meeting(db, workspace_id, project_id, meeting.id)


def list_meetings(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    user_id: UUID,
    *,
    limit: int,
    offset: int,
    search: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
    sort_by: str,
    sort_direction: str,
) -> list[dict[str, object]]:
    with db.begin():
        _context(db, workspace_id, project_id, user_id, lock=False)
        statement = _meeting_statement().where(
            Meeting.workspace_id == workspace_id, Meeting.project_id == project_id
        )
        if search:
            escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            statement = statement.where(Meeting.title.ilike(f"%{escaped}%", escape="\\"))
        if starts_after is not None:
            statement = statement.where(Meeting.starts_at >= starts_after)
        if starts_before is not None:
            statement = statement.where(Meeting.starts_at <= starts_before)
        sort_column = {
            "starts_at": Meeting.starts_at,
            "created_at": Meeting.created_at,
            "updated_at": Meeting.updated_at,
            "title": Meeting.title,
            "meeting_type": Meeting.meeting_type,
        }[sort_by]
        order = sort_column.asc() if sort_direction == "asc" else sort_column.desc()
        rows = db.execute(statement.order_by(order, Meeting.id).limit(limit).offset(offset)).all()
        return [_meeting_row(row) for row in rows]


def get_meeting(
    db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID, user_id: UUID
) -> dict[str, object]:
    with db.begin():
        _context(db, workspace_id, project_id, user_id, lock=False)
        response = _get_meeting(db, workspace_id, project_id, meeting_id)
        response["attendees"] = [
            _attendee_response(row)
            for row in _attendee_rows(db, workspace_id, project_id, meeting_id)
        ]
        return response


def update_meeting(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    actor_id: UUID,
    changes: dict[str, object],
) -> dict[str, object]:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _require_manager(access)
        meeting = _get_meeting_for_update(db, workspace_id, project_id, meeting_id)
        attendees = changes.pop("attendee_user_ids", None)
        if attendees is not None:
            _validate_attendees(db, workspace_id, project_id, attendees)
            existing = set(
                db.scalars(
                    select(MeetingAttendee.user_id).where(
                        MeetingAttendee.workspace_id == workspace_id,
                        MeetingAttendee.project_id == project_id,
                        MeetingAttendee.meeting_id == meeting_id,
                    )
                ).all()
            )
            requested = set(attendees)
            for user_id in sorted(existing - requested, key=str):
                db.execute(
                    MeetingAttendee.__table__.delete().where(
                        MeetingAttendee.workspace_id == workspace_id,
                        MeetingAttendee.project_id == project_id,
                        MeetingAttendee.meeting_id == meeting_id,
                        MeetingAttendee.user_id == user_id,
                    )
                )
                record_project_activity(
                    db,
                    workspace_id,
                    project_id,
                    actor_id,
                    "meeting.attendee_removed",
                    "meeting",
                    meeting_id,
                    {"user_id": str(user_id)},
                )
            for user_id in sorted(requested - existing, key=str):
                db.add(
                    MeetingAttendee(
                        workspace_id=workspace_id,
                        project_id=project_id,
                        meeting_id=meeting_id,
                        user_id=user_id,
                    )
                )
                record_project_activity(
                    db,
                    workspace_id,
                    project_id,
                    actor_id,
                    "meeting.attendee_added",
                    "meeting",
                    meeting_id,
                    {"user_id": str(user_id)},
                )
        changed = {
            name: value for name, value in changes.items() if getattr(meeting, name) != value
        }
        for name, value in changed.items():
            setattr(meeting, name, value)
        if changed:
            db.flush()
            record_project_activity(
                db,
                workspace_id,
                project_id,
                actor_id,
                "meeting.updated",
                "meeting",
                meeting_id,
                {"fields": sorted(changed)},
            )
        db.flush()
        return _get_meeting(db, workspace_id, project_id, meeting_id)


def delete_meeting(
    db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID, actor_id: UUID
) -> None:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _require_manager(access)
        meeting = _get_meeting_for_update(db, workspace_id, project_id, meeting_id)
        record_project_activity(
            db, workspace_id, project_id, actor_id, "meeting.deleted", "meeting", meeting_id
        )
        db.delete(meeting)


def list_attendees(
    db: Session, workspace_id: UUID, project_id: UUID, meeting_id: UUID, user_id: UUID
) -> list[dict[str, object]]:
    with db.begin():
        _context(db, workspace_id, project_id, user_id, lock=False)
        if (
            db.scalar(
                select(Meeting.id).where(
                    Meeting.id == meeting_id,
                    Meeting.workspace_id == workspace_id,
                    Meeting.project_id == project_id,
                )
            )
            is None
        ):
            raise HTTPException(status_code=404, detail="Meeting not found")
        return [
            _attendee_response(row)
            for row in _attendee_rows(db, workspace_id, project_id, meeting_id)
        ]


def add_attendee(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    actor_id: UUID,
    user_id: UUID,
) -> dict[str, object]:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        _require_manager(access)
        _get_meeting_for_update(db, workspace_id, project_id, meeting_id)
        _validate_attendees(db, workspace_id, project_id, [user_id])
        exists = db.scalar(
            select(MeetingAttendee.user_id).where(
                MeetingAttendee.workspace_id == workspace_id,
                MeetingAttendee.project_id == project_id,
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.user_id == user_id,
            )
        )
        if exists is not None:
            raise HTTPException(status_code=409, detail="User is already an attendee")
        db.add(
            MeetingAttendee(
                workspace_id=workspace_id,
                project_id=project_id,
                meeting_id=meeting_id,
                user_id=user_id,
            )
        )
        record_project_activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "meeting.attendee_added",
            "meeting",
            meeting_id,
            {"user_id": str(user_id)},
        )
        db.flush()
        row = db.execute(
            select(MeetingAttendee.user_id, Profile.display_name, MeetingAttendee.created_at)
            .join(Profile, Profile.user_id == MeetingAttendee.user_id)
            .where(
                MeetingAttendee.workspace_id == workspace_id,
                MeetingAttendee.project_id == project_id,
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.user_id == user_id,
            )
        ).one()
        return _attendee_response(row)


def remove_attendee(
    db: Session,
    workspace_id: UUID,
    project_id: UUID,
    meeting_id: UUID,
    actor_id: UUID,
    user_id: UUID,
) -> None:
    with db.begin():
        project, access = _context(db, workspace_id, project_id, actor_id, lock=True)
        if project.archived_at is not None:
            raise HTTPException(status_code=409, detail="Archived projects are read-only")
        meeting = _get_meeting_for_update(db, workspace_id, project_id, meeting_id)
        if actor_id != user_id:
            _require_manager(access)
        attendee = db.get(
            MeetingAttendee,
            (workspace_id, project_id, meeting_id, user_id),
        )
        if attendee is None:
            raise HTTPException(status_code=404, detail="Meeting attendee not found")
        db.delete(attendee)
        record_project_activity(
            db,
            workspace_id,
            project_id,
            actor_id,
            "meeting.attendee_removed",
            "meeting",
            meeting.id,
            {"user_id": str(user_id)},
        )
