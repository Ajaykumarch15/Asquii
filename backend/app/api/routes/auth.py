"""Authentication inspection endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.auth.schemas import CurrentProfileResponse, CurrentProfileUpdate
from app.auth.service import provision_profile, update_profile
from app.database.session import get_db
from app.models.profile import Profile

router = APIRouter(prefix="/auth", tags=["auth"])


def _profile_response(profile: Profile, user: CurrentUser) -> CurrentProfileResponse:
    return CurrentProfileResponse(
        user_id=profile.user_id,
        email=user.email,
        display_name=profile.display_name,
        job_title=profile.job_title,
    )


@router.get("/me", response_model=CurrentProfileResponse)
def current_profile(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrentProfileResponse:
    """Return the authenticated user's persisted safe profile."""

    return _profile_response(provision_profile(db, user), user)


@router.patch("/me", response_model=CurrentProfileResponse)
def update_current_profile(
    body: CurrentProfileUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrentProfileResponse:
    """Update the authenticated user's display name and job title.

    The verified subject, email, and roles are never client-editable.
    """

    # exclude_unset keeps "field omitted" distinct from "job_title cleared".
    changes = body.model_dump(exclude_unset=True)
    return _profile_response(update_profile(db, user, changes), user)
