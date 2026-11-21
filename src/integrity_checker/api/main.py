"""FastAPI app factory + startup."""

from __future__ import annotations

import os
import re
import threading
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

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
from integrity_checker.config import (
    PROJECT_ROOT,
    get_settings,
    is_production_env,
    is_test_runtime,
)
from integrity_checker.db import session as session_mod
from integrity_checker.db.session import init_db
from integrity_checker.logging import (
    configure_logging,
    get_logger,
    reset_request_id,
    set_request_id,
)

logger = get_logger(__name__)

_SAFE_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


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


class RequestIdMiddleware:
    """Pure ASGI correlation-ID middleware propagating safe X-Request-ID into logs & responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def _resolve_request_id(scope: Scope) -> str:
        for raw_key, raw_val in scope.get("headers") or ():
            if raw_key.lower() == b"x-request-id":
                try:
                    candidate = raw_val.decode("ascii").strip()
                except UnicodeDecodeError:
                    break
                if _SAFE_REQUEST_ID_RE.fullmatch(candidate):
                    return candidate
                break
        return uuid.uuid4().hex

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        req_id = self._resolve_request_id(scope)
        req_id_bytes = req_id.encode("ascii")
        token = set_request_id(req_id)

        async def _send_with_request_id(message: Message) -> None:
            if message.get("type") == "http.response.start":
                raw_headers = list(message.get("headers") or [])
                existing = {k.lower() for k, _ in raw_headers}
                if b"x-request-id" not in existing:
                    raw_headers.append((b"x-request-id", req_id_bytes))
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, _send_with_request_id)
        finally:
            reset_request_id(token)


class SecurityHeadersMiddleware:
    """Pure ASGI security-header injector preserving zero-buffer streaming & disconnect detection."""

    _DEFAULT_HEADERS: tuple[tuple[bytes, bytes], ...] = (
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"SAMEORIGIN"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
        (b"cross-origin-resource-policy", b"same-site"),
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


def _startup_background_maintenance(stop_event: threading.Event) -> None:
    """Cooperatively warm local caches & recover orphaned jobs when server lifespan starts."""
    if stop_event.is_set():
        return
    try:
        from integrity_checker.database import LocalDatabase

        LocalDatabase().get_stats()
        logger.info("Pre-warmed local_papers.db stats cache")
    except Exception as exc:
        logger.debug(f"Could not pre-warm local_papers.db stats: {exc}")

    if stop_event.is_set():
        return
    try:
        from integrity_checker.matching.semantic import SemanticMatcher

        matcher = SemanticMatcher.get_instance()
        model = matcher._get_model()
        if model is not None and not stop_event.is_set():
            matcher._get_intent_embeddings(model)
            logger.info("Pre-warmed SemanticMatcher model & intent embeddings")
    except Exception as exc:
        logger.debug(f"Could not pre-warm SemanticMatcher model: {exc}")

    if stop_event.is_set():
        return
    try:
        from integrity_checker.api.deps import get_pipeline
        from integrity_checker.api.job_recovery import recover_orphaned_essay_jobs

        recovery_summary = recover_orphaned_essay_jobs(get_pipeline)
        if any(recovery_summary.values()):
            logger.info(f"Startup orphan job recovery summary: {recovery_summary}")
    except Exception as exc:
        logger.warning(f"Startup orphan job recovery failed: {exc}")


def _is_memory_or_static_engine(eng: Any) -> bool:
    """Return True if *eng* uses StaticPool or an in-memory SQLite URL (including SQLAlchemy 2.1 `sqlite://`)."""
    from sqlalchemy.pool import StaticPool

    if isinstance(getattr(eng, "pool", None), StaticPool):
        return True
    url_obj = getattr(eng, "url", None)
    url_str = str(url_obj or "").strip()
    if url_str in ("sqlite://", "sqlite:///", "sqlite:///:memory:") or ":memory:" in url_str:
        return True
    db_attr = getattr(url_obj, "database", "__non_memory__")
    return bool(url_str.startswith("sqlite") and db_attr in (None, "", ":memory:"))


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Ensure DB is initialized on startup and background/pooled resources are disposed on shutdown."""
    init_db()
    stop_event = threading.Event()
    maint_thread: threading.Thread | None = None
    worker_mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower() or "inline"
    if not is_test_runtime() and worker_mode == "inline":
        maint_thread = threading.Thread(
            target=_startup_background_maintenance,
            args=(stop_event,),
            name="citra-startup-maintenance",
            daemon=True,
        )
        maint_thread.start()
    try:
        yield
    finally:
        stop_event.set()
        if maint_thread is not None and maint_thread.is_alive():
            maint_thread.join(timeout=2.0)
        eng = session_mod._engine
        if eng is not None and not _is_memory_or_static_engine(eng):
            eng.dispose()


def _configured_uvicorn_workers() -> int:
    workers = 1
    for env_name in ("UVICORN_WORKERS", "WEB_CONCURRENCY"):
        raw = (os.getenv(env_name) or "").strip()
        if raw:
            try:
                workers = max(workers, int(raw))
            except ValueError:
                continue
    return workers


def create_app() -> FastAPI:
    """App factory — dễ test."""
    settings = get_settings()
    configure_logging()

    is_prod = is_production_env() and not is_test_runtime()

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
        lifespan=_lifespan,
    )

    allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
    if allowed_origins:
        origins = [o.strip() for o in allowed_origins.split(",") if o.strip()]
    else:
        origins = [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ]

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
    app.add_middleware(RequestIdMiddleware)
    logger.info(f"CORS configured with origins: {origins}, credentials: {allow_credentials}")

    # Idempotent init_db() so bare TestClient(app) callers without context manager still work
    init_db()
    logger.info("Database initialized")

    worker_mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower() or "inline"
    configured_workers = _configured_uvicorn_workers()
    if worker_mode == "inline" and configured_workers > 1:
        logger.warning(
            f"CITRA_WORKER_MODE=inline with multiple Uvicorn workers ({configured_workers}) "
            "duplicates SBERT/ONNX memory and splits in-memory SSE progress & admission queues. "
            "Pin --workers 1 for inline mode or run CITRA_WORKER_MODE=web_only + standalone worker."
        )

    env_avatars = (os.getenv("AVATARS_DIR") or "").strip()
    avatars_dir = (
        Path(env_avatars)
        if env_avatars
        else (Path(settings.paths.data_dir) / "avatars" if settings.paths.data_dir else PROJECT_ROOT / "data" / "avatars")
    )
    avatars_dir.mkdir(parents=True, exist_ok=True)

    app.mount(
        "/api/avatars",
        StaticFiles(directory=str(avatars_dir)),
        name="avatars",
    )
    logger.info("Avatar static mount registered at /api/avatars")

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


if TYPE_CHECKING:
    app: FastAPI

_app_instance: FastAPI | None = None
_app_lock = threading.Lock()


def get_app() -> FastAPI:
    """Return lazily created module-level FastAPI app singleton."""
    global _app_instance
    if _app_instance is None:
        with _app_lock:
            if _app_instance is None:
                _app_instance = create_app()
                globals()["app"] = _app_instance
    return _app_instance


def __getattr__(name: str) -> Any:
    if name == "app":
        return get_app()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
