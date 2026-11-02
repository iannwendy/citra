"""FastAPI routers."""

from integrity_checker.api.routes import (
    auth,
    cache,
    essays,
    export,
    health,
    report,
    users,
    verdicts,
)

__all__ = ["auth", "cache", "essays", "export", "health", "report", "users", "verdicts"]
