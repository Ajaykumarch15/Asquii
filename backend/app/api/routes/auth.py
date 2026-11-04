"""Authentication inspection endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.auth.schemas import CurrentProfileResponse
from app.auth.service import provision_profile
from app.database.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=CurrentProfileResponse)
def current_profile(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrentProfileResponse:
    """Return the authenticated user's persisted safe profile."""

    profile = provision_profile(db, user)
    return CurrentProfileResponse(
        user_id=profile.user_id,
        email=user.email,
        display_name=profile.display_name,
        job_title=profile.job_title,
    )
