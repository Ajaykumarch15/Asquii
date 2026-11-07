"""Lightweight metadata reference for Supabase-managed identity tables."""

from sqlalchemy import Column, Table
from sqlalchemy import Uuid as UUIDType

from app.database.base import Base

auth_users = Table(
    "users",
    Base.metadata,
    Column("id", UUIDType(as_uuid=True), primary_key=True),
    schema="auth",
    info={"external": True},
)
