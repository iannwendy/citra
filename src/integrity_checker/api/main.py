"""FastAPI app factory + startup."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from integrity_checker.api.routes import (
    audit,
    auth,
    billing,
    cache,
    essays,
    export,
    health,
    report,
    system,
    teacher,
    users,
    verdicts,
)
from integrity_checker.config import get_settings, is_test_runtime
from integrity_checker.db.session import init_db
from integrity_checker.logging import configure_logging, get_logger

logger = get_logger(__name__)


def create_app() -> FastAPI:
    """App factory — dễ test."""
    settings = get_settings()
    configure_logging()

    is_prod = (
        settings.app.env.strip().lower() in ("production", "prod", "live")
        and not is_test_runtime()
    )

    app = FastAPI(
        title="Essay Integrity Checker API",
        description=(
            "Citation-only validation. Decision-support for lecturers — "
            "KHÔNG tự động kết luận gian lận học thuật."
        ),
        version=settings.app.version,
        docs_url=None if is_prod else "/docs",
        redoc_url=None if is_prod else "/redoc",
        openapi_url=None if is_prod else "/openapi.json",
    )

    # CORS configuration
    # FIX: Don't use allow_credentials=True with allow_origins=["*"] (browsers reject this)
    # Use environment-based allowed origins for production
    import os
    allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
    if allowed_origins:
        # Split by comma and strip whitespace
        origins = [o.strip() for o in allowed_origins.split(",") if o.strip()]
    else:
        # Default to localhost for development
        origins = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]

    # Determine if credentials are allowed based on origins
    # If using wildcard origins, don't allow credentials
    allow_credentials = "*" not in ",".join(origins) if origins else False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    logger.info(f"CORS configured with origins: {origins}, credentials: {allow_credentials}")

    @app.middleware("http")
    async def add_security_headers(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    # Init DB (MVP)
    init_db()
    logger.info("Database initialized")

    if not is_test_runtime():
        import threading

        def _prewarm_local_papers_stats() -> None:
            try:
                from integrity_checker.database import LocalDatabase

                LocalDatabase().get_stats()
                logger.info("Pre-warmed local_papers.db stats cache")
            except Exception as exc:
                logger.debug(f"Could not pre-warm local_papers.db stats: {exc}")

            try:
                from integrity_checker.matching.semantic import SemanticMatcher

                matcher = SemanticMatcher.get_instance()
                model = matcher._get_model()
                if model is not None:
                    matcher._get_intent_embeddings(model)
                    logger.info("Pre-warmed SemanticMatcher model & intent embeddings")
            except Exception as exc:
                logger.debug(f"Could not pre-warm SemanticMatcher model: {exc}")

        threading.Thread(target=_prewarm_local_papers_stats, daemon=True).start()

    # Ensure avatars directory exists before mounting
    from integrity_checker.config import PROJECT_ROOT

    avatars_dir = PROJECT_ROOT / "data" / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    # Serve uploaded avatars (user-uploaded profile pictures)
    app.mount(
        "/api/avatars",
        StaticFiles(directory=str(avatars_dir)),
        name="avatars",
    )
    logger.info("Avatar static mount registered at /api/avatars")

    # Mount routes
    app.include_router(health.router, prefix="/api", tags=["health"])
    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(billing.router, prefix="/api/billing", tags=["billing"])
    app.include_router(audit.router, prefix="/api/audit", tags=["audit"])
    app.include_router(cache.router, prefix="/api/cache", tags=["cache"])
    app.include_router(users.router, prefix="/api/users", tags=["users"])
    app.include_router(teacher.router, prefix="/api/teacher", tags=["teacher"])
    app.include_router(system.router, prefix="/api/system", tags=["system"])
    app.include_router(essays.router, prefix="/api/essays", tags=["essays"])
    app.include_router(verdicts.router, prefix="/api/essays", tags=["verdicts"])
    app.include_router(report.router, prefix="/api/essays", tags=["report"])
    app.include_router(export.router, prefix="/api/export", tags=["export"])

    return app


# Module-level app cho uvicorn
app = create_app()
