"""Apply the least-privilege application role to the configured database.

Reads DATABASE_URL (admin, e.g. the Supabase `postgres` role) from
backend/.env plus a password for the `asquii_app` role, then applies
backend/db/roles/app_least_privilege.sql idempotently (safe to re-run).

Usage:
    python scripts/apply_app_role.py [--password <secret>]

Without --password a random password is generated and printed once; paste it
into backend/.env's DATABASE_URL (the app role connection) and point
DATABASE_MIGRATE_URL at the admin connection for migrations.
"""

import argparse
import re as re_module
import secrets
from pathlib import Path

from sqlalchemy import create_engine, text

SQL_PATH = Path(__file__).resolve().parents[1] / "db" / "roles" / "app_least_privilege.sql"

PASSWORD_TOKEN = "'__ASQUII_APP_PASSWORD__'"
DB_TOKEN = "__ASQUII_DB_NAME__"

# secrets.token_urlsafe output matches this; keep the guard so a future
# manual password cannot smuggle SQL through the literal substitution.
SAFE_PASSWORD = re_module.compile(r"^[A-Za-z0-9_\-!@#$%^*+.]{16,128}$")


def read_admin_url() -> str:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            break
    else:
        raise SystemExit("DATABASE_URL not found in backend/.env")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description="Create/refresh the asquii_app least-privilege role")
    parser.add_argument("--password", help="Password for the asquii_app role; generated when omitted")
    args = parser.parse_args()

    password = args.password or secrets.token_urlsafe(24)
    if not SAFE_PASSWORD.match(password):
        raise SystemExit("Password contains unsupported characters; use 16+ of A-Za-z0-9_-")

    raw = SQL_PATH.read_text(encoding="utf-8")

    engine = create_engine(read_admin_url(), connect_args={"connect_timeout": 20})
    with engine.connect() as connection:
        db_name = connection.execute(text("SELECT current_database()")).scalar_one()
        if '"' in db_name or "'" in db_name:
            raise SystemExit(f"Unexpected database name: {db_name!r}")

        role_exists = connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asquii_app')")
        ).scalar_one()

        if role_exists:
            # Password refresh path: quoted literal, charset validated above.
            statement = f"ALTER ROLE asquii_app LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
        else:
            statement = raw.replace(PASSWORD_TOKEN, f"'{password}'")
        statement = statement.replace(DB_TOKEN, db_name)

        connection.exec_driver_sql(statement)
        connection.commit()

        grants = connection.execute(text(
            "SELECT COUNT(*) FROM information_schema.role_table_grants "
            "WHERE grantee = 'asquii_app' AND table_schema = 'public' AND privilege_type = 'SELECT'"
        )).scalar_one()
        flags = connection.execute(text(
            "SELECT rolbypassrls, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'asquii_app'"
        )).one()
    engine.dispose()
    line = (
        f"role asquii_app ensured (existed={role_exists}): "
        f"bypassrls={flags.rolbypassrls} superuser={flags.rolsuper} "
        f"createrole={flags.rolcreaterole} createdb={flags.rolcreatedb}"
    )
    print(line)
    print(f"SELECT grants on public tables: {grants} (expected 15)")
    print(f"PASSWORD={password}")


if __name__ == "__main__":
    main()
