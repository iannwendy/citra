"""Unit tests for Phase 3 LinkValidator, broken-link rules, and CIS identifier_validity."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import patch

import httpx
import pytest

from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator


@pytest.mark.asyncio
async def test_link_validator_fake_domain() -> None:
    validator = LinkValidator()
    res = await validator.validate_url("https://example.com/fake-paper.pdf")
    assert res.status == LinkStatus.FAKE_DOMAIN
    assert res.is_broken is True
    assert res.is_valid is False


@pytest.mark.asyncio
async def test_link_validator_alive_200() -> None:
    async def mock_head(self, url, **kwargs):
        return httpx.Response(200, request=httpx.Request("HEAD", url))

    validator = LinkValidator()
    with patch.object(httpx.AsyncClient, "head", mock_head):
        res = await validator.validate_url("https://arxiv.org/abs/1706.03762")

    assert res.status == LinkStatus.ALIVE
    assert res.status_code == 200
    assert res.is_valid is True
    assert res.is_broken is False


@pytest.mark.asyncio
async def test_link_validator_paywall_403_treated_as_restricted_alive() -> None:
    async def mock_head(self, url, **kwargs):
        return httpx.Response(405, request=httpx.Request("HEAD", url))

    @asynccontextmanager
    async def mock_stream(self, method, url, **kwargs):
        yield httpx.Response(403, request=httpx.Request(method, url))

    validator = LinkValidator()
    with patch.object(httpx.AsyncClient, "head", mock_head), patch.object(
        httpx.AsyncClient, "stream", mock_stream
    ):
        res = await validator.validate_url("https://ieeexplore.ieee.org/document/7780459")

    assert res.status == LinkStatus.RESTRICTED_ALIVE
    assert res.status_code == 403
    assert res.is_valid is True
    assert res.is_broken is False


@pytest.mark.asyncio
async def test_link_validator_404_treated_as_dead_link() -> None:
    async def mock_head(self, url, **kwargs):
        return httpx.Response(404, request=httpx.Request("HEAD", url))

    @asynccontextmanager
    async def mock_stream(self, method, url, **kwargs):
        yield httpx.Response(404, request=httpx.Request(method, url))

    validator = LinkValidator()
    with patch.object(httpx.AsyncClient, "head", mock_head), patch.object(
        httpx.AsyncClient, "stream", mock_stream
    ):
        res = await validator.validate_url("https://aclanthology.org/nonexistent-paper-9999")

    assert res.status == LinkStatus.DEAD_LINK
    assert res.status_code == 404
    assert res.is_broken is True
    assert res.is_valid is False


@pytest.mark.asyncio
async def test_link_validator_connect_error_treated_as_dead_link() -> None:
    async def mock_head(self, url, **kwargs):
        raise httpx.ConnectError("DNS lookup failed")

    validator = LinkValidator()
    with patch.object(httpx.AsyncClient, "head", mock_head):
        res = await validator.validate_url("https://nonexistent-scholar-domain.org/paper")

    assert res.status == LinkStatus.DEAD_LINK
    assert res.is_broken is True


def test_dead_url_no_candidate_returns_suspected_hallucination() -> None:
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw="Pham, T. (2023). Hallucinated Paper. https://scholar.uni.edu/missing.pdf",
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={"crossref": "timeout", "openalex": "timeout"},
        url_status="dead_link",
        url_status_code=404,
    )
    outcome = rules.apply(
        MatchFeatures(),
        source,
        citation_url="https://scholar.uni.edu/missing.pdf",
        citation_authors=["Pham, T."],
        citation_year="2023",
        citation_raw=source.citation_raw,
    )
    assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-DEAD-URL" in outcome.triggered_rules
    assert "url" in outcome.mismatched_fields


def test_verified_record_with_dead_url_flags_domain_exception() -> None:
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )
    cit = Citation(
        raw_text="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444. https://nature.com/articles/broken-link-404",
        title="Deep learning",
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        doi="10.1038/nature14539",
        url="https://nature.com/articles/broken-link-404",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1038/nature14539",
        title="Deep learning",
        authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        year="2015",
        confidence=0.95,
    )
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
        url_status="dead_link",
        url_status_code=404,
    )
    verdict = checker.check(cit, source)
    assert verdict.label == ValidationLabel.VERIFIED
    assert verdict.domain_exception is True
    assert "R-DOMAIN-EXCEPTION" in verdict.triggered_rules
    assert "R-BROKEN-LINK" in verdict.triggered_rules
    assert "url" in verdict.mismatched_fields

    cis = CISCalculator().compute([verdict])
    assert cis.components.identifier_validity == 0.0


def test_analysis_report_roundtrip_preserves_url_status_and_domain_exception() -> None:
    from integrity_checker.pipeline.integrity_pipeline import AnalysisReport

    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )
    cit = Citation(
        raw_text="Vaswani, A. et al. (2017). Attention Is All You Need. https://arxiv.org/abs/1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani"],
        year="2017",
        doi="10.48550/arXiv.1706.03762",
        url="https://arxiv.org/abs/1706.03762",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    cand = SourceCandidate(
        source_name="arxiv",
        found=True,
        doi="10.48550/arXiv.1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani"],
        year="2017",
        confidence=0.98,
    )
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["arxiv"],
        sources_succeeded=["arxiv"],
        url_status="alive",
        url_status_code=200,
    )
    verdict = checker.check(cit, source)
    report = AnalysisReport(
        essay_id=1,
        filename="test.pdf",
        num_pages=5,
        num_citations=1,
        verdicts=[verdict],
    )
    payload = report.to_dict()
    assert payload["verdicts"][0]["url_status"] == "alive"
    assert payload["verdicts"][0]["url_status_code"] == 200
    assert payload["verdicts"][0]["features"]["url_status"] == "alive"
    assert payload["verdicts"][0]["features"]["url_status_code"] == 200
    assert payload["verdicts"][0]["features"]["checked_url"] == "https://arxiv.org/abs/1706.03762"

    rehydrated = AnalysisReport.from_dict(payload)
    assert rehydrated.verdicts[0].matched_source is not None
    assert rehydrated.verdicts[0].matched_source.url_status == "alive"
    assert rehydrated.verdicts[0].matched_source.url_status_code == 200


def test_alive_url_no_scholarly_candidate_returns_url_resource() -> None:
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw="[6] CNCF (2023) Microservices. Available at: https://glossary.cncf.io/microservices/",
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results for 'Microservices'",
            "openalex": "OpenAlex: no results for 'Microservices'",
        },
        url_status="alive",
        url_status_code=200,
    )
    outcome = rules.apply(
        MatchFeatures(),
        source,
        citation_url="https://glossary.cncf.io/microservices/",
        citation_authors=["CNCF"],
        citation_year="2023",
        citation_raw=source.citation_raw,
    )
    assert outcome.label == ValidationLabel.RESOURCE
    assert "R-URL-RESOURCE" in outcome.triggered_rules


def test_neuro_symbolic_checker_classifies_official_docs_as_resource() -> None:
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )
    cit = Citation(
        raw_text="[16] Docker Inc. (2024) Docker documentation. Available at: https://docs.docker.com/ (Accessed: 17 October 2024).",
        title="Docker documentation",
        authors=["Docker Inc."],
        year="2024",
        url="https://docs.docker.com/",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
    )
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
    )
    verdict = checker.check(cit, source)
    assert verdict.label == ValidationLabel.RESOURCE
    assert "R-WEB-RESOURCE" in verdict.triggered_rules


