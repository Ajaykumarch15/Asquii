"""Central versioned API router."""

from fastapi import APIRouter

from app.activities.router import project_router as project_activities_router
from app.activities.router import workspace_router as workspace_activities_router
from app.api.routes.auth import router as auth_router
from app.core.config import get_settings
from app.meetings.router import router as meetings_router
from app.projects.router import router as projects_router
from app.resources.router import router as resources_router
from app.tasks.router import router as tasks_router
from app.workspaces.router import invitation_router, workspace_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(workspace_router)
router.include_router(invitation_router)
router.include_router(projects_router)
router.include_router(tasks_router)
router.include_router(meetings_router)
router.include_router(resources_router)
router.include_router(workspace_activities_router)
router.include_router(project_activities_router)


@router.get("/", tags=["meta"])
def api_info() -> dict[str, str]:
    """Return basic versioned API metadata."""

    settings = get_settings()
    return {"name": settings.app_name, "version": settings.app_version}
