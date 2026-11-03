"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestIDMiddleware
from app.database import health as database_health
from app.database.session import engine

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Build the application and its routes/middleware from validated settings."""

    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("application_started", extra={"environment": settings.app_env})
        yield
        if engine is not None:
            engine.dispose()
        logger.info("application_stopped")

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        debug=settings.debug and settings.app_env == "development",
        lifespan=lifespan,
    )
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    register_exception_handlers(app)

    @app.get("/health", tags=["health"])
    def liveness() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready", tags=["health"])
    def readiness():
        from fastapi.responses import JSONResponse

        if not database_health.database_is_ready():
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return {"status": "ready"}

    app.include_router(router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
