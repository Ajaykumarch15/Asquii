"""Central versioned API router."""

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/", tags=["meta"])
def api_info() -> dict[str, str]:
    """Return basic versioned API metadata."""

    settings = get_settings()
    return {"name": settings.app_name, "version": settings.app_version}
