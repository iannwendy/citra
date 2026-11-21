"""Structured logger cho toàn hệ thống.

Dùng `loguru` để có log format đẹp + level + rotation. Mọi module import `logger` từ đây.
"""

from __future__ import annotations

import atexit
import logging
import sys
from contextvars import ContextVar, Token
from pathlib import Path
from types import FrameType
from typing import Any

from loguru import logger as _loguru

from integrity_checker.config import get_settings

request_id_var: ContextVar[str] = ContextVar("citra_request_id", default="-")
_ATEXIT_REGISTERED = False


def get_request_id() -> str:
    """Return active request correlation ID (or '-' outside HTTP context)."""
    return request_id_var.get()


def set_request_id(request_id: str) -> Token[str]:
    """Bind a request correlation ID for the current async/thread context."""
    return request_id_var.set(request_id)


def reset_request_id(token: Token[str]) -> None:
    """Restore previous request correlation ID context."""
    request_id_var.reset(token)


def _patch_record(record: Any) -> None:
    record["extra"].setdefault("request_id", request_id_var.get())


_loguru.configure(patcher=_patch_record)


class InterceptHandler(logging.Handler):
    """Route stdlib logging records (e.g. from extraction/linking/matching) to loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = _loguru.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame: FrameType | None = logging.currentframe()
        depth = 2
        while frame is not None and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        _loguru.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def configure_logging() -> None:
    """Cấu hình logger theo settings. Gọi lúc startup."""
    from integrity_checker.config import is_production_env

    global _ATEXIT_REGISTERED
    settings = get_settings()
    level = settings.app.log_level.upper()
    is_prod = is_production_env()

    _loguru.remove()
    _loguru.configure(patcher=_patch_record)

    if not _ATEXIT_REGISTERED:
        atexit.register(_loguru.remove)
        _ATEXIT_REGISTERED = True

    # Console handler (disable ANSI color codes in production container logs)
    _loguru.add(
        sys.stderr,
        level=level,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "[{extra[request_id]}] "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
            "<level>{message}</level>"
            if not is_prod
            else "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | [{extra[request_id]}] {name}:{function}:{line} — {message}"
        ),
        colorize=not is_prod,
    )

    # Rotating file handler (non-blocking & multiprocess-safe via enqueue=True)
    log_dir = Path(settings.paths.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    _loguru.add(
        log_dir / "integrity_checker.log",
        level=level,
        rotation="10 MB",
        retention="7 days",
        enqueue=True,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | [{extra[request_id]}] {name}:{function}:{line} — {message}",
    )

    # Route stdlib integrity_checker.* loggers into loguru
    pkg_logger = logging.getLogger("integrity_checker")
    pkg_logger.handlers = [InterceptHandler()]
    pkg_logger.setLevel(getattr(logging, level, logging.INFO))
    pkg_logger.propagate = False


# Module-level logger (đã configure ở entry-point)
logger = _loguru


def get_logger(name: str | None = None) -> Any:
    """Trả về logger bound với module name. Dùng cho log có context."""
    if name:
        return _loguru.bind(module=name)
    return _loguru
