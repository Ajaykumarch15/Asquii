"""Static checks for PostgreSQL schema metadata and tenant constraints."""

from app.models import Base
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import configure_mappers
from sqlalchemy.schema import CreateIndex, CreateTable

EXPECTED_TABLES = {
    "profiles",
    "workspaces",
    "workspace_members",
    "workspace_invitations",
    "projects",
    "project_members",
    "milestones",
    "tasks",
    "task_subtasks",
    "task_comments",
    "meetings",
    "meeting_attendees",
    "resources",
    "user_resource_preferences",
    "activity_logs",
}


def test_all_approved_models_are_registered():
    app_tables = {table.name for table in Base.metadata.tables.values() if table.schema != "auth"}
    assert app_tables == EXPECTED_TABLES
    assert "users" in Base.metadata.tables["auth.users"].name


def test_orm_relationships_configure_without_ambiguity():
    configure_mappers()


def test_postgresql_ddl_compiles_for_all_application_tables_and_indexes():
    dialect = postgresql.dialect()
    application_tables = [table for table in Base.metadata.sorted_tables if table.schema != "auth"]
    assert len(application_tables) == len(EXPECTED_TABLES)
    for table in application_tables:
        assert "CREATE TABLE" in str(CreateTable(table).compile(dialect=dialect))
        for index in table.indexes:
            assert "CREATE" in str(CreateIndex(index).compile(dialect=dialect))


def test_supabase_auth_is_referenced_but_not_modeled_as_application_table():
    profiles = Base.metadata.tables["profiles"]
    assert next(iter(profiles.c.user_id.foreign_keys)).target_fullname == "auth.users.id"
    assert "password" not in profiles.c
    assert "password_hash" not in profiles.c


def test_tenant_relationships_use_composite_foreign_keys():
    project_members = Base.metadata.tables["project_members"]
    member_targets = {
        tuple(element.target_fullname for element in constraint.elements)
        for constraint in project_members.foreign_key_constraints
    }
    assert ("projects.id", "projects.workspace_id") in member_targets
    assert (
        "workspace_members.workspace_id",
        "workspace_members.user_id",
    ) in member_targets

    tasks = Base.metadata.tables["tasks"]
    task_targets = {
        tuple(element.target_fullname for element in constraint.elements)
        for constraint in tasks.foreign_key_constraints
    }
    assert ("projects.id", "projects.workspace_id") in task_targets
    assert (
        "project_members.workspace_id",
        "project_members.project_id",
        "project_members.user_id",
    ) in task_targets


def test_workspace_and_project_role_guards_exist():
    members = Base.metadata.tables["workspace_members"]
    roles = Base.metadata.tables["project_members"]
    assert any(
        "Owner" in str(check.sqltext) for check in members.constraints if hasattr(check, "sqltext")
    )
    assert any(
        "Project Manager" in str(check.sqltext)
        for check in roles.constraints
        if hasattr(check, "sqltext")
    )
    owner_index = next(
        index for index in members.indexes if index.name == "uq_workspace_members_active_owner"
    )
    assert owner_index.unique is True
    assert "removed_at IS NULL" in str(owner_index.dialect_options["postgresql"]["where"])


def test_preferences_and_activity_log_keep_intended_boundaries():
    resources = Base.metadata.tables["resources"]
    assert "starred" not in resources.c
    assert "starred" in Base.metadata.tables["user_resource_preferences"].c
    activity = Base.metadata.tables["activity_logs"]
    assert activity.c.project_id.nullable
    assert activity.c.actor_user_id.nullable
    assert activity.c.created_at.server_default is not None
