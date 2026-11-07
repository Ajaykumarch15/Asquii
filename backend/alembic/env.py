"""Alembic environment configured from validated process settings."""

from logging.config import fileConfig

import app.models  # noqa: F401
from alembic import context
from app.core.config import get_settings
from app.database.base import Base
from sqlalchemy import engine_from_config, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
# Migrations may run under a dedicated admin URL (DATABASE_MIGRATE_URL) so the
# runtime connection (DATABASE_URL, the least-privilege asquii_app role) never
# needs DDL rights. Fall back to the runtime URL when the migrate URL is unset.
migrate_url = (
    settings.database_migrate_url
    if settings.database_migrate_url is not None
    else settings.database_url
)
if migrate_url is not None:
    # Escape configparser interpolation ("%%" -> "%") so URL-encoded
    # credentials such as %40 in passwords survive set_main_option.
    config.set_main_option(
        "sqlalchemy.url", migrate_url.get_secret_value().replace("%", "%%")
    )
target_metadata = Base.metadata


def include_object(object_, name, type_, reflected, compare_to):
    """Keep Supabase-owned auth metadata out of application autogeneration."""

    if type_ == "table" and object_.info.get("external"):
        return False
    if type_ == "table" and object_.schema == "auth":
        return False
    if type_ == "column" and object_.table.schema == "auth":
        return False
    return True


def run_migrations_offline() -> None:
    """Run migrations without creating an Engine."""

    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
        version_table_schema="public",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations using a fresh SQLAlchemy connection."""

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
            version_table_schema="public",
        )
        with context.begin_transaction():
            # Revisions 0002/0003 contain some unqualified PostgreSQL DDL.
            # Pin its resolution for this transaction and fail closed if the
            # intended schema is not the effective first schema.
            connection.exec_driver_sql("SET LOCAL search_path TO public, pg_catalog")
            current_schema = connection.exec_driver_sql("SELECT current_schema()").scalar_one()
            if current_schema != "public":
                raise RuntimeError("Alembic migrations must target the public schema")
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
