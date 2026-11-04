"""PostgreSQL-only lifecycle tests for deferred trigger invariants.

Set TEST_DATABASE_URL to a dedicated database ending in ``_test`` that has a
minimal ``auth.users(id uuid primary key)`` fixture table and Alembic at head.
Tests use rollback for ordinary cases and unique, explicitly cleaned rows for
concurrency cases. SQLite is not supported by this module.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="PostgreSQL lifecycle tests require a disposable TEST_DATABASE_URL",
)


@pytest.fixture(scope="module")
def pg_engine() -> Engine:
    """Connect only to an explicitly named, pre-migrated PostgreSQL test DB."""

    assert TEST_DATABASE_URL is not None
    db_name = make_url(TEST_DATABASE_URL).database
    if not db_name or not db_name.lower().endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must name a dedicated database ending in _test")

    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            actual_database = connection.scalar(text("SELECT current_database()"))
            if actual_database != db_name:
                pytest.fail("TEST_DATABASE_URL connected to an unexpected database")
            version = connection.scalar(text("SELECT version_num FROM public.alembic_version"))
            if version != "0003_lifecycle_hardening":
                pytest.fail("PostgreSQL lifecycle tests require Alembic head 0003")
            auth_columns = set(
                connection.scalars(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'auth' AND table_name = 'users'"
                    )
                )
            )
            if auth_columns != {"id"}:
                pytest.fail(
                    "Use a disposable test database with only auth.users(id uuid primary key)"
                )
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def pg_connection(pg_engine: Engine):
    """Run an integration case in a rollback-only transaction."""

    with pg_engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            if transaction.is_active:
                transaction.rollback()


def _profile(connection, user_id: UUID) -> None:
    connection.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    connection.execute(
        text("INSERT INTO public.profiles (user_id, display_name) VALUES (:id, 'Test user')"),
        {"id": user_id},
    )


def _workspace(connection, workspace_id: UUID, owner_id: UUID, *, archived: bool = False) -> None:
    connection.execute(
        text(
            "INSERT INTO public.workspaces (id, name, slug, archived_at) "
            "VALUES (:id, 'Test workspace', :slug, "
            "CASE WHEN :archived THEN now() ELSE NULL END)"
        ),
        {
            "id": workspace_id,
            "slug": f"test-{workspace_id.hex}",
            "archived": archived,
        },
    )
    if not archived:
        _workspace_member(connection, workspace_id, owner_id, "Owner")


def _workspace_member(connection, workspace_id: UUID, user_id: UUID, role: str) -> None:
    connection.execute(
        text(
            "INSERT INTO public.workspace_members (workspace_id, user_id, role) "
            "VALUES (:workspace_id, :user_id, :role)"
        ),
        {"workspace_id": workspace_id, "user_id": user_id, "role": role},
    )


def _project(connection, project_id: UUID, workspace_id: UUID, *, archived: bool = False) -> None:
    connection.execute(
        text(
            "INSERT INTO public.projects (id, workspace_id, name, archived_at) "
            "VALUES (:id, :workspace_id, 'Test project', "
            "CASE WHEN :archived THEN now() ELSE NULL END)"
        ),
        {
            "id": project_id,
            "workspace_id": workspace_id,
            "archived": archived,
        },
    )


def _project_member(connection, workspace_id: UUID, project_id: UUID, user_id: UUID) -> None:
    connection.execute(
        text(
            "INSERT INTO public.project_members "
            "(workspace_id, project_id, user_id, role) "
            "VALUES (:workspace_id, :project_id, :user_id, 'Project Manager')"
        ),
        {"workspace_id": workspace_id, "project_id": project_id, "user_id": user_id},
    )


def _validate_deferred_constraints(connection) -> None:
    connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def _cleanup_committed_workspace(
    engine: Engine, workspace_id: UUID, user_ids: list[UUID], project_ids: list[UUID]
) -> None:
    """Delete only rows created by a concurrency case in the named test DB."""

    with engine.begin() as connection:
        connection.execute(
            text("UPDATE public.workspaces SET archived_at = now() WHERE id = :id"),
            {"id": workspace_id},
        )
        for project_id in project_ids:
            connection.execute(
                text("UPDATE public.projects SET archived_at = now() WHERE id = :id"),
                {"id": project_id},
            )
        connection.execute(
            text("DELETE FROM public.project_members WHERE workspace_id = :id"),
            {"id": workspace_id},
        )
        connection.execute(
            text("DELETE FROM public.projects WHERE workspace_id = :id"),
            {"id": workspace_id},
        )
        connection.execute(
            text("DELETE FROM public.workspace_members WHERE workspace_id = :id"),
            {"id": workspace_id},
        )
        connection.execute(
            text("DELETE FROM public.workspaces WHERE id = :id"), {"id": workspace_id}
        )
        for user_id in user_ids:
            connection.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": user_id})


def test_workspace_and_first_owner_can_be_created_in_one_transaction(pg_connection):
    workspace_id, owner_id = uuid4(), uuid4()
    _profile(pg_connection, owner_id)
    _workspace(pg_connection, workspace_id, owner_id)

    _validate_deferred_constraints(pg_connection)


def test_active_workspace_without_owner_is_rejected(pg_connection):
    workspace_id, user_id = uuid4(), uuid4()
    _profile(pg_connection, user_id)
    pg_connection.execute(
        text("INSERT INTO public.workspaces (id, name, slug) VALUES (:id, 'No owner', :slug)"),
        {"id": workspace_id, "slug": f"no-owner-{workspace_id.hex}"},
    )

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_multiple_active_workspace_owners_are_rejected(pg_connection):
    workspace_id, owner_a, owner_b = uuid4(), uuid4(), uuid4()
    _profile(pg_connection, owner_a)
    _profile(pg_connection, owner_b)
    _workspace(pg_connection, workspace_id, owner_a)

    with pytest.raises(IntegrityError):
        _workspace_member(pg_connection, workspace_id, owner_b, "Owner")


def test_workspace_owner_transfer_is_valid_in_one_transaction(pg_connection):
    workspace_id, owner_a, owner_b = uuid4(), uuid4(), uuid4()
    _profile(pg_connection, owner_a)
    _profile(pg_connection, owner_b)
    _workspace(pg_connection, workspace_id, owner_a)
    _workspace_member(pg_connection, workspace_id, owner_b, "Admin")

    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET role = 'Admin' "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_id, "user_id": owner_a},
    )
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET role = 'Owner' "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_id, "user_id": owner_b},
    )

    _validate_deferred_constraints(pg_connection)


def test_removing_last_workspace_owner_is_rejected(pg_connection):
    workspace_id, owner_id = uuid4(), uuid4()
    _profile(pg_connection, owner_id)
    _workspace(pg_connection, workspace_id, owner_id)
    pg_connection.execute(
        text(
            "DELETE FROM public.workspace_members "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_id, "user_id": owner_id},
    )

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_project_and_first_manager_can_be_created_in_one_transaction(pg_connection):
    workspace_id, owner_id, project_id = uuid4(), uuid4(), uuid4()
    _profile(pg_connection, owner_id)
    _workspace(pg_connection, workspace_id, owner_id)
    _project(pg_connection, project_id, workspace_id)
    _project_member(pg_connection, workspace_id, project_id, owner_id)

    _validate_deferred_constraints(pg_connection)


def test_active_project_without_manager_is_rejected(pg_connection):
    workspace_id, owner_id, project_id = uuid4(), uuid4(), uuid4()
    _profile(pg_connection, owner_id)
    _workspace(pg_connection, workspace_id, owner_id)
    _project(pg_connection, project_id, workspace_id)

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_last_project_manager_can_be_transferred_in_one_transaction(pg_connection):
    workspace_id, owner_id, manager_a, manager_b, project_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    for user_id in (owner_id, manager_a, manager_b):
        _profile(pg_connection, user_id)
    _workspace(pg_connection, workspace_id, owner_id)
    _workspace_member(pg_connection, workspace_id, manager_a, "Member")
    _workspace_member(pg_connection, workspace_id, manager_b, "Member")
    _project(pg_connection, project_id, workspace_id)
    _project_member(pg_connection, workspace_id, project_id, manager_a)
    _project_member(pg_connection, workspace_id, project_id, manager_b)
    pg_connection.execute(
        text(
            "UPDATE public.project_members SET role = 'Project Member' "
            "WHERE workspace_id = :workspace_id AND project_id = :project_id "
            "AND user_id = :user_id"
        ),
        {"workspace_id": workspace_id, "project_id": project_id, "user_id": manager_a},
    )

    _validate_deferred_constraints(pg_connection)


def test_removing_workspace_membership_cannot_remove_last_active_manager(pg_connection):
    workspace_id, owner_id, manager_id, project_id = uuid4(), uuid4(), uuid4(), uuid4()
    for user_id in (owner_id, manager_id):
        _profile(pg_connection, user_id)
    _workspace(pg_connection, workspace_id, owner_id)
    _workspace_member(pg_connection, workspace_id, manager_id, "Member")
    _project(pg_connection, project_id, workspace_id)
    _project_member(pg_connection, workspace_id, project_id, manager_id)
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET removed_at = now() "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_id, "user_id": manager_id},
    )

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_workspace_member_reassignment_checks_old_workspace(pg_connection):
    workspace_a, workspace_b = uuid4(), uuid4()
    owner_id = uuid4()
    _profile(pg_connection, owner_id)
    _workspace(pg_connection, workspace_a, owner_id)
    pg_connection.execute(
        text(
            "INSERT INTO public.workspaces (id, name, slug, archived_at) "
            "VALUES (:id, 'Archived target', :slug, now())"
        ),
        {"id": workspace_b, "slug": f"archived-{workspace_b.hex}"},
    )
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET workspace_id = :new_workspace "
            "WHERE workspace_id = :old_workspace AND user_id = :user_id"
        ),
        {"new_workspace": workspace_b, "old_workspace": workspace_a, "user_id": owner_id},
    )
    pg_connection.execute(
        text("UPDATE public.workspaces SET archived_at = NULL WHERE id = :id"),
        {"id": workspace_b},
    )

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_workspace_member_reassignment_passes_when_both_workspaces_are_valid(pg_connection):
    workspace_a, workspace_b, owner_a, owner_b = uuid4(), uuid4(), uuid4(), uuid4()
    for user_id in (owner_a, owner_b):
        _profile(pg_connection, user_id)
    _workspace(pg_connection, workspace_a, owner_a)
    pg_connection.execute(
        text(
            "INSERT INTO public.workspaces (id, name, slug, archived_at) "
            "VALUES (:id, 'Archived target', :slug, now())"
        ),
        {"id": workspace_b, "slug": f"archived-{workspace_b.hex}"},
    )
    _workspace_member(pg_connection, workspace_a, owner_b, "Member")
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET role = 'Admin' "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_a, "user_id": owner_a},
    )
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET role = 'Owner' "
            "WHERE workspace_id = :workspace_id AND user_id = :user_id"
        ),
        {"workspace_id": workspace_a, "user_id": owner_b},
    )
    pg_connection.execute(
        text(
            "UPDATE public.workspace_members SET workspace_id = :new_workspace, role = 'Owner' "
            "WHERE workspace_id = :old_workspace AND user_id = :user_id"
        ),
        {"new_workspace": workspace_b, "old_workspace": workspace_a, "user_id": owner_a},
    )
    pg_connection.execute(
        text("UPDATE public.workspaces SET archived_at = NULL WHERE id = :id"),
        {"id": workspace_b},
    )

    _validate_deferred_constraints(pg_connection)


def test_project_member_reassignment_checks_old_project(pg_connection):
    workspace_id, owner_id, manager_a, manager_b, project_a, project_b = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    for user_id in (owner_id, manager_a, manager_b):
        _profile(pg_connection, user_id)
    _workspace(pg_connection, workspace_id, owner_id)
    _workspace_member(pg_connection, workspace_id, manager_a, "Member")
    _workspace_member(pg_connection, workspace_id, manager_b, "Member")
    _project(pg_connection, project_a, workspace_id)
    _project(pg_connection, project_b, workspace_id)
    _project_member(pg_connection, workspace_id, project_a, manager_a)
    _project_member(pg_connection, workspace_id, project_b, manager_b)
    pg_connection.execute(
        text(
            "UPDATE public.project_members SET project_id = :new_project "
            "WHERE workspace_id = :workspace_id AND project_id = :old_project "
            "AND user_id = :user_id"
        ),
        {
            "workspace_id": workspace_id,
            "old_project": project_a,
            "new_project": project_b,
            "user_id": manager_a,
        },
    )

    with pytest.raises(IntegrityError):
        _validate_deferred_constraints(pg_connection)


def test_project_member_reassignment_checks_old_and_new_projects(pg_connection):
    workspace_id, owner_id, manager_a, backup_a, manager_b, project_a, project_b = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    for user_id in (owner_id, manager_a, backup_a, manager_b):
        _profile(pg_connection, user_id)
    _workspace(pg_connection, workspace_id, owner_id)
    for user_id in (manager_a, backup_a, manager_b):
        _workspace_member(pg_connection, workspace_id, user_id, "Member")
    _project(pg_connection, project_a, workspace_id)
    _project(pg_connection, project_b, workspace_id)
    _project_member(pg_connection, workspace_id, project_a, manager_a)
    _project_member(pg_connection, workspace_id, project_a, backup_a)
    _project_member(pg_connection, workspace_id, project_b, manager_b)
    pg_connection.execute(
        text(
            "UPDATE public.project_members SET project_id = :new_project "
            "WHERE workspace_id = :workspace_id AND project_id = :old_project "
            "AND user_id = :user_id"
        ),
        {
            "workspace_id": workspace_id,
            "old_project": project_a,
            "new_project": project_b,
            "user_id": manager_a,
        },
    )

    _validate_deferred_constraints(pg_connection)


def test_concurrent_owner_transfers_leave_one_active_owner(pg_engine: Engine):
    workspace_id, owner_id, successor_a, successor_b = uuid4(), uuid4(), uuid4(), uuid4()
    user_ids = [owner_id, successor_a, successor_b]
    with pg_engine.begin() as connection:
        for user_id in user_ids:
            _profile(connection, user_id)
        _workspace(connection, workspace_id, owner_id)
        _workspace_member(connection, workspace_id, successor_a, "Admin")
        _workspace_member(connection, workspace_id, successor_b, "Admin")

    barrier = Barrier(2)

    def transfer(successor_id: UUID) -> bool:
        try:
            with pg_engine.begin() as connection:
                barrier.wait(timeout=10)
                connection.execute(
                    text(
                        "UPDATE public.workspace_members SET role = 'Admin' "
                        "WHERE workspace_id = :workspace_id AND user_id = :owner_id "
                        "AND role = 'Owner'"
                    ),
                    {"workspace_id": workspace_id, "owner_id": owner_id},
                )
                connection.execute(
                    text(
                        "UPDATE public.workspace_members SET role = 'Owner' "
                        "WHERE workspace_id = :workspace_id AND user_id = :successor_id"
                    ),
                    {"workspace_id": workspace_id, "successor_id": successor_id},
                )
            return True
        except DBAPIError:
            return False

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(transfer, (successor_a, successor_b)))
        assert results.count(True) == 1
        with pg_engine.connect() as connection:
            owner_count = connection.scalar(
                text(
                    "SELECT count(*) FROM public.workspace_members "
                    "WHERE workspace_id = :workspace_id AND role = 'Owner' AND removed_at IS NULL"
                ),
                {"workspace_id": workspace_id},
            )
        assert owner_count == 1
    finally:
        _cleanup_committed_workspace(pg_engine, workspace_id, user_ids, [])


def test_concurrent_manager_removals_leave_one_active_manager(pg_engine: Engine):
    workspace_id, owner_id, manager_a, manager_b, project_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    user_ids = [owner_id, manager_a, manager_b]
    with pg_engine.begin() as connection:
        for user_id in user_ids:
            _profile(connection, user_id)
        _workspace(connection, workspace_id, owner_id)
        _workspace_member(connection, workspace_id, manager_a, "Member")
        _workspace_member(connection, workspace_id, manager_b, "Member")
        _project(connection, project_id, workspace_id)
        _project_member(connection, workspace_id, project_id, manager_a)
        _project_member(connection, workspace_id, project_id, manager_b)

    barrier = Barrier(2)

    def remove_manager(user_id: UUID) -> bool:
        try:
            with pg_engine.begin() as connection:
                barrier.wait(timeout=10)
                connection.execute(
                    text(
                        "UPDATE public.project_members SET role = 'Project Member' "
                        "WHERE workspace_id = :workspace_id AND project_id = :project_id "
                        "AND user_id = :user_id AND role = 'Project Manager'"
                    ),
                    {
                        "workspace_id": workspace_id,
                        "project_id": project_id,
                        "user_id": user_id,
                    },
                )
            return True
        except DBAPIError:
            return False

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(remove_manager, (manager_a, manager_b)))
        assert results.count(True) == 1
        with pg_engine.connect() as connection:
            manager_count = connection.scalar(
                text(
                    "SELECT count(*) FROM public.project_members "
                    "WHERE workspace_id = :workspace_id AND project_id = :project_id "
                    "AND role = 'Project Manager'"
                ),
                {"workspace_id": workspace_id, "project_id": project_id},
            )
        assert manager_count == 1
    finally:
        _cleanup_committed_workspace(pg_engine, workspace_id, user_ids, [project_id])
