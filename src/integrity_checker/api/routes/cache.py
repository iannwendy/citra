"""Deprecated cache-management routes kept for API compatibility.

Retrieval now uses ``local_papers.db`` and report SHA-256 caching, but older
clients still call ``/api/cache/stats``.  Expose the existing SQLAlchemy
``CitationCache`` table rather than reintroducing the removed disk-cache path.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.db.models import User
from integrity_checker.db.repository import Repository

router = APIRouter()


class CacheStatsResponse(BaseModel):
    total: int
    by_source: dict
    total_hits: int
    avg_hit_count: float
    local_papers_count: int = 0
    local_queries_count: int = 0
    local_hit_rate_percent: float = 0.0


class CacheClearResponse(BaseModel):
    deleted_count: int


@router.get("/stats", response_model=CacheStatsResponse)
def get_cache_stats(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CacheStatsResponse:
    del admin
    return CacheStatsResponse(**Repository(db).get_cache_stats())


@router.delete("", response_model=CacheClearResponse)
def clear_cache(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CacheClearResponse:
    from integrity_checker.api import deps
    from integrity_checker.api.routes import essays

    del admin
    repo = Repository(db)
    deleted_count = repo.clear_cache()
    repo.commit()

    seen_orchestrators: set[int] = set()
    for candidate_pipeline in (
        deps._pipeline_singleton,
        getattr(essays, "_pipeline", None),
    ):
        orch = (
            getattr(candidate_pipeline, "orchestrator", None)
            if candidate_pipeline is not None
            else None
        )
        if orch is not None and id(orch) not in seen_orchestrators:
            seen_orchestrators.add(id(orch))
            clear_fn = getattr(orch, "clear_runtime_caches", None)
            if callable(clear_fn):
                clear_fn()

    return CacheClearResponse(deleted_count=deleted_count)
