"""Tests for implicit bibliography detection in SectionSegmenter.

Covers Fix 1 from PLAN_fix_ref_extraction.md.
"""


from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.section_segmenter import (
    SectionSegmenter,
    SectionType,
)


class TestImplicitBibliographyDetection:
    """Test implicit bibliography detection when PDF has no References header."""

    def _make_doc(self, pages: list[Page]) -> Document:
        """Helper to create a Document."""
        return Document(
            file_path="test.pdf",
            num_pages=len(pages),
            pages=pages,
            parser_used="test",
        )

    def test_explicit_header_still_works(self):
        """Explicit 'References' header should still be detected."""
        pages = [
            Page(page_num=1, text="Introduction\nStudy methodology", has_text_layer=True),
            Page(page_num=2, text="Results and discussion", has_text_layer=True),
            Page(page_num=3, text="References\n[1] Author, Title, 2020.", has_text_layer=True),
        ]
        doc = self._make_doc(pages)
        sections = SectionSegmenter().segment(doc)

        assert len(sections) >= 2
        biblio = next((s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY), None)
        assert biblio is not None
        assert biblio.start_page == 3

    def test_implicit_bibliography_detected(self):
        """IEEE-style [N] pages after page 10 should trigger implicit bibliography."""
        pages = []
        # Body pages (no [N] markers)
        for i in range(1, 18):
            pages.append(Page(
                page_num=i,
                text="Introduction to research methodology\nStudy examines depression.",
                has_text_layer=True,
            ))
        # Bibliography pages (no header, many [N] markers)
        pages.append(Page(page_num=18, text="\n".join([
            "[8] Y. Liu, Y. Yang, D. Waller, M. Strowd, and R. Leggieri,",
            "\"Promoting Inclusion in Text-Based Online Peer-Support Communities,\"",
            "ACM Transactions on Social Computing, vol. 5, no. 3-4, pp. 1-19, 2022.",
            "[9] D. Yates, S. Wood, and G. Phuong,",
            "\"Youth Depression and Suicide in Vietnam: A Cross-Cultural Perspective,\"",
            "International Journal of Social Psychiatry, vol. 68, no. 3, pp. 576-584, 2022.",
            "[10] S. Cao, Y. Guo, Y. Ren, Y. Zhang, H. Liu, Y. Li, W. Chen, and C. Yang,",
            "\"Examination of Social Media Use, Emotional Distress and Depression among Chinese",
            "University Students During COVID-19,\" Journal of Technology in Behavioral Science, 2023.",
        ]), has_text_layer=True))
        pages.append(Page(page_num=19, text="\n".join([
            "[11] M. P. Davis et al., \"Depression and Anxiety among College Students During COVID-19,\"",
            "Journal of American College Health, 2022.",
            "[12] R. L. Szklo, \"Social Media and Mental Health: A Review,\"",
            "Journal of Medical Internet Research, 2023.",
        ]), has_text_layer=True))

        doc = self._make_doc(pages)
        sections = SectionSegmenter().segment(doc)

        # Should have body + bibliography sections
        body = next((s for s in sections if s.section_type == SectionType.BODY), None)
        biblio = next((s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY), None)

        assert body is not None, "Body section should exist"
        assert biblio is not None, "Bibliography section should be detected"
        assert biblio.start_page == 18
        assert biblio.end_page == 19
        assert body.end_page == 17

    def test_no_bibliography_short_document(self):
        """Short documents without bibliography should not crash."""
        pages = [
            Page(page_num=1, text="Short essay content.", has_text_layer=True),
            Page(page_num=2, text="More content without references.", has_text_layer=True),
        ]
        doc = self._make_doc(pages)
        sections = SectionSegmenter().segment(doc)

        assert all(s.section_type == SectionType.BODY for s in sections)

    def test_body_only_if_no_bibliography_found(self):
        """Document with no [N] pages should be entirely body."""
        pages = [
            Page(page_num=1, text="Chapter 1. Introduction\nBackground information.", has_text_layer=True),
            Page(page_num=2, text="Chapter 2. Methods\nStudy design.", has_text_layer=True),
            Page(page_num=3, text="Chapter 3. Results\nData analysis.", has_text_layer=True),
            Page(page_num=4, text="Chapter 4. Discussion\nImplications.", has_text_layer=True),
            Page(page_num=5, text="Chapter 5. Conclusion\nSummary of findings.", has_text_layer=True),
            Page(page_num=6, text="End of essay.", has_text_layer=True),
        ]
        doc = self._make_doc(pages)
        sections = SectionSegmenter().segment(doc)

        # All body, no bibliography
        assert all(s.section_type == SectionType.BODY for s in sections)
        body = next((s for s in sections if s.section_type == SectionType.BODY), None)
        assert body is not None
        assert body.end_page == 6


class TestReferenceParserFallback:
    """Test fallback parser for IEEE entries without quoted titles."""

    def test_fallback_parses_entry_without_quotes(self):
        """Entry without quoted title should be parsed with fallback parser."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        parser = ReferenceListParser()
        entry = (
            "[15] Y. Liu, D. Smith, A. Jones, "
            "Promoting Inclusion in Online Communities, "
            "ACM Transactions on Social Computing, vol. 5, 2022."
        )
        c = parser._parse_entry(entry, order_index=1, page_num=18)

        assert c is not None
        assert c.numeric_index == 15
        assert c.style.value == "IEEE"
        assert c.matched_pattern == "fallback_ieee_entry"
        assert c.year == "2022"
        # Fallback parser extracts year and numeric_index; title may be None for entries without quotes
        # Title extraction is best-effort for unstructured entries

    def test_fallback_extracts_doi(self):
        """Fallback parser should extract DOI from entry."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        parser = ReferenceListParser()
        entry = (
            "[16] V. Nguyen, T. Tran, "
            "Social Media and Mental Health in Vietnam, "
            "ACM Transactions, 2023. doi: 10.1145/1234567.8901"
        )
        c = parser._parse_entry(entry, order_index=1, page_num=18)

        assert c is not None
        assert c.doi == "10.1145/1234567.8901"
        assert c.numeric_index == 16

    def test_ieee_parser_still_works_with_quotes(self):
        """IEEE parser should still work with standard quoted titles."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        parser = ReferenceListParser()
        entry = (
            '[8] Y. Liu et al., "Promoting Inclusion in Text-Based Online '
            'Peer-Support Communities," ACM Transactions on Social Computing, 2022.'
        )
        c = parser._parse_entry(entry, order_index=1, page_num=18)

        assert c is not None
        assert c.numeric_index == 8
        assert c.title == "Promoting Inclusion in Text-Based Online Peer-Support Communities"
        # matched_pattern can be either "ieee_reference_entry" or "ieee_quote_based"
        # Both are valid IEEE parsing strategies that extract the correct metadata
        assert c.matched_pattern in ("ieee_reference_entry", "ieee_quote_based")


class TestNumericCitationMetadataPopulation:
    """Test Fix 3: metadata population for numeric in-text citations."""

    def test_metadata_populated_for_numeric_citation(self):
        """Numeric in-text citation should get metadata from matched reference."""
        from integrity_checker.linking.statuses import CitationMappingStatus, MappingMethod
        from integrity_checker.models.citation import Citation, CitationStyle, CitationType
        from integrity_checker.models.validation import CitationLink
        from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

        # Reference entry with full metadata
        ref = Citation(
            raw_text='[1] Y. Liu et al., "RoBERTa," ACL, 2020.',
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            reference_id="ref-0001",
            numeric_index=1,
            title="RoBERTa: A Robustly Optimized BERT Pretraining Approach",
            year="2020",
            authors=["Liu Y."],
            doi="10.48550/arXiv.1907.11692",
        )

        # In-text citation with only [1] - no title/author/year
        in_text = Citation(
            raw_text="[1]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-0001",
            numeric_index=1,
        )

        # Build link: occ-0001 → ref-0001
        link = CitationLink(
            occurrence_id="occ-0001",
            reference_id="ref-0001",
            status=CitationMappingStatus.MATCHED,
            confidence=0.9,
            method=MappingMethod.NUMERIC_INDEX,
        )
        link_lookup = {"occ-0001": link}

        # Populate metadata
        IntegrityPipeline._populate_citation_metadata([in_text], [ref], link_lookup)

        # In-text should now have metadata from reference
        assert in_text.title == ref.title
        assert in_text.year == ref.year
        assert in_text.authors == ref.authors
        assert in_text.doi == ref.doi

    def test_no_overwrite_existing_metadata(self):
        """Existing title/author/year should NOT be overwritten."""
        from integrity_checker.linking.statuses import CitationMappingStatus, MappingMethod
        from integrity_checker.models.citation import Citation, CitationStyle, CitationType
        from integrity_checker.models.validation import CitationLink
        from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

        ref = Citation(
            raw_text='[1] Y. Liu et al., "RoBERTa," ACL, 2020.',
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            reference_id="ref-0001",
            numeric_index=1,
            title="RoBERTa",
            year="2020",
        )

        # In-text already has some metadata
        in_text = Citation(
            raw_text="[1]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-0001",
            numeric_index=1,
            title="RoBERTa (existing)",  # Already has title
        )

        link = CitationLink(
            occurrence_id="occ-0001",
            reference_id="ref-0001",
            status=CitationMappingStatus.MATCHED,
            confidence=0.9,
            method=MappingMethod.NUMERIC_INDEX,
        )
        link_lookup = {"occ-0001": link}

        IntegrityPipeline._populate_citation_metadata([in_text], [ref], link_lookup)

        # Should NOT overwrite existing title
        assert in_text.title == "RoBERTa (existing)"
