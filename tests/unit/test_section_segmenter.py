"""Unit tests cho extraction/section_segmenter.py (v1.2 §3.4)."""

from __future__ import annotations

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.section_segmenter import (
    SectionSegmenter,
    SectionType,
)


def _doc(*pages_text: str) -> Document:
    return Document(
        file_path="test.pdf",
        num_pages=len(pages_text),
        parser_used="test",
        pages=[Page(page_num=i + 1, text=t) for i, t in enumerate(pages_text)],
    )


class TestSectionType:
    def test_body_is_citable(self):
        assert SectionType.BODY.is_citable is True

    def test_bibliography_not_citable(self):
        assert SectionType.BIBLIOGRAPHY.is_citable is False

    def test_appendix_not_citable(self):
        assert SectionType.APPENDIX.is_citable is False

    def test_unknown_is_citable_by_default(self):
        assert SectionType.UNKNOWN.is_citable is True


class TestSectionSegmenterBasic:
    def test_empty_document(self):
        doc = Document(file_path="x.pdf", num_pages=0, parser_used="t", pages=[])
        assert SectionSegmenter().segment(doc) == []

    def test_body_only_no_bibliography(self):
        doc = _doc("Intro text", "Body text", "Conclusion")
        sections = SectionSegmenter().segment(doc)
        # Không có bibliography → 1 section BODY kéo dài hết
        assert len(sections) == 1
        assert sections[0].section_type == SectionType.BODY
        assert sections[0].start_page == 1
        assert sections[0].end_page == 3


class TestBibliographyHeader:
    def test_english_references(self):
        doc = _doc(
            "Body text",
            "References\nSmith, J. (2020). Title. Journal.",
        )
        sections = SectionSegmenter().segment(doc)
        types = [s.section_type for s in sections]
        assert SectionType.BODY in types
        assert SectionType.BIBLIOGRAPHY in types
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert biblio.start_page == 2

    def test_vietnamese_references(self):
        doc = _doc(
            "Body",
            "Tài liệu tham khảo\nNguyen, V. (2020). Title. Journal.",
        )
        sections = SectionSegmenter().segment(doc)
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert biblio.start_page == 2

    def test_numbered_bibliography_header(self):
        doc = _doc(
            "Body",
            "1. References\nSmith, J. (2020). Title. Journal.",
        )
        sections = SectionSegmenter().segment(doc)
        # "1. References" phải match → biblio bắt đầu từ page 2
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert biblio.start_page == 2

    def test_chapter_references(self):
        doc = _doc(
            "Body",
            "Chapter 4: Methods\n...",
            "References\nSmith, J. (2020). Title.",
        )
        sections = SectionSegmenter().segment(doc)
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert biblio.start_page == 3

    def test_header_below_page_furniture(self):
        """Regression: running header + page number push 'References' down.

        Many theses put the essay title and a standalone page number above the
        bibliography heading, so the heading is no longer in the first 5 lines.
        """
        doc = _doc(
            "Body",
            "FAITH UNDER THE FÜHRER\n\n\n52\n\n\nBibliography\n"
            "Bonhoeffer, D. Letters and Papers from Prison. 2010.",
        )
        sections = SectionSegmenter().segment(doc)
        biblio = next(
            s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY
        )
        assert biblio.start_page == 2

    def test_lowercase_singular_reference_in_table_ignored(self):
        """Regression (thesis.pdf p57): wrapped 'reference' word in table cell is not a header."""
        doc = _doc(
            "Chapter 1",
            "44\nTable 5.1: Implementation status\nSubsystem\nExtraction\nregex\nreference\nparser",
            "55\nREFERENCES\n[1] Lopez, P. (2009). GROBID.",
        )
        sections = SectionSegmenter().segment(doc)
        biblio = next(
            s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY
        )
        assert biblio.start_page == 3


class TestAppendixHeader:
    def test_appendix_after_bibliography(self):
        doc = _doc(
            "Body",
            "References\nSmith, J. (2020). Title.",
            "Appendix A: Extra stuff",
        )
        sections = SectionSegmenter().segment(doc)
        types = [s.section_type for s in sections]
        assert SectionType.BODY in types
        assert SectionType.BIBLIOGRAPHY in types
        assert SectionType.APPENDIX in types
        appendix = next(s for s in sections if s.section_type == SectionType.APPENDIX)
        assert appendix.start_page == 3

    def test_appendix_prose_reference_ignored(self):
        """Regression (thesis.pdf p64): wrapped 'Appendix C, chance-corrected...' is prose, not header."""
        doc = _doc(
            "Body",
            "References\n[1] Lopez, P. (2009). GROBID.",
            "51\nFollowing\nAppendix C, chance-corrected inter-annotator agreement will be computed",
            "58\nAPPENDIX\nAppendix A. Runtime Configuration",
        )
        sections = SectionSegmenter().segment(doc)
        appendix = next(s for s in sections if s.section_type == SectionType.APPENDIX)
        assert appendix.start_page == 4

    def test_appendix_vietnamese(self):
        doc = _doc(
            "Body",
            "Tài liệu tham khảo\n...",
            "Phụ lục A: Extra",
        )
        sections = SectionSegmenter().segment(doc)
        assert any(s.section_type == SectionType.APPENDIX for s in sections)


class TestSectionMetadata:
    def test_section_text_combined(self):
        doc = _doc(
            "Body page 1",
            "References\nSmith, J. (2020). Title.",
            "Doe, A. (2021). Other.",
        )
        sections = SectionSegmenter().segment(doc)
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert "Smith" in biblio.text
        assert "Doe" in biblio.text
        assert biblio.page_break_used is True

    def test_single_page_no_break(self):
        doc = _doc("Body", "References\nSmith, J. (2020). Title.")
        sections = SectionSegmenter().segment(doc)
        biblio = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert biblio.page_break_used is False

    def test_section_ordering(self):
        doc = _doc(
            "Body page 1",
            "Body page 2",
            "References\n...",
            "Appendix",
        )
        sections = SectionSegmenter().segment(doc)
        types = [s.section_type for s in sections]
        # Phải theo thứ tự: BODY, BIBLIOGRAPHY, APPENDIX
        body_idx = types.index(SectionType.BODY)
        biblio_idx = types.index(SectionType.BIBLIOGRAPHY)
        appendix_idx = types.index(SectionType.APPENDIX)
        assert body_idx < biblio_idx < appendix_idx
