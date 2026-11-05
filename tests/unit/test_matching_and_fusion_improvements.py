"""Unit tests for Task 3: Matching, title normalization, and cross-candidate metadata fusion."""

from __future__ import annotations

from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import _VN_EN_ACADEMIC_BRIDGE
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult


def test_corporate_and_acronym_author_matching() -> None:
    """author_match_score should match corporate authors with their standard acronyms."""
    assert author_match_score(["WHO"], ["World Health Organization"]) == 1.0
    assert author_match_score(["World Health Organization"], ["WHO"]) == 1.0
    assert (
        author_match_score(
            ["CDC"], ["Centers for Disease Control and Prevention"]
        )
        == 1.0
    )
    assert (
        author_match_score(
            ["Bộ Giáo dục và Đào tạo (BGDĐT)"], ["BGDĐT"]
        )
        == 1.0
    )


def test_east_asian_same_initial_swapped_author_matching() -> None:
    """author_match_score should handle East-Asian swapped order even when Given and Family share the same initial."""
    assert author_match_score(["Wang, W."], ["Wang Wei"]) == 1.0
    assert author_match_score(["Li, L."], ["Li Lei"]) == 1.0


def test_title_similarity_strips_bracketed_medium_tags() -> None:
    """FeatureCalculator should strip bracketed medium tags like [Online] and [Computer software]."""
    calc = FeatureCalculator(enable_content_alignment=False)
    sim1 = calc._compute_title_similarity(
        "Scikit-learn: Machine learning in Python [Computer software]",
        "Scikit-learn: Machine learning in Python",
    )
    assert sim1 == 1.0

    sim2 = calc._compute_title_similarity(
        "Attention is all you need [Preprint]",
        "Attention Is All You Need",
    )
    assert sim2 == 1.0


def test_title_similarity_matches_bilingual_bracketed_translation() -> None:
    """FeatureCalculator should match either the original title or the bracketed translated title."""
    calc = FeatureCalculator(enable_content_alignment=False)
    cited_bilingual = (
        "Nghiên cứu ảnh hưởng của chuyển đổi số đến doanh nghiệp "
        "[A study on the impact of digital transformation on enterprises]"
    )
    assert (
        calc._compute_title_similarity(
            cited_bilingual.lower(),
            "a study on the impact of digital transformation on enterprises",
        )
        == 1.0
    )
    assert (
        calc._compute_title_similarity(
            cited_bilingual.lower(),
            "nghiên cứu ảnh hưởng của chuyển đổi số đến doanh nghiệp",
        )
        == 1.0
    )


def test_cross_candidate_metadata_fusion_enriches_missing_fields() -> None:
    """FeatureCalculator.compute should fuse missing authors/venue/year from agreeing consensus candidates."""
    calc = FeatureCalculator(enable_content_alignment=False)
    citation = Citation(
        raw_text="Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
        year="2017",
        title="Attention is all you need",
        venue="Advances in Neural Information Processing Systems",
        doi="10.48550/arXiv.1706.03762",
    )
    # Candidate 1 has exact DOI and title, but missing authors and venue
    cand1 = SourceCandidate(
        source_name="Crossref",
        found=True,
        title="Attention Is All You Need",
        authors=[],
        year="2017",
        doi="10.48550/arXiv.1706.03762",
        venue=None,
        confidence=0.95,
    )
    # Candidate 2 has the same title and year, plus full authors and venue
    cand2 = SourceCandidate(
        source_name="dblp",
        found=True,
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
        year="2017",
        doi=None,
        venue="Advances in Neural Information Processing Systems",
        confidence=0.90,
    )
    source = SourceResult(citation_raw=citation.raw_text, candidates=[cand1, cand2])
    features = calc.compute(citation, source)
    assert features.doi_exact_match is True
    assert features.title_sim_fuzzy == 1.0
    assert features.author_jaccard == 1.0
    assert features.venue_sim >= 0.90


def test_expanded_vn_en_academic_bridge_contains_legal_and_cs_concepts() -> None:
    """_VN_EN_ACADEMIC_BRIDGE should include Vietnamese legal, finance, and AI concepts."""
    vn_terms = {vn for vn, _ in _VN_EN_ACADEMIC_BRIDGE}
    assert "phá sản doanh nghiệp" in vn_terms
    assert "trái phiếu doanh nghiệp" in vn_terms
    assert "bồi thường thiệt hại" in vn_terms
    assert "học liên kết" in vn_terms
    assert "mô hình khuếch tán" in vn_terms
