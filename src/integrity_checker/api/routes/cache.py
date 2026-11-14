"""Deprecated cache-management routes kept for API compatibility.

Retrieval now uses ``local_papers.db`` and report SHA-256 caching, but older
clients still call ``/api/cache/stats``.  Expose the existing SQLAlchemy
``CitationCache`` table rather than reintroducing the removed disk-cache path.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.database.local_db import clear_local_query_cache
from integrity_checker.db.models import User
from integrity_checker.db.repository import Repository

router = APIRouter()


class CacheStatsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    total: int
    dynamic_entries: int = 0
    by_source: dict
    total_hits: int
    avg_hit_count: float
    persistent_entries: int = 0
    persistent_hits: int = 0
    expired_entries: int = 0
    session_hits: int = 0
    session_misses: int = 0
    session_hit_rate_percent: float = 0.0
    wave0_entries: int = 0
    negative_cache_entries: int = 0
    singleflight_coalesced: int = 0
    local_papers_count: int = 0
    local_queries_count: int = 0
    local_hits_count: int = 0
    local_hit_rate_percent: float = 0.0
    local_corpus_by_source: dict[str, int] = {}


class CacheClearResponse(BaseModel):
    deleted_count: int


@router.get("/stats", response_model=CacheStatsResponse)
def get_cache_stats(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CacheStatsResponse:
    del admin
    return CacheStatsResponse(**Repository(db).get_cache_stats())


def _reset_persistent_cache_instance(pc: object | None) -> None:
    if pc is None:
        return
    clear_fn = getattr(pc, "clear_memory_stats", None) or getattr(pc, "reset_stats", None)
    if callable(clear_fn):
        clear_fn()
    for attr in ("hits", "misses", "_hits", "_misses"):
        if hasattr(pc, attr):
            try:
                setattr(pc, attr, 0)
            except Exception:
                pass


@router.delete("", response_model=CacheClearResponse)
def clear_cache(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CacheClearResponse:
    from integrity_checker.api import deps
    from integrity_checker.api.routes import essays
    from integrity_checker.retrieval import persistent_cache as persistent_cache_mod

    del admin
    repo = Repository(db)
    deleted_count = repo.clear_cache()
    repo.commit()

    clear_local_query_cache()

    mod_clear_fn = getattr(persistent_cache_mod, "clear_memory_stats", None) or getattr(
        persistent_cache_mod, "reset_runtime_stats", None
    )
    if callable(mod_clear_fn):
        mod_clear_fn()
    for singleton_attr in (
        "_DEFAULT_CACHE",
        "_GLOBAL_CACHE",
        "_PERSISTENT_CACHE_SINGLETON",
    ):
        _reset_persistent_cache_instance(getattr(persistent_cache_mod, singleton_attr, None))
    getter_fn = getattr(persistent_cache_mod, "get_persistent_verification_cache", None)
    if callable(getter_fn):
        try:
            _reset_persistent_cache_instance(getter_fn())
        except Exception:
            pass

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
            _reset_persistent_cache_instance(getattr(orch, "persistent_cache", None))
            _reset_persistent_cache_instance(getattr(orch, "_persistent_cache", None))

    return CacheClearResponse(deleted_count=deleted_count)
