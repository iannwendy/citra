"""Unit tests for Task 8 (A1 + A3) & Task 7 carried-in ISO-4 stem ruling:
- Subsystem A1: `assess_bibliographic_completeness` & `R-INCOMPLETE-METADATA`
  (separating bare/incomplete student references from `SUSPECTED_HALLUCINATION`
  while preserving 100% hallucination sensitivity on fabricated academic claims,
  plus 0.25 `metadata_accuracy` credit in `CISCalculator`).
- Subsystem A3: Quantized `ONNX INT8` multilingual encoder (`_select_quantized_onnx_file`,
  safe auto-fallback when `optimum`/`onnxruntime` is absent, and hybrid cross-lingual
  VI-EN content alignment scoring >= 0.55 outside the static 320-term bridge dictionary).
- Task 7 carried-in ruling: ISO-4 stem cleanup in `acs.py` and `rules.py`.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch

from integrity_checker.config import MatchingConfig
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.completeness import (
    BibliographicCompleteness,
    assess_bibliographic_completeness,
)
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.author_parser import Author
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.vn_en_academic_bridge import (
    compute_cross_lingual_concept_overlap,
)
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)


class TestBibliographicCompletenessAssessment:
    """Verify `assess_bibliographic_completeness` field detection and scope guards."""

    def test_bare_english_student_entry_with_spurious_first_word_author_is_incomplete(
        self,
    ) -> None:
        raw = "[2] Making a robot vacuum cleaner to avoid falling down the stairs"
        comp_str = assess_bibliographic_completeness(
            citation_raw=raw,
            citation_authors=["Making"],
            citation_year=None,
            citation_venue=None,
            citation_doi=None,
            citation_url=None,
        )
        assert isinstance(comp_str, BibliographicCompleteness)
        assert comp_str.is_incomplete is True
        assert comp_str.has_resolvable_id is False
        assert comp_str.has_valid_year is False
        assert comp_str.has_real_authors is False
        assert comp_str.has_academic_venue is False
        assert comp_str.missing_fields == ["authors", "year", "venue"]

        # Same check when `citation_authors` contains an Author object
        comp_obj = assess_bibliographic_completeness(
            citation_raw=raw,
            citation_authors=[Author(last_name="making", initials=[], raw="Making")],
            citation_year=None,
            citation_venue=None,
            citation_doi=None,
            citation_url=None,
        )
        assert comp_obj.is_incomplete is True
        assert comp_obj.has_real_authors is False

    def test_bare_vietnamese_student_entry_with_spurious_first_word_author_is_incomplete(
        self,
    ) -> None:
        raw = "[5] Xây dựng hệ thống tưới cây tự động dùng cảm biến độ ẩm"
        comp = assess_bibliographic_completeness(
            citation_raw=raw,
            citation_authors=["Xây"],
            citation_year=None,
            citation_venue=None,
            citation_doi=None,
            citation_url=None,
        )
        assert comp.is_incomplete is True
        assert comp.has_real_authors is False
        assert comp.has_valid_year is False
        assert comp.has_academic_venue is False
        assert comp.missing_fields == ["authors", "year", "venue"]

    def test_resolvable_identifiers_and_fake_domains_never_marked_incomplete(self) -> None:
        # Non-existent / fabricated DOI must NOT be marked incomplete
        comp_doi = assess_bibliographic_completeness(
            citation_raw="Quantum Neural Surgery",
            citation_authors=[],
            citation_year=None,
            citation_venue=None,
            citation_doi="10.1016/j.nonexistent.2024.99999",
        )
        assert comp_doi.has_resolvable_id is True
        assert comp_doi.is_incomplete is False

        # arXiv ID in raw text
        comp_arxiv = assess_bibliographic_completeness(
            citation_raw="[4] Attention mechanisms in vision, arXiv:2401.12345",
            citation_authors=[],
            citation_year=None,
            citation_venue=None,
        )
        assert comp_arxiv.has_resolvable_id is True
        assert comp_arxiv.is_incomplete is False

        # Vietnamese technical standard / statutory code
        comp_tcvn = assess_bibliographic_completeness(
            citation_raw="TCVN 5574:2018 Thiết kế kết cấu bê tông và bê tông cốt thép",
            citation_authors=[],
            citation_year=None,
            citation_venue=None,
        )
        assert comp_tcvn.has_resolvable_id is True
        assert comp_tcvn.is_incomplete is False

        # Fake URL domain: has_resolvable_id is False, AND is_incomplete MUST be False
        # so fake URLs still get caught as SUSPECTED_HALLUCINATION
        comp_fake_url = assess_bibliographic_completeness(
            citation_raw="Unverified Online Claim https://example.com/fake-paper",
            citation_authors=[],
            citation_year=None,
            citation_venue=None,
            citation_url="https://example.com/fake-paper",
            url_status="fake_domain",
        )
        assert comp_fake_url.has_resolvable_id is False
        assert comp_fake_url.is_incomplete is False

    def test_institutional_authors_and_in_text_citations_handled_accurately(self) -> None:
        comp_inst = assess_bibliographic_completeness(
            citation_raw="World Health Organization. (2022). Global tuberculosis report.",
            citation_authors=["World Health Organization"],
            citation_year="2022",
            citation_venue=None,
        )
        assert comp_inst.has_real_authors is True
        assert comp_inst.has_valid_year is True
        assert comp_inst.is_incomplete is False

        # Bare in-text parenthetical citation must NOT be classified as incomplete reference
        comp_in_text = assess_bibliographic_completeness(
            citation_raw="(Smith, 2020)",
            citation_authors=["Smith"],
            citation_year="2020",
            citation_venue=None,
            citation_type=CitationType.IN_TEXT,
        )
        assert comp_in_text.is_incomplete is False


class TestRIncompleteMetadataVsHallucinationRules:
    """Verify `SymbolicRules` separates `R-INCOMPLETE-METADATA` from `SUSPECTED_HALLUCINATION`."""

    def test_incomplete_student_entry_zero_candidates_returns_r_incomplete_metadata(
        self,
    ) -> None:
        rules = SymbolicRules()
        raw = "[2] Making a robot vacuum cleaner to avoid falling down the stairs"
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
                "dblp": "DBLP: no results for query",
            },
        )
        outcome = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Making"],
            citation_year=None,
            citation_doi=None,
            citation_url=None,
            citation_venue=None,
            citation_raw=raw,
            citation_title="Making a robot vacuum cleaner to avoid falling down the stairs",
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"]
        assert outcome.confidence == pytest.approx(0.80)
        assert set(outcome.mismatched_fields) == {"authors", "year", "venue"}

    def test_incomplete_student_entry_noisy_low_sim_candidate_returns_r_incomplete_metadata(
        self,
    ) -> None:
        rules = SymbolicRules()
        raw = "[2] Making a robot vacuum cleaner to avoid falling down the stairs"
        noisy_cand = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Stair-Climbing Tracked Mobile Robot Mechanism",
            authors=["Kim, H."],
            year="2019",
            venue="IEEE Access",
            confidence=0.30,
        )
        source = SourceResult(
            citation_raw=raw,
            candidates=[noisy_cand],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
            sources_failed={"crossref": "Crossref: no results for query"},
        )
        features = MatchFeatures(
            title_sim_fuzzy=0.21,
            title_sim_semantic=0.19,
            author_jaccard=0.0,
            year_distance=99,
            doi_exact_match=False,
            source_consensus=1,
        )
        outcome = rules.apply(
            features,
            source,
            citation_authors=["Making"],
            citation_year=None,
            citation_doi=None,
            citation_url=None,
            citation_venue=None,
            citation_raw=raw,
            citation_title="Making a robot vacuum cleaner to avoid falling down the stairs",
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"]
        assert outcome.confidence == pytest.approx(0.80)

    def test_vietnamese_bare_title_returns_r_incomplete_metadata(self) -> None:
        rules = SymbolicRules()
        raw = "[5] Xây dựng hệ thống tưới cây tự động dùng cảm biến độ ẩm"
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            },
        )
        outcome = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Xây"],
            citation_year=None,
            citation_venue=None,
            citation_raw=raw,
            citation_title="Xây dựng hệ thống tưới cây tự động dùng cảm biến độ ẩm",
        )
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"]
        assert outcome.confidence == pytest.approx(0.80)

    def test_genuine_ai_hallucinated_citations_still_flagged_as_suspected_hallucination(
        self,
    ) -> None:
        rules = SymbolicRules()
        halluc_raw = (
            "Smith, J., & Doe, A. (2023). Quantum Neural Transformers for Autonomous Surgery. "
            "Journal of Medical AI, 14(2), 112-129."
        )

        # 1. Zero registry hits -> SUSPECTED_HALLUCINATION
        empty_source = SourceResult(
            citation_raw=halluc_raw,
            candidates=[],
            sources_queried=["crossref", "openalex", "europepmc"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
                "europepmc": "EuropePMC: no results for query",
            },
        )
        out_zero = rules.apply(
            MatchFeatures(),
            empty_source,
            citation_authors=["Smith, J.", "Doe, A."],
            citation_year="2023",
            citation_venue="Journal of Medical AI",
            citation_raw=halluc_raw,
            citation_title="Quantum Neural Transformers for Autonomous Surgery",
        )
        assert out_zero.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-INCOMPLETE-METADATA" not in out_zero.triggered_rules

        # 2. Low-similarity noisy hit (0.22) -> SUSPECTED_HALLUCINATION
        noisy_source = SourceResult(
            citation_raw=halluc_raw,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Robotic Laparoscopy Overview",
                    authors=["Brown, K."],
                    year="2018",
                    confidence=0.25,
                )
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["openalex"],
            sources_failed={},
        )
        out_noisy = rules.apply(
            MatchFeatures(
                title_sim_fuzzy=0.22,
                title_sim_semantic=0.20,
                author_jaccard=0.0,
                year_distance=5,
                doi_exact_match=False,
                source_consensus=1,
            ),
            noisy_source,
            citation_authors=["Smith, J.", "Doe, A."],
            citation_year="2023",
            citation_venue="Journal of Medical AI",
            citation_raw=halluc_raw,
            citation_title="Quantum Neural Transformers for Autonomous Surgery",
        )
        assert out_noisy.label == ValidationLabel.SUSPECTED_HALLUCINATION

        # 3. Fabricated / non-existent DOI -> SUSPECTED_HALLUCINATION
        fake_doi_raw = "Quantum Neural Transformers. doi:10.1016/j.nonexistent.2024.99999"
        fake_doi_source = SourceResult(
            citation_raw=fake_doi_raw,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for query",
                "openalex": "OpenAlex: no results for query",
            },
        )
        out_doi = rules.apply(
            MatchFeatures(),
            fake_doi_source,
            citation_doi="10.1016/j.nonexistent.2024.99999",
            citation_authors=[],
            citation_year=None,
            citation_venue=None,
            citation_raw=fake_doi_raw,
        )
        assert out_doi.label == ValidationLabel.SUSPECTED_HALLUCINATION

        # 4. Fake URL domain -> SUSPECTED_HALLUCINATION
        fake_url_source = SourceResult(
            citation_raw="Unverified Guide https://example.com/guide",
            candidates=[],
            sources_queried=["crossref"],
            sources_succeeded=[],
            sources_failed={"crossref": "Crossref: no results for query"},
            url_status="fake_domain",
        )
        out_url = rules.apply(
            MatchFeatures(),
            fake_url_source,
            citation_url="https://example.com/guide",
            citation_raw="Unverified Guide https://example.com/guide",
        )
        assert out_url.label == ValidationLabel.SUSPECTED_HALLUCINATION

    def test_rate_limited_all_failed_incomplete_entry_abstains_to_unresolved(self) -> None:
        rules = SymbolicRules()
        raw = "[2] Making a robot vacuum cleaner to avoid falling down the stairs"
        source = SourceResult(
            citation_raw=raw,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "HTTP 429 rate limit exceeded",
                "openalex": "HTTP 429 rate limit backoff",
            },
        )
        outcome = rules.apply(
            MatchFeatures(),
            source,
            citation_authors=["Making"],
            citation_raw=raw,
        )
        assert outcome.label == ValidationLabel.UNRESOLVED
        assert "R-FAIL-ALL" in outcome.triggered_rules
        assert "R-RATE-LIMITED-ABSTAIN" in outcome.triggered_rules


class TestCISIncompleteMetadataWeighting:
    """Verify `R-INCOMPLETE-METADATA` receives 0.25 `metadata_accuracy` credit in `CISCalculator`."""

    def test_cis_gives_quarter_metadata_accuracy_credit_to_incomplete_metadata(self) -> None:
        calc = CISCalculator()
        cit = Citation(
            raw_text="[2] Making a robot vacuum cleaner to avoid falling down the stairs",
            citation_type=CitationType.REFERENCE_LIST,
            authors=["Making"],
        )

        incomplete_verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.80,
            triggered_rules=["R-INCOMPLETE-METADATA"],
            mismatched_fields=["authors", "year", "venue"],
        )
        halluc_verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.85,
            triggered_rules=["R-NO-CANDIDATE", "R-NO-SCHOLARLY-RECORD"],
            mismatched_fields=["title"],
        )
        standard_meta_err_verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.70,
            triggered_rules=["R-SINGLE-SOURCE-PARTIAL"],
            mismatched_fields=["year"],
        )

        res_incomplete = calc.compute([incomplete_verdict])
        res_halluc = calc.compute([halluc_verdict])
        res_standard_meta = calc.compute([standard_meta_err_verdict])

        assert res_incomplete.components.metadata_accuracy == pytest.approx(0.25)
        assert res_halluc.components.metadata_accuracy == pytest.approx(0.00)
        assert res_standard_meta.components.metadata_accuracy == pytest.approx(0.00)
        assert res_incomplete.components.metadata_accuracy > res_halluc.components.metadata_accuracy


class TestMultilingualQuantizedOnnxAndCrossLingualAlignment:
    """Verify Subsystem A3: `ONNX INT8` multilingual encoder & hybrid VI-EN alignment."""

    def test_matching_config_defaults_enable_multilingual_and_onnx_quantized(self) -> None:
        cfg = MatchingConfig()
        assert cfg.enable_multilingual_encoder is True
        assert cfg.onnx_quantized is True

    def test_select_quantized_onnx_file_by_cpu_architecture(self) -> None:
        assert (
            SemanticMatcher._select_quantized_onnx_file("arm64")
            == "onnx/model_qint8_arm64.onnx"
        )
        assert (
            SemanticMatcher._select_quantized_onnx_file("aarch64")
            == "onnx/model_qint8_arm64.onnx"
        )
        assert (
            SemanticMatcher._select_quantized_onnx_file("x86_64")
            == "onnx/model_qint8_avx2.onnx"
        )
        assert (
            SemanticMatcher._select_quantized_onnx_file("AMD64")
            == "onnx/model_qint8_avx2.onnx"
        )

    def test_load_multilingual_encoder_uses_onnx_and_falls_back_cleanly(self) -> None:
        matcher = SemanticMatcher()
        matcher.enable_multilingual_encoder = True
        matcher.onnx_quantized = True
        matcher._multilingual_model = None

        # Case 1: ONNX backend loads cleanly on arm64
        fake_onnx_model = MagicMock(name="FakeOnnxMultilingualModel")
        with (
            patch(
                "integrity_checker.matching.semantic.platform.machine",
                return_value="arm64",
            ),
            patch(
                "sentence_transformers.SentenceTransformer",
                return_value=fake_onnx_model,
            ) as mock_st,
        ):
            loaded = matcher._load_multilingual_encoder()
            assert loaded is fake_onnx_model
            first_call = mock_st.call_args_list[0]
            assert first_call.args[0] == matcher.multilingual_model_name
            assert first_call.kwargs.get("backend") == "onnx"
            assert first_call.kwargs.get("model_kwargs") == {
                "file_name": "onnx/model_qint8_arm64.onnx"
            }

        # Case 2: `optimum` / `onnxruntime` absent -> ImportError / OSError falls back cleanly
        fallback_pytorch_model = MagicMock(name="FallbackPytorchMultilingualModel")

        def _fake_st_constructor(*args, **kwargs):
            if kwargs.get("backend") == "onnx":
                raise ImportError("optimum.onnxruntime is not installed")
            return fallback_pytorch_model

        with patch(
            "sentence_transformers.SentenceTransformer",
            side_effect=_fake_st_constructor,
        ):
            loaded_fb = matcher._load_multilingual_encoder()
            assert loaded_fb is fallback_pytorch_model

    def test_cross_lingual_vi_en_alignment_outside_static_dictionary_with_deterministic_encoder(
        self,
    ) -> None:
        # Vietnamese nephrology/toxicology claim & English abstract with ZERO terms in VN_EN_ACADEMIC_BRIDGE
        vi_claim = (
            "Phơi nhiễm cadmi mạn tính từ nước ngầm làm tổn thương ống lượn gần "
            "và gây rối loạn bài tiết phosphat ở cư dân ven biển [12]."
        )
        en_title = "Chronic Groundwater Cadmium Exposure and Proximal Tubular Nephropathy"
        en_abstract = (
            "Prolonged intake of cadmium-contaminated drinking water damages renal proximal "
            "tubules and disrupts urinary phosphate excretion in coastal residents."
        )

        # Confirm zero static dictionary overlap
        overlap_score, overlap_pairs = compute_cross_lingual_concept_overlap(
            vi_claim, f"{en_title} {en_abstract}"
        )
        assert overlap_score == 0.0
        assert overlap_pairs == []

        matcher = SemanticMatcher()
        matcher.enable_multilingual_encoder = True

        # English-only encoder produces weak cross-lingual similarity (~0.18)
        class _DummyMonoEncoder:
            def encode(self, texts, **kwargs):
                out = []
                for t in texts:
                    if "Phơi nhiễm" in t or "ống lượn gần" in t:
                        v = torch.tensor([1.0, 0.0, 0.0, 0.0])
                    else:
                        v = torch.tensor([0.18, 0.9836, 0.0, 0.0])
                    out.append(v / torch.linalg.norm(v))
                return torch.stack(out)

        # Multilingual encoder maps VI & EN nephrology claims into aligned semantic vectors (~0.82)
        class _DummyMultiEncoder:
            def encode(self, texts, **kwargs):
                out = []
                for t in texts:
                    if "Phơi nhiễm" in t or "ống lượn gần" in t:
                        v = torch.tensor([0.92, 0.39, 0.0, 0.0])
                    elif "cadmium" in t.lower() or "tubul" in t.lower():
                        v = torch.tensor([0.88, 0.47, 0.0, 0.0])
                    else:
                        v = torch.tensor([0.0, 0.0, 1.0, 0.0])
                    out.append(v / torch.linalg.norm(v))
                return torch.stack(out)

        SemanticMatcher.clear_embedding_cache()
        with (
            patch.object(matcher, "_get_model", return_value=_DummyMonoEncoder()),
            patch.object(
                matcher, "_get_multilingual_model", return_value=_DummyMultiEncoder()
            ),
        ):
            res = matcher.check_content_alignment(
                cited_context=vi_claim,
                source_title=en_title,
                source_abstract=en_abstract,
                citation_marker="[12]",
            )
        assert res.similarity >= 0.55
        assert res.is_aligned is True

    def test_cross_lingual_vi_en_alignment_real_cached_multilingual_model_if_present(
        self,
    ) -> None:
        cache_dir = (
            Path.home()
            / ".cache"
            / "huggingface"
            / "hub"
            / "models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2"
        )
        if not cache_dir.exists():
            pytest.skip("Multilingual MiniLM cache not present on this runner")

        vi_claim = (
            "Phơi nhiễm cadmi mạn tính từ nước ngầm làm tổn thương ống lượn gần "
            "và gây rối loạn bài tiết phosphat ở cư dân ven biển [12]."
        )
        en_title = "Chronic Groundwater Cadmium Exposure and Proximal Tubular Nephropathy"
        en_abstract = (
            "Prolonged intake of cadmium-contaminated drinking water damages renal proximal "
            "tubules and disrupts urinary phosphate excretion in coastal residents."
        )
        overlap_score, _ = compute_cross_lingual_concept_overlap(
            vi_claim, f"{en_title} {en_abstract}"
        )
        assert overlap_score == 0.0

        SemanticMatcher.clear_embedding_cache()
        matcher = SemanticMatcher()
        matcher.enable_multilingual_encoder = True
        matcher.onnx_quantized = True
        res = matcher.check_content_alignment(
            cited_context=vi_claim,
            source_title=en_title,
            source_abstract=en_abstract,
            citation_marker="[12]",
        )
        assert res.similarity >= 0.55
        assert res.is_aligned is True


class TestTask7CarriedInIso4StemCleanup:
    """Verify Task 7 carried-in ruling on `_ISO4_CONTEXT_STEM_RE` deletion and stem splits."""

    def test_acs_process_and_hazard_titles_split_cleanly_from_abbreviated_venues(self) -> None:
        parser = ReferenceListParser()

        cit_process = parser.parse_single_entry(
            "(1) Smith, J.; Doe, A. Fischer-Tropsch Process. J. Am. Chem. Soc. 2020, 142, 100–110.",
            order_index=1,
            page_num=4,
        )
        assert cit_process is not None
        assert cit_process.title == "Fischer-Tropsch Process"
        assert (cit_process.venue or "").rstrip(".") == "J. Am. Chem. Soc"

        cit_hazard = parser.parse_single_entry(
            "(1) Smith, J.; Doe, A. Moral Hazard. Am. Econ. Rev. 2020, 110, 100–110.",
            order_index=1,
            page_num=4,
        )
        assert cit_hazard is not None
        assert cit_hazard.title == "Moral Hazard"
        assert (cit_hazard.venue or "").rstrip(".") == "Am. Econ. Rev"

    def test_target_title_before_chem_sci_and_med_behaves_accurately(self) -> None:
        parser = ReferenceListParser()
        checker = NeuroSymbolicChecker(enable_content_alignment=False)

        # 1. Chimeric title ending in "Target." before "Chem. Sci." -> SUSPECTED_HALLUCINATION
        rsc_chimeric = parser.parse_single_entry(
            "14. (a) Y. Zhang and X. Liu, Quantum Gravity Target. "
            "Chem. Sci., 2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A",
            order_index=14,
            page_num=5,
        )
        assert rsc_chimeric is not None
        assert rsc_chimeric.title == "Quantum Gravity Target"
        assert rsc_chimeric.venue == "Chem. Sci."
        verdict_chimeric = checker.check(
            rsc_chimeric,
            SourceResult(
                citation_raw=rsc_chimeric.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        title="Photoredox Cross-Coupling of Aryl Halides",
                        authors=["Y. Zhang", "X. Liu"],
                        year="2020",
                        venue="Chemical Science",
                        doi="10.1039/D0SC00111A",
                        confidence=0.95,
                        score=1.0,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert verdict_chimeric.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in verdict_chimeric.triggered_rules

        # 2. Legitimate title ending in "Target." before Cell Press 1-word journal "Med" -> VERIFIED
        med_cit = parser.parse_single_entry(
            "1. Smith, J.; Doe, A. Therapeutic Cancer Target. "
            "Med 2020, 1, 100–110. DOI: 10.1016/j.medj.2020.01.001.",
            order_index=1,
            page_num=5,
        )
        assert med_cit is not None
        assert med_cit.title == "Therapeutic Cancer Target"
        assert med_cit.venue == "Med"
        verdict_med = checker.check(
            med_cit,
            SourceResult(
                citation_raw=med_cit.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        title="Therapeutic Cancer Target",
                        authors=["J. Smith", "A. Doe"],
                        year="2020",
                        venue="Med",
                        doi="10.1016/j.medj.2020.01.001",
                        confidence=0.95,
                        score=1.0,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert verdict_med.label == ValidationLabel.VERIFIED

        # 3. Title-less "Earth Planet. Sci. Lett." stays intact without false split
        epsl_subs = parser.parse_reference_section(
            "14. (a) Zhang, Y.; Liu, X. Earth Planet. Sci. Lett. 2020, 530, 115900; "
            "(b) Wang, L. Earth Planet. Sci. Lett. 2021, 555, 116700.",
            page_num=5,
        )
        assert len(epsl_subs) == 2
        assert epsl_subs[0].title is None
        assert (epsl_subs[0].venue or "").rstrip(".") == "Earth Planet. Sci. Lett"
