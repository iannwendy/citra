"""Health check endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from integrity_checker.api.deps import require_admin
from integrity_checker.config import get_settings
from integrity_checker.db.models import User
from integrity_checker.extraction import GROBID_STATUS, get_grobid_manager
from integrity_checker.logging import get_logger
from integrity_checker.models.api_schemas import GrobidHealthStatus, HealthResponse

logger = get_logger(__name__)

router = APIRouter()


def _get_grobid_health() -> GrobidHealthStatus:
    """Get GROBID health status."""
    settings = get_settings()
    grobid_config = settings.extraction.grobid

    try:
        manager = get_grobid_manager()
        status = manager.check_health()

        # Determine available status
        available = status == GROBID_STATUS.AVAILABLE

        # Get message
        if status == GROBID_STATUS.AVAILABLE:
            message = "GROBID is running and healthy"
        elif status == GROBID_STATUS.UNHEALTHY:
            message = "GROBID container running but API not responding"
        elif status == GROBID_STATUS.STOPPED:
            message = "GROBID container is stopped"
        elif status == GROBID_STATUS.STARTING:
            message = "GROBID container is starting"
        else:
            message = "GROBID status unknown"

        return GrobidHealthStatus(
            available=available,
            status=status.value,
            container_running=manager.is_container_running(),
            container_id=manager.stats.container_id if hasattr(manager, 'stats') else None,
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


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        version=settings.app.version,
        disclaimer=settings.disclaimer.short,
        grobid=_get_grobid_health(),
    )


@router.get("/health/grobid")
def grobid_health() -> GrobidHealthStatus:
    """GROBID health endpoint."""
    return _get_grobid_health()


@router.post("/health/grobid/start", dependencies=[Depends(require_admin)])
def grobid_start(admin: User = Depends(require_admin)) -> dict:
    """Start GROBID container. Requires admin authentication."""
    try:
        manager = get_grobid_manager(auto_start=True)
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
