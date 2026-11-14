"""FastAPI app factory + startup."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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


class SSEPassthroughGZipMiddleware:
    """Pure ASGI GZip wrapper that bypasses compression and buffering for SSE streams."""

    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int = 500,
        compresslevel: int = 9,
    ) -> None:
        self.app = app
        self._gzip_app = GZipMiddleware(
            app,
            minimum_size=minimum_size,
            compresslevel=compresslevel,
        )

    @staticmethod
    def _should_bypass_gzip(scope: Scope) -> bool:
        if scope.get("type") != "http":
            return True
        path = scope.get("path", "")
        if isinstance(path, str) and path.endswith("/events"):
            return True
        for raw_key, raw_val in scope.get("headers") or ():
            if raw_key.lower() == b"accept" and b"text/event-stream" in raw_val.lower():
                return True
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self._should_bypass_gzip(scope):
            await self.app(scope, receive, send)
            return
        await self._gzip_app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Pure ASGI security-header injector preserving zero-buffer streaming & disconnect detection."""

    _DEFAULT_HEADERS: tuple[tuple[bytes, bytes], ...] = (
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"SAMEORIGIN"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        async def _send_with_headers(message: Message) -> None:
            if message.get("type") == "http.response.start":
                raw_headers = list(message.get("headers") or [])
                existing = {k.lower() for k, _ in raw_headers}
                for key_bytes, val_bytes in self._DEFAULT_HEADERS:
                    if key_bytes not in existing:
                        raw_headers.append((key_bytes, val_bytes))
                message = {**message, "headers": raw_headers}
            await send(message)

        await self.app(scope, receive, _send_with_headers)


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
    app.add_middleware(SSEPassthroughGZipMiddleware, minimum_size=1000)
    app.add_middleware(SecurityHeadersMiddleware)
    logger.info(f"CORS configured with origins: {origins}, credentials: {allow_credentials}")

    # Init DB (MVP)
    init_db()
    logger.info("Database initialized")

    worker_mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower() or "inline"
    if not is_test_runtime() and worker_mode != "web_only":
        import threading

        def _startup_background_maintenance() -> None:
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

            try:
                from integrity_checker.api.deps import get_pipeline
                from integrity_checker.api.job_recovery import recover_orphaned_essay_jobs

                recovery_summary = recover_orphaned_essay_jobs(get_pipeline)
                if any(recovery_summary.values()):
                    logger.info(f"Startup orphan job recovery summary: {recovery_summary}")
            except Exception as exc:
                logger.warning(f"Startup orphan job recovery failed: {exc}")

        threading.Thread(target=_startup_background_maintenance, daemon=True).start()

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
