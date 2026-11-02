"""Unit tests cho grobid_adapter module.

Tests Phase 1: Bibliography mapping (GrobidBibEntry → Citation)
và Phase 2: In-text mapping (GrobidCitation → Citation).

References:
    docs/plans/grobid-adapter.md
    src/integrity_checker/extraction/grobid_adapter.py
"""

from __future__ import annotations

import pytest

from integrity_checker.extraction.grobid_adapter import (
    SAMPLE_GROBID_OUTPUT,
    build_grobid_id_map,
    grobid_to_in_text_citations,
    grobid_to_references,
    merge_extraction_results,
    normalize_grobid_id,
    resolve_tei_links,
)
from integrity_checker.extraction.grobid_parser import (
    GrobidBibEntry,
    GrobidCitation,
    GrobidOutput,
)

# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture
def sample_grobid_output() -> GrobidOutput:
    """Sample GrobidOutput với 3 references và 3 in-text citations."""
    return GrobidOutput(
        is_available=True,
        header={"title": "Sample Paper"},
        bibliography=[
            GrobidBibEntry(
                id="b0",
                authors=[],
                title="Deep Learning",
                year="2015",
                venue="Nature",
                doi="10.1038/nature14539",
            ),
            GrobidBibEntry(
                id="b1",
                authors=[],
                title="Attention Is All You Need",
                year="2017",
                venue="NeurIPS",
                doi="10.48550/arXiv.1706.03762",
            ),
            GrobidBibEntry(
                id="b2",
                authors=[],
                title="BERT: Pre-training",
                year="2018",
                venue="NAACL",
                doi="10.18653/v1/N19-1423",
            ),
        ],
        citations=[
            GrobidCitation(raw_text="(LeCun et al., 2015)", ref_id="b0", page=1),
            GrobidCitation(raw_text="(Vaswani et al., 2017)", ref_id="b1", page=3),
            GrobidCitation(raw_text="(Devlin et al., 2018)", ref_id="b2", page=5),
        ],
    )


@pytest.fixture
def grobid_output_with_authors() -> GrobidOutput:
    """GrobidOutput với author information."""
    return GrobidOutput(
        is_available=True,
        bibliography=[
            GrobidBibEntry(
                id="b0",
                authors=[
                    type("GrobidAuthor", (), {"full_name": "LeCun, Yann", "first_name": "Yann", "last_name": "LeCun"}),
                    type("GrobidAuthor", (), {"full_name": "Bengio, Yoshua", "first_name": "Yoshua", "last_name": "Bengio"}),
                ],
                title="Deep Learning",
                year="2015",
                venue="Nature",
                doi="10.1038/nature14539",
            ),
        ],
        citations=[],
    )


@pytest.fixture
def empty_grobid_output() -> GrobidOutput:
    """GrobidOutput với is_available=False."""
    return GrobidOutput(is_available=False, error_message="GROBID unavailable")


# ===========================================================================
# Test: grobid_to_references
# ===========================================================================


class TestGrobidToReferences:
    """Test GrobidBibEntry → Citation conversion."""

    def test_converts_bibliography_to_citations(self, sample_grobid_output):
        """GROBID bibliography được chuyển thành Citation list."""
        citations = grobid_to_references(sample_grobid_output)

        assert len(citations) == 3
        # Check first citation
        assert citations[0].title == "Deep Learning"
        assert citations[0].year == "2015"
        assert citations[0].doi == "10.1038/nature14539"

    def test_order_index_assigned(self, sample_grobid_output):
        """References được gán order_index theo thứ tự."""
        citations = grobid_to_references(sample_grobid_output)

        assert citations[0].order_index == 1
        assert citations[1].order_index == 2
        assert citations[2].order_index == 3

    def test_numeric_index_matches_order(self, sample_grobid_output):
        """numeric_index = order_index cho IEEE/Vancouver linking."""
        citations = grobid_to_references(sample_grobid_output)

        for c in citations:
            assert c.numeric_index == c.order_index

    def test_citation_type_is_reference_list(self, sample_grobid_output):
        """Citation type = REFERENCE_LIST."""
        citations = grobid_to_references(sample_grobid_output)

        for c in citations:
            assert c.citation_type.value == "reference_list"

    def test_style_is_apa(self, sample_grobid_output):
        """GROBID bibliography được label là APA style."""
        citations = grobid_to_references(sample_grobid_output)

        for c in citations:
            assert c.style.value == "APA"

    def test_confidence_high_for_complete_metadata(self, grobid_output_with_authors):
        """Confidence cao (>0.85) khi có đầy đủ metadata."""
        citations = grobid_to_references(grobid_output_with_authors)

        assert citations[0].confidence >= 0.85

    def test_confidence_lower_for_incomplete_metadata(self, sample_grobid_output):
        """Confidence thấp hơn khi thiếu metadata."""
        citations = grobid_to_references(sample_grobid_output)

        # Without authors, confidence is lower
        assert citations[0].confidence < 0.95

    def test_grobid_ref_id_stored(self, sample_grobid_output):
        """grobid_ref_id được lưu trong Citation.grobid_ref_id field."""
        citations = grobid_to_references(sample_grobid_output)

        assert citations[0].grobid_ref_id == "b0"
        assert citations[1].grobid_ref_id == "b1"
        assert citations[2].grobid_ref_id == "b2"

    def test_authors_extracted(self, grobid_output_with_authors):
        """Authors được trích xuất đúng."""
        citations = grobid_to_references(grobid_output_with_authors)

        assert len(citations[0].authors) == 2
        assert "LeCun, Yann" in citations[0].authors
        assert "Bengio, Yoshua" in citations[0].authors

    def test_year_suffix_extraction(self):
        """Year suffix (2018a, 2018b) được tách đúng."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    authors=[],
                    title="Paper A",
                    year="2018a",
                    doi=None,
                ),
            ],
        )
        citations = grobid_to_references(output)

        assert citations[0].year == "2018"
        assert citations[0].year_suffix == "a"

    def test_year_prefix_in_title_removed(self):
        """GROBID artefact year prefix trong title được remove."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    authors=[],
                    title="2018a. Actual Title Here",
                    year="2018",
                    doi=None,
                ),
            ],
        )
        citations = grobid_to_references(output)

        assert citations[0].title == "Actual Title Here"

    def test_raw_text_constructed(self, sample_grobid_output):
        """raw_text được ghép từ structured fields."""
        citations = grobid_to_references(sample_grobid_output)

        # raw_text nên chứa các thành phần chính
        assert "Deep Learning" in citations[0].raw_text
        assert "2015" in citations[0].raw_text
        assert "10.1038/nature14539" in citations[0].raw_text

    def test_empty_bibliography_returns_empty_list(self, empty_grobid_output):
        """is_available=False trả về empty list."""
        citations = grobid_to_references(empty_grobid_output)

        assert citations == []

    def test_none_input_returns_empty_list(self):
        """None input trả về empty list."""
        citations = grobid_to_references(None)

        assert citations == []


# ===========================================================================
# Test: grobid_to_in_text_citations
# ===========================================================================


class TestGrobidToInTextCitations:
    """Test GrobidCitation → Citation conversion."""

    def test_converts_in_text_citations(self, sample_grobid_output):
        """GROBID in-text citations được chuyển thành Citation list."""
        citations = grobid_to_in_text_citations(sample_grobid_output)

        assert len(citations) == 3
        assert citations[0].raw_text == "(LeCun et al., 2015)"
        assert citations[1].raw_text == "(Vaswani et al., 2017)"

    def test_page_number_preserved(self, sample_grobid_output):
        """Page number được giữ nguyên."""
        citations = grobid_to_in_text_citations(sample_grobid_output)

        assert citations[0].page_num == 1
        assert citations[1].page_num == 3
        assert citations[2].page_num == 5

    def test_grobid_ref_id_stored(self, sample_grobid_output):
        """ref_id được lưu trong Citation.grobid_ref_id field."""
        citations = grobid_to_in_text_citations(sample_grobid_output)

        assert citations[0].grobid_ref_id == "b0"
        assert citations[1].grobid_ref_id == "b1"
        assert citations[2].grobid_ref_id == "b2"

    def test_citation_type_numeric_for_brackets(self):
        """Citation type = NUMERIC cho [N] format."""
        output = GrobidOutput(
            is_available=True,
            citations=[
                GrobidCitation(raw_text="[1]", ref_id="b0", page=1),
                GrobidCitation(raw_text="[2, 3]", ref_id="b1", page=2),
            ],
        )
        citations = grobid_to_in_text_citations(output)

        assert citations[0].citation_type.value == "numeric"
        assert citations[1].citation_type.value == "numeric"

    def test_citation_type_intext_for_parenthetical(self, sample_grobid_output):
        """Citation type = IN_TEXT cho (Author, Year) format."""
        citations = grobid_to_in_text_citations(sample_grobid_output)

        for c in citations:
            assert c.citation_type.value == "in_text"

    def test_confidence_high(self, sample_grobid_output):
        """Confidence cao (0.90) cho GROBID structured extraction."""
        citations = grobid_to_in_text_citations(sample_grobid_output)

        for c in citations:
            assert c.confidence == 0.90

    def test_empty_citations_returns_empty_list(self):
        """Empty citations list trả về empty list."""
        output = GrobidOutput(is_available=True, citations=[])
        citations = grobid_to_in_text_citations(output)

        assert citations == []


# ===========================================================================
# Test: build_grobid_id_map
# ===========================================================================


class TestBuildGrobidIdMap:
    """Test TEI ID → Citation mapping."""

    def test_maps_ref_id_to_citations(self, sample_grobid_output):
        """grobid_ref_id → list[Citation] mapping đúng."""
        refs = grobid_to_references(sample_grobid_output)
        intext = grobid_to_in_text_citations(sample_grobid_output)

        id_map = build_grobid_id_map(refs + intext)

        assert "b0" in id_map
        assert "b1" in id_map
        assert "b2" in id_map
        # b0 appears in both reference and in-text
        assert len(id_map["b0"]) == 2

    def test_empty_list_returns_empty_map(self):
        """Empty citations list trả về empty dict."""
        id_map = build_grobid_id_map([])

        assert id_map == {}

    def test_id_without_ref_returns_empty_list(self):
        """Citation không có _grobid_ref_id không có trong map."""
        id_map = build_grobid_id_map([])

        assert "nonexistent" not in id_map


# ===========================================================================
# Test: merge_extraction_results
# ===========================================================================


class TestMergeExtractionResults:
    """Test GROBID + regex merge logic."""

    def test_grobid_used_when_available(self, sample_grobid_output):
        """GROBID references được sử dụng khi available."""
        from integrity_checker.models.citation import Citation

        regex_refs: list[Citation] = []
        regex_intext: list[Citation] = []

        result = merge_extraction_results(
            sample_grobid_output, regex_refs, regex_intext
        )

        assert result.grobid_used is True
        assert result.grobid_fallback is False
        assert len(result.references) == 3

    def test_grobid_fallback_when_unavailable(self, empty_grobid_output):
        """Regex references được sử dụng khi GROBID unavailable."""
        from integrity_checker.models.citation import Citation, CitationType

        regex_ref = Citation(
            raw_text="Smith et al. (2020). Some Paper. Journal.",
            citation_type=CitationType.REFERENCE_LIST,
        )
        regex_refs = [regex_ref]
        regex_intext: list[Citation] = []

        result = merge_extraction_results(
            empty_grobid_output, regex_refs, regex_intext
        )

        assert result.grobid_used is False
        assert result.grobid_fallback is True
        assert len(result.references) == 1

    def test_statistics_populated(self, sample_grobid_output):
        """Merge statistics được tính đúng."""
        result = merge_extraction_results(
            sample_grobid_output, [], []
        )

        assert result.statistics["grobid_references"] == 3
        assert result.statistics["grobid_intext"] == 3
        assert result.statistics["merged_references"] == 3
        assert result.statistics["merged_intext"] == 3

    def test_provenance_map_populated(self, sample_grobid_output):
        """Provenance map được tạo cho mỗi citation."""
        result = merge_extraction_results(
            sample_grobid_output, [], []
        )

        assert len(result.provenance_map) > 0
        # Check first citation provenance
        first_prov = result.provenance_map.get("(LeCun et al., 2015)")
        if first_prov:
            assert first_prov.source == "grobid"


# ===========================================================================
# Test: normalize_grobid_id
# ===========================================================================


class TestNormalizeGrobidId:
    """Test TEI ID normalization."""

    def test_strips_hash_prefix(self):
        """'#b0' → 'b0'."""
        assert normalize_grobid_id("#b0") == "b0"

    def test_keeps_id_without_hash(self):
        """'b0' → 'b0'."""
        assert normalize_grobid_id("b0") == "b0"

    def test_empty_string(self):
        """Empty string được giữ nguyên."""
        assert normalize_grobid_id("") == ""


# ===========================================================================
# Test: resolve_tei_links
# ===========================================================================


class TestResolveTeiLinks:
    """Test TEI link resolution."""

    def test_resolves_direct_links(self, sample_grobid_output):
        """Direct TEI links được resolve đúng."""
        refs = grobid_to_references(sample_grobid_output)
        intext = grobid_to_in_text_citations(sample_grobid_output)
        id_map = build_grobid_id_map(refs + intext)

        links = resolve_tei_links(intext, refs, id_map)

        assert len(links) == 3
        assert links[0]["direct"] is True
        assert links[0]["method"] == "tei_link"
        assert links[0]["confidence"] == 0.95

    def test_handles_unresolved_refs(self):
        """References không được cite vẫn được track."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(id="b0", title="Paper A", year="2020"),
            ],
            citations=[
                GrobidCitation(raw_text="(Smith, 2019)", ref_id="b1", page=1),
            ],
        )
        refs = grobid_to_references(output)
        intext = grobid_to_in_text_citations(output)
        id_map = build_grobid_id_map(refs + intext)

        links = resolve_tei_links(intext, refs, id_map)

        assert len(links) == 1
        assert links[0]["direct"] is False
        assert links[0]["reference"] is None


# ===========================================================================
# Test: Sample Fixture
# ===========================================================================


class TestSampleGrobidOutput:
    """Test SAMPLE_GROBID_OUTPUT fixture."""

    def test_sample_fixture_available(self):
        """SAMPLE_GROBID_OUTPUT fixture tồn tại và có data."""
        assert SAMPLE_GROBID_OUTPUT.is_available is True
        assert len(SAMPLE_GROBID_OUTPUT.bibliography) == 2
        assert len(SAMPLE_GROBID_OUTPUT.citations) == 2

    def test_sample_fixture_converts_correctly(self):
        """SAMPLE_GROBID_OUTPUT converts đúng."""
        citations = grobid_to_references(SAMPLE_GROBID_OUTPUT)

        assert len(citations) == 2
        assert citations[0].title == "Deep learning"


# ===========================================================================
# Test: Error Handling
# ===========================================================================


class TestErrorHandling:
    """Test error handling và edge cases."""

    def test_malformed_year_does_not_crash(self):
        """Malformed year (non-numeric) không crash."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(id="b0", title="Paper", year="abcd"),
            ],
        )
        # Should not raise
        citations = grobid_to_references(output)

        assert len(citations) == 1

    def test_none_doi_handled(self):
        """DOI=None được xử lý đúng."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(id="b0", title="Paper", year="2020"),
            ],
        )
        citations = grobid_to_references(output)

        assert citations[0].doi is None

    def test_missing_authors_handled(self):
        """Missing authors được xử lý đúng."""
        output = GrobidOutput(
            is_available=True,
            bibliography=[
                GrobidBibEntry(id="b0", title="Paper", year="2020"),
            ],
        )
        citations = grobid_to_references(output)

        assert citations[0].authors == []
