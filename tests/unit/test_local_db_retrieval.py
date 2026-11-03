"""Regression tests for local-database-first retrieval."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from integrity_checker.database import LocalDatabase, Paper
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def _client(name: str, result: SourceCandidate | None = None) -> object:
    client = type("StubClient", (), {})()
    client.name = name
    client.lookup = AsyncMock()
    if result is None:
        client.lookup.side_effect = AssertionError(
            f"External API {name!r} was called after the paper was cached"
        )
    else:
        client.lookup.return_value = result
    return client


@pytest.mark.asyncio
async def test_api_result_is_synced_then_reused_from_local_db(tmp_path) -> None:
    """A second retrieval of an API result must be a DB hit, not an API call."""
    db = LocalDatabase(tmp_path / "local_papers.db")
    citation = Citation(
        raw_text="New API Paper",
        title="New API Paper",
        authors=["Roe, John"],
        year="2021",
    )
    api_candidate = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.5555/new-api-paper",
        title="New API Paper",
        authors=["Roe, John"],
        year="2021",
        confidence=0.9,
    )

    first_clients = [
        _client("crossref", api_candidate),
        _client("openalex", SourceCandidate(source_name="openalex", found=False, error="not found")),
        _client(
            "semantic_scholar",
            SourceCandidate(source_name="semantic_scholar", found=False, error="not found"),
        ),
        _client("coreapi", SourceCandidate(source_name="coreapi", found=False, error="not used")),
    ]
    first = RetrievalOrchestrator(
        crossref=first_clients[0],
        openalex=first_clients[1],
        semantic_scholar=first_clients[2],
        coreapi=first_clients[3],
        local_db=db,
        use_local_db=True,
        parallel=True,
    )
    first_result = await first.retrieve(citation)

    assert first_result.sources_succeeded == ["crossref"]
    assert db.find_by_doi("https://doi.org/10.5555/new-api-paper") is not None
    assert first_clients[0].lookup.await_count == 1

    second_clients = [_client(name) for name in ("crossref", "openalex", "semantic_scholar", "coreapi")]
    second = RetrievalOrchestrator(
        crossref=second_clients[0],
        openalex=second_clients[1],
        semantic_scholar=second_clients[2],
        coreapi=second_clients[3],
        local_db=db,
        use_local_db=True,
        parallel=True,
    )
    second_result = await second.retrieve(
        Citation(
            raw_text="https://doi.org/10.5555/new-api-paper",
            doi="https://doi.org/10.5555/new-api-paper",
        )
    )

    assert second_result.sources_succeeded == ["local_db"]
    assert second_result.best_candidate() is not None
    assert second_result.best_candidate().paper_id is not None
    assert all(client.lookup.await_count == 0 for client in second_clients)


@pytest.mark.asyncio
async def test_existing_doi_in_local_db_skips_all_external_clients(tmp_path) -> None:
    """A known DOI is resolved locally before any API client is touched."""
    db = LocalDatabase(tmp_path / "local_papers.db")
    paper_id = db.add_paper(
        Paper(
            doi="10.1234/verified-paper.",
            title="A Verified Local Paper",
            authors=["Doe, Jane"],
            year=2020,
            venue="Test Journal",
        )
    )

    clients = [_client(name) for name in ("crossref", "openalex", "semantic_scholar", "coreapi")]
    orchestrator = RetrievalOrchestrator(
        crossref=clients[0],
        openalex=clients[1],
        semantic_scholar=clients[2],
        coreapi=clients[3],
        local_db=db,
        use_local_db=True,
        parallel=True,
    )
    result = await orchestrator.retrieve(
        Citation(
            raw_text="10.1234/verified-paper",
            doi="https://doi.org/10.1234/verified-paper",
        )
    )

    assert result.sources_succeeded == ["local_db"]
    assert result.best_candidate() is not None
    assert result.best_candidate().paper_id == paper_id
    assert all(client.lookup.await_count == 0 for client in clients)


def test_local_db_lru_query_cache_and_single_transaction_bulk_insert(monkeypatch, tmp_path) -> None:
    """Verify OrderedDict LRU eviction in LocalDatabase._query_cache and single-connection add_papers_bulk."""
    import integrity_checker.database.local_db as local_db_mod

    db = LocalDatabase(tmp_path / "bulk_lru.db")
    db._query_cache.clear()
    monkeypatch.setattr(local_db_mod, "_QUERY_CACHE_MAX_SIZE", 3)

    # 1. Verify add_papers_bulk executes all inserts in a single connection
    papers = [
        Paper(
            doi=f"10.1000/bulk-{i}",
            title=f"Bulk Paper Number {i}",
            authors=[f"Author {i}"],
            year=2020 + i,
            venue="ACL",
        )
        for i in range(5)
    ]

    conn_open_count = 0
    orig_get_conn = db._get_conn

    from contextlib import contextmanager

    @contextmanager
    def counting_get_conn():
        nonlocal conn_open_count
        conn_open_count += 1
        with orig_get_conn() as c:
            yield c

    monkeypatch.setattr(db, "_get_conn", counting_get_conn)
    added = db.add_papers_bulk(papers)
    assert added == 5
    assert conn_open_count == 1

    # 2. Verify OrderedDict LRU eviction preserves recently accessed entry and evicts oldest
    db._query_cache.clear()
    assert db.find_by_doi("10.1000/bulk-0") is not None
    assert db.find_by_doi("10.1000/bulk-1") is not None
    assert db.find_by_doi("10.1000/bulk-2") is not None
    assert len(db._query_cache) == 3

    # Touch bulk-0 so it moves to the most-recently-used end; bulk-1 becomes the oldest
    assert db.find_by_doi("10.1000/bulk-0") is not None
    # Insert bulk-3 into cache -> bulk-1 should be evicted, while bulk-0 remains cached
    assert db.find_by_doi("10.1000/bulk-3") is not None
    assert len(db._query_cache) == 3

    cached_dois = [k[-1] for k in db._query_cache]
    assert "10.1000/bulk-0" in cached_dois
    assert "10.1000/bulk-2" in cached_dois
    assert "10.1000/bulk-3" in cached_dois
    assert "10.1000/bulk-1" not in cached_dois


def test_log_query_preserves_lru_query_cache_and_updates_stats(tmp_path) -> None:
    """Logging a query must not wipe the in-memory paper LRU cache, while get_stats() stays fresh."""
    db = LocalDatabase(tmp_path / "log_cache.db")
    pid = db.add_paper(
        Paper(
            doi="10.18653/v1/N19-1423",
            title="BERT: Pre-training of Deep Bidirectional Transformers",
            authors=["Jacob Devlin"],
            year=2019,
            venue="NAACL",
        )
    )
    db._query_cache.clear()
    assert db.find_by_doi("10.18653/v1/N19-1423") is not None
    assert len(db._query_cache) == 1

    s0 = db.get_stats()
    assert s0["total_papers"] == 1
    assert s0["total_queries"] == 0

    db.log_query({"doi": "10.18653/v1/N19-1423"}, found=True, source="local_db", paper_id=pid)
    # Paper LRU cache must remain intact after log_query!
    assert len(db._query_cache) == 1
    s1 = db.get_stats()
    assert s1["total_papers"] == 1
    assert s1["total_queries"] == 1
    assert s1["hit_rate_percent"] == 100.0
