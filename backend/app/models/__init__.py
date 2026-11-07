"""Application ORM models, imported here for Alembic metadata discovery."""

from app.database.base import Base
from app.models.activity_log import ActivityLog
from app.models.meeting import Meeting, MeetingAttendee
from app.models.milestone import Milestone
from app.models.profile import Profile
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.resource import Resource, UserResourcePreference
from app.models.task import Task, TaskComment, TaskSubtask
from app.models.workspace import Workspace
from app.models.workspace_invitation import WorkspaceInvitation
from app.models.workspace_member import WorkspaceMember

__all__ = [
    "ActivityLog",
    "Base",
    "Meeting",
    "MeetingAttendee",
    "Milestone",
    "Profile",
    "Project",
    "ProjectMember",
    "Resource",
    "Task",
    "TaskComment",
    "TaskSubtask",
    "UserResourcePreference",
    "Workspace",
    "WorkspaceInvitation",
    "WorkspaceMember",
]
