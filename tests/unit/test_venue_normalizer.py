"""Tests cho VenueNormalizer (task #30 — Sprint 2)."""

from __future__ import annotations

import pytest

from integrity_checker.matching.venue_normalizer import (
    VenueMatchResult,
    VenueNormalizer,
)


class TestNormalize:
    """normalize() returns canonical full name."""

    def test_jmlr(self) -> None:
        n = VenueNormalizer()
        assert n.normalize("JMLR") == "Journal of Machine Learning Research"

    def test_neurips(self) -> None:
        n = VenueNormalizer()
        assert (
            n.normalize("NeurIPS")
            == "Advances in Neural Information Processing Systems"
        )

    def test_with_punctuation(self) -> None:
        n = VenueNormalizer()
        assert n.normalize("J. Mach. Learn. Res.") == "Journal of Machine Learning Research"

    def test_already_full(self) -> None:
        n = VenueNormalizer()
        assert (
            n.normalize("Journal of Machine Learning Research")
            == "Journal of Machine Learning Research"
        )

    def test_strip_the_prefix(self) -> None:
        n = VenueNormalizer()
        # "The Lancet" → strip "The " → "lancet" → map to "The Lancet"
        assert n.normalize("the lancet") == "The Lancet"

    def test_unknown_returns_normalized(self) -> None:
        n = VenueNormalizer()
        result = n.normalize("Some Unknown Journal of Stuff")
        assert result == "some unknown journal of stuff"

    def test_empty(self) -> None:
        n = VenueNormalizer()
        assert n.normalize("") == ""
        assert n.normalize(None) == ""  # type: ignore[arg-type]

    def test_issn_fallback(self) -> None:
        n = VenueNormalizer()
        result = n.normalize("ISSN 1234-5678")
        assert result == "<ISSN:1234-5678>"

    def test_vietnamese(self) -> None:
        n = VenueNormalizer()
        result = n.normalize("Tạp chí Khoa học và Công nghệ")
        assert result == "Tạp chí Khoa học và Công nghệ"


class TestSimilarity:
    """similarity() returns 0–1 score."""

    def test_identical(self) -> None:
        n = VenueNormalizer()
        assert n.similarity("Nature", "Nature") == 1.0

    def test_abbr_to_full(self) -> None:
        n = VenueNormalizer()
        # PNAS → Proceedings of the National Academy of Sciences
        score = n.similarity("PNAS", "Proc. Natl. Acad. Sci.")
        assert score == 1.0

    def test_different_venues(self) -> None:
        n = VenueNormalizer()
        assert n.similarity("Nature", "Science") == 0.0

    def test_issn_match(self) -> None:
        n = VenueNormalizer()
        assert n.similarity("ISSN 1234-5678", "ISSN 1234-5678") == 1.0

    def test_issn_mismatch(self) -> None:
        n = VenueNormalizer()
        assert n.similarity("ISSN 1234-5678", "ISSN 9999-9999") == 0.0

    def test_partial_overlap_fuzzy(self) -> None:
        n = VenueNormalizer()
        # "Pattern Recognition Letters" vs "Pattern Recognition"
        # norm1 = "pattern recognition letters", norm2 = "pattern recognition"
        # tokens: {pattern, recognition, letters} vs {pattern, recognition}
        # intersect {pattern, recognition} = 2, union {pattern, recognition, letters} = 3
        # 2/3 ≈ 0.667
        score = n.similarity("Pattern Recognition Letters", "Pattern Recognition")
        assert score == pytest.approx(0.667, abs=0.01)

    def test_empty(self) -> None:
        n = VenueNormalizer()
        assert n.similarity("", "Nature") == 0.0
        assert n.similarity("Nature", "") == 0.0


class TestMatch:
    """match() returns detailed VenueMatchResult."""

    def test_dict_match(self) -> None:
        n = VenueNormalizer()
        result = n.match("JMLR", "Journal of Machine Learning Research")
        assert isinstance(result, VenueMatchResult)
        assert result.matched is True
        assert result.method == "dict"
        assert result.score == 1.0

    def test_issn_match(self) -> None:
        n = VenueNormalizer()
        result = n.match("1234-5678", "ISSN 1234-5678")
        assert result.matched is True
        assert result.method == "issn"
        assert result.issn == "1234-5678"

    def test_no_match(self) -> None:
        n = VenueNormalizer()
        result = n.match("Nature", "Science")
        assert result.matched is False
        assert result.method == "fuzzy"
        assert result.score < 0.85

    def test_custom_threshold(self) -> None:
        n = VenueNormalizer()
        # "Pattern Recognition Letters" vs "Pattern Recognition" — score ~0.667
        # With threshold 0.5 → matched
        result = n.match(
            "Pattern Recognition Letters",
            "Pattern Recognition",
            threshold=0.5,
        )
        assert result.matched is True
        assert result.score == pytest.approx(0.667, abs=0.01)

    def test_empty_inputs(self) -> None:
        n = VenueNormalizer()
        result = n.match("", "Nature")
        assert result.matched is False
        assert result.method == "none"
        assert result.score == 0.0

    def test_neurips_aliases_all_match(self) -> None:
        n = VenueNormalizer()
        assert n.match("Neural Information Processing Systems", "NeurIPS").matched is True
        assert n.match("Advances in Neural Information Processing Systems", "NIPS").matched is True
        assert n.match("Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition", "CVPR").matched is True
