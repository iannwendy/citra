"""Regression tests for E2E & Batch Audit Batch P1 fixes (BUG-02, BUG-03, BUG-08, BUG-09, BUG-13, BUG-14, BUG-15)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import patch

import httpx
import pytest

from integrity_checker.extraction.base import Document
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


@pytest.mark.asyncio
async def test_bug02_wayback_retry_cache_and_transient_error_gives_unchecked() -> None:
    """BUG-02: Wayback retries transient timeouts, caches snapshots, and returns UNCHECKED when Archive.org itself fails."""
    if hasattr(LinkValidator, "clear_wayback_cache"):
        LinkValidator.clear_wayback_cache()

    wb_calls = {"archived": 0, "transient_fail": 0, "confirmed_dead": 0}

    async def mock_head(self, url, **kwargs):
        return httpx.Response(404, request=httpx.Request("HEAD", url))

    @asynccontextmanager
    async def mock_stream(self, method, url, **kwargs):
        yield httpx.Response(404, request=httpx.Request(method, url))

    async def mock_get(self, url, **kwargs):
        params = kwargs.get("params") or {}
        target = params.get("url", "")
        if "iworld.com.vn" in target:
            wb_calls["archived"] += 1
            if wb_calls["archived"] == 1:
                raise httpx.TimeoutException("Wayback transient timeout")
            return httpx.Response(
                200,
                json={
                    "archived_snapshots": {
                        "closest": {
                            "available": True,
                            "url": "https://web.archive.org/web/20260114114246/https://www.iworld.com.vn/siem/",
                            "timestamp": "20260114114246",
                            "status": "200",
                        }
                    }
                },
                request=httpx.Request("GET", url),
            )
        if "archive-down.vn" in target:
            wb_calls["transient_fail"] += 1
            raise httpx.TimeoutException("Wayback completely unreachable")
        wb_calls["confirmed_dead"] += 1
        if "cdx" in url:
            return httpx.Response(200, json=[], request=httpx.Request("GET", url))
        return httpx.Response(
            200,
            json={"archived_snapshots": {}},
            request=httpx.Request("GET", url),
        )

    validator = LinkValidator(timeout=2.0, enable_wayback_fallback=True)
    with (
        patch.object(httpx.AsyncClient, "head", mock_head),
        patch.object(httpx.AsyncClient, "stream", mock_stream),
        patch.object(httpx.AsyncClient, "get", mock_get),
    ):
        # 1. Transient timeout on attempt 1 -> retry succeeds -> ARCHIVED_ALIVE
        res1 = await validator.validate_url("https://www.iworld.com.vn/siem/")
        assert res1.status == LinkStatus.ARCHIVED_ALIVE
        assert res1.archive_url == "https://web.archive.org/web/20260114114246/https://www.iworld.com.vn/siem/"
        calls_after_first = wb_calls["archived"]
        assert calls_after_first == 2

        # 2. Second lookup hits session cache -> zero additional archive.org calls
        res1_cached = await validator.validate_url("https://www.iworld.com.vn/siem/")
        assert res1_cached.status == LinkStatus.ARCHIVED_ALIVE
        assert wb_calls["archived"] == calls_after_first

        # 3. Archive.org itself times out on all retries -> UNCHECKED (never false DEAD_LINK)
        res_transient = await validator.validate_url("https://www.archive-down.vn/article/")
        assert res_transient.status == LinkStatus.UNCHECKED

        # 4. Archive.org returns 200 empty -> confirmed DEAD_LINK
        res_dead = await validator.validate_url("https://www.real-domain.org/truly-missing-404")
        assert res_dead.status == LinkStatus.DEAD_LINK


def test_bug03_numbered_wrapped_bare_url_and_check12_fake_dead_scholarly_guards() -> None:
    """BUG-03: Numbered/wrapped bare URLs route as web resources; Check 1/2 respect fake/dead/Wayback/scholarly URLs."""
    wrapped_bare_url = Citation(
        raw_text="[9] https://ntshanoi.com.vn/giai-phap-siem.html#:~:text=SIEM%20l%C3%A0%20g%C3%AC... vi%E1%\nBA%BFt%20t%E1%BA%AFt",
        url="https://ntshanoi.com.vn/giai-phap-siem.html",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
    )
    assert RetrievalOrchestrator.is_web_or_legal_resource(wrapped_bare_url) is True

    scholarly_bare_url = Citation(
        raw_text="[1] https://aclanthology.org/N19-1423/",
        url="https://aclanthology.org/N19-1423/",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
    )
    assert RetrievalOrchestrator.is_web_or_legal_resource(scholarly_bare_url) is False

    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # Check 2 pattern with a FAKE domain must NOT become RESOURCE
    fake_api_doc = Citation(
        raw_text="Google for Developers. (2024). REST API Documentation. https://example.com/api-docs",
        title="REST API Documentation",
        authors=["Google"],
        year="2024",
        url="https://example.com/api-docs",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    v_fake = checker.check(
        fake_api_doc,
        SourceResult(citation_raw=fake_api_doc.raw_text, url_status="fake_domain"),
    )
    assert v_fake.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-FAKE-URL" in v_fake.triggered_rules

    # Check 2 pattern with a DEAD link must NOT become RESOURCE
    dead_api_doc = Citation(
        raw_text="Google for Developers. (2024). REST API Documentation. https://developers.real-portal.org/missing",
        title="REST API Documentation",
        authors=["Google"],
        year="2024",
        url="https://developers.real-portal.org/missing",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    v_dead = checker.check(
        dead_api_doc,
        SourceResult(
            citation_raw=dead_api_doc.raw_text,
            url_status="dead_link",
            url_status_code=404,
        ),
    )
    assert v_dead.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-DEAD-URL" in v_dead.triggered_rules

    # Check 1 bare URL recovered via Wayback must preserve archive_url and R-WAYBACK-ARCHIVED
    archived_bare = Citation(
        raw_text="https://websitehcm.com/recurrent-neural-network-rnn-trong-tensorflow/",
        url="https://websitehcm.com/recurrent-neural-network-rnn-trong-tensorflow/",
        citation_type=CitationType.REFERENCE_LIST,
    )
    v_wb = checker.check(
        archived_bare,
        SourceResult(
            citation_raw=archived_bare.raw_text,
            url_status="archived_alive",
            archive_url="https://web.archive.org/web/20240916024700/https://websitehcm.com/recurrent-neural-network-rnn-trong-tensorflow/",
        ),
    )
    assert v_wb.label == ValidationLabel.RESOURCE
    assert "R-WAYBACK-ARCHIVED" in v_wb.triggered_rules
    assert v_wb.archive_url is not None and "web.archive.org" in v_wb.archive_url

    # Bare scholarly paper URL must NOT be forced to RESOURCE by Check 1
    bare_acl_paper = Citation(
        raw_text="https://aclanthology.org/N19-1423/",
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        url="https://aclanthology.org/N19-1423/",
        citation_type=CitationType.REFERENCE_LIST,
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.18653/v1/N19-1423",
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors=["Jacob Devlin", "Ming-Wei Chang"],
        year="2019",
        confidence=0.95,
    )
    v_acl = checker.check(
        bare_acl_paper,
        SourceResult(
            citation_raw=bare_acl_paper.raw_text,
            candidates=[cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
            url_status="alive",
            url_status_code=200,
        ),
    )
    assert v_acl.label == ValidationLabel.VERIFIED


def test_bug08_verified_outcomes_never_carry_mismatched_fields_or_missing_local_db_doi_mismatch() -> None:
    """BUG-08: VERIFIED outcomes always have mismatched_fields=[]; missing local_db DOI is not a conflict, real conflict is METADATA_ERROR."""
    rules = SymbolicRules()

    # Case 1: local_db record has doi=None while citation has authentic DOI -> VERIFIED with mismatched_fields=[]
    cand_no_doi = SourceCandidate(
        source_name="local_db",
        found=True,
        doi=None,
        title="DeepGCNs: Can GCNs Go as Deep as CNNs?",
        authors=["Guohao Li", "Matthias Muller", "Ali Thabet", "Bernard Ghanem"],
        year="2019",
        confidence=0.92,
    )
    src_no_doi = SourceResult(
        citation_raw="Li, G. et al. (2019). DeepGCNs. DOI: 10.1109/ICCV.2019.00936",
        candidates=[cand_no_doi],
        sources_queried=["local_db"],
        sources_succeeded=["local_db"],
    )
    feat_no_doi = MatchFeatures(
        title_sim_fuzzy=0.98,
        title_sim_semantic=0.98,
        author_jaccard=0.90,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
    )
    out1 = rules.apply(
        feat_no_doi,
        src_no_doi,
        citation_doi="10.1109/ICCV.2019.00936",
        citation_authors=["Guohao Li"],
        used_local_db=True,
    )
    assert out1.label == ValidationLabel.VERIFIED
    assert out1.mismatched_fields == []
    assert "differs from canonical record" not in out1.reasoning

    # Case 2: local_db record has a DIFFERENT real DOI -> must NOT be VERIFIED, must be METADATA_ERROR (['doi'])
    cand_wrong_doi = SourceCandidate(
        source_name="local_db",
        found=True,
        doi="10.18653/v1/P19-1999",
        title="DeepGCNs: Can GCNs Go as Deep as CNNs?",
        authors=["Guohao Li", "Matthias Muller"],
        year="2019",
        confidence=0.92,
    )
    src_wrong_doi = SourceResult(
        citation_raw="Li, G. et al. (2019). DeepGCNs. DOI: 10.1109/ICCV.2019.00936",
        candidates=[cand_wrong_doi],
        sources_queried=["local_db"],
        sources_succeeded=["local_db"],
    )
    out2 = rules.apply(
        feat_no_doi,
        src_wrong_doi,
        citation_doi="10.1109/ICCV.2019.00936",
        citation_authors=["Guohao Li"],
        used_local_db=True,
    )
    assert out2.label == ValidationLabel.METADATA_ERROR
    assert "doi" in out2.mismatched_fields

    # Case 3: _rule_local_db_good_match returning VERIFIED must have mismatched_fields=[]
    feat_good = MatchFeatures(
        title_sim_fuzzy=0.96,
        title_sim_semantic=0.96,
        author_jaccard=0.60,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
    )
    out3 = rules.apply(
        feat_good,
        src_no_doi,
        citation_doi="10.1109/ICCV.2019.00936",
        citation_authors=["Guohao Li"],
        used_local_db=True,
    )
    assert out3.label == ValidationLabel.VERIFIED
    assert out3.mismatched_fields == []

    # Case 4: Rule 1c (R-WELL-LINKED-MODERATE) returning VERIFIED must have mismatched_fields=[]
    cand_live = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1145/1234567",
        title="A Study of Distributed Graph Processing Systems",
        authors=["Alice Smith", "Bob Jones"],
        year="2020",
        confidence=0.90,
    )
    src_live = SourceResult(
        citation_raw="Smith, A. (2020).",
        candidates=[cand_live],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref", "openalex"],
    )
    feat_mod = MatchFeatures(
        title_sim_fuzzy=0.62,
        title_sim_semantic=0.68,
        author_jaccard=0.50,
        year_distance=0,
        doi_exact_match=True,
        source_consensus=2,
    )
    out4 = rules.apply(
        feat_mod,
        src_live,
        mapping_status=CitationMappingStatus.MATCHED,
        citation_doi="10.1145/1234567",
        citation_authors=["Alice Smith"],
    )
    assert out4.label == ValidationLabel.VERIFIED
    assert "R-WELL-LINKED-MODERATE" in out4.triggered_rules
    assert out4.mismatched_fields == []


def test_bug09_vietnamese_domestic_periodical_abstains_and_semantic_noise_reasoning_accurate() -> None:
    """BUG-09: Vietnamese domestic journals without international DOI abstain to UNRESOLVED; semantic-noise message never prints '0.78 < 0.4'."""
    rules = SymbolicRules()

    cand_noise = SourceCandidate(
        source_name="openalex",
        found=True,
        title="Global minimum corporate tax implementation challenges",
        authors=["John Miller"],
        year="2023",
        confidence=0.50,
    )
    vn_raw = 'Phùng Anh Tuấn (2023), "Các giải pháp thực hiện quy định thuế toàn cầu", Tạp chí Tài chính, tập 1, số 802, 2023.'
    src_vn = SourceResult(
        citation_raw=vn_raw,
        candidates=[cand_noise],
        sources_queried=["crossref", "openalex", "doaj", "openaire_hal"],
        sources_succeeded=["openalex"],
    )
    feat_noise = MatchFeatures(
        title_sim_fuzzy=0.31,
        title_sim_semantic=0.77,
        author_jaccard=0.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
    )
    out_vn = rules.apply(
        feat_noise,
        src_vn,
        citation_authors=["Phùng Anh Tuấn"],
        citation_year="2023",
        citation_raw=vn_raw,
    )
    assert out_vn.label == ValidationLabel.UNRESOLVED
    assert "R-UNINDEXED-BOOK-OR-SOURCE" in out_vn.triggered_rules

    # English fabricated journal article hitting is_semantic_only_noise -> SUSPECTED_HALLUCINATION with honest reasoning
    en_raw = "Carter, B. (2023). Quantum neural taxation in decentralized ledgers. International Journal of Fictional Finance, 12(4), 10-25."
    src_en = SourceResult(
        citation_raw=en_raw,
        candidates=[cand_noise],
        sources_queried=["crossref", "openalex", "doaj", "dblp"],
        sources_succeeded=["openalex"],
    )
    out_en = rules.apply(
        feat_noise,
        src_en,
        citation_authors=["Carter, B."],
        citation_year="2023",
        citation_raw=en_raw,
    )
    assert out_en.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "0.77 < 0.4" not in out_en.reasoning
    assert "fuzzy_title_sim=0.31" in out_en.reasoning


def test_bug13_comma_separated_ieee_brackets_extracted_and_figure_captions_ignored() -> None:
    """BUG-13: '[3], [4]' in prose is extracted while 2D array '[[37, 95], [449, 95]]' and 'Hình 2.1 ... Rogue (1980)' are ignored."""
    from integrity_checker.extraction.base import Page

    text = (
        "Items appear frequently in a database[3], [4]. Prior algorithms [1], [2] also apply.\n"
        "Bounding boxes are stored as [[37, 95], [449, 95]] in pixel space.\n"
        "Hình 2.1 Gameplay của Rogue (1980)\n"
        "Hình 2.1 Gameplay của Rogue (1980) ........................ 15\n"
    )
    doc = Document(file_path="test.pdf", num_pages=1, pages=[Page(page_num=1, text=text)])
    extractor = CitationExtractor(preserve_occurrences=True)
    cits = extractor.extract_from_document(doc)
    raws = [c.raw_text.strip() for c in cits]
    assert "[3]" in raws
    assert "[4]" in raws
    assert "[1]" in raws
    assert "[2]" in raws
    assert not any("37" in r or "449" in r for r in raws)
    assert not any("Rogue" in r for r in raws)


def test_bug14_grobid_merge_year_conflict_and_acm_comma_separated_journal() -> None:
    """BUG-14: _merge_reference_lists blocks cross-entry overwrite on year/index conflict; ReferenceListParser splits mixed Vancouver & parses comma-ACM."""
    parser = DocumentParser()
    g4 = Citation(
        raw_text='[4] Xiao, Y., Wang, J., & Lee, S. (2023). Hallucination detection in large language models using semantic consistency. Journal of AI Safety, 2023.',
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
        authors=["Xiao, Y.", "Wang, J.", "Lee, S."],
        year="2023",
        title="Hallucination detection in large language models using semantic consistency",
        venue="Journal of AI Safety",
        numeric_index=4,
    )
    g5 = Citation(
        raw_text="Xiao Y. (2022) Hallucination in neural networks. Neural Computing Review. DOI: 10.1234/ncr.2022.0456",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.VANCOUVER,
        authors=["Xiao, Y."],
        year="2022",
        title="Hallucination in neural networks",
        venue="Neural Computing Review",
        doi="10.1234/ncr.2022.0456",
        numeric_index=None,
    )
    glued_donor = Citation(
        raw_text=(
            '[4] Xiao, Y., Wang, J., & Lee, S. (2023). "Hallucination detection in large language models," '
            "Journal of AI Safety, 2023. Xiao Y. Hallucination in neural networks. Neural Computing Review. "
            "2022;45:234-256. https://doi.org/10.1234/ncr.2022.0456"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.IEEE,
        authors=["Xiao, Y.", "Wang, J.", "Lee, S."],
        year="2023",
        title="Hallucination detection in large language models",
        doi="10.1234/ncr.2022.0456",
        numeric_index=4,
    )
    merged = parser._merge_reference_lists([g4, g5], [glued_donor])
    assert len(merged) == 2
    assert merged[0].numeric_index == 4
    assert merged[1].numeric_index != 4
    assert len(merged[1].authors) == 1
    assert "Wang" not in " ".join(str(a) for a in merged[1].authors)

    # ReferenceListParser splits IEEE [4] followed by unnumbered Vancouver entry
    rp = ReferenceListParser()
    mixed_text = (
        "References\n"
        '[4] Xiao, Y., Wang, J., & Lee, S. (2023). "Hallucination detection in large language models using semantic consistency," Journal of AI Safety, vol. 15, pp. 112-128, 2023.\n'
        "Xiao Y. Hallucination in neural networks. Neural Computing Review. 2022;45:234-256. https://doi.org/10.1234/ncr.2022.0456\n"
        '[6] Brown, T. (2020). "Language models are few-shot learners," NeurIPS, 2020.'
    )
    split_entries = rp._split_entries(mixed_text)
    assert len(split_entries) == 3

    # Comma-separated IEEE/ACM journal entry (041_huit Ref #6)
    s_acm = (
        "[6] Akinsola, Jide E. T, Awodele, Oludele, Idowu, Sunday A, "
        "SQL Injection Attacks Predictive Analytics Using Supervised Machine Learning Techniques, "
        "International Journal of Computer Applications (0975 – 8887) Volume 176 – No. 28, June 2020"
    )
    parsed_acm = rp._parse_entry(s_acm, page_num=1, order_index=5)
    assert parsed_acm is not None
    assert parsed_acm.title == "SQL Injection Attacks Predictive Analytics Using Supervised Machine Learning Techniques"
    assert len(parsed_acm.authors) == 3
    assert parsed_acm.year == "2020"


def test_bug15_linker_pass3_year_mismatch_ambiguous_and_compound_missing_priority() -> None:
    """BUG-15: Pass 3 flags IN_TEXT_MISMATCH on year discrepancy, AMBIGUOUS_MAPPING on ties, and preserves missing_reference on compound citations."""
    linker = CitationLinker()

    # 1. Year discrepancy (Bloem 2024 vs 2021) -> IN_TEXT_MISMATCH, NOT UNCITED_REFERENCE
    body1 = [
        Citation(
            raw_text="Bloem et al. (2024)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )
    ]
    refs1 = [
        Citation(
            raw_text="Bloem, B. R., Okun, M. S., & Klein, C. (2021). Parkinson's disease. The Lancet, 397(10291), 2284-2303.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Bloem, B. R.", "Okun, M. S.", "Klein, C."],
            year="2021",
            title="Parkinson's disease",
            reference_id="ref-0000",
        )
    ]
    res1 = linker.link(body1, refs1)
    assert len(res1.links) == 1
    assert res1.links[0].reference_id == "ref-0000"
    assert res1.links[0].status == CitationMappingStatus.IN_TEXT_MISMATCH
    assert body1[0].mapping_status == CitationMappingStatus.IN_TEXT_MISMATCH.value
    assert res1.unmatched_reference_ids == []
    assert refs1[0].mapping_status == CitationMappingStatus.MATCHED.value

    # 2. Ambiguous tie: (Nguyen, 2021) against Nguyen (2020) and Nguyen (2022)
    body2 = [
        Citation(
            raw_text="(Nguyen, 2021)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )
    ]
    refs2 = [
        Citation(
            raw_text="Nguyen, A. (2020). Paper One.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Nguyen, A."],
            year="2020",
            title="Paper One",
            reference_id="ref-0000",
        ),
        Citation(
            raw_text="Nguyen, A. (2022). Paper Two.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Nguyen, A."],
            year="2022",
            title="Paper Two",
            reference_id="ref-0001",
        ),
    ]
    res2 = linker.link(body2, refs2)
    assert len(res2.links) == 1
    assert res2.links[0].status == CitationMappingStatus.AMBIGUOUS_MAPPING
    assert body2[0].mapping_status == CitationMappingStatus.AMBIGUOUS_MAPPING.value

    # 3. Compound citation (Lee et al., 2024; Mandarić et al., 2022) where Mandarić is missing
    body3 = [
        Citation(
            raw_text="(Lee et al., 2024; Mandarić et al., 2022)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
            reference_id="occ-0001",
        )
    ]
    refs3 = [
        Citation(
            raw_text="Lee, S., Kim, J., & Park, H. (2024). Fitness app engagement.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Lee, S.", "Kim, J.", "Park, H."],
            year="2024",
            title="Fitness app engagement",
            reference_id="ref-0000",
        )
    ]
    res3 = linker.link(body3, refs3)
    assert len(res3.links) == 2
    assert {lnk.status for lnk in res3.links} == {
        CitationMappingStatus.MATCHED,
        CitationMappingStatus.MISSING_REFERENCE,
    }
    assert body3[0].mapping_status == CitationMappingStatus.MISSING_REFERENCE.value

    # 4. Reference-side verdict linked via IN_TEXT_MISMATCH must count as MATCHED (not UNRESOLVED)
    from integrity_checker.models.validation import CitationVerdict
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    ref_links_resolved = [
        lnk
        for lnk in res1.links
        if lnk.reference_id == "ref-0000"
        and getattr(lnk.status, "value", lnk.status)
        in ("matched", "in_text_mismatch", "ambiguous_mapping")
    ]
    assert len(ref_links_resolved) == 1
    verdict_ref1 = CitationVerdict(
        citation=refs1[0],
        label=ValidationLabel.VERIFIED,
        confidence=0.98,
        reasoning="Verified",
        mapping_status=CitationMappingStatus.MATCHED,
    )
    summary1 = IntegrityPipeline._build_linking_summary([verdict_ref1], res1)
    assert summary1["matched"] == 1
    assert summary1["in_text_mismatch"] == 1
    assert summary1["unresolved"] == 0

