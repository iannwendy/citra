"""Structured logger cho toàn hệ thống.

Dùng `loguru` để có log format đẹp + level + rotation. Mọi module import `logger` từ đây.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from loguru import logger as _loguru

from integrity_checker.config import get_settings


class InterceptHandler(logging.Handler):
    """Route stdlib logging records (e.g. from extraction/linking/matching) to loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = _loguru.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        _loguru.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def configure_logging() -> None:
    """Cấu hình logger theo settings. Gọi 1 lần lúc startup."""
    settings = get_settings()
    level = settings.app.log_level.upper()

    _loguru.remove()

    # Console handler
    _loguru.add(
        sys.stderr,
        level=level,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    # Optional file handler
    log_dir = Path(settings.paths.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    _loguru.add(
        log_dir / "integrity_checker.log",
        level=level,
        rotation="10 MB",
        retention="7 days",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} — {message}",
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
