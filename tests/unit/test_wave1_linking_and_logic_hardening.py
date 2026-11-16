"""Wave 1–3 Remediation Regression Tests for Track 2:
Layer-1 CitationLinker, SymbolicRules, VNLegalVerifier, Calibration & IntegrityPipeline.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from integrity_checker.config import get_settings
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.document_parser import ParsedDocument
from integrity_checker.extraction.patterns.apa import parse_vn_legal_reference
from integrity_checker.linking import statuses as statuses_mod
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.calibration import HybridMLScorer
from integrity_checker.logic.explanation import ExplanationGenerator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules, _is_fake_url
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    MatchFeatures,
    ValidationLabel,
)
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

# ============================================================================
# 1. AMBIGUOUS_MAPPING Definition Accuracy (statuses.py & explanation.py)
# ============================================================================


class TestAmbiguousMappingDefinitions:
    def test_ambiguous_mapping_definition_describes_one_intext_to_multiple_refs(self) -> None:
        module_doc = (statuses_mod.__doc__ or "").lower()
        enum_doc = (CitationMappingStatus.AMBIGUOUS_MAPPING.__doc__ or "").lower()
        vi_long = ExplanationGenerator.MAPPING_VI_LONG["ambiguous_mapping"].lower()

        # Must NOT have the old inverted definition ("nhiều in-text trỏ cùng một reference entry")
        assert "≥2 in-text occurrences refer cùng 1 reference entry" not in module_doc
        assert "≥2 in-text occurrences refer cùng 1 reference entry" not in enum_doc
        assert "nhiều in-text trỏ cùng một reference" not in vi_long
        # Must describe 1 in-text matching >=2 / multiple reference entries
        assert "nhiều" in vi_long and "reference" in vi_long or "mục" in vi_long


# ============================================================================
# 2. CitationLinker: STYLE_INCONSISTENT, (Smith, 2020) Collision & [1, 99]
# ============================================================================


class TestCitationLinkerHardening:
    def test_emits_style_inconsistent_for_stray_author_year_in_high_conf_ieee_doc(self) -> None:
        bibs = [
            Citation(
                raw_text="[1] J. Smith, \"Deep Neural Models,\" IEEE Access, 2020.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                authors=["Smith, J."],
                year="2020",
                title="Deep Neural Models",
                numeric_index=1,
                reference_id="ref-0001",
            ),
            Citation(
                raw_text="[2] A. Doe, \"Graph Transformers,\" CVPR, 2021.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                authors=["Doe, A."],
                year="2021",
                title="Graph Transformers",
                numeric_index=2,
                reference_id="ref-0002",
            ),
            Citation(
                raw_text="[3] B. Lee, \"Vision Backbones,\" ICCV, 2022.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                authors=["Lee, B."],
                year="2022",
                title="Vision Backbones",
                numeric_index=3,
                reference_id="ref-0003",
            ),
            Citation(
                raw_text="[4] C. Kim, \"Sparse Attention,\" NeurIPS, 2023.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                authors=["Kim, C."],
                year="2023",
                title="Sparse Attention",
                numeric_index=4,
                reference_id="ref-0004",
            ),
        ]
        body = [
            Citation(raw_text="[2]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE, reference_id="occ-1"),
            Citation(raw_text="[3]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE, reference_id="occ-2"),
            Citation(raw_text="[4]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE, reference_id="occ-3"),
            Citation(raw_text="(Smith, 2020)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA, reference_id="occ-4"),
        ]

        res = CitationLinker().link(body, bibs)
        by_occ = {lnk.occurrence_id: lnk for lnk in res.links}
        assert by_occ["occ-1"].status == CitationMappingStatus.MATCHED
        assert by_occ["occ-2"].status == CitationMappingStatus.MATCHED
        assert by_occ["occ-3"].status == CitationMappingStatus.MATCHED
        assert by_occ["occ-4"].status == CitationMappingStatus.STYLE_INCONSISTENT
        assert by_occ["occ-4"].reference_id == "ref-0001"
        assert body[3].mapping_status == CitationMappingStatus.STYLE_INCONSISTENT.value
        assert res.status_counts.get(CitationMappingStatus.STYLE_INCONSISTENT, 0) == 1
        assert "ref-0001" not in res.unmatched_reference_ids

    def test_emits_style_inconsistent_for_stray_numeric_when_dominant_style_apa_passed(self) -> None:
        bibs = [
            Citation(
                raw_text="Smith, J. (2020). Foundations of NLP. Journal of AI.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                title="Foundations of NLP",
                reference_id="ref-0001",
            ),
            Citation(
                raw_text="Doe, A. (2021). Symbolic Reasoning. Artificial Intelligence.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Doe, A."],
                year="2021",
                title="Symbolic Reasoning",
                reference_id="ref-0002",
            ),
        ]
        body = [
            Citation(raw_text="(Smith, 2020)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA, reference_id="occ-1"),
            Citation(raw_text="[2]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE, reference_id="occ-2"),
            Citation(raw_text="[99]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE, reference_id="occ-3"),
        ]

        res = CitationLinker().link(body, bibs, dominant_style="APA-like")
        by_occ = {lnk.occurrence_id: lnk for lnk in res.links}
        assert by_occ["occ-1"].status == CitationMappingStatus.MATCHED
        assert by_occ["occ-2"].status == CitationMappingStatus.STYLE_INCONSISTENT
        assert by_occ["occ-2"].reference_id == "ref-0002"
        assert by_occ["occ-3"].status == CitationMappingStatus.MISSING_REFERENCE
        assert "ref-0002" not in res.unmatched_reference_ids

    def test_unsuffixed_smith_2020_against_2020a_2020b_emits_ambiguous_mapping(self) -> None:
        bibs = [
            Citation(
                raw_text="Smith, J. (2020a). Neural architectures for vision. CVPR.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="a",
                title="Neural architectures for vision",
                reference_id="ref-a",
            ),
            Citation(
                raw_text="Smith, J. (2020b). Contrastive pretraining for audio. ICML.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="b",
                title="Contrastive pretraining for audio",
                reference_id="ref-b",
            ),
        ]
        body = [
            Citation(
                raw_text="(Smith, 2020)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-amb",
            )
        ]

        res = CitationLinker().link(body, bibs)
        assert len(res.links) >= 1
        assert all(lnk.status == CitationMappingStatus.AMBIGUOUS_MAPPING for lnk in res.links)
        assert body[0].mapping_status == CitationMappingStatus.AMBIGUOUS_MAPPING.value
        assert res.unmatched_reference_ids == []

    def test_numeric_cluster_1_99_emits_missing_reference_for_99(self) -> None:
        bibs = [
            Citation(
                raw_text="[1] Vaswani, A. et al. Attention Is All You Need, 2017.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                numeric_index=1,
                reference_id="ref-0001",
            )
        ]
        body = [
            Citation(
                raw_text="[1, 99]",
                citation_type=CitationType.NUMERIC,
                style=CitationStyle.IEEE,
                reference_id="occ-cluster",
            )
        ]

        res = CitationLinker().link(body, bibs)
        statuses = [lnk.status for lnk in res.links]
        assert CitationMappingStatus.MATCHED in statuses
        assert CitationMappingStatus.MISSING_REFERENCE in statuses
        assert body[0].mapping_status == CitationMappingStatus.MISSING_REFERENCE.value
        assert res.status_counts.get(CitationMappingStatus.MISSING_REFERENCE, 0) == 1


# ============================================================================
# 3. IntegrityPipeline: Verdict Mapping Preservation & Report Cache Isolation
# ============================================================================


class TestIntegrityPipelineHardening:
    @pytest.mark.asyncio
    async def test_pipeline_preserves_ambiguous_and_intext_mismatch_when_no_clean_match(
        self, tmp_path: Path
    ) -> None:
        pdf_file = tmp_path / "ambiguous_essay.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 test content")

        refs = [
            Citation(
                raw_text="Smith, J. (2020a). First distinct study on compilers. PLDI.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="a",
                title="First distinct study on compilers",
            ),
            Citation(
                raw_text="Smith, J. (2020b). Second distinct study on operating systems. OSDI.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="b",
                title="Second distinct study on operating systems",
            ),
            Citation(
                raw_text="Bloem, B. R. (2021). Parkinson disease clinical review. The Lancet.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Bloem, B. R."],
                year="2021",
                title="Parkinson disease clinical review",
            ),
            Citation(
                raw_text="Doe, A. (2022). Cleanly matched paper. Nature.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Doe, A."],
                year="2022",
                title="Cleanly matched paper",
            ),
        ]
        body = [
            Citation(raw_text="(Smith, 2020)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
            Citation(raw_text="(Bloem, 2024)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
            Citation(raw_text="(Doe, 2022)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
            Citation(raw_text="(Doe, 2025)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
        ]
        parsed_doc = ParsedDocument(
            document=Document(file_path=str(pdf_file), num_pages=2, pages=[Page(page_num=1, text="Body text")]),
            body_citations=body,
            references=refs,
            appendix_citations=[],
            sections=[],
            parser_warnings=[],
        )
        mock_parser = MagicMock()
        mock_parser.parse.return_value = parsed_doc

        mock_orch = MagicMock()
        mock_orch.retrieve = AsyncMock(
            side_effect=lambda cit, **_kw: SourceResult(
                citation_raw=cit.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        title="Borderline related topic",
                        authors=["Other, X."],
                        year="2020",
                        confidence=0.55,
                    )
                ],
                sources_queried=["openalex"],
                sources_succeeded=["openalex"],
            )
        )

        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        pipe = IntegrityPipeline(
            document_parser=mock_parser,
            use_document_parser=True,
            orchestrator=mock_orch,
            checker=checker,
            use_report_cache=False,
        )

        report = await pipe.run_async(str(pdf_file), essay_id=101)
        verdict_by_ref = {v.citation.reference_id: v for v in report.verdicts}

        assert verdict_by_ref["ref-0001"].mapping_status == CitationMappingStatus.AMBIGUOUS_MAPPING
        assert verdict_by_ref["ref-0002"].mapping_status == CitationMappingStatus.AMBIGUOUS_MAPPING
        assert "R-AMBIGUOUS-MAPPING" in verdict_by_ref["ref-0001"].triggered_rules
        assert verdict_by_ref["ref-0003"].mapping_status == CitationMappingStatus.IN_TEXT_MISMATCH
        # ref-0004 has a clean MATCHED link alongside a mismatched one -> stays MATCHED
        assert verdict_by_ref["ref-0004"].mapping_status == CitationMappingStatus.MATCHED

    @pytest.mark.asyncio
    async def test_report_cache_key_isolates_plan_params_and_honors_bypass(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        pdf_file = tmp_path / "shared_thesis.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 shared thesis bytes")

        def _make_parsed() -> ParsedDocument:
            refs = [
                Citation(
                    raw_text=f"[{i}] Author {i} (202{i}). Title {i}. Journal.",
                    citation_type=CitationType.REFERENCE_LIST,
                    style=CitationStyle.IEEE,
                    authors=[f"Author {i}"],
                    year=f"202{i}",
                    title=f"Title {i}",
                    numeric_index=i,
                )
                for i in (1, 2, 3)
            ]
            body = [
                Citation(raw_text=f"[{i}]", citation_type=CitationType.NUMERIC, style=CitationStyle.IEEE)
                for i in (1, 2, 3)
            ]
            return ParsedDocument(
                document=Document(file_path=str(pdf_file), num_pages=3, pages=[Page(page_num=1, text="Body")]),
                body_citations=body,
                references=refs,
                appendix_citations=[],
                sections=[],
                parser_warnings=[],
            )

        mock_parser = MagicMock()
        mock_parser.parse.side_effect = lambda _p: _make_parsed()
        retrieve_calls = 0

        async def _fake_retrieve(cit: Citation, **_kw: object) -> SourceResult:
            nonlocal retrieve_calls
            retrieve_calls += 1
            return SourceResult(citation_raw=cit.raw_text, candidates=[])

        mock_orch = MagicMock()
        mock_orch.retrieve = _fake_retrieve

        pipe = IntegrityPipeline(
            document_parser=mock_parser,
            use_document_parser=True,
            orchestrator=mock_orch,
            checker=NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False),
            use_report_cache=True,
        )
        pipe._report_cache_dir = tmp_path / "report_cache"

        k_basic = pipe._report_cache_key(str(pdf_file), max_citations=1, allow_serpapi=False)
        k_pro = pipe._report_cache_key(str(pdf_file), max_citations=None, allow_serpapi=True)
        k_noserp = pipe._report_cache_key(str(pdf_file), max_citations=None, allow_serpapi=False)
        assert k_basic is not None and k_pro is not None and k_noserp is not None
        assert len({k_basic, k_pro, k_noserp}) == 3

        # Default allow_serpapi=None reads settings.retrieval.sources.serpapi accurately
        monkeypatch.setattr(get_settings().retrieval.sources, "serpapi", False)
        k_default_disabled = pipe._report_cache_key(
            str(pdf_file), max_citations=None, allow_serpapi=None
        )
        assert k_default_disabled is not None
        assert k_default_disabled.endswith("-sp_0")
        assert k_default_disabled == k_noserp

        monkeypatch.setattr(get_settings().retrieval.sources, "serpapi", True)
        k_default_enabled = pipe._report_cache_key(
            str(pdf_file), max_citations=None, allow_serpapi=None
        )
        assert k_default_enabled == k_pro

        # Serialization or mid-write failure in _save_report_cache leaves zero orphan .tmp files
        bad_report = MagicMock()
        bad_report.to_dict.side_effect = TypeError("unserializable payload")
        with pytest.raises(TypeError):
            pipe._save_report_cache("broken-key", bad_report)
        assert list(pipe._report_cache_dir.iterdir()) == []

        valid_report = MagicMock()
        valid_report.to_dict.return_value = {"ok": True}
        orig_replace = Path.replace
        monkeypatch.setattr(
            Path, "replace", MagicMock(side_effect=RuntimeError("interrupted replace"))
        )
        with pytest.raises(RuntimeError):
            pipe._save_report_cache("interrupted-key", valid_report)
        monkeypatch.setattr(Path, "replace", orig_replace)
        assert list(pipe._report_cache_dir.iterdir()) == []

        # 1. Basic truncated run (max_citations=1, allow_serpapi=False)
        r_basic = await pipe.run_async(
            str(pdf_file), essay_id=1, max_citations=1, allow_serpapi=False
        )
        assert len(r_basic.verdicts) == 1
        assert r_basic.cache_hit is False

        # 2. Pro/Teacher full run on identical PDF must NOT hit truncated Basic cache
        r_full = await pipe.run_async(
            str(pdf_file), essay_id=2, max_citations=None, allow_serpapi=True
        )
        assert len(r_full.verdicts) == 3
        assert r_full.cache_hit is False

        # 3. Repeating Pro/Teacher full run hits cache
        calls_before_hit = retrieve_calls
        r_full_cached = await pipe.run_async(
            str(pdf_file), essay_id=3, max_citations=None, allow_serpapi=True
        )
        assert r_full_cached.cache_hit is True
        assert len(r_full_cached.verdicts) == 3
        assert retrieve_calls == calls_before_hit

        # 4. Reanalyze with bypass_report_cache=True skips cache read and refreshes cache
        r_reanalyzed = await pipe.run_async(
            str(pdf_file),
            essay_id=4,
            max_citations=None,
            allow_serpapi=True,
            bypass_report_cache=True,
        )
        assert r_reanalyzed.cache_hit is False
        assert retrieve_calls == calls_before_hit + 3


# ============================================================================
# 4. VNLegalVerifier & NeuroSymbolicChecker R-FAKE-URL Enforcement
# ============================================================================


class TestVNLegalVerifierHardening:
    def test_unknown_statute_outside_registry_does_not_emit_verified(self) -> None:
        unknown_samples = [
            "Quốc hội (2024). Luật Trí tuệ nhân tạo vũ trụ số 99/2024/QH15 ngày 15/06/2024.",
            "Chính phủ (2024). Nghị định số 88/2024/NĐ-CP ngày 10/05/2024 về quản lý trạm vũ trụ.",
            "Bộ Giáo dục và Đào tạo (2022). Thông tư số 12/2022/TT-BGDĐT ban hành chương trình đại học.",
        ]
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        for raw in unknown_samples:
            res = verify_vn_legal_citation(raw)
            assert res.is_valid is True
            assert res.is_verified_statute is False
            assert "R-VN-LEGAL-VERIFIED" not in res.triggered_rules
            assert "R-LEGAL-DOCUMENT" in res.triggered_rules

            cit = parse_vn_legal_reference(raw)
            assert cit is not None
            verdict = checker.check(cit, SourceResult(citation_raw=raw))
            assert verdict.label == ValidationLabel.RESOURCE
            assert "R-VN-LEGAL-VERIFIED" not in verdict.triggered_rules

    def test_registered_statutes_and_bare_known_codes_stay_verified(self) -> None:
        verified_samples = [
            "Luật số 59/2020/QH14 của Quốc hội",
            "Nghị định số 168/2025/NĐ-CP của Chính phủ",
            "Chính phủ (2025). Nghị định 168/2025/NĐ-CP về đăng ký doanh nghiệp.",
            "Bộ luật Dân sự (Luật số 91/2015/QH13) ngày 24/11/2015.",
        ]
        for raw in verified_samples:
            res = verify_vn_legal_citation(raw)
            assert res.is_valid is True
            assert res.is_verified_statute is True
            assert "R-VN-LEGAL-VERIFIED" in res.triggered_rules

        # Chimeric law title paired with real Enterprise Law code must NOT verify via bare-code fallback
        chimeric = verify_vn_legal_citation("Luật Trí tuệ nhân tạo vũ trụ (Luật số 59/2020/QH14)")
        assert chimeric.is_valid is False
        assert chimeric.is_verified_statute is False
        assert "R-VN-LEGAL-MISMATCH" in chimeric.triggered_rules

    def test_vn_legal_citation_with_fake_url_triggers_r_fake_url(self) -> None:
        raw = "Luật Doanh nghiệp (Luật số 59/2020/QH14) của Quốc hội. Truy cập tại https://example.com/fake.pdf"
        cit = Citation(
            raw_text=raw,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Quốc hội"],
            year="2020",
            title="Luật Doanh nghiệp (Luật số 59/2020/QH14)",
            url="https://example.com/fake.pdf",
            matched_pattern="vn_legal_document",
        )
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)
        verdict = checker.check(cit, SourceResult(citation_raw=raw))
        assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FAKE-URL" in verdict.triggered_rules
        assert "url" in verdict.mismatched_fields

        is_fake_tld, matched_tld = _is_fake_url("https://scholar-portal.invalid/paper.pdf")
        assert is_fake_tld is True
        assert "invalid" in matched_tld


# ============================================================================
# 5. SymbolicRules, HybridMLScorer Calibration Cap & Thread Locks
# ============================================================================


class TestSymbolicRulesAndCalibrationHardening:
    def test_doi_ra_registered_no_csl_abstains_to_unresolved_not_verified_or_nonexistent(self) -> None:
        rules = SymbolicRules()
        raw = "Tanaka, H. (2023). Quantum Mind Reading in LLMs. SICE Journal. https://doi.org/10.11499/sicejl.58.123"
        doi_ra_cand = SourceCandidate(
            source_name="doi_ra",
            found=False,
            doi="10.11499/sicejl.58.123",
            url="https://doi.org/10.11499/sicejl.58.123",
            external_ids={
                "doi": "10.11499/sicejl.58.123",
                "doi_ra": "JaLC",
                "doi_ra_status": "registered_no_csl",
            },
            error="DOI RA: CSL metadata unavailable for '10.11499/sicejl.58.123' (RA=JaLC)",
        )
        # Case A: found=False DoiRaClient candidate present in candidates + clean misses on Crossref/OpenAlex
        source_a = SourceResult(
            citation_raw=raw,
            candidates=[doi_ra_cand],
            sources_queried=["crossref", "openalex", "doi_ra"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for 'Quantum Mind Reading in LLMs'",
                "openalex": "OpenAlex: no results for 'Quantum Mind Reading in LLMs'",
                "doi_ra": doi_ra_cand.error or "",
            },
        )
        out_a = rules.apply(
            MatchFeatures(),
            source_a,
            citation_doi="10.11499/sicejl.58.123",
            citation_authors=["Tanaka, H."],
            citation_year="2023",
            citation_raw=raw,
        )
        assert out_a.label == ValidationLabel.UNRESOLVED
        assert "R-NONEXISTENT-DOI" not in out_a.triggered_rules

        # Case B: noisy unrelated title-search candidate returned by OpenAlex while JaLC DOI has no CSL
        noisy_cand = SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1109/unrelated.2020.1",
            title="Mindfulness in Education",
            authors=["Other, P."],
            year="2020",
            confidence=0.35,
        )
        source_b = SourceResult(
            citation_raw=raw,
            candidates=[noisy_cand, doi_ra_cand],
            sources_queried=["crossref", "openalex", "doi_ra"],
            sources_succeeded=["openalex"],
            sources_failed={
                "crossref": "Crossref: no results for 'Quantum Mind Reading in LLMs'",
                "doi_ra": doi_ra_cand.error or "",
            },
        )
        feats_b = MatchFeatures(
            title_sim_fuzzy=0.22,
            title_sim_semantic=0.25,
            author_jaccard=0.0,
            year_distance=3,
            doi_exact_match=False,
            source_consensus=1,
        )
        out_b = rules.apply(
            feats_b,
            source_b,
            citation_doi="10.11499/sicejl.58.123",
            citation_authors=["Tanaka, H."],
            citation_year="2023",
            citation_raw=raw,
        )
        assert out_b.label == ValidationLabel.UNRESOLVED
        assert "R-NONEXISTENT-DOI" not in out_b.triggered_rules

    def test_content_mismatch_on_strongly_matched_real_paper_returns_metadata_error(self) -> None:
        rules = SymbolicRules()
        cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Graph Neural Networks for Molecular Property Prediction",
            authors=["Nguyen, V. A.", "Tran, B."],
            year="2022",
            abstract="We introduce message passing graph neural networks for molecular toxicity prediction.",
            confidence=0.92,
        )
        source = SourceResult(
            citation_raw="Nguyen, V. A., & Tran, B. (2022). Graph Neural Networks for Molecular Property Prediction.",
            candidates=[cand],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex"],
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.92,
            title_sim_semantic=0.90,
            author_jaccard=0.67,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
            content_alignment_score=0.38,
            content_is_aligned=False,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Nguyen, V. A.", "Tran, B."],
            citation_year="2022",
            citation_raw=source.citation_raw,
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "R-CONTENT-MISMATCH" in outcome.triggered_rules
        assert "content" in outcome.mismatched_fields

    def test_future_year_allows_next_year_cover_date_and_uses_non_accusatory_wording(self) -> None:
        rules = SymbolicRules()
        next_year = str(datetime.now().year + 1)
        far_future = str(datetime.now().year + 3)

        # 1. current_year + 1 journal cover date on real matched paper -> VERIFIED (not R-FUTURE-YEAR)
        cand_cover = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1016/j.eswa.2026.123456",
            title="Advance Cover Date Neural Control Systems",
            authors=["Park, S.", "Kim, H."],
            year=next_year,
            confidence=0.95,
        )
        src_cover = SourceResult(
            citation_raw=f"Park, S., & Kim, H. ({next_year}). Advance Cover Date Neural Control Systems. Expert Systems with Applications.",
            candidates=[cand_cover],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        feats_cover = MatchFeatures(
            title_sim_fuzzy=0.98,
            title_sim_semantic=0.98,
            author_jaccard=1.0,
            year_distance=0,
            doi_exact_match=True,
            source_consensus=1,
        )
        out_cover = rules.apply(
            feats_cover,
            src_cover,
            citation_doi="10.1016/j.eswa.2026.123456",
            citation_authors=["Park, S.", "Kim, H."],
            citation_year=next_year,
            citation_raw=src_cover.citation_raw,
        )
        assert out_cover.label == ValidationLabel.VERIFIED
        assert "R-FUTURE-YEAR" not in out_cover.triggered_rules
        assert "R-FUTURE-YEAR-KNOWN-AUTHOR" not in out_cover.triggered_rules

        # 2. Unindexed current_year + 1 citation also does NOT trigger R-FUTURE-YEAR
        src_unindexed = SourceResult(
            citation_raw=f"Park, S. ({next_year}). Forthcoming Cover Date Paper.",
            candidates=[],
            sources_queried=["crossref"],
            sources_succeeded=[],
            sources_failed={"crossref": "Crossref: no results for 'Forthcoming Cover Date Paper'"},
        )
        out_unindexed = rules.apply(
            MatchFeatures(),
            src_unindexed,
            citation_authors=["Park, S."],
            citation_year=next_year,
            citation_raw=src_unindexed.citation_raw,
        )
        assert "R-FUTURE-YEAR" not in out_unindexed.triggered_rules

        # 3. Impossible far-future year (>= current_year + 2) triggers R-FUTURE-YEAR without deterministic accusation
        src_far = SourceResult(
            citation_raw=f"Park, S. ({far_future}). Implausible Future Paper.",
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
        )
        out_far = rules.apply(
            MatchFeatures(),
            src_far,
            citation_authors=["Park, S."],
            citation_year=far_future,
            citation_raw=src_far.citation_raw,
        )
        assert out_far.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FUTURE-YEAR" in out_far.triggered_rules
        assert "fabricated citation" not in out_far.reasoning.lower()

    def test_hybrid_ml_scorer_caps_absence_of_evidence_r_no_scholarly_record_at_088(self) -> None:
        raw = (
            "Nguyen, M. T., & Hoang, Q. (2023). Unindexed Regional Optimization Methods for Supply Chains. "
            "Journal of Applied Operations, 14(2), 45-62."
        )
        cit = Citation(
            raw_text=raw,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Nguyen, M. T.", "Hoang, Q."],
            year="2023",
            title="Unindexed Regional Optimization Methods for Supply Chains",
            venue="Journal of Applied Operations",
        )
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for 'Unindexed Regional Optimization'",
                "openalex": "OpenAlex: no results for 'Unindexed Regional Optimization'",
                "dblp": "DBLP: no results for 'Unindexed Regional Optimization'",
            },
        )
        checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=True)
        verdict = checker.check(cit, source)
        assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-NO-SCHOLARLY-RECORD" in verdict.triggered_rules
        assert verdict.confidence <= 0.88

        scorer = HybridMLScorer.load_default()
        direct_conf = scorer.calibrate_verdict_confidence(
            symbolic_label="suspected_hallucination",
            symbolic_confidence=0.80,
            features=MatchFeatures(),
            has_candidate=False,
        )
        assert direct_conf <= 0.88

    def test_thread_locks_present_on_neuro_symbolic_checker_and_semantic_intent_cache(self) -> None:
        assert hasattr(NeuroSymbolicChecker, "_init_lock")
        assert hasattr(SemanticMatcher, "_intent_cache_lock")
