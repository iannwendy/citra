"""Unit tests for v3.70.0 Cross-Lingual ONNX INT8 (Subsystem A3) & Symbolic Rules / CIS Sync.

Covers:
1. `FeatureCalculator._select_best_candidate`: Multilingual ONNX INT8 `cross_lingual_title_similarity`
   candidate selection for specialized Vietnamese/English translated titles outside the static lexicon,
   plus candidate cap (>6 candidates -> top 5 by author/year).
2. `SemanticMatcher.discover_implicit_body_context`: Prefers `_get_multilingual_model()` over
   `_get_model()` whenever Vietnamese diacritics appear in `target_text` or body windows.
3. Bidirectional `VI <-> EN` & `EN -> VI` cross-lingual concept bridge, accurate
   `cross_lingual=VI->EN` / `cross_lingual=EN->VI` diagnostic tags, and `"R-CROSS-LINGUAL-ALIGNMENT"`
   emission on both explicit `citation.context` and `implicit_body_discovery`.
4. `"R-DOI-CONFLICT"` emission when `features.has_doi_conflict=True` in `SymbolicRules`, and
   `"R-DOI-METADATA-MISMATCH"` + `"R-DOI-CONFLICT"` reflection in `CISCalculator` `identifier_validity`.
"""

from __future__ import annotations

import pytest
import torch

from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.vn_en_academic_bridge import (
    bridge_cross_lingual_context,
    compute_cross_lingual_concept_overlap,
    compute_cross_lingual_context_overlap,
    detect_cross_lingual_direction,
)
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)


class _VectorStubEncoder:
    """Deterministic unit-norm tensor encoder mapping substring cues to orthogonal basis vectors."""

    def __init__(self, cue_map: dict[str, list[float]], default_vec: list[float]) -> None:
        self.cue_map = cue_map
        self.default_vec = default_vec
        self.encoded_batches: list[list[str]] = []

    def encode(self, texts, **_kwargs):
        single = isinstance(texts, str)
        items = [texts] if single else list(texts)
        self.encoded_batches.append(items)
        rows = []
        for text in items:
            low = text.lower()
            chosen = self.default_vec
            for cue, vec in self.cue_map.items():
                if cue.lower() in low:
                    chosen = vec
                    break
            t = torch.tensor(chosen, dtype=torch.float32)
            norm = torch.norm(t)
            rows.append(t / norm if norm > 0 else t)
        stacked = torch.stack(rows, dim=0)
        return stacked[0] if single else stacked


# ==============================================================================
# 1. Candidate Selection with Multilingual ONNX INT8 (`features.py`)
# ==============================================================================


def test_select_best_candidate_vn_title_outside_static_lexicon_selects_en_paper():
    """Specialized Vietnamese translated title outside static lexicon selects matching English
    candidate over same-author distractor via `cross_lingual_title_similarity`."""
    vn_title = (
        "Ảnh hưởng của phơi nhiễm hạt vi nhựa polyethylene đối với hệ vi sinh vật đường ruột cá biển"
    )
    en_distractor_title = (
        "Quantum Hall conductivity in twisted bilayer graphene nanoribbon heterostructures"
    )
    en_target_title = (
        "Effects of polyethylene microplastic exposure on marine fish gut microbiota"
    )

    # Confirm static lexicon has < 0.50 overlap on this specialized marine-biology title pair
    xl_ov_target, _ = compute_cross_lingual_concept_overlap(vn_title, en_target_title)
    xl_ov_dist, _ = compute_cross_lingual_concept_overlap(vn_title, en_distractor_title)
    assert xl_ov_target < 0.50
    assert xl_ov_dist < 0.50

    class _StubSemantic:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str]] = []

        def similarity(self, _t1: str, _t2: str) -> float:
            return 0.18

        def cross_lingual_title_similarity(
            self, cited_title: str, candidate_title: str
        ) -> tuple[bool, float, list[str]]:
            self.calls.append((cited_title, candidate_title))
            if "microplastic" in candidate_title.lower():
                return True, 0.84, []
            return True, 0.14, []

    stub_sem = _StubSemantic()
    fc = FeatureCalculator(semantic=stub_sem, enable_content_alignment=False)  # type: ignore[arg-type]

    citation = Citation(
        raw_text=f"Zhang, W. (2023). {vn_title}. Marine Pollution Bulletin.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Zhang, W."],
        year=2023,
        title=vn_title,
        venue="Marine Pollution Bulletin",
    )
    # Place distractor FIRST with slightly higher confidence so without ONNX XL scoring it would win
    distractor_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        title=en_distractor_title,
        authors=["Wei Zhang"],
        year="2023",
        venue="Physical Review B",
        confidence=0.95,
    )
    target_cand = SourceCandidate(
        source_name="crossref",
        found=True,
        title=en_target_title,
        authors=["Wei Zhang"],
        year="2023",
        venue="Marine Pollution Bulletin",
        confidence=0.80,
    )
    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[distractor_cand, target_cand],
        sources_queried=["openalex", "crossref"],
        sources_succeeded=["openalex", "crossref"],
    )

    selected = fc._select_best_candidate(citation, source, citation.authors)
    assert selected is target_cand
    assert len(stub_sem.calls) == 2

    features = fc.compute(citation, source)
    assert features.cross_lingual_title_detected is True
    assert features.cross_lingual_title_sim == pytest.approx(0.84, abs=1e-4)
    assert features.venue_sim >= 0.90


def test_select_best_candidate_reverse_en_cited_title_vs_vn_candidates():
    """Reverse direction (English cited title vs Vietnamese candidates) also invokes ONNX XL scoring."""
    en_cited = "Pharmacological triterpenoid saponins isolated from Panax vietnamensis rhizomes"
    vn_distractor = "Phân tích biến động kinh tế vĩ mô và lạm phát tại khu vực Đông Nam Á"
    vn_target = "Nghiên cứu hợp chất saponin triterpenoid phân lập từ thân rễ Sâm Ngọc Linh"

    class _FloatReturnSemantic:
        def similarity(self, _t1: str, _t2: str) -> float:
            return 0.15

        def cross_lingual_title_similarity(self, _c: str, cand: str) -> float:
            return 0.81 if "Sâm Ngọc Linh" in cand else 0.11

    fc = FeatureCalculator(
        semantic=_FloatReturnSemantic(),  # type: ignore[arg-type]
        enable_content_alignment=False,
    )
    citation = Citation(
        raw_text=f"Tran, Q. L. (2022). {en_cited}.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Tran, Q. L."],
        year=2022,
        title=en_cited,
    )
    c1 = SourceCandidate(
        source_name="doaj",
        found=True,
        title=vn_distractor,
        authors=["Tran Quoc Long"],
        year="2022",
        confidence=0.90,
    )
    c2 = SourceCandidate(
        source_name="vjol",
        found=True,
        title=vn_target,
        authors=["Tran Quoc Long"],
        year="2022",
        confidence=0.80,
    )
    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[c1, c2],
        sources_queried=["doaj", "vjol"],
        sources_succeeded=["doaj", "vjol"],
    )

    selected = fc._select_best_candidate(citation, source, citation.authors)
    assert selected is c2


def test_select_best_candidate_caps_onnx_xl_calls_to_top_five_when_many_candidates():
    """When > 6 candidates exist, ONNX cross-lingual title scoring is capped to top 5 by author/year."""
    vn_title = "Cơ chế hấp phụ kim loại nặng cadmium bằng than sinh học từ vỏ trấu biến tính"

    class _CountingSemantic:
        def __init__(self) -> None:
            self.call_count = 0

        def similarity(self, _t1: str, _t2: str) -> float:
            return 0.10

        def cross_lingual_title_similarity(
            self, _c: str, cand: str
        ) -> tuple[bool, float, list[str]]:
            self.call_count += 1
            if "cadmium adsorption" in cand.lower():
                return True, 0.87, []
            return True, 0.15, []

    counting_sem = _CountingSemantic()
    fc = FeatureCalculator(semantic=counting_sem, enable_content_alignment=False)  # type: ignore[arg-type]

    citation = Citation(
        raw_text=f"Pham, H. T. (2024). {vn_title}.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Pham, H. T."],
        year=2024,
        title=vn_title,
    )

    candidates: list[SourceCandidate] = []
    # 4 low-priority wrong-author/wrong-year distractors
    for idx in range(4):
        candidates.append(
            SourceCandidate(
                source_name="openalex",
                found=True,
                title=f"Unrelated metallurgical crystal growth experiment part {idx + 1}",
                authors=["John Doe"],
                year="2015",
                confidence=0.60,
            )
        )
    # 4 matching-author/year distractors + 1 matching-author/year target (total = 9 > 6)
    for idx in range(4):
        candidates.append(
            SourceCandidate(
                source_name="crossref",
                found=True,
                title=f"Photocatalytic hydrogen evolution over titanium oxide nanosheets {idx + 1}",
                authors=["Pham Hoang Minh"],
                year="2024",
                confidence=0.85,
            )
        )
    target = SourceCandidate(
        source_name="crossref",
        found=True,
        title="Mechanism of heavy metal cadmium adsorption by modified rice husk biochar",
        authors=["Pham Hoang Minh"],
        year="2024",
        confidence=0.82,
    )
    candidates.append(target)

    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=candidates,
        sources_queried=["openalex", "crossref"],
        sources_succeeded=["openalex", "crossref"],
    )

    selected = fc._select_best_candidate(citation, source, citation.authors)
    assert selected is target
    assert counting_sem.call_count == 5


# ==============================================================================
# 2. Multilingual Implicit Body Context Discovery (`semantic.py`)
# ==============================================================================


def test_discover_implicit_body_context_uses_multilingual_model_for_vn_body_and_en_source(
    monkeypatch: pytest.MonkeyPatch,
):
    """When body windows contain Vietnamese diacritics and reference is in English,
    `discover_implicit_body_context` must prefer `_get_multilingual_model()` over `_get_model()`."""
    matcher = SemanticMatcher()
    matcher.enable_multilingual_encoder = True

    # Monolingual stub intentionally points Vietnamese marine window away from English target
    mono_encoder = _VectorStubEncoder(
        cue_map={
            "microplastic": [1.0, 0.0, 0.0],
            "hạt vi nhựa": [0.0, 1.0, 0.0],
            "chứng khoán": [1.0, 0.0, 0.0],
        },
        default_vec=[0.0, 0.0, 1.0],
    )
    # Multilingual stub aligns Vietnamese marine window with English microplastic paper
    multi_encoder = _VectorStubEncoder(
        cue_map={
            "microplastic": [0.98, 0.20, 0.0],
            "hạt vi nhựa": [0.96, 0.28, 0.0],
            "chứng khoán": [0.0, 0.0, 1.0],
        },
        default_vec=[0.0, 1.0, 0.0],
    )

    multi_calls = 0
    mono_calls = 0

    def _fake_get_multi():
        nonlocal multi_calls
        multi_calls += 1
        return multi_encoder

    def _fake_get_mono():
        nonlocal mono_calls
        mono_calls += 1
        return mono_encoder

    monkeypatch.setattr(matcher, "_get_multilingual_model", _fake_get_multi)
    monkeypatch.setattr(matcher, "_get_model", _fake_get_mono)

    body_pages = [
        (
            2,
            "Thị trường chứng khoán phái sinh ghi nhận thanh khoản tăng mạnh trong quý đầu năm. "
            "Các quỹ đầu tư tài chính cơ cấu lại danh mục trái phiếu doanh nghiệp.",
        ),
        (
            5,
            "Phơi nhiễm hạt vi nhựa polyethylene làm suy giảm đa dạng hệ vi sinh vật đường ruột cá biển. "
            "Kết quả mô bệnh học cho thấy tổn thương biểu mô ruột rõ rệt sau bốn tuần thí nghiệm.",
        ),
    ]

    discovered = matcher.discover_implicit_body_context(
        body_pages=body_pages,
        source_title="Effects of polyethylene microplastic exposure on marine fish gut microbiota",
        source_abstract=(
            "Chronic polyethylene microplastic exposure alters intestinal microbial diversity "
            "and induces epithelial inflammation in marine teleost fish."
        ),
        source_authors=["Zhang, Wei"],
    )

    assert discovered is not None
    page_num, passage, score = discovered
    assert multi_calls >= 1
    assert mono_calls == 0
    assert len(multi_encoder.encoded_batches) == 1
    assert page_num == 5
    assert "hạt vi nhựa" in passage.lower()
    assert score >= 0.90


def test_discover_implicit_body_context_uses_multilingual_model_for_en_body_and_vn_source(
    monkeypatch: pytest.MonkeyPatch,
):
    """When body windows are in English and reference `target_text` is in Vietnamese (`EN -> VI`),
    `discover_implicit_body_context` also prefers `_get_multilingual_model()`."""
    matcher = SemanticMatcher()
    matcher.enable_multilingual_encoder = True

    multi_encoder = _VectorStubEncoder(
        cue_map={
            "bảo vệ dữ liệu cá nhân": [1.0, 0.0, 0.0],
            "personal data protection": [0.95, 0.31, 0.0],
            "reinforced concrete": [0.0, 1.0, 0.0],
        },
        default_vec=[0.0, 0.0, 1.0],
    )

    multi_called = False
    mono_called = False

    def _fake_multi():
        nonlocal multi_called
        multi_called = True
        return multi_encoder

    def _fake_mono():
        nonlocal mono_called
        mono_called = True
        return None

    monkeypatch.setattr(matcher, "_get_multilingual_model", _fake_multi)
    monkeypatch.setattr(matcher, "_get_model", _fake_mono)

    body_pages = [
        (
            3,
            "Shear strength of reinforced concrete beams under cyclic seismic loading was measured. "
            "Finite element simulations matched structural laboratory observations.",
        ),
        (
            7,
            "Cross-border cloud operators must obtain explicit user consent for personal data protection. "
            "Data controllers are required to file impact assessments with Vietnamese regulators.",
        ),
    ]

    discovered = matcher.discover_implicit_body_context(
        body_pages=body_pages,
        source_title="Nghị định quy định về bảo vệ dữ liệu cá nhân tại Việt Nam",
        source_abstract="Quy định chi tiết nghĩa vụ đồng ý của chủ thể dữ liệu và đánh giá tác động xử lý dữ liệu cá nhân.",
        source_authors=["Chính phủ"],
    )

    assert discovered is not None
    page_num, passage, score = discovered
    assert multi_called is True
    assert mono_called is False
    assert page_num == 7
    assert "personal data protection" in passage.lower()
    assert score >= 0.90


def test_discover_implicit_body_context_monolingual_en_and_multilingual_none_fallback(
    monkeypatch: pytest.MonkeyPatch,
):
    """Monolingual English windows use `_get_model()` without loading multilingual weights;
    Vietnamese windows fall back cleanly to `_get_model()` when `_get_multilingual_model()` returns None."""
    matcher = SemanticMatcher()
    mono_encoder = _VectorStubEncoder(
        cue_map={"transformer": [1.0, 0.0, 0.0]},
        default_vec=[0.8, 0.6, 0.0],
    )
    multi_calls = 0
    mono_calls = 0

    def _none_multi():
        nonlocal multi_calls
        multi_calls += 1
        return None

    def _ok_mono():
        nonlocal mono_calls
        mono_calls += 1
        return mono_encoder

    monkeypatch.setattr(matcher, "_get_multilingual_model", _none_multi)
    monkeypatch.setattr(matcher, "_get_model", _ok_mono)

    en_pages = [
        (
            4,
            "Self-attention layers in the Transformer architecture replace recurrent sequence models. "
            "Multi-head attention enables parallel token representation learning.",
        )
    ]
    res_en = matcher.discover_implicit_body_context(
        body_pages=en_pages,
        source_title="Attention Is All You Need: Transformer Architecture",
        source_abstract="We propose the Transformer based solely on attention mechanisms.",
    )
    assert res_en is not None
    assert multi_calls == 0
    assert mono_calls == 1

    vn_pages = [
        (
            6,
            "Kiến trúc Transformer sử dụng cơ chế tự chú ý giúp tăng tốc độ huấn luyện mô hình dịch máy. "
            "Phương pháp này loại bỏ hoàn toàn các tầng hồi quy tuần tự.",
        )
    ]
    res_vn = matcher.discover_implicit_body_context(
        body_pages=vn_pages,
        source_title="Attention Is All You Need: Transformer Architecture",
        source_abstract="We propose the Transformer based solely on attention mechanisms.",
    )
    assert res_vn is not None
    assert multi_calls == 1
    assert mono_calls == 2


def test_select_best_candidate_skips_onnx_when_static_lexicon_overlap_already_high():
    """When static lexicon overlap `xl_ov >= 0.50`, `_select_best_candidate` boosts `t_sim`
    directly without invoking `cross_lingual_title_similarity`."""
    vn_title = "Ứng dụng học sâu và mạng nơ-ron tích chập trong phân loại ảnh y tế"
    en_target = "Deep learning and convolutional neural networks for medical image classification"
    en_distractor = "Macroeconomic monetary policy transmission in emerging markets"

    class _NoCallSemantic:
        def __init__(self) -> None:
            self.xl_calls = 0

        def similarity(self, _a: str, _b: str) -> float:
            return 0.15

        def cross_lingual_title_similarity(self, _a: str, b: str):
            self.xl_calls += 1
            return (True, 0.90, []) if "deep learning" in b.lower() else (True, 0.12, [])

    sem = _NoCallSemantic()
    fc = FeatureCalculator(semantic=sem, enable_content_alignment=False)  # type: ignore[arg-type]
    cit = Citation(
        raw_text=f"Le, M. (2023). {vn_title}.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Le, M."],
        year=2023,
        title=vn_title,
    )
    d_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        title=en_distractor,
        authors=["Minh Le"],
        year="2023",
        confidence=0.90,
    )
    t_cand = SourceCandidate(
        source_name="crossref",
        found=True,
        title=en_target,
        authors=["Minh Le"],
        year="2023",
        confidence=0.85,
    )
    src = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[d_cand, t_cand],
        sources_queried=["openalex", "crossref"],
        sources_succeeded=["openalex", "crossref"],
    )

    chosen = fc._select_best_candidate(cit, src, cit.authors)
    assert chosen is t_cand
    # Target had static xl_ov >= 0.50, so ONNX XL was only called on distractor (1 call, not 2)
    assert sem.xl_calls == 1


# ==============================================================================
# 3. Bidirectional `VI <-> EN` Concept Bridge & Implicit Context Rule Tagging
# ==============================================================================


def test_bidirectional_vn_en_academic_bridge_overlap_and_direction():
    """Verify `VI->EN` and `EN->VI` concept overlap and directional formatting."""
    vi_ctx = "Mô hình học sâu và mạng nơ-ron tích chập giúp cải thiện phân loại ảnh y tế."
    en_src = "Deep learning with convolutional neural networks for medical image classification."

    assert detect_cross_lingual_direction(vi_ctx, en_src) == "VI->EN"
    ov_vi_en, pairs_vi_en = compute_cross_lingual_context_overlap(vi_ctx, en_src)
    assert ov_vi_en >= 0.65
    assert any("học sâu → deep learning" in p for p in pairs_vi_en)

    en_ctx = (
        "Our thesis applies machine learning and natural language processing to sentiment analysis."
    )
    vi_src = (
        "Giáo trình Học máy và Xử lý ngôn ngữ tự nhiên trong bài toán phân tích cảm xúc văn bản."
    )

    assert detect_cross_lingual_direction(en_ctx, vi_src) == "EN->VI"
    ov_en_vi, pairs_en_vi = compute_cross_lingual_context_overlap(en_ctx, vi_src)
    assert ov_en_vi >= 0.65
    assert any("machine learning" in p and "→ học máy" in p for p in pairs_en_vi)
    assert any(
        "natural language processing" in p and "→ xử lý ngôn ngữ tự nhiên" in p
        for p in pairs_en_vi
    )

    is_xl, bridged, concepts, direction = bridge_cross_lingual_context(en_ctx, vi_src)
    assert is_xl is True
    assert direction == "EN->VI"
    assert len(concepts) >= 2
    assert bridged


def test_neuro_symbolic_checker_en_to_vi_textbook_and_statute_tag_direction():
    """English thesis citing (a) a Vietnamese university textbook and (b) a Vietnamese legal statute
    emits `R-CROSS-LINGUAL-ALIGNMENT` and formats `cross_lingual=EN->VI`."""

    class _StubXLSemantic:
        def similarity(self, _t1: str, _t2: str) -> float:
            return 0.95

        def cross_lingual_title_similarity(
            self, ctx: str, src: str
        ) -> tuple[bool, float, list[str]]:
            if "data protection" in ctx.lower() and "dữ liệu cá nhân" in src.lower():
                return True, 0.78, ["personal data protection → bảo vệ dữ liệu cá nhân"]
            if "machine learning" in ctx.lower() and "học máy" in src.lower():
                return True, 0.82, ["machine learning → học máy"]
            return False, 0.15, []

        def check_content_alignment(
            self,
            cited_context: str,
            source_title: str,
            source_abstract: str | None = None,
            source_body: str | None = None,
            citation_marker: str | None = None,
        ):
            from integrity_checker.matching.semantic import SemanticAlignmentResult

            return SemanticAlignmentResult(
                similarity=0.35,
                confidence="low",
                is_aligned=False,
                compared_texts={"cited_context": cited_context, "source_title": source_title},
            )

    fc = FeatureCalculator(
        semantic=_StubXLSemantic(),  # type: ignore[arg-type]
        enable_content_alignment=True,
    )
    checker = NeuroSymbolicChecker(
        feature_calculator=fc,
        enable_content_alignment=True,
        enable_calibration=False,
    )

    # (a) English thesis citing Vietnamese university textbook
    tb_citation = Citation(
        raw_text="Nguyễn, V. H. (2021). Giáo trình Học máy và Khai phá dữ liệu. NXB Đại học Quốc gia.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Nguyễn, V. H."],
        year=2021,
        title="Giáo trình Học máy và Khai phá dữ liệu",
        venue="NXB Đại học Quốc gia",
    )
    tb_source = SourceResult(
        citation_raw=tb_citation.raw_text,
        candidates=[
            SourceCandidate(
                source_name="tech_standard",
                found=True,
                title="Giáo trình Học máy và Khai phá dữ liệu",
                authors=["Nguyễn Văn Hiếu"],
                year="2021",
                venue="NXB Đại học Quốc gia",
                abstract="Trình bày các thuật toán học máy, cây quyết định và khai phá dữ liệu.",
                external_ids={"vn_textbook_id": "vn-tb-ml-2021"},
                confidence=0.95,
            )
        ],
        sources_queried=["tech_standard"],
        sources_succeeded=["tech_standard"],
    )
    en_thesis_ctx = (
        "Following Nguyễn (2021), we train supervised machine learning and data mining "
        "classifiers on tabular student retention records."
    )

    tb_verdict = checker.check(tb_citation, tb_source, citation_context=en_thesis_ctx)
    assert tb_verdict.label == ValidationLabel.VERIFIED
    assert "R-VN-TEXTBOOK-VERIFIED" in tb_verdict.triggered_rules
    assert "R-CROSS-LINGUAL-ALIGNMENT" in tb_verdict.triggered_rules
    assert "cross_lingual=EN->VI" in tb_verdict.reasoning
    assert "cross_lingual=VI->EN" not in tb_verdict.reasoning

    # (b) English thesis citing Vietnamese statute (Check 3 legal verifier path)
    legal_citation = Citation(
        raw_text="Chính phủ (2023). Nghị định số 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.",
        citation_type=CitationType.REFERENCE_LIST,
        matched_pattern="vn_legal_document",
        year=2023,
        title="Nghị định số 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân",
    )
    legal_source = SourceResult(citation_raw=legal_citation.raw_text)
    en_legal_ctx = (
        "Under Decree 13/2023/ND-CP on personal data protection, fintech platforms operating "
        "in Vietnam must obtain explicit informed consent prior to processing biometric data."
    )

    legal_verdict = checker.check(
        legal_citation, legal_source, citation_context=en_legal_ctx
    )
    assert legal_verdict.label == ValidationLabel.RESOURCE
    assert "R-CROSS-LINGUAL-ALIGNMENT" in legal_verdict.triggered_rules
    assert "cross_lingual=EN->VI" in legal_verdict.reasoning


def test_neuro_symbolic_checker_implicit_body_discovery_emits_cross_lingual_rule():
    """Cross-lingual alignment via `context_source == 'implicit_body_discovery'` (both via
    `citation.context` and via `precomputed_features`) rescues alignment with ONNX cosine
    similarity and appends `R-CROSS-LINGUAL-ALIGNMENT` + `cross_lingual=VI->EN`."""

    class _ImplicitONNXSemantic:
        def __init__(self) -> None:
            self.xl_calls: list[tuple[str, str]] = []

        def similarity(self, _t1: str, _t2: str) -> float:
            return 0.98

        def cross_lingual_title_similarity(
            self, ctx: str, src: str
        ) -> tuple[bool, float, list[str]]:
            self.xl_calls.append((ctx, src))
            if "hạt vi nhựa" in ctx.lower() and "microplastic" in src.lower():
                return True, 0.79, []
            return False, 0.10, []

        def check_content_alignment(
            self,
            cited_context: str,
            source_title: str,
            source_abstract: str | None = None,
            source_body: str | None = None,
            citation_marker: str | None = None,
        ):
            from integrity_checker.matching.semantic import SemanticAlignmentResult

            # Simulate monolingual pass missing specialized non-lexicon Vietnamese paragraph
            return SemanticAlignmentResult(
                similarity=0.22,
                confidence="low",
                is_aligned=False,
                compared_texts={"cited_context": cited_context, "source_title": source_title},
            )

    sem = _ImplicitONNXSemantic()
    fc = FeatureCalculator(semantic=sem, enable_content_alignment=True)  # type: ignore[arg-type]
    checker = NeuroSymbolicChecker(
        feature_calculator=fc,
        enable_content_alignment=True,
        enable_calibration=False,
    )

    citation = Citation(
        raw_text=(
            "Zhang, W., & Liu, Y. (2023). Effects of polyethylene microplastic exposure on "
            "marine fish gut microbiota. Marine Pollution Bulletin, 188, 114620."
        ),
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Zhang, W.", "Liu, Y."],
        year=2023,
        title="Effects of polyethylene microplastic exposure on marine fish gut microbiota",
        venue="Marine Pollution Bulletin",
        context=(
            "Sự phơi nhiễm hạt vi nhựa polyethylene kéo dài làm rối loạn hệ vi sinh vật "
            "đường ruột và gây viêm niêm mạc ở các loài cá biển ven bờ."
        ),
    )
    citation._context_source = "implicit_body_discovery"  # type: ignore[attr-defined]

    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                title="Effects of polyethylene microplastic exposure on marine fish gut microbiota",
                authors=["Wei Zhang", "Yang Liu"],
                year="2023",
                venue="Marine Pollution Bulletin",
                abstract=(
                    "Chronic polyethylene microplastic exposure disrupts gut microbiota "
                    "composition and triggers intestinal mucosal inflammation in marine fish."
                ),
                confidence=0.95,
            ),
            SourceCandidate(
                source_name="openalex",
                found=True,
                title="Effects of polyethylene microplastic exposure on marine fish gut microbiota",
                authors=["Wei Zhang", "Yang Liu"],
                year="2023",
                venue="Marine Pollution Bulletin",
                confidence=0.92,
            ),
        ],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref", "openalex"],
    )

    # Case A: `citation.context` + `_context_source = "implicit_body_discovery"` with citation_context=None
    verdict_a = checker.check(citation, source, citation_context=None)
    assert verdict_a.label == ValidationLabel.VERIFIED
    assert verdict_a.features.context_source == "implicit_body_discovery"
    assert verdict_a.features.content_is_aligned is True
    assert verdict_a.features.content_alignment_score >= 0.75
    assert "R-CROSS-LINGUAL-ALIGNMENT" in verdict_a.triggered_rules
    assert "cross_lingual=VI->EN" in verdict_a.reasoning
    assert len(sem.xl_calls) >= 1

    # Case B: `compare_evidence` -> `check(..., citation_context=None, precomputed_features=pre)`
    pre = checker.compare_evidence(citation, source, citation_context=None)
    assert pre is not None
    assert pre.context_source == "implicit_body_discovery"
    assert pre.content_is_aligned is True
    verdict_b = checker.check(
        citation, source, citation_context=None, precomputed_features=pre
    )
    assert "R-CROSS-LINGUAL-ALIGNMENT" in verdict_b.triggered_rules
    assert "cross_lingual=VI->EN" in verdict_b.reasoning


def test_neuro_symbolic_checker_polarity_inversion_not_rescued_by_cross_lingual():
    """Refuting cross-lingual claim (`stance_label == 'contradiction_risk'`) must NOT emit
    `R-CROSS-LINGUAL-ALIGNMENT` and must emit `R-CONTENT-MISMATCH`."""
    fc = FeatureCalculator(enable_content_alignment=False)
    checker = NeuroSymbolicChecker(
        feature_calculator=fc,
        enable_content_alignment=True,
        enable_calibration=False,
    )
    checker.semantic = type(
        "_StubSem",
        (),
        {"cross_lingual_title_similarity": staticmethod(lambda _c, _s: (True, 0.76, []))},
    )()

    citation = Citation(
        raw_text="Chawla, N. V. (2002). SMOTE: Synthetic Minority Over-sampling Technique.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Chawla, N. V."],
        year=2002,
        title="SMOTE: Synthetic Minority Over-sampling Technique",
    )
    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                title="SMOTE: Synthetic Minority Over-sampling Technique",
                authors=["Nitesh V. Chawla"],
                year="2002",
                abstract="SMOTE improves classifier performance on imbalanced datasets.",
                confidence=0.95,
            )
        ],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    pre = MatchFeatures(
        title_sim_fuzzy=1.0,
        title_sim_semantic=1.0,
        author_jaccard=1.0,
        year_distance=0,
        source_consensus=1,
        content_alignment_score=0.62,
        content_alignment_confidence="medium",
        content_is_aligned=False,
        stance_label="contradiction_risk",
        cross_lingual_detected=True,
        context_source="implicit_body_discovery",
        best_cited_sentence="Nghiên cứu của Chawla chứng minh SMOTE hoàn toàn thất bại và không hiệu quả.",
    )

    verdict = checker.check(citation, source, precomputed_features=pre)
    assert "R-CONTENT-MISMATCH" in verdict.triggered_rules
    assert "R-CROSS-LINGUAL-ALIGNMENT" not in verdict.triggered_rules


# ==============================================================================
# 4. `R-DOI-CONFLICT` (`rules.py`) & `R-DOI-METADATA-MISMATCH` (`cis.py`)
# ==============================================================================


def test_rules_appends_r_doi_conflict_when_features_has_doi_conflict_true():
    """When `features.has_doi_conflict` is True, `SymbolicRules.apply` appends `R-DOI-CONFLICT`
    without altering existing verdict labels, while arXiv-vs-published DOI remains exempt."""
    rules = SymbolicRules()

    # Path 1: Multi-source consensus match with conflicting DOI
    source_consensus = SourceResult(
        citation_raw="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature. doi:10.1038/wrong999",
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                title="Deep learning",
                doi="10.1038/nature14539",
                authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
                year="2015",
                venue="Nature",
                confidence=0.95,
            ),
            SourceCandidate(
                source_name="openalex",
                found=True,
                title="Deep learning",
                doi="10.1038/nature14539",
                authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
                year="2015",
                venue="Nature",
                confidence=0.95,
            ),
        ],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref", "openalex"],
    )
    fc = FeatureCalculator(enable_content_alignment=False)
    cit_conflict = Citation(
        raw_text=source_consensus.citation_raw,
        citation_type=CitationType.REFERENCE_LIST,
        authors=["LeCun, Y.", "Bengio, Y.", "Hinton, G."],
        year=2015,
        title="Deep learning",
        venue="Nature",
        doi="10.1038/wrong999",
    )
    computed_features = fc.compute(cit_conflict, source_consensus)
    assert getattr(computed_features, "has_doi_conflict", False) is True

    outcome = rules.apply(
        computed_features,
        source_consensus,
        citation_doi=cit_conflict.doi,
        citation_authors=cit_conflict.authors,
        citation_year=cit_conflict.year,
        citation_raw=cit_conflict.raw_text,
        citation_venue=cit_conflict.venue,
        citation_title=cit_conflict.title,
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "R-CONSENSUS-PARTIAL" in outcome.triggered_rules
    assert "R-DOI-CONFLICT" in outcome.triggered_rules
    assert outcome.triggered_rules.count("R-DOI-CONFLICT") == 1
    assert "doi" in outcome.mismatched_fields

    # Path 2: Direct `MatchFeatures` instance with `has_doi_conflict=True` on single live source
    single_source = SourceResult(
        citation_raw=cit_conflict.raw_text,
        candidates=[source_consensus.candidates[0]],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    manual_features = MatchFeatures(
        title_sim_fuzzy=0.98,
        title_sim_semantic=0.98,
        author_jaccard=1.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=1,
    )
    manual_features.has_doi_conflict = True  # type: ignore[attr-defined]
    single_outcome = rules.apply(
        manual_features,
        single_source,
        citation_doi="10.1038/wrong999",
        citation_authors=cit_conflict.authors,
        citation_year=2015,
        citation_title="Deep learning",
    )
    assert "R-DOI-CONFLICT" in single_outcome.triggered_rules

    # Path 3: arXiv preprint DOI vs published conference DOI on matching paper -> NO conflict
    cit_arxiv = Citation(
        raw_text="Devlin, J. (2019). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Devlin, J."],
        year=2019,
        title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        doi="10.48550/arXiv.1810.04805",
    )
    src_pub = SourceResult(
        citation_raw=cit_arxiv.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                doi="10.18653/v1/N19-1423",
                authors=["Jacob Devlin"],
                year="2019",
                confidence=0.95,
            )
        ],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    arxiv_features = fc.compute(cit_arxiv, src_pub)
    assert getattr(arxiv_features, "has_doi_conflict", False) is False
    arxiv_outcome = rules.apply(
        arxiv_features,
        src_pub,
        citation_doi=cit_arxiv.doi,
        citation_authors=cit_arxiv.authors,
        citation_year=2019,
        citation_title=cit_arxiv.title,
    )
    assert "R-DOI-CONFLICT" not in arxiv_outcome.triggered_rules


def test_cis_identifier_validity_reflects_r_doi_metadata_mismatch_and_r_doi_conflict():
    """`CISCalculator` must count both `R-DOI-METADATA-MISMATCH` and `R-DOI-CONFLICT`
    as invalid identifiers in `identifier_validity` (both academic and resource-only paths)."""
    calc = CISCalculator()

    valid_verdict = CitationVerdict(
        citation=Citation(
            raw_text="LeCun, Y. (2015). Deep learning. Nature.",
            doi="10.1038/nature14539",
        ),
        label=ValidationLabel.VERIFIED,
        confidence=0.95,
        triggered_rules=["R-CONSENSUS-FULL"],
    )
    doi_meta_mismatch_verdict = CitationVerdict(
        citation=Citation(
            raw_text="Smith, J. (2020). J. Am. Chem. Soc. 2020, 142, 100.",
            doi="10.1021/jacs.9b00001",
        ),
        label=ValidationLabel.METADATA_ERROR,
        confidence=0.72,
        triggered_rules=["R-DOI-METADATA-MISMATCH"],
        mismatched_fields=["author"],
    )
    doi_conflict_verdict = CitationVerdict(
        citation=Citation(
            raw_text="Hinton, G. (2015). Distilling the knowledge in a neural network.",
            doi="10.1000/conflicting.doi",
        ),
        label=ValidationLabel.METADATA_ERROR,
        confidence=0.65,
        triggered_rules=["R-CONSENSUS-PARTIAL", "R-DOI-CONFLICT"],
        mismatched_fields=["doi"],
    )

    cis_meta_mismatch = calc.compute([valid_verdict, doi_meta_mismatch_verdict])
    assert cis_meta_mismatch.components.identifier_validity == pytest.approx(0.50)

    cis_doi_conflict = calc.compute([valid_verdict, doi_conflict_verdict])
    assert cis_doi_conflict.components.identifier_validity == pytest.approx(0.50)

    cis_all_three = calc.compute(
        [valid_verdict, doi_meta_mismatch_verdict, doi_conflict_verdict]
    )
    assert cis_all_three.components.identifier_validity == pytest.approx(1.0 / 3.0)

    # Resource-only path check
    res_valid = CitationVerdict(
        citation=Citation(
            raw_text="https://docs.python.org/3/",
            url="https://docs.python.org/3/",
        ),
        label=ValidationLabel.RESOURCE,
        confidence=0.95,
        triggered_rules=["R-URL-RESOURCE"],
    )
    res_doi_mismatch = CitationVerdict(
        citation=Citation(
            raw_text="https://doi.org/10.1000/mismatch",
            doi="10.1000/mismatch",
        ),
        label=ValidationLabel.RESOURCE,
        confidence=0.70,
        triggered_rules=["R-DOI-METADATA-MISMATCH"],
    )
    cis_res = calc.compute([res_valid, res_doi_mismatch])
    assert cis_res.components.identifier_validity == pytest.approx(0.50)
