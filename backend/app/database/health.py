"""Bounded database readiness probe."""

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database.session import engine


def database_is_ready() -> bool:
    """Return whether PostgreSQL accepts a simple query within the pool timeout."""

    if engine is None:
        return False
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False
