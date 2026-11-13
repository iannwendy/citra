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
    assert recorded_calls[0][1]["per_page"] == 50
    assert recorded_calls[1][1]["per_page"] == 50
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
