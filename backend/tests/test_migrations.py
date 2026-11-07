"""Static migration chain and operation checks; no database is modified."""

import re
from pathlib import Path
from unittest.mock import patch

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_schema_revision_follows_preserved_empty_baseline():
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_current_head() == "0005_rls_lock_read_relaxations"
    revision = script.get_revision("0002_mvp_schema")
    correction = script.get_revision("0003_lifecycle_hardening")
    hardening = script.get_revision("0004_enable_rls_and_policies")
    relaxations = script.get_revision("0005_rls_lock_read_relaxations")
    assert revision.down_revision == "0001_empty_baseline"
    assert correction.down_revision == "0002_mvp_schema"
    assert hardening.down_revision == "0003_lifecycle_hardening"
    assert relaxations.down_revision == "0004_enable_rls_and_policies"
    assert script.get_revision("0001_empty_baseline") is not None

    relaxations_source = (
        backend_root / "alembic" / "versions" / "0005_rls_lock_read_relaxations.py"
    ).read_text(encoding="utf-8")
    assert relaxations_source.count('"ALTER POLICY"') == 0
    assert relaxations_source.count("ALTER POLICY") == 2
    # Members/invitees may lock-read, but actual updates stay Owner/manager-only.
    assert "OR private.is_workspace_member(id)" in relaxations_source
    assert "OR private.can_read_project(workspace_id, id)" in relaxations_source
    assert relaxations_source.count(
        "private.has_workspace_role(id, ARRAY['Owner', 'Admin'])"
    ) >= 2
    assert relaxations_source.count(
        "private.can_manage_project(workspace_id, id)\""
    ) >= 1


def test_alembic_pins_version_table_and_migration_search_path_to_public():
    backend_root = Path(__file__).resolve().parents[1]
    env_source = (backend_root / "alembic" / "env.py").read_text(encoding="utf-8")

    assert env_source.count('version_table_schema="public"') == 2
    assert "SET LOCAL search_path TO public, pg_catalog" in env_source
    assert 'current_schema != "public"' in env_source

    for revision_file in (
        "0002_mvp_schema.py",
        "0003_lifecycle_hardening.py",
    ):
        source = (backend_root / "alembic" / "versions" / revision_file).read_text(encoding="utf-8")
        assert source.count("SET LOCAL search_path TO public, pg_catalog") == 2


def test_rls_draft_scopes_policies_and_helpers_to_authenticated_role():
    repo_root = Path(__file__).resolve().parents[2]
    source = (repo_root / "docs" / "supabase" / "05_rls_policies.sql").read_text(encoding="utf-8")
    policies = re.findall(r"(?m)^FOR (?:SELECT|INSERT|UPDATE|DELETE)(.*)$", source)

    assert policies
    assert all(" TO authenticated " in policy for policy in policies)
    assert "TO anon" not in source
    assert "workspace_has_any_member" not in source
    assert "FROM PUBLIC, anon, authenticated, service_role;" in source
    assert "REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;" in source
    assert "current_user <> 'asquii_owner'" in source


def test_migration_has_upgrade_downgrade_and_invariant_triggers():
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0002_mvp_schema.py"
    )
    source = migration_path.read_text(encoding="utf-8")
    namespace = {}
    exec(compile(source, str(migration_path), "exec"), namespace)

    assert callable(namespace["upgrade"])
    assert callable(namespace["downgrade"])
    assert "workspace_owner_invariant" in source
    assert "project_manager_invariant" in source
    assert "activity_logs_immutable" in source
    assert "FOR UPDATE" in source


def test_upgrade_declares_all_application_tables_without_auth_ddl():
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0002_mvp_schema.py"
    )
    namespace = {}
    exec(
        compile(migration_path.read_text(encoding="utf-8"), str(migration_path), "exec"), namespace
    )

    with patch("alembic.op.execute") as execute:
        namespace["upgrade"]()

    statements = [str(call.args[0]) for call in execute.call_args_list]
    created_tables = {
        name
        for statement in statements
        for name in (
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
        )
        if f"CREATE TABLE {name} " in statement
    }
    assert created_tables == {
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
    assert not any("CREATE TABLE auth.users" in statement for statement in statements)


def test_corrective_revision_handles_old_and_new_parents_without_coalesce():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0003_lifecycle_hardening.py"
    )
    source = migration_path.read_text(encoding="utf-8")
    namespace = {}
    exec(compile(source, str(migration_path), "exec"), namespace)

    assert namespace["revision"] == "0003_lifecycle_hardening"
    assert namespace["down_revision"] == "0002_mvp_schema"
    assert callable(namespace["upgrade"])
    assert callable(namespace["downgrade"])
    assert "COALESCE" not in source.upper()
    assert "ARRAY[OLD.workspace_id, NEW.workspace_id]" in source
    assert "ARRAY[OLD.project_id, NEW.project_id]" in source
    assert "ORDER BY ids.workspace_id" in source
    assert "ORDER BY ids.project_id" in source
    assert "AFTER INSERT OR UPDATE OR DELETE" in source


def test_corrective_downgrade_restores_sprint_two_triggers():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0003_lifecycle_hardening.py"
    )
    namespace = {}
    exec(
        compile(migration_path.read_text(encoding="utf-8"), str(migration_path), "exec"),
        namespace,
    )
    with patch("alembic.op.execute") as execute:
        namespace["downgrade"]()

    statements = [str(call.args[0]) for call in execute.call_args_list]
    assert any("RENAME TO lock_workspace_owner_parent" in statement for statement in statements)
    assert any(
        "CREATE CONSTRAINT TRIGGER workspace_owner_invariant_member" in statement
        for statement in statements
    )
    assert any(
        "CREATE CONSTRAINT TRIGGER project_manager_invariant_member" in statement
        for statement in statements
    )


def test_corrective_upgrade_renames_prior_functions_before_replacement():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0003_lifecycle_hardening.py"
    )
    namespace = {}
    exec(
        compile(migration_path.read_text(encoding="utf-8"), str(migration_path), "exec"),
        namespace,
    )
    with patch("alembic.op.execute") as execute:
        namespace["upgrade"]()

    statements = [str(call.args[0]) for call in execute.call_args_list]
    assert any(
        "ALTER FUNCTION public.enforce_workspace_owner_invariant() "
        "RENAME TO enforce_workspace_owner_invariant_sprint2" in statement
        for statement in statements
    )
    assert any(
        "CREATE CONSTRAINT TRIGGER workspace_owner_invariant_workspace" in statement
        and "AFTER INSERT OR UPDATE OR DELETE" in statement
        for statement in statements
    )
