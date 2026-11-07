"""Profile provisioning for verified Supabase identities."""

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
