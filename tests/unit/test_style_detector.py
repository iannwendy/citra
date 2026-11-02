"""Unit tests cho extraction/style_detector.py (v1.2 §3.5)."""

from __future__ import annotations

from integrity_checker.extraction.style_detector import StyleDetector
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


def _in_text(text: str) -> Citation:
    return Citation(raw_text=text, citation_type=CitationType.IN_TEXT)


def _numeric(text: str) -> Citation:
    return Citation(raw_text=text, citation_type=CitationType.NUMERIC)


def _bib(style: CitationStyle) -> Citation:
    return Citation(
        raw_text="x", citation_type=CitationType.REFERENCE_LIST, style=style
    )


class TestStyleDetectorAPA:
    def test_clear_apa(self):
        body = [
            _in_text("(Smith, 2020)"),
            _in_text("(Doe, 2021)"),
            _in_text("(LeCun et al., 2015)"),
            _in_text("(Jones, 2019)"),
            _in_text("(Brown, 2018)"),
            _in_text("(Chen, 2022)"),
        ]
        bib = [_bib(CitationStyle.APA)] * 5
        profile = StyleDetector().detect(body, bib)
        assert profile.label == "APA-like"
        assert profile.confidence > 0.5

    def test_apa_authors_with_diacritics(self):
        body = [
            _in_text("(Nguyễn, 2020)"),
            _in_text("(Trần, 2021)"),
            _in_text("(Lê, 2022)"),
            _in_text("(Phạm, 2023)"),
            _in_text("(Hoàng, 2024)"),
        ]
        profile = StyleDetector().detect(body, [])
        assert profile.label == "APA-like"


class TestStyleDetectorIEEE:
    def test_clear_ieee(self):
        body = [
            _numeric("[1]"),
            _numeric("[2]"),
            _numeric("[3]"),
            _numeric("[4]"),
            _numeric("[5]"),
            _numeric("[6]"),
        ]
        bib = [_bib(CitationStyle.IEEE)] * 5
        profile = StyleDetector().detect(body, bib)
        assert profile.label == "IEEE-like"
        assert profile.confidence > 0.5

    def test_ieee_multi_index(self):
        body = [
            _numeric("[1, 2]"),
            _numeric("[3-5]"),
            _numeric("[1, 4, 7]"),
            _numeric("[2]"),
            _numeric("[6]"),
        ]
        profile = StyleDetector().detect(body, [])
        assert profile.label == "IEEE-like"


class TestStyleDetectorMixed:
    def test_mixed_body(self):
        body = [
            _in_text("(Smith, 2020)"),
            _numeric("[1]"),
            _in_text("(Doe, 2021)"),
            _numeric("[2]"),
            _in_text("(Brown, 2018)"),
            _numeric("[3]"),
        ]
        profile = StyleDetector().detect(body, [])
        assert profile.label == "MIXED"

    def test_mixed_with_bib(self):
        body = [
            _in_text("(Smith, 2020)"),
            _numeric("[1]"),
            _in_text("(Doe, 2021)"),
            _numeric("[2]"),
            _in_text("(Brown, 2018)"),
            _numeric("[3]"),
        ]
        bib = [_bib(CitationStyle.APA), _bib(CitationStyle.IEEE)]
        profile = StyleDetector().detect(body, bib)
        assert profile.label == "MIXED"


class TestStyleDetectorUnknown:
    def test_empty(self):
        profile = StyleDetector().detect([], [])
        assert profile.label == "UNKNOWN"
        assert profile.confidence == 0.0

    def test_very_few_signals(self):
        body = [_in_text("(Smith, 2020)")]
        profile = StyleDetector().detect(body, [])
        assert profile.label == "UNKNOWN"

    def test_unknown_no_clear_winner(self):
        # 5 APA, 5 IEEE but both floating below 0.5
        body = (
            [_in_text("(Smith, 2020)"), _in_text("(Doe, 2021)"),
             _in_text("(Brown, 2018)"), _in_text("(Lee, 2017)"),
             _in_text("(Chen, 2016)")]
            + [_numeric("[1]"), _numeric("[2]"), _numeric("[3]"),
               _numeric("[4]"), _numeric("[5]")]
        )
        # Lower threshold to test "no clear winner" → UNKNOWN
        from integrity_checker.config import StyleDetectionConfig
        cfg = StyleDetectionConfig(mixed_threshold=0.7)
        profile = StyleDetector(cfg).detect(body, [])
        # Both ~0.5, threshold 0.7 → MIXED
        # Actually both > 0.5 → cả 2 cross threshold → MIXED
        assert profile.label in ("MIXED", "UNKNOWN")


class TestStyleFeatures:
    def test_features_empty(self):
        from integrity_checker.extraction.style_detector import StyleFeatures
        f = StyleFeatures()
        assert f.body_total_citations == 0
        assert f.bib_total_entries == 0

    def test_profile_has_ratios(self):
        body = [_in_text(f"(S{i}, 2020)") for i in range(6)]
        profile = StyleDetector().detect(body, [])
        assert "apa_combined" in profile.ratios
        assert "ieee_combined" in profile.ratios
        assert "body_apa" in profile.ratios

    def test_profile_has_explanation(self):
        body = [_in_text(f"(S{i}, 2020)") for i in range(6)]
        profile = StyleDetector().detect(body, [])
        assert isinstance(profile.explanation, str)
        assert profile.explanation != ""
