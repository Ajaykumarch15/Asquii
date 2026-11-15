"""Profile provisioning for verified Supabase identities."""

from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.jwt import CurrentUser
from app.models.profile import Profile


def provision_profile(db: Session, user: CurrentUser) -> Profile:
    """Create a missing profile once, without overwriting user-edited fields."""

    profile = db.get(Profile, user.user_id)
    if profile is not None:
        return profile

    display_name = user.email.partition("@")[0][:120] if user.email else "New user"
    statement = (
        insert(Profile)
        .values(user_id=user.user_id, display_name=display_name)
        .on_conflict_do_nothing(index_elements=[Profile.user_id])
    )
    db.execute(statement)
    profile = db.scalar(select(Profile).where(Profile.user_id == user.user_id))
    if profile is None:
        # A missing auth.users row or concurrent external deletion should fail closed.
        raise RuntimeError("Verified Supabase user has no provisionable profile")
    return profile


def update_profile(
    db: Session, user: CurrentUser, changes: Mapping[str, str | None]
) -> Profile:
    """Update self-service profile fields for the verified subject only."""

    profile = provision_profile(db, user)
    if "display_name" in changes:
        display_name = changes["display_name"]
        if display_name is None or not display_name.strip():
            raise ValueError("Display name must not be blank")
        profile.display_name = display_name
    if "job_title" in changes:
        profile.job_title = changes["job_title"]
    db.flush()
    return profile
