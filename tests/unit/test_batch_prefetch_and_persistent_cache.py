"""Unit tests for Task 4 (B1): Wave-0 Batch DOI/arXiv Pre-Fetch & Persistent TTL Cache."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from integrity_checker.config import get_settings
from integrity_checker.db.models import CitationCache
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session, init_db
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.circuit_breaker import CircuitBreakerRegistry
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.normalization import author_key, normalize_text
from integrity_checker.retrieval.openalex_client import OpenAlexClient
from integrity_checker.retrieval.persistent_cache import (
    CLEAN_MISS_TTL_SECONDS,
    POSITIVE_MATCH_TTL_SECONDS,
    URL_CHECK_TTL_SECONDS,
    PersistentVerificationCache,
    build_verification_cache_key,
)
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def _make_openalex_work(doi: str, idx: int) -> dict:
    return {
        "id": f"https://openalex.org/W{100000 + idx}",
        "doi": f"https://doi.org/{doi}",
        "display_name": f"Deep Neural Architecture Study Part {idx}",
        "publication_year": 2022,
        "authorships": [
            {"author": {"display_name": f"Alice Researcher {idx}"}},
            {"author": {"display_name": "Bob Coauthor"}},
        ],
        "primary_location": {
            "source": {"display_name": "Journal of Machine Learning Research"},
            "landing_page_url": f"https://doi.org/{doi}",
        },
        "abstract_inverted_index": {
            "We": [0],
            "present": [1],
            "batch": [2],
            f"study-{idx}": [3],
            "results.": [4],
        },
        "ids": {"openalex": f"https://openalex.org/W{100000 + idx}", "doi": f"https://doi.org/{doi}"},
    }


def _make_crossref_item(doi: str, idx: int, *, retracted: bool = False) -> dict:
    item: dict = {
        "DOI": doi.upper() if idx % 2 == 0 else doi,
        "title": [f"Deep Neural Architecture Study Part {idx}"],
        "author": [
            {"family": f"Researcher {idx}", "given": "Alice"},
            {"family": "Coauthor", "given": "Bob"},
        ],
        "published-print": {"date-parts": [[2022, 5, 1]]},
        "container-title": ["Journal of Machine Learning Research"],
        "URL": f"https://doi.org/{doi}",
        "type": "journal-article",
    }
    if retracted:
        item["update-to"] = [
            {
                "type": "retraction",
                "DOI": f"10.1038/retraction-{idx}",
                "label": "Retraction",
            }
        ]
    return item


def _make_arxiv_atom_xml(arxiv_ids: list[str]) -> str:
    entries = []
    for i, aid in enumerate(arxiv_ids):
        entries.append(
            f"""
  <entry>
    <id>http://arxiv.org/abs/{aid}v2</id>
    <updated>2023-01-10T00:00:00Z</updated>
    <published>2023-01-05T00:00:00Z</published>
    <title>Scalable Transformer Preprint Number {i}</title>
    <summary>Abstract for arXiv preprint {aid} demonstrating batch Atom XML parsing.</summary>
    <author><name> Vaswani {i} </name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG"/>
  </entry>"""
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        + "".join(entries)
        + "\n</feed>"
    )


@pytest.mark.asyncio
async def test_openalex_lookup_dois_batch_chunks_65_dois_and_reconstructs_abstracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 1: 65 DOIs chunk into 2 pipe-separated requests (40 + 25) and map normalized DOIs with abstracts."""
    recorded_calls: list[tuple[str, dict]] = []

    raw_dois = [
        f"https://doi.org/10.1038/s41586-022-{i:04d}." if i % 2 == 0 else f"DOI:10.1038/S41586-022-{i:04d}"
        for i in range(65)
    ]

    class FakeHttpClient:
        async def get(self, url: str, **kwargs: object) -> httpx.Response:
            params = kwargs.get("params")
            assert isinstance(params, dict) or params is None
            recorded_calls.append((url, dict(params or {})))
            flt = (params or {}).get("filter", "")
            assert flt.startswith("doi:")
            batch_dois = [
                part.removeprefix("https://doi.org/").lower()
                for part in flt.removeprefix("doi:").split("|")
                if part
            ]
            works = [
                _make_openalex_work(d, int(d.rsplit("-", 1)[-1]))
                for d in batch_dois
            ]
            return httpx.Response(
                200,
                json={"results": works},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(
        "integrity_checker.retrieval.openalex_client.get_shared_http_client",
        lambda **_kw: FakeHttpClient(),
    )

    client = OpenAlexClient(contact_email="test@example.com")
    batch_map = await client.lookup_dois_batch(raw_dois)

    assert len(recorded_calls) == 2
    first_filter = recorded_calls[0][1]["filter"].removeprefix("doi:").split("|")
    second_filter = recorded_calls[1][1]["filter"].removeprefix("doi:").split("|")
    assert len(first_filter) == 40
    assert len(second_filter) == 25
    assert recorded_calls[0][1]["per_page"] >= 100
    assert recorded_calls[1][1]["per_page"] >= 100
    assert all(p.startswith("https://doi.org/10.1038/") for p in first_filter)

    assert len(batch_map) == 65
    sample_key = "10.1038/s41586-022-0042"
    assert sample_key in batch_map
    cand = batch_map[sample_key]
    assert cand.found is True
    assert cand.confidence == 1.0
    assert cand.doi == sample_key
    assert cand.abstract == "We present batch study-42 results."


@pytest.mark.asyncio
async def test_crossref_lookup_dois_batch_chunks_and_preserves_retraction_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 2: Crossref batch chunks at 40 DOIs and preserves is_retracted=True."""
    recorded_calls: list[tuple[str, dict]] = []
    raw_dois = [f"10.1145/3442188.{3445900 + i}" for i in range(45)]
    retracted_target = "10.1145/3442188.3445907"
    relation_retracted_target = "10.1145/3442188.3445942"

    class FakeHttpClient:
        async def get(self, url: str, **kwargs: object) -> httpx.Response:
            params = kwargs.get("params")
            assert isinstance(params, dict) or params is None
            recorded_calls.append((url, dict(params or {})))
            flt = (params or {}).get("filter", "")
            parts = [p.removeprefix("doi:") for p in flt.split(",") if p]
            items = []
            for idx, d in enumerate(parts):
                item = _make_crossref_item(d, idx, retracted=(d == retracted_target))
                if d == relation_retracted_target:
                    item["relation"] = {"is-retracted-by": [{"id": "10.1145/retraction.99"}]}
                items.append(item)
            return httpx.Response(
                200,
                json={"status": "ok", "message": {"items": items}},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(
        "integrity_checker.retrieval.crossref_client.get_shared_http_client",
        lambda **_kw: FakeHttpClient(),
    )

    client = CrossrefClient(contact_email="test@example.com")
    batch_map = await client.lookup_dois_batch(raw_dois)

    assert len(recorded_calls) == 2
    assert len(recorded_calls[0][1]["filter"].split(",")) == 40
    assert len(recorded_calls[1][1]["filter"].split(",")) == 5
    assert recorded_calls[0][1]["rows"] == 50

    assert len(batch_map) == 45
    assert batch_map[retracted_target].found is True
    assert batch_map[retracted_target].is_retracted is True
    assert batch_map[relation_retracted_target].is_retracted is True
    assert batch_map["10.1145/3442188.3445900"].is_retracted is False


@pytest.mark.asyncio
async def test_arxiv_lookup_arxiv_batch_chunks_and_normalizes_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ArxivClient.lookup_arxiv_batch chunks up to 40 normalized IDs via id_list."""
    recorded_params: list[dict] = []
    raw_ids = [
        f"arXiv:2301.{10000 + i:05d}v2" if i % 2 == 0 else f"https://arxiv.org/abs/2301.{10000 + i:05d}"
        for i in range(45)
    ]

    async def fake_fetch_xml(params: dict) -> str:
        recorded_params.append(dict(params))
        ids = [x for x in params["id_list"].split(",") if x]
        return _make_arxiv_atom_xml(ids)

    client = ArxivClient(contact_email="test@example.com")
    monkeypatch.setattr(client, "_fetch_xml_with_retry", fake_fetch_xml)

    batch_map = await client.lookup_arxiv_batch(raw_ids)

    assert len(recorded_params) == 2
    assert len(recorded_params[0]["id_list"].split(",")) == 40
    assert len(recorded_params[1]["id_list"].split(",")) == 5
    assert len(batch_map) == 45
    assert "2301.10000" in batch_map
    assert batch_map["2301.10000"].found is True
    assert batch_map["2301.10000"].external_ids.get("arxiv") == "2301.10000"
    assert "batch Atom XML parsing" in (batch_map["2301.10000"].abstract or "")


@pytest.mark.asyncio
async def test_prefetch_identifiers_resolves_30_dois_in_wave0_with_zero_per_citation_calls() -> None:
    """Invariant 3: 30 DOI-bearing citations resolve in 1 parallel wave with consensus >= 2 and 0 per-citation lookups."""
    citations = [
        Citation(
            raw_text=f"Researcher {i}, A., & Coauthor, B. (2022). Deep Neural Architecture Study Part {i}. JMLR. https://doi.org/10.1038/s41586-022-{i:04d}",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=[f"Alice Researcher {i}", "Bob Coauthor"],
            year="2022",
            title=f"Deep Neural Architecture Study Part {i}",
            venue="Journal of Machine Learning Research",
            doi=f"https://doi.org/10.1038/s41586-022-{i:04d}",
        )
        for i in range(30)
    ]
    title_only_cit = Citation(
        raw_text="Unknown, X. (2021). Unindexed Workshop Manuscript Without DOI.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["X. Unknown"],
        year="2021",
        title="Unindexed Workshop Manuscript Without DOI",
    )

    oa_client = OpenAlexClient(contact_email="test@example.com")
    cr_client = CrossrefClient(contact_email="test@example.com")
    ax_client = ArxivClient(contact_email="test@example.com")

    oa_client.lookup = AsyncMock(
        side_effect=AssertionError("Per-citation OpenAlex.lookup must not run for Wave-0 DOIs")
    )
    cr_client.lookup = AsyncMock(
        side_effect=AssertionError("Per-citation Crossref.lookup must not run for Wave-0 DOIs")
    )
    ax_client.lookup = AsyncMock(
        side_effect=AssertionError("Per-citation Arxiv.lookup must not run for Wave-0 DOIs")
    )

    async def fake_oa_batch(dois: list[str]) -> dict[str, SourceCandidate]:
        out: dict[str, SourceCandidate] = {}
        for idx, d in enumerate(dois):
            nd = d.lower().removeprefix("https://doi.org/")
            cand = oa_client._work_to_candidate(_make_openalex_work(nd, idx))
            cand.found = True
            cand.confidence = 1.0
            out[nd] = cand
        return out

    async def fake_cr_batch(dois: list[str]) -> dict[str, SourceCandidate]:
        out: dict[str, SourceCandidate] = {}
        for idx, d in enumerate(dois):
            nd = d.lower().removeprefix("https://doi.org/")
            cand = cr_client._message_to_candidate(
                _make_crossref_item(nd, idx, retracted=(idx == 5))
            )
            cand.found = True
            cand.confidence = 1.0
            out[nd] = cand
        return out

    oa_client.lookup_dois_batch = AsyncMock(side_effect=fake_oa_batch)
    cr_client.lookup_dois_batch = AsyncMock(side_effect=fake_cr_batch)
    ax_client.lookup_arxiv_batch = AsyncMock(return_value={})

    cb = CircuitBreakerRegistry()
    orchestrator = RetrievalOrchestrator(
        crossref=cr_client,
        openalex=oa_client,
        arxiv=ax_client,
        use_local_db=False,
        enable_link_validation=False,
        circuit_breakers=cb,
    )

    resolved = await orchestrator.prefetch_identifiers([*citations, title_only_cit])

    assert oa_client.lookup_dois_batch.await_count == 1
    assert cr_client.lookup_dois_batch.await_count == 1
    assert len(resolved) == 30
    assert id(title_only_cit) not in resolved

    for idx, cit in enumerate(citations):
        assert id(cit) in resolved
        res = resolved[id(cit)]
        assert res.consensus_count() >= 2
        assert set(res.sources_succeeded) >= {"openalex", "crossref"}
        best = res.best_candidate()
        assert best is not None
        assert best.abstract is not None
        if idx == 5:
            assert res.is_retracted is True
            assert best.is_retracted is True
        else:
            assert res.is_retracted is False

    # Cloned Citation with same DOI hits Wave-0 / persistent cache immediately with 0 HTTP lookups
    cloned = Citation(
        raw_text=citations[0].raw_text,
        citation_type=CitationType.REFERENCE_LIST,
        authors=list(citations[0].authors),
        year=citations[0].year,
        title=citations[0].title,
        doi=citations[0].doi,
    )
    cloned_res = await orchestrator.retrieve(cloned)
    assert cloned_res.consensus_count() >= 2
    assert oa_client.lookup.await_count == 0
    assert cr_client.lookup.await_count == 0


@pytest.mark.asyncio
async def test_prefetch_identifiers_respects_open_circuit_breaker() -> None:
    """Open circuits are skipped during Wave-0 batch pre-fetch without calling the tripped upstream."""
    cit = Citation(
        raw_text="Author, A. (2022). Deep Neural Architecture Study Part 1. https://doi.org/10.1038/s41586-022-0001",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Alice Researcher 1"],
        year="2022",
        title="Deep Neural Architecture Study Part 1",
        doi="10.1038/s41586-022-0001",
    )
    cb = CircuitBreakerRegistry(failure_threshold=2, recovery_timeout_seconds=60.0)
    cb.record_infra_failure("crossref", "HTTP 503", 120.0)
    cb.record_infra_failure("crossref", "HTTP 503", 120.0)

    oa_client = OpenAlexClient(contact_email="test@example.com")
    cr_client = CrossrefClient(contact_email="test@example.com")

    cand = oa_client._work_to_candidate(_make_openalex_work("10.1038/s41586-022-0001", 1))
    cand.found = True
    cand.confidence = 1.0
    oa_client.lookup_dois_batch = AsyncMock(return_value={"10.1038/s41586-022-0001": cand})
    cr_client.lookup_dois_batch = AsyncMock(
        side_effect=AssertionError("Open circuit must skip Crossref batch call")
    )

    orchestrator = RetrievalOrchestrator(
        crossref=cr_client,
        openalex=oa_client,
        use_local_db=False,
        enable_link_validation=False,
        circuit_breakers=cb,
    )

    resolved = await orchestrator.prefetch_identifiers([cit])
    assert cr_client.lookup_dois_batch.await_count == 0
    # Only 1 source succeeded because Crossref circuit was open -> consensus < 2 -> left for fallback
    assert id(cit) not in resolved


@pytest.mark.asyncio
async def test_prefetch_identifiers_arxiv_wave0_and_batch_failure_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wave-0 resolves arXiv citations (OpenAlex + arXiv) and records batch 429/503 failures into CircuitBreakerRegistry."""
    arxiv_cit = Citation(
        raw_text="Vaswani, A. (2023). Scalable Transformer Preprint Number 0. arXiv:2301.10000v2",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Vaswani 0"],
        year="2023",
        title="Scalable Transformer Preprint Number 0",
        url="https://arxiv.org/abs/2301.10000v2",
    )

    oa_client = OpenAlexClient(contact_email="test@example.com", max_retries=1)
    cr_client = CrossrefClient(contact_email="test@example.com", max_retries=1)
    ax_client = ArxivClient(contact_email="test@example.com", max_retries=1)

    oa_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.48550/arxiv.2301.10000",
        title="Scalable Transformer Preprint Number 0",
        authors=["Vaswani 0"],
        year="2023",
        abstract="Abstract from OpenAlex.",
        confidence=1.0,
    )
    oa_client.lookup_dois_batch = AsyncMock(
        return_value={"10.48550/arxiv.2301.10000": oa_cand}
    )
    monkeypatch.setattr(
        ax_client,
        "_fetch_xml_with_retry",
        AsyncMock(return_value=_make_arxiv_atom_xml(["2301.10000"])),
    )

    cb = CircuitBreakerRegistry(failure_threshold=2, recovery_timeout_seconds=60.0)
    orch = RetrievalOrchestrator(
        crossref=cr_client,
        openalex=oa_client,
        arxiv=ax_client,
        use_local_db=False,
        enable_link_validation=False,
        circuit_breakers=cb,
    )
    resolved = await orch.prefetch_identifiers([arxiv_cit])
    assert id(arxiv_cit) in resolved
    assert resolved[id(arxiv_cit)].consensus_count() >= 2
    assert set(resolved[id(arxiv_cit)].sources_succeeded) >= {"openalex", "arxiv"}

    # Now verify a 429 during batch lookup records an infra failure in CircuitBreakerRegistry
    class Fake429HttpClient:
        async def get(self, url: str, **_kwargs: object) -> httpx.Response:
            return httpx.Response(
                429,
                headers={"Retry-After": "10"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(
        "integrity_checker.retrieval.crossref_client.get_shared_http_client",
        lambda **_kw: Fake429HttpClient(),
    )
    doi_cit = Citation(
        raw_text="Paper (2022). https://doi.org/10.1145/3442188.3445999",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Author A"],
        year="2022",
        title="Test Rate Limited Batch Paper",
        doi="10.1145/3442188.3445999",
    )
    await orch.prefetch_identifiers([doi_cit])
    snap = cb.snapshot_all()
    assert snap["crossref"]["consecutive_failures"] >= 1
    assert snap["crossref"]["http_429_count"] >= 1


def test_build_verification_cache_key_priority_order() -> None:
    """Canonical key follows doi -> arxiv -> url -> meta:{sha256(...)} priority."""
    c_doi = Citation(
        raw_text="Paper with DOI and arXiv and URL",
        doi="https://doi.org/10.1038/Nature14539.",
        url="https://arxiv.org/abs/1706.03762v5",
        title="Deep learning",
        authors=["Yann LeCun"],
        year="2015",
    )
    assert build_verification_cache_key(c_doi) == "doi:10.1038/nature14539"

    c_arxiv = Citation(
        raw_text="Vaswani et al. arXiv:1706.03762v5",
        url="https://arxiv.org/abs/1706.03762v5",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani"],
        year="2017",
    )
    assert build_verification_cache_key(c_arxiv) == "arxiv:1706.03762"

    c_url = Citation(
        raw_text="OpenAI Blog (2023). https://Example.COM/research/gpt-4?ref=blog#section-2",
        url="https://Example.COM/research/gpt-4?ref=blog#section-2",
        title="GPT-4 Technical Blog",
        authors=["OpenAI"],
        year="2023",
    )
    assert build_verification_cache_key(c_url) == "url:https://example.com/research/gpt-4?ref=blog"

    c_meta = Citation(
        raw_text="Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need!",
        title="Attention Is All You Need!",
        authors=["Vaswani, A.", "Shazeer, N."],
        year="2017",
    )
    expected_payload = (
        f"{normalize_text('Attention Is All You Need!')}|{author_key('Vaswani, A.')}|2017"
    )
    expected_hash = hashlib.sha256(expected_payload.encode("utf-8")).hexdigest()
    assert build_verification_cache_key(c_meta) == f"meta:{expected_hash}"


@pytest.mark.asyncio
async def test_persistent_cache_shares_positive_and_clean_miss_across_orchestrators_and_updates_stats(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Invariant 4a: 30d positive hits, 7d URL checks, and 24h clean HTTP-200 misses persist across fresh orchestrators."""
    db_file = tmp_path / "cross_essay_cache.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    init_db()

    clock = {"now": time.time()}
    shared_pcache_1 = PersistentVerificationCache(now_fn=lambda: clock["now"])
    shared_pcache_2 = PersistentVerificationCache(now_fn=lambda: clock["now"])

    pos_cit = Citation(
        raw_text="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep hierarchical representation learning. Nature. https://doi.org/10.1038/s41586-015-9999",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        title="Deep hierarchical representation learning",
        venue="Nature",
        doi="10.1038/s41586-015-9999",
    )
    miss_cit = Citation(
        raw_text="Fictional, Z. (2024). Completely Nonexistent Quantum Hallucinated Paper.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Z. Fictional"],
        year="2024",
        title="Completely Nonexistent Quantum Hallucinated Paper",
        venue="Journal of Imaginary Science",
    )

    def _stub_client(name: str, pos_cand: SourceCandidate | None) -> object:
        c = SimpleNamespace(name=name)

        async def _lookup(citation: Citation) -> SourceCandidate:
            if citation.doi and pos_cand is not None:
                return pos_cand
            return SourceCandidate(source_name=name, found=False, error=f"{name}: no results")

        c.lookup = AsyncMock(side_effect=_lookup)
        return c

    cr_cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1038/s41586-015-9999",
        title="Deep hierarchical representation learning",
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        venue="Nature",
        confidence=1.0,
    )
    oa_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.1038/s41586-015-9999",
        title="Deep hierarchical representation learning",
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        venue="Nature",
        abstract="Deep learning allows computational models to learn representations.",
        confidence=1.0,
    )

    orch1 = RetrievalOrchestrator(
        crossref=_stub_client("crossref", cr_cand),
        openalex=_stub_client("openalex", oa_cand),
        dblp=_stub_client("dblp", None),
        arxiv=_stub_client("arxiv", None),
        openlibrary=_stub_client("openlibrary", None),
        europepmc=_stub_client("europepmc", None),
        use_local_db=False,
        enable_link_validation=False,
        persistent_cache=shared_pcache_1,
    )

    r1_pos = await orch1.retrieve(pos_cit)
    assert r1_pos.consensus_count() >= 2
    r1_miss = await orch1.retrieve(miss_cit)
    assert len(r1_miss.candidates) == 0

    # Also verify a fresh RetrievalOrchestrator() with NO explicit persistent_cache kwarg
    # automatically shares the initialized SQLite CitationCache DB!
    fail_if_called = lambda name: SimpleNamespace(  # noqa: E731
        name=name,
        lookup=AsyncMock(side_effect=AssertionError(f"{name} should not be called on persistent cache hit")),
    )
    orch2_default = RetrievalOrchestrator(
        crossref=fail_if_called("crossref"),
        openalex=fail_if_called("openalex"),
        dblp=fail_if_called("dblp"),
        arxiv=fail_if_called("arxiv"),
        openlibrary=fail_if_called("openlibrary"),
        europepmc=fail_if_called("europepmc"),
        use_local_db=False,
        enable_link_validation=False,
    )
    r2_pos_auto = await orch2_default.retrieve(pos_cit)
    assert r2_pos_auto.consensus_count() >= 2
    assert r2_pos_auto.best_candidate() is not None
    assert "computational models" in (r2_pos_auto.best_candidate().abstract or "")

    r2_miss_auto = await orch2_default.retrieve(miss_cit)
    assert len(r2_miss_auto.candidates) == 0
    assert len(r2_miss_auto.sources_queried) >= 3

    # Verify CitationCache rows, TTLs, hit_count, last_hit_at, and Repository.get_cache_stats()
    with get_session() as session:
        repo = Repository(session)
        stats = repo.get_cache_stats()
        assert stats["total"] >= 2
        assert stats["total_hits"] >= 2
        pos_row = (
            session.query(CitationCache)
            .filter(CitationCache.cache_key == "doi:10.1038/s41586-015-9999")
            .first()
        )
        assert pos_row is not None
        assert pos_row.hit_count >= 1
        assert pos_row.last_hit_at is not None

    # URL check 7d TTL check
    url_key = "url:https://example.org/docs/spec"
    url_result = SourceResult(
        citation_raw="https://example.org/docs/spec",
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        sources_failed={},
        url_status="live",
        url_status_code=200,
    )
    shared_pcache_2.set(url_key, url_result, URL_CHECK_TTL_SECONDS)
    assert shared_pcache_2.get(url_key) is not None

    # Advance 2 days -> 24h negative miss expires, 7d URL check & 30d positive hit survive!
    clock["now"] += 2 * 86_400
    assert shared_pcache_2.get(build_verification_cache_key(miss_cit)) is None
    assert shared_pcache_2.get(url_key) is not None
    assert shared_pcache_2.get("doi:10.1038/s41586-015-9999") is not None

    # Advance 8 more days (10d total) -> 7d URL check expires, 30d positive hit survives!
    clock["now"] += 8 * 86_400
    assert shared_pcache_2.get(url_key) is None
    assert shared_pcache_2.get("doi:10.1038/s41586-015-9999") is not None

    # Advance past 30d -> 30d positive hit expires!
    clock["now"] += 25 * 86_400
    assert shared_pcache_2.get("doi:10.1038/s41586-015-9999") is None
    assert POSITIVE_MATCH_TTL_SECONDS == 2_592_000
    assert URL_CHECK_TTL_SECONDS == 604_800
    assert CLEAN_MISS_TTL_SECONDS == 86_400


def test_persistent_cache_refuses_transient_failures_and_handles_uninitialized_db(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Invariant 4b: Refuse 429/5xx/timeout/circuit_open/rate-limit misses, and never crash on uninitialized DB."""
    # 1. Uninitialized SQLite file (no init_db() -> no citation_cache table)
    uninit_db = tmp_path / "uninitialized.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{uninit_db}")
    get_settings.cache_clear()

    uninit_cache = PersistentVerificationCache()
    assert uninit_cache.get("doi:10.1038/uninit") is None
    assert uninit_cache.misses == 1
    # Must also no-op cleanly on set without raising OperationalError
    sample_pos = SourceResult(
        citation_raw="Test",
        candidates=[
            SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.1038/uninit",
                title="Valid Scholarly Paper Title",
                authors=["Jane Doe"],
                year="2022",
                confidence=1.0,
            )
        ],
        sources_queried=["openalex"],
        sources_succeeded=["openalex"],
        sources_failed={},
    )
    uninit_cache.set("doi:10.1038/uninit", sample_pos, POSITIVE_MATCH_TTL_SECONDS)

    # 2. Initialized SQLite DB: verify degraded/transient failures are strictly refused
    init_file = tmp_path / "guarded_cache.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{init_file}")
    get_settings.cache_clear()
    init_db()

    cache = PersistentVerificationCache()
    degraded_cases = [
        {"openalex": "OpenAlex: rate limited (429)", "crossref": "no results", "dblp": "no results"},
        {"openalex": "HTTP 503 Service Unavailable", "crossref": "no results", "dblp": "no results"},
        {"openalex": "Request timed out after 10s", "crossref": "no results", "dblp": "no results"},
        {"openalex": "circuit_open (42s remaining)", "crossref": "no results", "dblp": "no results"},
        {"openalex": "openalex: skipped (rate-limit backoff active)", "crossref": "no results", "dblp": "no results"},
        {"openalex": "network connect error", "crossref": "no results", "dblp": "no results"},
        {"openalex": "no results", "crossref": "not found"},  # < 3 clean sources
    ]
    for idx, failed_map in enumerate(degraded_cases):
        key = f"meta:degraded-{idx}"
        bad_res = SourceResult(
            citation_raw=f"Degraded citation {idx}",
            candidates=[],
            sources_queried=list(failed_map.keys()),
            sources_succeeded=[],
            sources_failed=failed_map,
        )
        cache.set(key, bad_res, CLEAN_MISS_TTL_SECONDS)
        assert cache.get(key) is None, f"Degraded miss {failed_map} must NOT be cached!"


@pytest.mark.asyncio
async def test_pipeline_step5_wires_wave0_prefetch_and_preserves_mock_orchestrator_compat(
    tmp_path: Path,
) -> None:
    """IntegrityPipeline.run_async invokes prefetch_identifiers in Step 5 and tolerates MagicMock orchestrators."""
    import fitz

    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    pdf_path = tmp_path / "wave0_essay.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(
        (72, 72),
        "1. Introduction\n"
        "Deep neural architectures achieve state-of-the-art results (LeCun & Bengio, 2022).\n\n"
        "References\n"
        "LeCun, Y., & Bengio, Y. (2022). Deep Neural Architecture Study Part 1. Nature. https://doi.org/10.1038/s41586-022-0001\n",
    )
    doc.save(str(pdf_path))
    doc.close()

    # Case A: Orchestrator with async prefetch_identifiers resolves DOI without calling per-citation retrieve
    orch_with_prefetch = MagicMock()

    async def fake_prefetch(citations: list[Citation]) -> dict[int, SourceResult]:
        out: dict[int, SourceResult] = {}
        for c in citations:
            if c.doi:
                cand = SourceCandidate(
                    source_name="openalex",
                    found=True,
                    doi="10.1038/s41586-022-0001",
                    title="Deep Neural Architecture Study Part 1",
                    authors=["Y. LeCun", "Y. Bengio"],
                    year="2022",
                    venue="Nature",
                    confidence=1.0,
                )
                cand._consensus_count = 2  # type: ignore[attr-defined]
                cand._agreed_sources = ["openalex", "crossref"]  # type: ignore[attr-defined]
                out[id(c)] = SourceResult(
                    citation_raw=c.raw_text,
                    candidates=[cand],
                    sources_queried=["openalex", "crossref"],
                    sources_succeeded=["openalex", "crossref"],
                    sources_failed={},
                )
        return out

    orch_with_prefetch.prefetch_identifiers = AsyncMock(side_effect=fake_prefetch)
    orch_with_prefetch.retrieve = AsyncMock(
        side_effect=AssertionError("retrieve() must be skipped for Wave-0 prefetched citations")
    )

    pipeline_a = IntegrityPipeline(
        orchestrator=orch_with_prefetch,
        use_document_parser=False,
        use_report_cache=False,
    )
    report_a = await pipeline_a.run_async(pdf_path)
    assert orch_with_prefetch.prefetch_identifiers.await_count == 1
    assert orch_with_prefetch.retrieve.await_count == 0
    assert len(report_a.verdicts) >= 1

    # Case B: Legacy MagicMock orchestrator where prefetch_identifiers is NOT an async function
    legacy_mock_orch = MagicMock()
    legacy_mock_orch.retrieve = AsyncMock(
        return_value=SourceResult(
            citation_raw="LeCun, Y., & Bengio, Y. (2022)...",
            candidates=[],
            sources_queried=["openalex", "crossref", "dblp"],
            sources_succeeded=[],
            sources_failed={"openalex": "no results", "crossref": "no results", "dblp": "no results"},
        )
    )
    pipeline_b = IntegrityPipeline(
        orchestrator=legacy_mock_orch,
        use_document_parser=False,
        use_report_cache=False,
    )
    report_b = await pipeline_b.run_async(pdf_path)
    assert legacy_mock_orch.retrieve.await_count >= 1
    assert len(report_b.verdicts) >= 1


@pytest.mark.asyncio
async def test_round1_no_cross_essay_poisoning_and_wave0_title_guard(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Finding 1: Chimeric arXiv/URL citations never poison valid citations, typo IDs don't short-circuit Wave-0, and authorless DOIs stay pristine."""
    db_file = tmp_path / "round1_isolation.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    init_db()

    bert_title = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"

    def _make_stub_clients() -> dict[str, object]:
        def _build(name: str) -> object:
            c = SimpleNamespace(name=name)

            async def _lookup(cit: Citation) -> SourceCandidate:
                t_low = (cit.title or "").lower()
                if "bert: pre-training" in t_low:
                    return SourceCandidate(
                        source_name=name,
                        found=True,
                        doi="10.48550/arxiv.1810.04805",
                        title=bert_title,
                        authors=["Jacob Devlin", "Ming-Wei Chang"],
                        year="2019",
                        venue="NAACL",
                        external_ids={"arxiv": "1810.04805"},
                        confidence=0.98,
                    )
                if "attention is all you need" in t_low:
                    return SourceCandidate(
                        source_name=name,
                        found=True,
                        doi="10.5555/3295222.3295349",
                        title="Attention Is All You Need",
                        authors=["Ashish Vaswani", "Noam Shazeer"],
                        year="2017",
                        venue="NeurIPS",
                        confidence=0.98,
                    )
                if "paper alpha on diffusion" in t_low:
                    return SourceCandidate(
                        source_name=name,
                        found=True,
                        title="Paper Alpha on Diffusion Models",
                        authors=["Alice Alpha"],
                        year="2023",
                        venue="ICML",
                        confidence=0.95,
                    )
                if "paper beta on reinforcement" in t_low:
                    return SourceCandidate(
                        source_name=name,
                        found=True,
                        title="Paper Beta on Reinforcement Learning",
                        authors=["Bob Beta"],
                        year="2023",
                        venue="ICML",
                        confidence=0.95,
                    )
                if "highly accurate protein structure" in t_low:
                    return SourceCandidate(
                        source_name=name,
                        found=True,
                        doi="10.1038/s41586-021-03819-2",
                        title="Highly accurate protein structure prediction with AlphaFold",
                        authors=["John Jumper", "Demis Hassabis"],
                        year="2021",
                        venue="Nature",
                        confidence=0.99,
                    )
                return SourceCandidate(source_name=name, found=False, error=f"{name}: no results for '{cit.title}'")

            c.lookup = AsyncMock(side_effect=_lookup)
            return c

        return {
            n: _build(n)
            for n in ("crossref", "openalex", "dblp", "arxiv", "openlibrary", "europepmc")
        }

    # --- 1A. Reverse-order chimeric arXiv negative-miss poisoning check ---
    essay_a_chimeric_arxiv = Citation(
        raw_text="Fake, X. (2024). Quantum Hallucinated Teleportation Engine. arXiv:1810.04805",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["X. Fake"],
        year="2024",
        title="Quantum Hallucinated Teleportation Engine",
    )
    essay_b_real_bert = Citation(
        raw_text=f"Devlin, J., & Chang, M. (2019). {bert_title}. arXiv:1810.04805",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        title=bert_title,
    )

    orch_a = RetrievalOrchestrator(
        **_make_stub_clients(),
        use_local_db=False,
        enable_link_validation=False,
    )
    res_a = await orch_a.retrieve(essay_a_chimeric_arxiv)
    assert len(res_a.candidates) == 0

    orch_b = RetrievalOrchestrator(
        **_make_stub_clients(),
        use_local_db=False,
        enable_link_validation=False,
    )
    res_b = await orch_b.retrieve(essay_b_real_bert)
    assert len(res_b.candidates) >= 1, "Essay A's chimeric arXiv miss poisoned Essay B's real BERT citation!"
    assert res_b.best_candidate() is not None
    assert "BERT" in (res_b.best_candidate().title or "")

    # --- 1B. Shared proceedings URL & chimeric scholarly URL check ---
    shared_proc_url = "https://proceedings.mlr.press/v202/"
    cit_alpha = Citation(
        raw_text=f"Alpha, A. (2023). Paper Alpha on Diffusion Models. ICML. {shared_proc_url}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Alice Alpha"],
        year="2023",
        title="Paper Alpha on Diffusion Models",
        venue="ICML",
        url=shared_proc_url,
    )
    cit_beta = Citation(
        raw_text=f"Beta, B. (2023). Paper Beta on Reinforcement Learning. ICML. {shared_proc_url}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Bob Beta"],
        year="2023",
        title="Paper Beta on Reinforcement Learning",
        venue="ICML",
        url=shared_proc_url,
    )
    r_alpha = await orch_a.retrieve(cit_alpha)
    r_beta = await orch_b.retrieve(cit_beta)
    assert r_alpha.best_candidate() is not None
    assert r_beta.best_candidate() is not None
    assert "Alpha" in (r_alpha.best_candidate().title or "")
    assert "Beta" in (r_beta.best_candidate().title or "")

    nature_url = "https://www.nature.com/articles/s41586-021-03819-2"
    fake_link_validator = SimpleNamespace(
        validate_with_archive=AsyncMock(return_value=("alive", 200, None))
    )
    orch_url_a = RetrievalOrchestrator(
        **_make_stub_clients(),
        use_local_db=False,
        enable_link_validation=True,
        link_validator=fake_link_validator,
    )
    orch_url_a._validate_citation_url_with_archive = AsyncMock(return_value=("alive", 200, None))  # type: ignore[method-assign]
    chimeric_nature = Citation(
        raw_text=f"Imaginary, Z. (2024). Fabricated Hallucination Title. Nature. {nature_url}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Z. Imaginary"],
        year="2024",
        title="Fabricated Hallucination Title",
        venue="Nature",
        url=nature_url,
    )
    r_chim_url = await orch_url_a.retrieve(chimeric_nature)
    assert len(r_chim_url.candidates) == 0

    orch_url_b = RetrievalOrchestrator(
        **_make_stub_clients(),
        use_local_db=False,
        enable_link_validation=True,
        link_validator=fake_link_validator,
    )
    orch_url_b._validate_citation_url_with_archive = AsyncMock(return_value=("alive", 200, None))  # type: ignore[method-assign]
    real_alphafold = Citation(
        raw_text=f"Jumper, J., & Hassabis, D. (2021). Highly accurate protein structure prediction with AlphaFold. Nature. {nature_url}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["John Jumper", "Demis Hassabis"],
        year="2021",
        title="Highly accurate protein structure prediction with AlphaFold",
        venue="Nature",
        url=nature_url,
    )
    r_real_url = await orch_url_b.retrieve(real_alphafold)
    assert len(r_real_url.candidates) >= 1, "Chimeric URL check poisoned real scholarly URL citation!"
    assert "AlphaFold" in (r_real_url.best_candidate().title or "")

    # --- 1C. Wave-0 typo identifier must NOT short-circuit mismatched title ---
    stubs_c = _make_stub_clients()
    stubs_c["openalex"].lookup_dois_batch = AsyncMock(
        return_value={
            "10.48550/arxiv.1409.0473": SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.48550/arxiv.1409.0473",
                title="Neural Machine Translation by Jointly Learning to Align and Translate",
                authors=["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"],
                year="2015",
                confidence=1.0,
            )
        }
    )
    stubs_c["arxiv"].lookup_arxiv_batch = AsyncMock(
        return_value={
            "1409.0473": SourceCandidate(
                source_name="arxiv",
                found=True,
                doi="10.48550/arxiv.1409.0473",
                title="Neural Machine Translation by Jointly Learning to Align and Translate",
                authors=["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"],
                year="2015",
                external_ids={"arxiv": "1409.0473"},
                confidence=0.98,
            )
        }
    )
    orch_c = RetrievalOrchestrator(
        **stubs_c,
        use_local_db=False,
        enable_link_validation=False,
    )
    vaswani_typo_arxiv = Citation(
        raw_text="Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need. NeurIPS. arXiv:1409.0473",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Ashish Vaswani", "Noam Shazeer"],
        year="2017",
        title="Attention Is All You Need",
        venue="NeurIPS",
    )
    wave0_res = await orch_c.prefetch_identifiers([vaswani_typo_arxiv])
    assert id(vaswani_typo_arxiv) not in wave0_res, "Wave-0 must not short-circuit when batch title disagrees with cited title!"
    fallback_res = await orch_c.retrieve(vaswani_typo_arxiv)
    assert fallback_res.best_candidate() is not None
    assert fallback_res.best_candidate().title == "Attention Is All You Need"

    # --- 1D. Authorless DOI candidate must not bake Essay A's citation.authors[0] into shared doi: cache ---
    stubs_d = _make_stub_clients()
    std_doi = "10.1109/ieeestd.2022.9999"
    stubs_d["openalex"].lookup_dois_batch = AsyncMock(
        return_value={
            std_doi: SourceCandidate(
                source_name="openalex",
                found=True,
                doi=std_doi,
                title="IEEE Standard for Information Technology Wireless LAN",
                authors=[],
                year="2022",
                venue="",
                confidence=1.0,
            )
        }
    )
    stubs_d["crossref"].lookup_dois_batch = AsyncMock(
        return_value={
            std_doi: SourceCandidate(
                source_name="crossref",
                found=True,
                doi=std_doi,
                title="IEEE Standard for Information Technology Wireless LAN",
                authors=[],
                year="2022",
                venue="",
                confidence=1.0,
            )
        }
    )
    orch_d1 = RetrievalOrchestrator(
        **stubs_d,
        use_local_db=False,
        enable_link_validation=False,
    )
    cit_std_a = Citation(
        raw_text=f"Alice InjectedAuthor (2022). IEEE Standard for Information Technology Wireless LAN. https://doi.org/{std_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Alice InjectedAuthor"],
        year="2022",
        title="IEEE Standard for Information Technology Wireless LAN",
        doi=std_doi,
    )
    pref_d1 = await orch_d1.prefetch_identifiers([cit_std_a])
    assert id(cit_std_a) in pref_d1

    orch_d2 = RetrievalOrchestrator(
        **_make_stub_clients(),
        use_local_db=False,
        enable_link_validation=False,
    )
    cit_std_b = Citation(
        raw_text=f"IEEE Working Group (2022). IEEE Standard for Information Technology Wireless LAN. https://doi.org/{std_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["IEEE Working Group"],
        year="2022",
        title="IEEE Standard for Information Technology Wireless LAN",
        doi=std_doi,
    )
    res_d2 = await orch_d2.retrieve(cit_std_b)
    assert res_d2.best_candidate() is not None
    assert "Alice InjectedAuthor" not in (res_d2.best_candidate().authors or [])


def test_round1_transient_no_response_rejected_and_quoted_title_keywords_cached(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Finding 2: 'no response' is rejected as transient, while titles containing 'Network'/'Connected'/'500' are cached."""
    db_file = tmp_path / "round1_transient.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    init_db()

    cache = PersistentVerificationCache()

    # 2A. 'no response' (from 5xx/timeout in OpenAlex/Crossref) MUST be treated as transient failure
    degraded_partial = SourceResult(
        citation_raw="Test",
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.1038/s41586-022-1111",
                title="Valid Paper Title",
                authors=["Jane Doe"],
                year="2022",
                confidence=1.0,
            )
        ],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
        sources_failed={"openalex": "OpenAlex: no response for 'Valid Paper Title'"},
    )
    assert cache.has_transient_failure(degraded_partial) is True
    assert cache.resolve_ttl_seconds(degraded_partial) is None
    assert cache.set("doi:10.1038/s41586-022-1111", degraded_partial) is False

    degraded_no_resp_miss = SourceResult(
        citation_raw="Not Found Study",
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no response for query 'Not Found Analysis'",
            "openalex": "OpenAlex: no response for 'Not Found Analysis'",
            "dblp": "DBLP: no response for 'Not Found Analysis'",
        },
    )
    assert cache.has_transient_failure(degraded_no_resp_miss) is True
    assert cache.resolve_ttl_seconds(degraded_no_resp_miss) is None

    dns_miss = SourceResult(
        citation_raw="DNS Failure Study",
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: host not found",
            "openalex": "OpenAlex: no results for 'DNS Failure Study'",
            "dblp": "DBLP: no results for 'DNS Failure Study'",
        },
    )
    assert cache.has_transient_failure(dns_miss) is True
    assert cache.resolve_ttl_seconds(dns_miss) is None

    # 2B. Quoted paper titles containing 'Network', 'Connected', '500', 'Timeout', 'Quota', or apostrophes MUST cache cleanly!
    tricky_titles = [
        "Graph Attention Network for Node Classification",
        "Fully Connected Neural Architectures at Scale",
        "500 Years of Timeout and Quota Credits in Unavailable Skipped Systems",
        "Grover's Algorithm in Quantum Network Routing",
    ]
    for idx, tricky in enumerate(tricky_titles):
        clean_miss = SourceResult(
            citation_raw=tricky,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp"],
            sources_succeeded=[],
            sources_failed={
                "crossref": f"Crossref: no results for '{tricky}'",
                "openalex": f"OpenAlex: no results for '{tricky}'",
                "dblp": f"DBLP: no title match (0.21) for '{tricky}'",
            },
        )
        assert cache.has_transient_failure(clean_miss) is False, f"False positive transient on title: {tricky}"
        assert cache.resolve_ttl_seconds(clean_miss) == CLEAN_MISS_TTL_SECONDS
        key = f"meta:tricky-{idx}"
        assert cache.set(key, clean_miss) is True
        assert cache.get(key) is not None


@pytest.mark.asyncio
async def test_round1_batch_recovered_429_records_success_and_arxiv_timeout_records_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Finding 3: Recovered 429->200 batch retry records success; ArxivClient._last_timed_out records timeout failure."""
    # 3A. Crossref batch sees initial 429 (Retry-After: 0) then recovers to 200 on retry
    calls = {"n": 0}
    target_doi = "10.1145/3442188.3445901"

    class RecoveringHttpClient:
        async def get(self, url: str, **_kw: object) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(
                    429,
                    headers={"Retry-After": "0"},
                    request=httpx.Request("GET", url),
                )
            return httpx.Response(
                200,
                json={"status": "ok", "message": {"items": [_make_crossref_item(target_doi, 1)]}},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(
        "integrity_checker.retrieval.crossref_client.get_shared_http_client",
        lambda **_kw: RecoveringHttpClient(),
    )

    cr_client = CrossrefClient(contact_email="test@example.com", max_retries=2)
    oa_client = OpenAlexClient(contact_email="test@example.com")
    oa_cand = oa_client._work_to_candidate(_make_openalex_work(target_doi, 1))
    oa_cand.found = True
    oa_cand.confidence = 1.0
    oa_client.lookup_dois_batch = AsyncMock(return_value={target_doi: oa_cand})

    ax_client = ArxivClient(contact_email="test@example.com")

    async def fake_arxiv_timeout(_ids: list[str]) -> dict[str, SourceCandidate]:
        ax_client._last_timed_out = True
        return {}

    ax_client.lookup_arxiv_batch = AsyncMock(side_effect=fake_arxiv_timeout)

    cb = CircuitBreakerRegistry(failure_threshold=4, recovery_timeout_seconds=60.0)
    orch = RetrievalOrchestrator(
        crossref=cr_client,
        openalex=oa_client,
        arxiv=ax_client,
        use_local_db=False,
        enable_link_validation=False,
        circuit_breakers=cb,
    )

    doi_cit = Citation(
        raw_text=f"Researcher 1, A. (2022). Deep Neural Architecture Study Part 1. JMLR. https://doi.org/{target_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Alice Researcher 1", "Bob Coauthor"],
        year="2022",
        title="Deep Neural Architecture Study Part 1",
        doi=target_doi,
    )
    arxiv_cit = Citation(
        raw_text="Vaswani, A. (2023). Scalable Transformer Preprint Number 0. arXiv:2301.10000",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Vaswani 0"],
        year="2023",
        title="Scalable Transformer Preprint Number 0",
    )

    resolved = await orch.prefetch_identifiers([doi_cit, arxiv_cit])
    assert id(doi_cit) in resolved
    snap = cb.snapshot_all()
    assert snap["crossref"]["success_count"] == 1
    assert snap["crossref"]["consecutive_failures"] == 0
    assert snap["arxiv"]["consecutive_failures"] == 1
    assert snap["arxiv"]["timeout_count"] == 1


@pytest.mark.asyncio
async def test_round1_openalex_batch_maps_published_arxiv_locations_and_prefers_abstract_on_duplicates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Finding 4: Published arXiv works map back to 10.48550/arxiv.{id} via locations/ids, and duplicates keep abstracts."""
    dup_doi = "10.1038/s41586-022-7777"
    bert_pub_doi = "10.18653/v1/n19-1423"

    bert_work = {
        "id": "https://openalex.org/W2963403868",
        "doi": f"https://doi.org/{bert_pub_doi}",
        "display_name": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        "publication_year": 2019,
        "authorships": [{"author": {"display_name": "Jacob Devlin"}}],
        "primary_location": {
            "source": {"display_name": "NAACL"},
            "landing_page_url": f"https://doi.org/{bert_pub_doi}",
        },
        "locations": [
            {
                "landing_page_url": f"https://doi.org/{bert_pub_doi}",
                "pdf_url": None,
            },
            {
                "landing_page_url": "https://arxiv.org/abs/1810.04805v2",
                "pdf_url": "https://arxiv.org/pdf/1810.04805",
            },
        ],
        "abstract_inverted_index": {
            "We": [0],
            "introduce": [1],
            "a": [2],
            "new": [3],
            "language": [4],
            "representation": [5],
            "model": [6],
            "called": [7],
            "BERT.": [8],
        },
    }

    dup_with_abstract = _make_openalex_work(dup_doi, 77)
    dup_without_abstract = _make_openalex_work(dup_doi, 77)
    dup_without_abstract["abstract_inverted_index"] = None

    class FakeHttpClient:
        async def get(self, url: str, **_kw: object) -> httpx.Response:
            return httpx.Response(
                200,
                json={"results": [bert_work, dup_with_abstract, dup_without_abstract]},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(
        "integrity_checker.retrieval.openalex_client.get_shared_http_client",
        lambda **_kw: FakeHttpClient(),
    )

    oa_client = OpenAlexClient(contact_email="test@example.com")
    batch_map = await oa_client.lookup_dois_batch(["10.48550/arxiv.1810.04805", dup_doi])

    assert "10.48550/arxiv.1810.04805" in batch_map
    assert batch_map["10.48550/arxiv.1810.04805"].title.startswith("BERT:")
    assert "language representation model" in (batch_map["10.48550/arxiv.1810.04805"].abstract or "")

    assert dup_doi in batch_map
    assert batch_map[dup_doi].abstract == "We present batch study-77 results."

    # Also verify Wave-0 prefetch_identifiers achieves consensus >= 2 when OpenAlex returns
    # the published NAACL DOI (10.18653/v1/n19-1423) and ArxivClient returns 10.48550/arxiv.1810.04805
    ax_client = ArxivClient(contact_email="test@example.com")
    ax_client.lookup_arxiv_batch = AsyncMock(
        return_value={
            "1810.04805": SourceCandidate(
                source_name="arxiv",
                found=True,
                doi="10.48550/arxiv.1810.04805",
                title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                external_ids={"arxiv": "1810.04805"},
                confidence=0.98,
            )
        }
    )
    cr_client = CrossrefClient(contact_email="test@example.com")
    cr_client.lookup_dois_batch = AsyncMock(return_value={})
    orch = RetrievalOrchestrator(
        openalex=oa_client,
        crossref=cr_client,
        arxiv=ax_client,
        use_local_db=False,
        enable_link_validation=False,
    )
    bert_arxiv_cit = Citation(
        raw_text="Devlin, J., & Chang, M. (2019). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. arXiv:1810.04805",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    )
    wave0 = await orch.prefetch_identifiers([bert_arxiv_cit])
    assert id(bert_arxiv_cit) in wave0
    assert wave0[id(bert_arxiv_cit)].consensus_count() >= 2


@pytest.mark.asyncio
async def test_round2_split_brain_chimeric_doi_and_title_no_bare_key_poisoning_or_wave0_shortcircuit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Round 2: Split-brain chimeric citations returning BOTH AlphaFold (via DOI) and Vaswani (via title/arXiv)
    must never poison bare doi:/arxiv: keys, leak retraction flags, or short-circuit Wave-0.
    """
    db_file = tmp_path / "round2_split_brain.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    init_db()

    alphafold_doi = "10.1038/s41586-021-03819-2"
    alphafold_title = "Highly accurate protein structure prediction with AlphaFold"
    roberta_title = "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
    vaswani_title = "Attention Is All You Need"

    def _make_split_brain_stubs(*, retracted_title_hit: bool = True) -> dict[str, object]:
        def _alphafold_cand(src: str) -> SourceCandidate:
            return SourceCandidate(
                source_name=src,
                found=True,
                doi=alphafold_doi,
                title=alphafold_title,
                authors=["John Jumper", "Demis Hassabis"],
                year="2021",
                venue="Nature",
                confidence=1.0,
            )

        def _roberta_cand(src: str, *, with_arxiv: bool = False) -> SourceCandidate:
            ext: dict[str, str] = {}
            if with_arxiv:
                ext["arxiv"] = "1907.11692"
            if retracted_title_hit:
                ext["is_retracted"] = "true"
            return SourceCandidate(
                source_name=src,
                found=True,
                doi="10.48550/arxiv.1907.11692",
                title=roberta_title,
                authors=["Yinhan Liu", "Myle Ott"],
                year="2019",
                venue="arXiv",
                external_ids=ext,
                confidence=0.98,
            )

        def _vaswani_cand(src: str, *, with_arxiv: bool = False) -> SourceCandidate:
            ext: dict[str, str] = {}
            if with_arxiv:
                ext["arxiv"] = "1706.03762"
            if retracted_title_hit:
                ext["is_retracted"] = "true"
            return SourceCandidate(
                source_name=src,
                found=True,
                doi="10.5555/3295222.3295349",
                title=vaswani_title,
                authors=["Ashish Vaswani", "Noam Shazeer"],
                year="2017",
                venue="NeurIPS",
                external_ids=ext,
                confidence=0.98,
            )

        stubs: dict[str, object] = {}
        for name in ("crossref", "openalex", "dblp", "arxiv", "openlibrary", "europepmc"):
            c = SimpleNamespace(name=name)

            async def _lookup(cit: Citation, _src: str = name) -> SourceCandidate:
                # DOI-first registries (crossref, openalex) return AlphaFold when DOI is cited
                if _src in ("crossref", "openalex") and (cit.doi or "").strip() == alphafold_doi:
                    return _alphafold_cand(_src)
                t_low = (cit.title or "").lower()
                if "roberta: a robustly optimized" in t_low and _src in ("dblp", "arxiv"):
                    return _roberta_cand(_src, with_arxiv=(_src == "arxiv"))
                if "attention is all you need" in t_low and _src in ("dblp", "arxiv"):
                    return _vaswani_cand(_src, with_arxiv=(_src == "arxiv"))
                if "highly accurate protein structure" in t_low and _src in ("crossref", "openalex"):
                    return _alphafold_cand(_src)
                return SourceCandidate(
                    source_name=_src,
                    found=False,
                    error=f"{_src}: no results for '{cit.title}'",
                )

            c.lookup = AsyncMock(side_effect=_lookup)
            stubs[name] = c

        stubs["openalex"].lookup_dois_batch = AsyncMock(
            side_effect=lambda dois: {
                d: _alphafold_cand("openalex") for d in dois if d == alphafold_doi
            }
        )
        stubs["crossref"].lookup_dois_batch = AsyncMock(
            side_effect=lambda dois: {
                d: _alphafold_cand("crossref") for d in dois if d == alphafold_doi
            }
        )
        stubs["arxiv"].lookup_arxiv_batch = AsyncMock(
            side_effect=lambda ids: {
                aid: (
                    _vaswani_cand("arxiv", with_arxiv=True)
                    if aid == "1706.03762"
                    else _roberta_cand("arxiv", with_arxiv=True)
                )
                for aid in ids
                if aid in ("1706.03762", "1907.11692")
            }
        )
        return stubs

    # --- 2A. Essay A chimeric (RoBERTa title + AlphaFold DOI) via retrieve() must NOT poison bare doi: key ---
    orch_a = RetrievalOrchestrator(
        **_make_split_brain_stubs(retracted_title_hit=True),
        use_local_db=False,
        enable_link_validation=False,
    )
    essay_a_chimeric = Citation(
        raw_text=f"Liu, Y., & Ott, M. (2019). {roberta_title}. https://doi.org/{alphafold_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Yinhan Liu", "Myle Ott"],
        year="2019",
        title=roberta_title,
        venue="arXiv",
        doi=alphafold_doi,
    )
    res_a = await orch_a.retrieve(essay_a_chimeric)
    titles_a = {c.title for c in res_a.candidates}
    assert alphafold_title in titles_a and roberta_title in titles_a

    p_cache = PersistentVerificationCache()
    bare_doi_cached = p_cache.get(f"doi:{alphafold_doi}")
    assert bare_doi_cached is None, (
        "Mixed chimeric [AlphaFold, RoBERTa] result must NEVER be persisted under bare doi: key!"
    )

    # Essay B citing real AlphaFold must get ONLY clean AlphaFold (no Vaswani, no leaked is_retracted=True)
    orch_b = RetrievalOrchestrator(
        **_make_split_brain_stubs(retracted_title_hit=True),
        use_local_db=False,
        enable_link_validation=False,
    )
    essay_b_real_alphafold = Citation(
        raw_text=f"Jumper, J., & Hassabis, D. (2021). {alphafold_title}. Nature. https://doi.org/{alphafold_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["John Jumper", "Demis Hassabis"],
        year="2021",
        title=alphafold_title,
        venue="Nature",
        doi=alphafold_doi,
    )
    res_b = await orch_b.retrieve(essay_b_real_alphafold)
    assert len(res_b.candidates) == 1
    assert res_b.best_candidate() is not None
    assert res_b.best_candidate().title == alphafold_title
    assert res_b.is_retracted is False
    assert res_b.best_candidate().is_retracted is False

    # Bare doi: key now holds ONLY clean AlphaFold; another chimeric Essay C must NOT short-circuit Wave-0
    bare_after_b = p_cache.get(f"doi:{alphafold_doi}")
    assert bare_after_b is not None
    assert all(c.title == alphafold_title for c in bare_after_b.candidates)
    assert bare_after_b.is_retracted is False

    orch_c = RetrievalOrchestrator(
        **_make_split_brain_stubs(retracted_title_hit=False),
        use_local_db=False,
        enable_link_validation=False,
    )
    essay_c_chimeric = Citation(
        raw_text=f"Vaswani, A. (2018). {vaswani_title}. https://doi.org/{alphafold_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Ashish Vaswani"],
        year="2018",
        title=vaswani_title,
        doi=alphafold_doi,
    )
    wave0_c = await orch_c.prefetch_identifiers([essay_c_chimeric])
    assert id(essay_c_chimeric) not in wave0_c

    # --- 2B. Wave-0 dual-ID chimeric citations (AlphaFold DOI + Vaswani arXiv:1706.03762) must NOT short-circuit ---
    db_file_w0 = tmp_path / "round2_wave0_dual_id.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file_w0}")
    get_settings.cache_clear()
    init_db()

    orch_w0 = RetrievalOrchestrator(
        **_make_split_brain_stubs(retracted_title_hit=True),
        use_local_db=False,
        enable_link_validation=False,
    )
    dual_id_vaswani_title = Citation(
        raw_text=f"Vaswani, A. (2017). {vaswani_title}. arXiv:1706.03762 https://doi.org/{alphafold_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Ashish Vaswani"],
        year="2017",
        title=vaswani_title,
        doi=alphafold_doi,
    )
    dual_id_alphafold_title = Citation(
        raw_text=f"Jumper, J. (2021). {alphafold_title}. arXiv:1706.03762 https://doi.org/{alphafold_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["John Jumper"],
        year="2021",
        title=alphafold_title,
        doi=alphafold_doi,
    )
    dual_id_untitled = Citation(
        raw_text=f"https://doi.org/{alphafold_doi} arXiv:1706.03762",
        citation_type=CitationType.REFERENCE_LIST,
        doi=alphafold_doi,
    )

    wave0_dual = await orch_w0.prefetch_identifiers(
        [dual_id_vaswani_title, dual_id_alphafold_title, dual_id_untitled]
    )
    assert wave0_dual == {}, (
        "Wave-0 must NOT short-circuit any dual-ID citation where DOI and arXiv candidates disagree!"
    )
    p_cache_w0 = PersistentVerificationCache()
    assert p_cache_w0.get(f"doi:{alphafold_doi}") is None
    assert p_cache_w0.get("arxiv:1706.03762") is None


@pytest.mark.asyncio
async def test_round2_shared_key_purity_and_stale_mixed_cache_read_sanitization(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Round 2 defense-in-depth: shared doi:/arxiv: entries store ONLY confirming candidates,
    sanitize stale mixed cache entries on read, and support legitimate agreeing dual-ID papers.
    """
    db_file = tmp_path / "round2_purity.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file}")
    get_settings.cache_clear()
    init_db()

    bert_pub_doi = "10.18653/v1/n19-1423"
    bert_title = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"

    p_cache = PersistentVerificationCache()
    # Seed a hypothetical legacy mixed row under bare doi: key containing BERT (clean) + RoBERTa (retracted)
    legacy_mixed = SourceResult(
        citation_raw="Legacy Mixed",
        candidates=[
            SourceCandidate(
                source_name="openalex",
                found=True,
                doi=bert_pub_doi,
                title=bert_title,
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                confidence=1.0,
            ),
            SourceCandidate(
                source_name="crossref",
                found=True,
                doi=bert_pub_doi,
                title=bert_title,
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                confidence=1.0,
            ),
            SourceCandidate(
                source_name="dblp",
                found=True,
                doi="10.48550/arxiv.1907.11692",
                title="RoBERTa: A Robustly Optimized BERT Pretraining Approach",
                authors=["Yinhan Liu"],
                year="2019",
                external_ids={"is_retracted": "true"},
                confidence=0.95,
            ),
        ],
        sources_queried=["openalex", "crossref", "dblp"],
        sources_succeeded=["openalex", "crossref", "dblp"],
        sources_failed={},
        is_retracted=True,
    )
    assert p_cache.set(f"doi:{bert_pub_doi}", legacy_mixed) is True

    stubs = {}
    for name in ("crossref", "openalex", "dblp", "arxiv", "openlibrary", "europepmc"):
        s = SimpleNamespace(
            name=name,
            lookup=AsyncMock(
                return_value=SourceCandidate(source_name=name, found=False, error="no results")
            ),
        )
        stubs[name] = s
    stubs["openalex"].lookup_dois_batch = AsyncMock(return_value={})
    stubs["crossref"].lookup_dois_batch = AsyncMock(return_value={})
    stubs["arxiv"].lookup_arxiv_batch = AsyncMock(return_value={})

    orch = RetrievalOrchestrator(
        **stubs,
        use_local_db=False,
        enable_link_validation=False,
    )

    # 1. Chimeric RoBERTa title + BERT DOI MUST reject the legacy mixed bare doi: entry
    chimeric_roberta = Citation(
        raw_text=f"Liu, Y. (2019). RoBERTa: A Robustly Optimized BERT Pretraining Approach. https://doi.org/{bert_pub_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Yinhan Liu"],
        year="2019",
        title="RoBERTa: A Robustly Optimized BERT Pretraining Approach",
        doi=bert_pub_doi,
    )
    assert await orch.prefetch_identifiers([chimeric_roberta]) == {}

    # 2. Valid BERT citation strips non-confirming RoBERTa and clears leaked is_retracted=True on read
    valid_bert = Citation(
        raw_text=f"Devlin, J. (2019). {bert_title}. https://doi.org/{bert_pub_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        title=bert_title,
        doi=bert_pub_doi,
    )
    valid_hit = await orch.retrieve(valid_bert)
    assert len(valid_hit.candidates) == 1
    assert valid_hit.best_candidate().title == bert_title
    assert valid_hit.is_retracted is False
    assert valid_hit.sources_succeeded == ["openalex", "crossref"]

    # 3. Reverse-order chimeric dual-ID citation (BERT DOI + unrelated Vaswani arXiv:1706.03762)
    # must NOT hit the bare doi:10.18653/v1/n19-1423 cache entry because 1706.03762 is unconfirmed
    reverse_dual_chimeric = Citation(
        raw_text=f"Devlin, J. (2019). {bert_title}. arXiv:1706.03762 https://doi.org/{bert_pub_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jacob Devlin"],
        year="2019",
        title=bert_title,
        doi=bert_pub_doi,
    )
    assert await orch.prefetch_identifiers([reverse_dual_chimeric]) == {}

    # 4. Legitimate agreeing dual-ID BERT citation (BERT publisher DOI + BERT arXiv:1810.04805)
    # resolves cleanly in Wave-0 and keeps bare doi: pure
    db_file_agree = tmp_path / "round2_dual_agree.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file_agree}")
    get_settings.cache_clear()
    init_db()

    stubs["openalex"].lookup_dois_batch = AsyncMock(
        return_value={
            bert_pub_doi: SourceCandidate(
                source_name="openalex",
                found=True,
                doi=bert_pub_doi,
                title=bert_title,
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                external_ids={"arxiv": "1810.04805"},
                confidence=1.0,
            )
        }
    )
    stubs["crossref"].lookup_dois_batch = AsyncMock(
        return_value={
            bert_pub_doi: SourceCandidate(
                source_name="crossref",
                found=True,
                doi=bert_pub_doi,
                title=bert_title,
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                confidence=1.0,
            )
        }
    )
    stubs["arxiv"].lookup_arxiv_batch = AsyncMock(
        return_value={
            "1810.04805": SourceCandidate(
                source_name="arxiv",
                found=True,
                doi="10.48550/arxiv.1810.04805",
                title=bert_title,
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year="2019",
                external_ids={"arxiv": "1810.04805"},
                confidence=0.98,
            )
        }
    )
    orch_agree = RetrievalOrchestrator(
        **stubs,
        use_local_db=False,
        enable_link_validation=False,
    )
    legit_dual_bert = Citation(
        raw_text=f"Devlin, J., & Chang, M. (2019). {bert_title}. NAACL. arXiv:1810.04805 https://doi.org/{bert_pub_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        title=bert_title,
        doi=bert_pub_doi,
    )
    w0_agree = await orch_agree.prefetch_identifiers([legit_dual_bert])
    assert id(legit_dual_bert) in w0_agree
    assert w0_agree[id(legit_dual_bert)].consensus_count() >= 2

    pure_stored = PersistentVerificationCache().get(f"doi:{bert_pub_doi}")
    assert pure_stored is not None
    assert all(c.doi == bert_pub_doi for c in pure_stored.candidates)



