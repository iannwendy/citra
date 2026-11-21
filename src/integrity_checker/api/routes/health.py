"""Health check endpoint."""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import text

from integrity_checker.api.deps import require_admin
from integrity_checker.config import get_settings, is_test_runtime
from integrity_checker.db.models import User
from integrity_checker.db.session import get_engine
from integrity_checker.extraction import GROBID_STATUS, get_grobid_manager
from integrity_checker.logging import get_logger
from integrity_checker.models.api_schemas import GrobidHealthStatus, HealthResponse

logger = get_logger(__name__)

router = APIRouter()

_GROBID_HEALTH_TTL_SECONDS = 5.0
_grobid_health_lock = threading.Lock()
_grobid_health_cache: tuple[float, GrobidHealthStatus] | None = None


def _invalidate_grobid_health_cache() -> None:
    global _grobid_health_cache
    with _grobid_health_lock:
        _grobid_health_cache = None


def _probe_grobid_health_sync() -> GrobidHealthStatus:
    """Probe GROBID health status synchronously (intended for cached/thread execution)."""
    settings = get_settings()
    grobid_config = settings.extraction.grobid

    try:
        manager = get_grobid_manager()
        status = manager.check_health()

        # Determine available and container_running status first so message is truthful
        available = status == GROBID_STATUS.AVAILABLE
        container_running = available or (
            status in (GROBID_STATUS.UNHEALTHY, GROBID_STATUS.STARTING)
            and bool(manager.is_container_running())
        )

        # Get message
        if status == GROBID_STATUS.AVAILABLE:
            message = "GROBID is running and healthy"
        elif status == GROBID_STATUS.UNHEALTHY:
            if container_running:
                message = "GROBID container running but API not responding"
            else:
                message = "GROBID container is not running (using built-in regex parser fallback)"
        elif status == GROBID_STATUS.STOPPED:
            message = "GROBID container is stopped"
        elif status == GROBID_STATUS.STARTING:
            message = "GROBID container is starting"
        else:
            message = "GROBID status unknown"

        return GrobidHealthStatus(
            available=available,
            status=status.value,
            container_running=container_running,
            container_id=manager.stats.container_id if hasattr(manager, "stats") else None,
            parser_mode="grobid" if available else "regex",
            cache_enabled=grobid_config.cache_by_file_sha256,
            stats=manager.get_stats() if available else None,
            message=message,
        )
    except Exception as exc:
        # Log internally, don't expose exception details to client
        logger.warning("GROBID health check failed: %s", exc)
        return GrobidHealthStatus(
            available=False,
            status="error",
            container_running=False,
            parser_mode="regex",
            cache_enabled=grobid_config.cache_by_file_sha256,
            message="GROBID health check failed",
        )


def _get_grobid_health() -> GrobidHealthStatus:
    """Get GROBID health status with short TTL cache outside test runtime."""
    global _grobid_health_cache
    if is_test_runtime():
        return _probe_grobid_health_sync()

    now = time.monotonic()
    with _grobid_health_lock:
        if _grobid_health_cache is not None and (now - _grobid_health_cache[0]) < _GROBID_HEALTH_TTL_SECONDS:
            return _grobid_health_cache[1]

    fresh = _probe_grobid_health_sync()
    with _grobid_health_lock:
        _grobid_health_cache = (time.monotonic(), fresh)
    return fresh


async def _get_grobid_health_async() -> GrobidHealthStatus:
    if is_test_runtime():
        return _probe_grobid_health_sync()
    now = time.monotonic()
    with _grobid_health_lock:
        if _grobid_health_cache is not None and (now - _grobid_health_cache[0]) < _GROBID_HEALTH_TTL_SECONDS:
            return _grobid_health_cache[1]
    return await asyncio.to_thread(_get_grobid_health)


class HealthCheckResponse(HealthResponse):
    """Extended health response including SQLite/DB readiness probe."""

    database: dict[str, Any] = Field(default_factory=lambda: {"ok": True})


def _probe_database_health_sync() -> dict[str, Any]:
    """Execute a lightweight SELECT 1 probe against the active SQLAlchemy engine."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        return {"ok": False, "error": "Database unavailable"}


@router.get("/health", response_model=HealthCheckResponse)
async def health() -> Any:
    settings = get_settings()
    grobid_status, db_status = await asyncio.gather(
        _get_grobid_health_async(),
        asyncio.to_thread(_probe_database_health_sync),
    )
    overall_ok = bool(db_status.get("ok"))
    payload = HealthCheckResponse(
        status="ok" if overall_ok else "degraded",
        version=settings.app.version,
        disclaimer=settings.disclaimer.short,
        grobid=grobid_status,
        database=db_status,
    )
    if not overall_ok:
        return JSONResponse(status_code=503, content=payload.model_dump())
    return payload


@router.get("/health/grobid")
async def grobid_health() -> GrobidHealthStatus:
    """GROBID health endpoint."""
    return await _get_grobid_health_async()


@router.post("/health/grobid/start", dependencies=[Depends(require_admin)])
def grobid_start(admin: User = Depends(require_admin)) -> dict:
    """Start GROBID container. Requires admin authentication."""
    try:
        manager = get_grobid_manager(auto_start=True)
        _invalidate_grobid_health_cache()
        return {
            "success": True,
            "status": manager.status.value,
            "message": "GROBID container started",
        }
    except Exception as exc:
        logger.error("Failed to start GROBID container: %s", exc)
        return {
            "success": False,
            "status": "error",
            "message": "Failed to start GROBID container",
        }


@router.post("/health/grobid/stop", dependencies=[Depends(require_admin)])
def grobid_stop(admin: User = Depends(require_admin)) -> dict:
    """Stop GROBID container. Requires admin authentication."""
    try:
        manager = get_grobid_manager()
        success = manager.stop()
        _invalidate_grobid_health_cache()
        return {
            "success": success,
            "status": "stopped" if success else "error",
            "message": "GROBID container stopped" if success else "Failed to stop",
        }
    except Exception as exc:
        logger.error("Failed to stop GROBID container: %s", exc)
        return {
            "success": False,
            "status": "error",
            "message": "Failed to stop GROBID container",
        }
