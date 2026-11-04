"""Regression tests for E2E Audit Batch P2 fixes.

Covers:
- BUG-04: Atomic per-loop time-slot reservation in DBLPClient & ArxivClient
- BUG-05: URL line-wrap/bracket cleaning & expanded HEAD -> GET status fallback
- BUG-10: APA 7th ellipsis (... & Z) detection, GROBID merge ellipsis preservation & swapped East Asian initials
- BUG-11: VenueNormalizer (PRL ambiguity, NLP/AI venues, ISO-4, running header strip, conference containment) & venue mismatch flag
- BUG-12: Crossref proceedings-article event/container year priority, ("hu", "2024"), and accurate known-paper reasoning
- BUG-16: StyleProfile counts, CIS uncited RESOURCE fairness, multi-style format consistency, invalid DOI rules & verdict JSON fields
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.style_detector import StyleProfile as DetectorStyleProfile
from integrity_checker.linking.citation_linker import LinkingResult
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.author_matcher import _has_et_al_indicator, author_match_score
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.venue_normalizer import VenueNormalizer
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, MatchFeatures, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import (
    IntegrityPipeline,
    _serialize_verdict_for_json,
)
from integrity_checker.retrieval import arxiv_client, dblp_client
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.dblp_client import DBLPClient
from integrity_checker.retrieval.link_validator import (
    LinkStatus,
    LinkValidator,
)
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


@pytest.mark.asyncio
async def test_bug04_dblp_and_arxiv_atomic_slot_reservation() -> None:
    """BUG-04: Concurrent DBLP and arXiv requests must reserve staggered time slots atomically."""
    # 1. DBLP concurrent spacing check (with cookie present so challenge lock is bypassed)
    dblp_times: list[float] = []

    async def fake_dblp_get(self_client: httpx.AsyncClient, url: str, **kwargs):
        dblp_times.append(time.monotonic())
        self_client.cookies.set("anubis", "ok")
        req = httpx.Request("GET", url)
        return httpx.Response(
            200,
            json={"result": {"hits": {"hit": []}}},
            request=req,
        )

    dblp = DBLPClient(timeout=3.0, max_retries=1)
    # Pre-seed loop cookie so all 3 coroutines hit the regular rate-limited path simultaneously
    loop_id = id(asyncio.get_running_loop())
    if hasattr(dblp_client, "_get_dblp_cookies"):
        dblp_client._get_dblp_cookies().set("anubis", "ok")
    else:
        dblp_client._SHARED_DBLP_COOKIES.set("anubis", "ok")
    if isinstance(getattr(dblp_client, "_LAST_DBLP_REQ_AT", None), dict):
        dblp_client._LAST_DBLP_REQ_AT[loop_id] = 0.0
    else:
        dblp_client._LAST_DBLP_REQ_AT = 0.0

    with patch.object(httpx.AsyncClient, "get", new=fake_dblp_get):
        await asyncio.gather(
            dblp._fetch_json_with_retry({"q": "attention 1", "h": 1, "format": "json"}),
            dblp._fetch_json_with_retry({"q": "attention 2", "h": 1, "format": "json"}),
            dblp._fetch_json_with_retry({"q": "attention 3", "h": 1, "format": "json"}),
        )

    assert len(dblp_times) == 3
    dblp_sorted = sorted(dblp_times)
    assert dblp_sorted[1] - dblp_sorted[0] >= 0.50
    assert dblp_sorted[2] - dblp_sorted[1] >= 0.50

    # 2. arXiv concurrent spacing & Semaphore(2) check
    arxiv_times: list[float] = []

    async def fake_arxiv_get(self_client: httpx.AsyncClient, url: str, **kwargs):
        arxiv_times.append(time.monotonic())
        req = httpx.Request("GET", url)
        return httpx.Response(
            200,
            text='<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
            request=req,
        )

    arx = ArxivClient(timeout=3.0, max_retries=1)
    if isinstance(getattr(arxiv_client, "_LAST_ARXIV_REQ_AT", None), dict):
        arxiv_client._LAST_ARXIV_REQ_AT[loop_id] = 0.0

    with patch.object(httpx.AsyncClient, "get", new=fake_arxiv_get):
        await asyncio.gather(
            arx._fetch_xml_with_retry({"id_list": "1706.03762", "max_results": 1}),
            arx._fetch_xml_with_retry({"id_list": "1810.04805", "max_results": 1}),
            arx._fetch_xml_with_retry({"id_list": "2005.14165", "max_results": 1}),
        )

    assert len(arxiv_times) == 3
    arxiv_sorted = sorted(arxiv_times)
    assert arxiv_sorted[1] - arxiv_sorted[0] >= 0.80
    assert arxiv_sorted[2] - arxiv_sorted[1] >= 0.80


@pytest.mark.asyncio
async def test_bug05_clean_wrapped_urls_brackets_and_head_to_get_fallback() -> None:
    """BUG-05: Clean trailing ]/>, repair PDF line-wrapped URLs, and fallback HEAD -> GET on 400/500/501/503."""
    from integrity_checker.retrieval.link_validator import clean_extracted_url

    assert clean_extracted_url("<https://owasp.org/www-project-top-ten/>.") == "https://owasp.org/www-project-top-ten/"
    assert clean_extracted_url("[https://docs.python.org/3/library/asyncio.html],") == "https://docs.python.org/3/library/asyncio.html"
    assert (
        clean_extracted_url("Retrieved from https:\n//papers.nips.cc/paper/5656-hidden-technical-debt.pdf")
        == "https://papers.nips.cc/paper/5656-hidden-technical-debt.pdf"
    )
    assert (
        clean_extracted_url("https://ntshanoi.com.vn/bai-vi%E1%\nBA%BFt-siem.html")
        == "https://ntshanoi.com.vn/bai-vi%E1%BA%BFt-siem.html"
    )

    validator = LinkValidator(timeout=3.0, enable_wayback_fallback=False)

    class _DummyStreamCtx:
        def __init__(self, url: str) -> None:
            self._resp = httpx.Response(200, request=httpx.Request("GET", url))

        async def __aenter__(self) -> httpx.Response:
            return self._resp

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

    for head_code in (400, 406, 500, 501, 503):
        test_url = f"https://portal.example-gov.vn/doc-{head_code}"
        with (
            patch.object(
                httpx.AsyncClient,
                "head",
                new=AsyncMock(
                    return_value=httpx.Response(head_code, request=httpx.Request("HEAD", test_url))
                ),
            ),
            patch.object(
                httpx.AsyncClient,
                "stream",
                side_effect=lambda method, u, **kw: _DummyStreamCtx(u),
            ),
        ):
            res = await validator.validate_url(f"[{test_url}]")
        assert res.url == test_url
        assert res.status == LinkStatus.ALIVE
        assert res.status_code == 200


def test_bug10_apa7_ellipsis_and_swapped_east_asian_coauthors() -> None:
    """BUG-10: APA 7th ellipsis (... & Z), GROBID merge ellipsis preservation, and swapped East Asian initials."""
    assert _has_et_al_indicator("Kiela, D., Bartolo, M., Nie, Y., ... & Williams, A.") is True
    assert _has_et_al_indicator("Kiela, D., Bartolo, M., Nie, Y., … & Williams, A.") is True

    # GROBID stripped '...' from raw_text, while regex donor preserved '... & Williams, A.'
    grobid_target = Citation(
        raw_text="Kiela, D., Bartolo, M., Nie, Y., Kaushik, D., Geiger, A., Wu, Z., Williams, A. (2021). Dynabench: Rethinking Benchmarking in NLP.",
        title="Dynabench: Rethinking Benchmarking in NLP",
        authors=[
            "Kiela, D.",
            "Bartolo, M.",
            "Nie, Y.",
            "Kaushik, D.",
            "Geiger, A.",
            "Wu, Z.",
            "Williams, A.",
        ],
        year="2021",
        citation_type=CitationType.REFERENCE_LIST,
        source="grobid",
    )
    regex_donor = Citation(
        raw_text="Kiela, D., Bartolo, M., Nie, Y., Kaushik, D., Geiger, A., Wu, Z., ... & Williams, A. (2021). Dynabench: Rethinking Benchmarking in NLP.",
        title="Dynabench: Rethinking Benchmarking in NLP",
        authors=["Kiela, D.", "Bartolo, M.", "Nie, Y."],
        year="2021",
        citation_type=CitationType.REFERENCE_LIST,
        source="regex",
    )
    merged_refs = DocumentParser()._merge_reference_lists([grobid_target], [regex_donor])
    assert len(merged_refs) == 1
    assert FeatureCalculator._citation_has_et_al(merged_refs[0], merged_refs[0].authors) is True

    # Real 19-author Dynabench candidate vs valid 7-author APA 7th ellipsis citation -> 1.0
    dynabench_authors = [
        "Douwe Kiela", "Max Bartolo", "Yixin Nie", "Divyansh Kaushik", "Atticus Geiger",
        "Zhengxuan Wu", "Bertie Vidgen", "Grusha Prasad", "Amanpreet Singh", "Pratik Ringshia",
        "Zhiyi Ma", "Tristan Thrush", "Sebastian Riedel", "Zeerak Waseem", "Pontus Stenetorp",
        "Robin Jia", "Mohit Bansal", "Christopher Potts", "Adina Williams",
    ]
    assert author_match_score(
        grobid_target.authors,
        dynabench_authors,
        has_et_al=FeatureCalculator._citation_has_et_al(grobid_target, grobid_target.authors),
    ) == 1.0

    # Mutual East Asian GivenName, SurnameInitial vs Surname, GivenInitial across >=2 co-authors
    cited_cn = ["Renxian, Z.", "Zhenhua, T.", "Xiao, H.", "Jiang, W."]
    cand_cn = ["Zhang, R.", "Tan, Z.", "Huang, X.", "Wang, J."]
    assert author_match_score(cited_cn, cand_cn) == 1.0


def test_bug11_venue_normalizer_prl_nlp_iso4_headers_and_rules_venue_mismatch() -> None:
    """BUG-11: VenueNormalizer handles PRL ambiguity, NLP/AI conferences, ISO-4, running headers, and SymbolicRules flags clear venue conflict."""
    vn = VenueNormalizer()

    # PRL must match BOTH Pattern Recognition Letters AND Physical Review Letters (no overwritten loss)
    assert vn.similarity("PRL", "Pattern Recognition Letters") == 1.0
    assert vn.similarity("PRL", "Physical Review Letters") == 1.0
    assert vn.similarity("Pattern Recognition Letters", "Physical Review Letters") < 0.5

    # Major NLP/AI conferences & proceedings containment
    assert (
        vn.similarity(
            "Proceedings of NAACL-HLT",
            "Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies",
        )
        >= 0.90
    )
    assert vn.similarity("EMNLP", "Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing") == 1.0
    assert vn.similarity("ICLR", "International Conference on Learning Representations") == 1.0
    assert vn.similarity("Adv. Neural Inf. Process. Syst.", "Advances in Neural Information Processing Systems") == 1.0

    # Strip leaked uppercase Vietnamese university running header
    assert vn.similarity("IEEE Access TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN", "IEEE Access") == 1.0

    # Existing journal distinction contract must still hold: Pattern Recognition vs Pattern Recognition Letters (~0.667)
    assert vn.similarity("Pattern Recognition Letters", "Pattern Recognition") == pytest.approx(0.667, abs=0.02)

    # SymbolicRules must include 'venue' in mismatched_fields on clear journal vs conference conflict (hard_02 #5)
    rules = SymbolicRules()
    cand_cvpr = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1109/cvpr.2016.90",
        title="Deep Residual Learning for Image Recognition",
        authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
        year="2016",
        venue="Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
        confidence=0.95,
    )
    src_cvpr = SourceResult(
        citation_raw="He, K., Zhang, X., & Ren, S. (2018). Deep residual learning for image recognition. Journal of Machine Learning Research. DOI: 10.1109/CVPR.2016.90",
        candidates=[cand_cvpr],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref", "openalex"],
    )
    feat_cvpr = MatchFeatures(
        title_sim_fuzzy=1.0,
        title_sim_semantic=1.0,
        author_jaccard=1.0,
        year_distance=2,
        doi_exact_match=True,
        source_consensus=2,
        venue_sim=vn.similarity("Journal of Machine Learning Research", cand_cvpr.venue),
    )
    out = rules.apply(
        feat_cvpr,
        src_cvpr,
        citation_doi="10.1109/CVPR.2016.90",
        citation_authors=["He, K.", "Zhang, X.", "Ren, S."],
        citation_year="2018",
        citation_venue="Journal of Machine Learning Research",
    )
    assert out.label == ValidationLabel.METADATA_ERROR
    assert "year" in out.mismatched_fields
    assert "venue" in out.mismatched_fields

    # Preprint arXiv -> CVPR must NEVER flag venue mismatch
    out_preprint = rules.apply(
        MatchFeatures(
            title_sim_fuzzy=1.0,
            title_sim_semantic=1.0,
            author_jaccard=1.0,
            year_distance=1,
            doi_exact_match=True,
            source_consensus=2,
            venue_sim=0.0,
        ),
        src_cvpr,
        citation_doi="10.48550/arXiv.1512.03385",
        citation_authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
        citation_year="2015",
        citation_venue="arXiv preprint arXiv:1512.03385",
    )
    assert out_preprint.label == ValidationLabel.VERIFIED
    assert "venue" not in out_preprint.mismatched_fields


def test_bug12_crossref_proceedings_event_year_hu2024_and_tier0_reasoning() -> None:
    """BUG-12: Crossref proceedings-article uses event.start / container year before retroactive published-online; Hu 2024 in _KNOWN_PAPERS; no false 'APIs failed'."""
    # 1. Crossref ICWSM 2013 digitized in 2021 (event.start present)
    msg_event = {
        "DOI": "10.1609/icwsm.v7i1.14432",
        "type": "proceedings-article",
        "title": ["Predicting Depression via Social Media"],
        "author": [{"given": "Munmun", "family": "De Choudhury"}],
        "published-online": {"date-parts": [[2021, 8, 3]]},
        "issued": {"date-parts": [[2021, 8, 3]]},
        "event": {
            "name": "Seventh International AAAI Conference on Weblogs and Social Media",
            "start": {"date-parts": [[2013, 7, 8]]},
        },
        "container-title": ["Proceedings of the International AAAI Conference on Web and Social Media"],
    }
    cand1 = CrossrefClient._message_to_candidate(msg_event)
    assert cand1.year == "2013"

    # 2. Crossref proceedings-article with conference year in container-title when event is missing
    msg_container = {
        "DOI": "10.1609/icwsm.v7i1.14432",
        "type": "proceedings-article",
        "title": ["Predicting Depression via Social Media"],
        "published-online": {"date-parts": [[2021, 8, 3]]},
        "container-title": [
            "Proceedings of the Seventh International AAAI Conference on Weblogs and Social Media, ICWSM 2013"
        ],
    }
    cand2 = CrossrefClient._message_to_candidate(msg_container)
    assert cand2.year == "2013"

    # 3. Hu et al. (2024) MiniCPM in _KNOWN_PAPERS
    cit_hu = Citation(
        raw_text="Hu, S., Tu, Y., Han, X., et al. (2024). MiniCPM: Unveiling the Potential of Small Language Models with Scalable Training Strategies.",
        title="MiniCPM: Unveiling the Potential of Small Language Models with Scalable Training Strategies",
        authors=["Hu, S.", "Tu, Y.", "Han, X."],
        year="2024",
    )
    is_known, info = RetrievalOrchestrator.is_known_paper(cit_hu)
    assert is_known is True
    assert info is not None and "MiniCPM" in info["title"]

    # 4. NeuroSymbolicChecker does not claim "APIs failed" when sources_failed is empty
    checker = NeuroSymbolicChecker(enable_calibration=False, enable_content_alignment=False)
    v_known = checker.check(
        cit_hu,
        SourceResult(
            citation_raw=cit_hu.raw_text,
            sources_queried=["known_papers"],
            sources_succeeded=["known_papers"],
            sources_failed={},
        ),
    )
    assert v_known.label == ValidationLabel.VERIFIED
    assert "APIs failed" not in v_known.reasoning


def test_bug16_style_profile_counts_cis_resource_fairness_and_verdict_json() -> None:
    """BUG-16: StyleProfile counts, CIS uncited RESOURCE fairness & multi-style support, invalid DOI rules, and verdict JSON fields."""
    # 1. StyleProfile bidirectional sync & IntegrityPipeline._run_style_detection non-zero counts
    sp = DetectorStyleProfile(label="APA-like", confidence=0.9)
    assert sp.style == "APA-like"

    body_cits = [
        Citation(raw_text="(Vaswani et al., 2017)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
        Citation(raw_text="(Devlin et al., 2019)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
        Citation(raw_text="[1]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE),
    ]
    bib_cits = [
        Citation(raw_text="Vaswani, A. (2017). Attention.", citation_type=CitationType.REFERENCE_LIST, style=CitationStyle.APA),
        Citation(raw_text="Devlin, J. (2019). BERT.", citation_type=CitationType.REFERENCE_LIST, style=CitationStyle.APA),
    ]
    pipeline_sp = IntegrityPipeline.__new__(IntegrityPipeline)._detect_style(body_cits, bib_cits)
    assert pipeline_sp.apa_count >= 2
    assert pipeline_sp.numeric_count >= 1

    # 2. CISCalculator: 6 uncited RESOURCE links with 0 body citations (like 014_tdtu) must NOT get >90 CIS
    calc = CISCalculator()
    uncited_resources = []
    for i in range(6):
        c_res = Citation(
            raw_text=f"https://gamedev-blog.example.org/post-{i}",
            url=f"https://gamedev-blog.example.org/post-{i}",
            citation_type=CitationType.REFERENCE_LIST,
            reference_id=f"ref-000{i}",
        )
        uncited_resources.append(
            CitationVerdict(
                citation=c_res,
                label=ValidationLabel.RESOURCE,
                confidence=0.95,
                mapping_status=CitationMappingStatus.UNCITED_REFERENCE,
            )
        )
    linking_uncited = LinkingResult(
        links=[],
        unmatched_reference_ids=[f"ref-000{i}" for i in range(6)],
    )
    cis_uncited_res = calc.compute(uncited_resources, linking_result=linking_uncited)
    assert cis_uncited_res.components.in_text_bib_consistency < 0.70
    assert cis_uncited_res.score < 70.0

    # 3. CISCalculator: consistent VANCOUVER / ACM / MLA / CHICAGO / HARVARD gets high format_consistency (>= 0.85)
    for style_name in ("VANCOUVER", "ACM", "MLA", "CHICAGO", "HARVARD"):
        fc = CISCalculator._compute_format_consistency(
            DetectorStyleProfile(style=style_name, confidence=0.90), []
        )
        assert fc >= 0.85

    # 4. CISCalculator: R-DOI-CONFLICT and R-CHIMERIC-DOI-MISMATCH penalize identifier_validity
    v_chimera = CitationVerdict(
        citation=Citation(
            raw_text="Fake Paper. DOI: 10.1109/CVPR.2016.90",
            doi="10.1109/CVPR.2016.90",
            citation_type=CitationType.REFERENCE_LIST,
        ),
        label=ValidationLabel.METADATA_ERROR,
        confidence=0.80,
        triggered_rules=["R-DOI-CONFLICT"],
    )
    cis_id = calc.compute([v_chimera])
    assert cis_id.components.identifier_validity == 0.0

    # 5. _serialize_verdict_for_json includes archive_url, is_retracted, matched_sources
    cand_s = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1000/xyz",
        title="Test Paper",
        authors=["Alice Smith"],
        year="2020",
        confidence=0.95,
    )
    src_s = SourceResult(
        citation_raw="Smith (2020)",
        candidates=[cand_s],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
        url_status="archived_alive",
        url_status_code=404,
        archive_url="https://web.archive.org/web/20230101000000/https://example.edu/paper",
        is_retracted=True,
    )
    verdict_s = CitationVerdict(
        citation=Citation(raw_text="Smith (2020)", citation_type=CitationType.REFERENCE_LIST),
        label=ValidationLabel.METADATA_ERROR,
        confidence=0.90,
        matched_source=src_s,
        archive_url="https://web.archive.org/web/20230101000000/https://example.edu/paper",
        is_retracted=True,
    )
    serialized = _serialize_verdict_for_json(verdict_s)
    assert serialized["archive_url"] == "https://web.archive.org/web/20230101000000/https://example.edu/paper"
    assert serialized["is_retracted"] is True
    assert isinstance(serialized["matched_sources"], list) and len(serialized["matched_sources"]) == 1
