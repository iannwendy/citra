"""Unit tests cho models."""

from __future__ import annotations

from integrity_checker.models.citation import Citation, parse_year_safe
from integrity_checker.models.validation import ValidationLabel


def test_parse_year_safe() -> None:
    assert parse_year_safe("Smith, 2020") == "2020"
    assert parse_year_safe("21st century") is None
    assert parse_year_safe("") is None
    assert parse_year_safe("From 1995 to 2020") == "1995"  # lấy match đầu


def test_citation_from_raw_extracts_doi() -> None:
    c = Citation.from_raw("See 10.1038/nature14539 for details.")
    assert c.doi == "10.1038/nature14539"
    assert c.year is None


def test_citation_from_raw_extracts_year() -> None:
    c = Citation.from_raw("Smith (2019) argues...")
    assert c.year == "2019"


def test_validation_label_color() -> None:
    assert ValidationLabel.VERIFIED.color == "#16a34a"
    assert ValidationLabel.SUSPECTED_HALLUCINATION.color == "#dc2626"
    assert ValidationLabel.UNRESOLVED.color == "#6b7280"


def test_citation_to_search_query_prefers_title() -> None:
    c = Citation(
        raw_text="(Smith, 2020)",
        title="Attention is all you need",
        authors=["Vaswani, A."],
        year="2017",
    )
    assert "Attention is all you need" in c.to_search_query()
    assert "Vaswani" in c.to_search_query()
    assert "2017" in c.to_search_query()
