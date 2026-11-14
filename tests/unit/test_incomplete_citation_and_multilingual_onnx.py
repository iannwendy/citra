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
    """Verify Spec §2.1 CIS `metadata_accuracy` monotonicity and `Repository.recalculate_essay_cis` parity."""

    def test_cis_gives_quarter_metadata_accuracy_credit_to_incomplete_metadata(self) -> None:
        calc = CISCalculator()
        cit = Citation(
            raw_text="[2] Making a robot vacuum cleaner to avoid falling down the stairs",
            citation_type=CitationType.REFERENCE_LIST,
            authors=["Making"],
        )

        verified_verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.VERIFIED,
            confidence=0.98,
            triggered_rules=["R-CONSENSUS-EXACT"],
            mismatched_fields=[],
        )
        standard_meta_err_verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.70,
            triggered_rules=["R-SINGLE-SOURCE-PARTIAL"],
            mismatched_fields=["year"],
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

        res_verified = calc.compute([verified_verdict])
        res_standard_meta = calc.compute([standard_meta_err_verdict])
        res_incomplete = calc.compute([incomplete_verdict])
        res_halluc = calc.compute([halluc_verdict])

        assert res_verified.components.metadata_accuracy == pytest.approx(1.00)
        assert res_standard_meta.components.metadata_accuracy == pytest.approx(0.50)
        assert res_incomplete.components.metadata_accuracy == pytest.approx(0.25)
        assert res_halluc.components.metadata_accuracy == pytest.approx(0.00)
        assert (
            res_verified.components.metadata_accuracy
            > res_standard_meta.components.metadata_accuracy
            > res_incomplete.components.metadata_accuracy
            > res_halluc.components.metadata_accuracy
        )

    def test_repository_recalculate_essay_cis_matches_monotonic_metadata_accuracy(self) -> None:
        import json as _json

        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session as SqlSession

        from integrity_checker.db.models import Base, VerdictRecord
        from integrity_checker.db.repository import Repository

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)

        with SqlSession(engine) as session:
            repo = Repository(session)
            essay = repo.create_essay(filename="monotonic_cis_check.pdf", num_pages=5)
            records = [
                VerdictRecord(
                    essay_id=essay.id,
                    citation_raw="Vaswani, A. et al. (2017). Attention Is All You Need. NeurIPS.",
                    label="verified",
                    confidence=0.98,
                    mapping_status="matched",
                    triggered_rules=_json.dumps(["R-CONSENSUS-EXACT"]),
                ),
                VerdictRecord(
                    essay_id=essay.id,
                    citation_raw="Vaswani, A. et al. (2018). Attention Is All You Need. NeurIPS.",
                    label="metadata_error",
                    confidence=0.75,
                    mapping_status="matched",
                    triggered_rules=_json.dumps(["R-SINGLE-SOURCE-PARTIAL"]),
                ),
                VerdictRecord(
                    essay_id=essay.id,
                    citation_raw="[3] Making a robot vacuum cleaner to avoid falling down the stairs",
                    label="metadata_error",
                    confidence=0.80,
                    mapping_status="matched",
                    triggered_rules=_json.dumps(["R-INCOMPLETE-METADATA"]),
                ),
                VerdictRecord(
                    essay_id=essay.id,
                    citation_raw="Doe, R. (2023). Quantum Neural Transformers. Cell, 186, 1-10.",
                    label="suspected_hallucination",
                    confidence=0.90,
                    mapping_status="matched",
                    triggered_rules=_json.dumps(["R-NO-SCHOLARLY-RECORD"]),
                ),
            ]
            session.add_all(records)
            session.flush()

            cis_dict = repo.recalculate_essay_cis(essay.id)
            assert cis_dict is not None
            # Penalty = (0.0 + 0.50 + 0.75 + 1.00) / 4 = 2.25 / 4 = 0.5625 -> accuracy = 0.4375
            expected_meta_acc = 1.0 - (0.50 + 0.75 + 1.00) / 4.0
            assert cis_dict["components"]["metadata_accuracy"] == pytest.approx(expected_meta_acc)


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

        # Case 2: `optimum` / `onnxruntime` absent -> ONLY attempts local PyTorch cache (`local_files_only=True`)
        fallback_pytorch_model = MagicMock(name="FallbackPytorchMultilingualModel")
        seen_calls: list[dict] = []

        def _fake_st_constructor(*args, **kwargs):
            seen_calls.append(dict(kwargs))
            if kwargs.get("backend") == "onnx":
                raise ImportError("optimum.onnxruntime is not installed")
            assert kwargs.get("local_files_only") is True
            return fallback_pytorch_model

        with patch(
            "sentence_transformers.SentenceTransformer",
            side_effect=_fake_st_constructor,
        ):
            loaded_fb = matcher._load_multilingual_encoder()
            assert loaded_fb is fallback_pytorch_model
            assert any(c.get("local_files_only") is True for c in seen_calls)

        # Case 3: Both ONNX and local PyTorch cache miss -> NEVER downloads FP32 over network; falls back to _get_model()
        miss_calls: list[dict] = []

        def _fake_st_miss(*args, **kwargs):
            miss_calls.append(dict(kwargs))
            if kwargs.get("backend") == "onnx":
                raise ImportError("optimum.onnxruntime is not installed")
            if kwargs.get("local_files_only") is True:
                raise OSError("Model not found in local HuggingFace cache")
            raise AssertionError("Unquantized FP32 network download must NEVER be triggered when onnx_quantized=True")

        mono_fallback = MagicMock(name="DefaultMonoEncoder")
        cache_key = f"{matcher.multilingual_model_name}::onnx"
        prior_cached = SemanticMatcher._model_cache.pop(cache_key, None)
        matcher._multilingual_model = None
        try:
            with (
                patch("sentence_transformers.SentenceTransformer", side_effect=_fake_st_miss),
                patch.object(matcher, "_get_model", return_value=mono_fallback),
            ):
                assert matcher._load_multilingual_encoder() is None
                resolved = matcher._get_multilingual_model()
                assert resolved is mono_fallback
                assert all(
                    c.get("backend") == "onnx" or c.get("local_files_only") is True
                    for c in miss_calls
                )
        finally:
            SemanticMatcher._model_cache.pop(cache_key, None)
            if prior_cached is not None:
                SemanticMatcher._model_cache[cache_key] = prior_cached

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


class TestTask8FixRound1Regressions:
    """Regression suite for all Task 8 Fix Round 1 review findings."""

    def test_finding1_substantive_author_year_hallucinations_never_downgrade_to_incomplete(
        self,
    ) -> None:
        rules = SymbolicRules()
        zero_features = MatchFeatures()

        # 1. Korean/Chinese/Vietnamese single-token surnames ("An", "Tài") with explicit author cues + year
        raw_an = "An et al. (2023). Quantum Neural Transformers for Autonomous Surgery. Cell, 186, 112-129."
        comp_an = assess_bibliographic_completeness(
            citation_raw=raw_an,
            citation_authors=["An"],
            citation_year="2023",
            citation_venue="Cell",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert comp_an.has_real_authors is True
        assert comp_an.has_valid_year is True
        assert comp_an.is_incomplete is False

        out_an = rules.evaluate(
            zero_features,
            SourceResult(
                citation_raw=raw_an,
                candidates=[],
                sources_queried=["crossref", "openalex", "semantic_scholar"],
                sources_succeeded=["crossref", "openalex", "semantic_scholar"],
            ),
            citation_raw=raw_an,
            citation_authors=["An"],
            citation_year="2023",
            citation_venue="Cell",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_an.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-INCOMPLETE-METADATA" not in out_an.triggered_rules

        raw_tai = "Tài (2023). Nghiên cứu mạng lượng tử tự hành."
        comp_tai = assess_bibliographic_completeness(
            citation_raw=raw_tai,
            citation_authors=["Tài"],
            citation_year="2023",
            citation_venue=None,
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert comp_tai.has_real_authors is True
        assert comp_tai.has_valid_year is True
        assert comp_tai.is_incomplete is False

        out_tai = rules.evaluate(
            zero_features,
            SourceResult(
                citation_raw=raw_tai,
                candidates=[],
                sources_queried=["crossref", "openalex", "semantic_scholar"],
                sources_succeeded=["crossref", "openalex", "semantic_scholar"],
            ),
            citation_raw=raw_tai,
            citation_authors=["Tài"],
            citation_year="2023",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_tai.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-INCOMPLETE-METADATA" not in out_tai.triggered_rules

        # 2. Structured `Author` object with `full_first_names` (and empty `raw` / `initials`)
        structured_author = Author(
            last_name="tài",
            full_first_names=["Nguyễn", "Văn"],
            initials=[],
            raw="",
        )
        raw_vn_author = "Nguyễn Văn Tài (2023). Mạng nơ-ron lượng tử cho phẫu thuật tự hành."
        comp_struct = assess_bibliographic_completeness(
            citation_raw=raw_vn_author,
            citation_authors=[structured_author],
            citation_year="2023",
            citation_venue=None,
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert comp_struct.has_real_authors is True
        assert comp_struct.is_incomplete is False

    def test_finding2_preflight_fake_author_never_flags_bare_student_titles(self) -> None:
        rules = SymbolicRules()
        zero_features = MatchFeatures()

        bare_student_titles = [
            ("[2] Artificial intelligence in healthcare", ["Artificial"]),
            ("[2] Synthetic aperture radar imaging", ["Synthetic"]),
            ("[2] Unknown input observer design for mobile robots", ["Unknown"]),
            ("[2] Unknown input observer design. Applications to mobile robots.", ["Unknown"]),
            ("[2] Detecting fake news in social media research", ["Detecting"]),
        ]
        for raw, sp_authors in bare_student_titles:
            outcome = rules.evaluate(
                zero_features,
                SourceResult(
                    citation_raw=raw,
                    candidates=[],
                    sources_queried=["crossref", "openalex", "semantic_scholar"],
                    sources_succeeded=["crossref", "openalex", "semantic_scholar"],
                ),
                citation_raw=raw,
                citation_authors=sp_authors,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert outcome.label == ValidationLabel.METADATA_ERROR, f"Failed on {raw}: {outcome}"
            assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"], f"Failed on {raw}: {outcome}"
            assert "R-FAKE-AUTHOR" not in outcome.triggered_rules

        # Genuine fake author personas MUST still trigger R-FAKE-AUTHOR (0.95)
        fake_persona_cases = [
            ("John Doe (2023). Fake Title.", ["John Doe"], "2023"),
            ("Jane Roe, 2022. Fake Study.", ["Jane Roe"], "2022"),
            ("Placeholder Author (2023). Fabricated Paper.", ["Placeholder Author"], "2023"),
            ("Anonymous Researcher (2024). Quantum Hallucinations.", ["Anonymous Researcher"], "2024"),
            ("Unknown Author. (2023). Some Fabricated Study.", ["Unknown Author"], "2023"),
            ("John Doe. Quantum Gravity.", ["John Doe"], None),
        ]
        for raw, f_authors, yr in fake_persona_cases:
            outcome = rules.evaluate(
                zero_features,
                SourceResult(
                    citation_raw=raw,
                    candidates=[],
                    sources_queried=["crossref", "openalex"],
                    sources_succeeded=["crossref", "openalex"],
                ),
                citation_raw=raw,
                citation_authors=f_authors,
                citation_year=yr,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION, f"Failed on {raw}: {outcome}"
            assert "R-FAKE-AUTHOR" in outcome.triggered_rules, f"Failed on {raw}: {outcome}"
            assert outcome.confidence == pytest.approx(0.95)

    def test_finding5_high_similarity_bare_titles_emit_r_incomplete_metadata(self) -> None:
        rules = SymbolicRules()
        raw = "[2] Attention Is All You Need"
        real_cand_1 = SourceCandidate(
            source_name="openalex",
            found=True,
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year="2017",
            venue="NeurIPS",
            doi="10.48550/arXiv.1706.03762",
            confidence=0.95,
            score=1.0,
        )
        real_cand_2 = SourceCandidate(
            source_name="semantic_scholar",
            found=True,
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year="2017",
            venue="NeurIPS",
            confidence=0.95,
            score=1.0,
        )

        # Subcase A: consensus=1, title_sim=1.00 -> METADATA_ERROR with R-INCOMPLETE-METADATA
        out_single = rules.evaluate(
            MatchFeatures(
                title_sim_fuzzy=1.00,
                author_jaccard=0.0,
                year_distance=99,
                doi_exact_match=False,
                source_consensus=1,
            ),
            SourceResult(
                citation_raw=raw,
                candidates=[real_cand_1],
                sources_queried=["openalex", "crossref"],
                sources_succeeded=["openalex", "crossref"],
            ),
            citation_raw=raw,
            citation_authors=["Attention"],
            citation_title="Attention Is All You Need",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_single.label == ValidationLabel.METADATA_ERROR
        assert "R-INCOMPLETE-METADATA" in out_single.triggered_rules

        # Subcase B: consensus=2, title_sim=0.85 -> METADATA_ERROR with R-INCOMPLETE-METADATA
        out_mid_consensus = rules.evaluate(
            MatchFeatures(
                title_sim_fuzzy=0.85,
                author_jaccard=0.0,
                year_distance=99,
                doi_exact_match=False,
                source_consensus=2,
            ),
            SourceResult(
                citation_raw=raw,
                candidates=[real_cand_1, real_cand_2],
                sources_queried=["openalex", "semantic_scholar"],
                sources_succeeded=["openalex", "semantic_scholar"],
            ),
            citation_raw=raw,
            citation_authors=["Attention"],
            citation_title="Attention Is All You Need",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_mid_consensus.label == ValidationLabel.METADATA_ERROR
        assert "R-INCOMPLETE-METADATA" in out_mid_consensus.triggered_rules

        # Subcase C: consensus=2, title_sim=1.00 (Rule 3 R-CONSENSUS-PARTIAL path) -> includes R-INCOMPLETE-METADATA
        out_high_consensus = rules.evaluate(
            MatchFeatures(
                title_sim_fuzzy=1.00,
                author_jaccard=0.0,
                year_distance=99,
                doi_exact_match=False,
                source_consensus=2,
            ),
            SourceResult(
                citation_raw=raw,
                candidates=[real_cand_1, real_cand_2],
                sources_queried=["openalex", "semantic_scholar"],
                sources_succeeded=["openalex", "semantic_scholar"],
            ),
            citation_raw=raw,
            citation_authors=["Attention"],
            citation_title="Attention Is All You Need",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_high_consensus.label == ValidationLabel.METADATA_ERROR
        assert "R-INCOMPLETE-METADATA" in out_high_consensus.triggered_rules

    def test_finding5_bare_stubs_and_cay_quyet_dinh_do_not_bypass_r_incomplete_metadata(
        self,
    ) -> None:
        rules = SymbolicRules()
        zero_features = MatchFeatures()

        # 1. Bare Vietnamese/English non-journal stubs missing author, year, and publisher -> R-INCOMPLETE-METADATA
        bare_stubs = [
            "[2] Bài giảng trí tuệ nhân tạo",
            "[2] Giáo trình học máy cơ bản",
            "[2] Tài liệu hướng dẫn sử dụng hệ thống",
            "[2] Luận văn ứng dụng học sâu trong y sinh",
            "[2] Khóa luận tốt nghiệp ngành khoa học máy tính",
            "[2] Technical report on autonomous navigation",
            "[2] White paper on zero trust architecture",
            "[2] Ứng dụng cây quyết định trong phân loại dữ liệu",
            "[2] Hệ hỗ trợ ra quyết định trong quản trị doanh nghiệp",
        ]
        for raw in bare_stubs:
            comp = assess_bibliographic_completeness(
                citation_raw=raw,
                citation_authors=[],
                citation_year=None,
                citation_venue=None,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert comp.has_resolvable_id is False, f"False resolvable ID on {raw}"
            assert comp.is_incomplete is True, f"Expected is_incomplete=True on {raw}"

            outcome = rules.evaluate(
                zero_features,
                SourceResult(
                    citation_raw=raw,
                    candidates=[],
                    sources_queried=["crossref", "openalex"],
                    sources_succeeded=["crossref", "openalex"],
                ),
                citation_raw=raw,
                citation_authors=[],
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert outcome.label == ValidationLabel.METADATA_ERROR, f"Failed on {raw}: {outcome}"
            assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"], f"Failed on {raw}: {outcome}"

        # 2. Complete Vietnamese textbook WITH author + year + publisher keeps is_incomplete=False (R-UNINDEXED-BOOK-OR-SOURCE)
        complete_vn_book = "Nguyễn Văn A (2020). Giáo trình Học máy cơ bản. NXB ĐHQG TP.HCM."
        comp_book = assess_bibliographic_completeness(
            citation_raw=complete_vn_book,
            citation_authors=["Nguyễn Văn A"],
            citation_year="2020",
            citation_venue="NXB ĐHQG TP.HCM",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert comp_book.is_incomplete is False
        out_book = rules.evaluate(
            zero_features,
            SourceResult(
                citation_raw=complete_vn_book,
                candidates=[],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["crossref", "openalex"],
            ),
            citation_raw=complete_vn_book,
            citation_authors=["Nguyễn Văn A"],
            citation_year="2020",
            citation_venue="NXB ĐHQG TP.HCM",
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert out_book.label == ValidationLabel.UNRESOLVED
        assert "R-UNINDEXED-BOOK-OR-SOURCE" in out_book.triggered_rules

        # 3. Genuine numbered Vietnamese legal documents still set has_resolvable_id=True
        for legal_raw in (
            "[1] Nghị định số 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.",
            "[2] Quyết định số 749/QĐ-TTg phê duyệt Chương trình Chuyển đổi số quốc gia.",
            "[3] Luật An ninh mạng năm 2018.",
        ):
            comp_leg = assess_bibliographic_completeness(
                citation_raw=legal_raw,
                citation_authors=[],
                citation_year=None,
                citation_venue=None,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert comp_leg.has_resolvable_id is True, f"Expected resolvable ID on {legal_raw}"
            assert comp_leg.is_incomplete is False

    def test_finding6_dockerfile_prebake_has_no_silent_fallback_pipe(self) -> None:
        dockerfile_path = Path(__file__).resolve().parents[2] / "Dockerfile"
        content = dockerfile_path.read_text(encoding="utf-8")
        assert "paraphrase-multilingual-MiniLM-L12-v2" in content
        assert "onnx/model_qint8_arm64.onnx" in content
        assert "onnx/model_qint8_avx2.onnx" in content
        for line in content.splitlines():
            if "paraphrase-multilingual-MiniLM-L12-v2" in line:
                assert "||" not in line, f"Silent fallback '||' found in Dockerfile pre-bake: {line}"


class TestTask8FixRound2Regressions:
    """Regression suite for Fix Round 2 case-sensitive `author_cue_re` and `and [A-ZÀ-Ỹ]` guards."""

    def test_bare_titles_with_and_or_comma_clause_remain_incomplete_metadata_error(self) -> None:
        rules = SymbolicRules()
        zero_features = MatchFeatures()

        bare_title_cases = [
            ("[2] Design and analysis of wireless sensors", ["Design"]),
            ("[2] Research and innovation in computer science", ["Research"]),
            ("[2] Making, a practical guide to computer science", ["Making"]),
            ("[2] Design and Implementation of Wireless Sensors", ["Design"]),
            ("[2] Design and implementation of mobile robots", ["Design"]),
            ("[2] Unknown and Uncertain Systems in Robotics", ["Unknown"]),
        ]
        for raw, sp_authors in bare_title_cases:
            comp = assess_bibliographic_completeness(
                citation_raw=raw,
                citation_authors=sp_authors,
                citation_year=None,
                citation_venue=None,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert comp.has_real_authors is False, f"Expected has_real_authors=False on {raw}: {comp}"
            assert comp.is_incomplete is True, f"Expected is_incomplete=True on {raw}: {comp}"
            assert "authors" in comp.missing_fields, f"Expected 'authors' in missing_fields on {raw}: {comp}"

            outcome = rules.evaluate(
                zero_features,
                SourceResult(
                    citation_raw=raw,
                    candidates=[],
                    sources_queried=["crossref", "openalex", "semantic_scholar"],
                    sources_succeeded=["crossref", "openalex", "semantic_scholar"],
                ),
                citation_raw=raw,
                citation_authors=sp_authors,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert outcome.label == ValidationLabel.METADATA_ERROR, f"Failed on {raw}: {outcome}"
            assert outcome.triggered_rules == ["R-INCOMPLETE-METADATA"], f"Failed on {raw}: {outcome}"
            assert "R-FAKE-AUTHOR" not in outcome.triggered_rules

    def test_real_single_surname_cues_and_explicit_fake_personas_preserved(self) -> None:
        rules = SymbolicRules()
        zero_features = MatchFeatures()

        # Real single-word surnames with uppercase initials, ampersands, years, or `et al.` remain real authors
        real_author_cases = [
            ("An et al. (2023). Quantum Neural Transformers. Cell, 186, 112-129.", ["An"], "2023"),
            ("Tài (2023). Nghiên cứu mạng lượng tử tự hành.", ["Tài"], "2023"),
            ("An & Lee (2023). Quantum Neural Transformers.", ["An"], "2023"),
            ("An and Lee (2023). Quantum Neural Transformers.", ["An"], "2023"),
            ("An and J. Lee. Quantum Neural Transformers.", ["An"], None),
            ("An, H. (2023). Quantum Neural Transformers.", ["An"], "2023"),
            ("An, H. Quantum Neural Transformers.", ["An"], None),
            ("An; Lee, K. Quantum Neural Transformers.", ["An"], None),
        ]
        for raw, authors, yr in real_author_cases:
            comp = assess_bibliographic_completeness(
                citation_raw=raw,
                citation_authors=authors,
                citation_year=yr,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert comp.has_real_authors is True, f"Expected has_real_authors=True on {raw}: {comp}"

        # Explicit fake personas with `and` or year-less `. Title` still trigger R-FAKE-AUTHOR (0.95)
        fake_cases = [
            ("John Doe and Jane Roe. Quantum Gravity.", ["John Doe", "Jane Roe"], None),
            ("Unknown Author (2023). Fake Title.", ["Unknown Author"], "2023"),
            ("Anonymous Researcher. Fake Study.", ["Anonymous Researcher"], None),
        ]
        for raw, f_authors, yr in fake_cases:
            outcome = rules.evaluate(
                zero_features,
                SourceResult(
                    citation_raw=raw,
                    candidates=[],
                    sources_queried=["crossref", "openalex"],
                    sources_succeeded=["crossref", "openalex"],
                ),
                citation_raw=raw,
                citation_authors=f_authors,
                citation_year=yr,
                citation_type=CitationType.REFERENCE_LIST,
            )
            assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION, f"Failed on {raw}: {outcome}"
            assert "R-FAKE-AUTHOR" in outcome.triggered_rules, f"Failed on {raw}: {outcome}"
            assert outcome.confidence == pytest.approx(0.95)
