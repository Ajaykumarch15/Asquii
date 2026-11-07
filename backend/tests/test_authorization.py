"""Table-driven authorization policy checks."""

from unittest.mock import Mock
from uuid import uuid4

import pytest
from app.authorization.service import (
    ProjectAccess,
    WorkspaceAccess,
    get_project_access,
    get_workspace_access,
    require_project_collaborator,
    require_project_manager,
    require_workspace_admin,
)
from fastapi import HTTPException


@pytest.mark.parametrize(
    ("role", "can_administer"),
    [("Owner", True), ("Admin", True), ("Member", False)],
)
def test_workspace_admin_policy(role, can_administer):
    access = WorkspaceAccess(uuid4(), uuid4(), role)
    assert access.can_administer is can_administer


@pytest.mark.parametrize(
    ("workspace_role", "project_role", "settings", "collaborate"),
    [
        ("Owner", None, True, True),
        ("Admin", None, True, True),
        ("Member", None, False, False),
        ("Member", "Project Manager", True, True),
        ("Member", "Project Member", False, True),
    ],
)
def test_project_policy_matrix(workspace_role, project_role, settings, collaborate):
    access = ProjectAccess(uuid4(), uuid4(), uuid4(), workspace_role, project_role)
    assert access.can_read is True
    assert access.can_manage_settings is settings
    assert access.can_manage_members is settings
    assert access.can_collaborate is collaborate


def test_removed_members_are_not_represented_as_authorized_context():
    """Database lookup helpers raise 403 rather than creating access on a miss."""

    class NoMembershipSession:
        def scalar(self, statement):
            return None

    with pytest.raises(HTTPException) as error:
        get_workspace_access(NoMembershipSession(), uuid4(), uuid4())
    assert error.value.status_code == 403


@pytest.mark.parametrize("role", ["Owner", "Admin", "Member"])
def test_workspace_role_is_loaded_from_current_database_membership(role):
    db = Mock()
    db.scalar.return_value = role
    user_id, workspace_id = uuid4(), uuid4()

    access = get_workspace_access(db, user_id, workspace_id)

    assert (access.user_id, access.workspace_id, access.role) == (
        user_id,
        workspace_id,
        role,
    )
    assert db.scalar.call_count == 1


def test_workspace_admin_guard_denies_member_and_removed_member():
    db = Mock()
    db.scalar.return_value = "Member"
    with pytest.raises(HTTPException) as member_error:
        require_workspace_admin(db, uuid4(), uuid4())
    assert member_error.value.status_code == 403

    db.scalar.return_value = None
    with pytest.raises(HTTPException) as removed_error:
        require_workspace_admin(db, uuid4(), uuid4())
    assert removed_error.value.status_code == 403


@pytest.mark.parametrize(
    ("workspace_role", "project_role", "settings", "collaborate"),
    [
        ("Owner", None, True, True),
        ("Admin", None, True, True),
        ("Member", None, False, False),
        ("Member", "Project Manager", True, True),
        ("Member", "Project Member", False, True),
    ],
)
def test_project_access_comes_from_active_database_rows(
    workspace_role, project_role, settings, collaborate
):
    workspace_id, project_id, user_id = uuid4(), uuid4(), uuid4()
    db = Mock()
    db.execute.return_value.one_or_none.return_value = (
        workspace_id,
        workspace_role,
        project_role,
    )

    access = get_project_access(db, user_id, project_id)

    assert access.workspace_id == workspace_id
    assert access.project_id == project_id
    assert access.can_read is True
    assert access.can_manage_settings is settings
    assert access.can_collaborate is collaborate
    assert db.execute.call_count == 1


def test_project_guards_deny_nonmember_and_cross_workspace_lookup_miss():
    db = Mock()
    db.execute.return_value.one_or_none.return_value = (uuid4(), "Member", None)
    with pytest.raises(HTTPException) as write_error:
        require_project_collaborator(db, uuid4(), uuid4())
    assert write_error.value.status_code == 403
    with pytest.raises(HTTPException) as manager_error:
        require_project_manager(db, uuid4(), uuid4())
    assert manager_error.value.status_code == 403

    db.execute.return_value.one_or_none.return_value = None
    with pytest.raises(HTTPException) as cross_workspace_error:
        get_project_access(db, uuid4(), uuid4())
    assert cross_workspace_error.value.status_code == 403
