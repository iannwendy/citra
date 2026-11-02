"""Task 1.2 — GROBID in-text TEI targets wired into Stage-1 (TEI_LINK) linking.

Regex body citations are enriched with the GROBID TEI target (`grobid_ref_id`)
by marker text / page so CitationLinker's TEI_LINK stage resolves them. The
regex path must be untouched when GROBID is unavailable, and misaligned or
multi-target TEI links must never override regex linking.
"""

from __future__ import annotations

from pathlib import Path

from integrity_checker.config import Settings
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.grobid_adapter import link_body_citations_to_grobid
from integrity_checker.extraction.grobid_parser import (
    GrobidAuthor,
    GrobidBibEntry,
    GrobidCitation,
    GrobidOutput,
)
from integrity_checker.linking import CitationLinker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.validation import MappingMethod


def body(raw: str, ctype: CitationType = CitationType.IN_TEXT, page: int = 1) -> Citation:
    return Citation(raw_text=raw, citation_type=ctype, style=CitationStyle.APA, page_num=page)


def bib(raw: str, *, gid: str | None, year: str | None = None, idx: int | None = None,
        title: str | None = None, doi: str | None = None, authors=None) -> Citation:
    return Citation(
        raw_text=raw, citation_type=CitationType.REFERENCE_LIST, year=year,
        numeric_index=idx, grobid_ref_id=gid, title=title, doi=doi,
        authors=authors or [],
    )


def gout(citations, bibliography=None) -> GrobidOutput:
    return GrobidOutput(is_available=True, citations=citations, bibliography=bibliography or [])


# ---------------------------------------------------------------------------
# Adapter-level enrichment
# ---------------------------------------------------------------------------


class TestEnrichment:
    def test_author_year_marker_enriched_by_token_containment(self):
        cits = [body("(Smith, 2020)"), body("(Doe, 2021)")]
        refs = [bib("Smith, J. (2020). X.", gid="b0", year="2020"),
                bib("Doe, A. (2021). Y.", gid="b1", year="2021")]
        n = link_body_citations_to_grobid(
            cits, gout([GrobidCitation("Smith, 2020", "#b0", 1),
                        GrobidCitation("Doe, 2021", "#b1", 1)]), refs)
        assert n == 2
        assert cits[0].grobid_ref_id == "b0" and cits[0].is_grobid_linked
        assert cits[1].grobid_ref_id == "b1"

    def test_numeric_marker_not_confused_with_larger_index(self):
        cits = [body("[13]", CitationType.NUMERIC), body("[3]", CitationType.NUMERIC)]
        refs = [bib("[3] A.", gid="b2", idx=3), bib("[13] B.", gid="b12", idx=13)]
        link_body_citations_to_grobid(cits, gout([GrobidCitation("3", "#b2", 1)]), refs)
        assert cits[0].grobid_ref_id is None
        assert cits[1].grobid_ref_id == "b2"

    def test_repeated_marker_assigned_in_document_order_preferring_page(self):
        cits = [body("(Smith, 2020)", page=1), body("(Smith, 2020)", page=4)]
        refs = [bib("Smith (2020).", gid="b0", year="2020")]
        link_body_citations_to_grobid(cits, gout([GrobidCitation("(Smith, 2020)", "b0", 4)]), refs)
        assert cits[1].grobid_ref_id == "b0"
        assert cits[0].grobid_ref_id is None

    def test_multi_key_parenthetical_keeps_regex_path(self):
        cits = [body("(Smith, 2020; Doe, 2021)")]
        refs = [bib("Smith (2020).", gid="b0", year="2020"), bib("Doe (2021).", gid="b1", year="2021")]
        n = link_body_citations_to_grobid(
            cits, gout([GrobidCitation("Smith, 2020", "b0", 1), GrobidCitation("Doe, 2021", "b1", 1)]),
            refs)
        assert n == 0 and cits[0].grobid_ref_id is None

    def test_multi_index_numeric_keeps_regex_path(self):
        cits = [body("[1, 2]", CitationType.NUMERIC)]
        refs = [bib("[1] A.", gid="b0", idx=1), bib("[2] B.", gid="b1", idx=2)]
        link_body_citations_to_grobid(cits, gout([GrobidCitation("[1, 2]", "b0", 1)]), refs)
        assert cits[0].grobid_ref_id is None

    def test_misaligned_target_rejected_by_year_and_index_checks(self):
        cits = [body("(Smith, 2020)"), body("[4]", CitationType.NUMERIC)]
        refs = [bib("Smith (2018).", gid="b0", year="2018"), bib("[5] X.", gid="b4", idx=5)]
        n = link_body_citations_to_grobid(
            cits, gout([GrobidCitation("Smith, 2020", "b0", 1), GrobidCitation("4", "b4", 1)]), refs)
        assert n == 0

    def test_year_suffix_mismatch_rejected(self):
        cits = [body("(Smith, 2020a)")]
        refs = [bib("Smith, J. (2020b). Other.", gid="b1", year="2020")]
        assert link_body_citations_to_grobid(
            cits, gout([GrobidCitation("Smith, 2020a", "b1", 1)]), refs) == 0

    def test_unknown_target_is_ignored(self):
        cits = [body("(Smith, 2020)")]
        refs = [bib("Smith (2020).", gid="b0", year="2020")]
        assert link_body_citations_to_grobid(
            cits, gout([GrobidCitation("Smith, 2020", "#b9", 1)]), refs) == 0

    def test_bare_year_marker_is_too_ambiguous(self):
        cits = [body("Smith (2020)")]
        refs = [bib("Smith (2020).", gid="b0", year="2020")]
        assert link_body_citations_to_grobid(cits, gout([GrobidCitation("2020", "b0", 1)]), refs) == 0

    def test_vietnamese_marker_with_diacritics_and_cong_su(self):
        cits = [body("(Nguyễn và cộng sự, 2019)")]
        refs = [bib("Nguyễn, V. A. (2019). Học sâu.", gid="b3", year="2019")]
        link_body_citations_to_grobid(cits, gout([GrobidCitation("Nguyen et al., 2019", "b3", 1)]), refs)
        # "Nguyen" folds to the same token; connector words are ignored.
        assert cits[0].grobid_ref_id == "b3"

    def test_regex_reference_gets_grobid_id_by_doi_then_title(self):
        cits = [body("(Trần, 2018)"), body("(Lê, 2017)")]
        refs = [
            bib("Trần, B. (2018). Kinh tế số. doi:10.1/kts", gid=None, year="2018", doi="10.1/KTS"),
            bib("Lê, C. (2017). Quản trị nguồn nhân lực hiện đại.", gid=None, year="2017",
                title="Quản trị nguồn nhân lực hiện đại"),
        ]
        grobid = gout(
            [GrobidCitation("Trần, 2018", "b0", 1), GrobidCitation("Lê, 2017", "b1", 1)],
            [GrobidBibEntry(id="b0", doi="https://doi.org/10.1/kts", title="Kinh te so"),
             GrobidBibEntry(id="b1", title="Quản trị nguồn nhân lực hiện đại")],
        )
        assert link_body_citations_to_grobid(cits, grobid, refs) == 2
        assert refs[0].grobid_ref_id == "b0" and refs[1].grobid_ref_id == "b1"

    def test_noop_when_grobid_unavailable_or_missing(self):
        cits = [body("(Smith, 2020)")]
        refs = [bib("Smith (2020).", gid="b0", year="2020")]
        assert link_body_citations_to_grobid(cits, None, refs) == 0
        unavailable = GrobidOutput(is_available=False,
                                   citations=[GrobidCitation("Smith, 2020", "b0", 1)])
        assert link_body_citations_to_grobid(cits, unavailable, refs) == 0
        assert cits[0].grobid_ref_id is None and not cits[0].is_grobid_linked


# ---------------------------------------------------------------------------
# Stage 1 resolution in CitationLinker
# ---------------------------------------------------------------------------


class TestStageOneResolution:
    def test_enriched_citation_resolves_via_tei_link(self):
        cits = [body("(Smyth, 2020)")]  # surname OCR variant: regex keys alone would miss
        refs = [bib("Smith, J. (2020). A study of X.", gid="b0", year="2020",
                    authors=["Smith, J."])]
        refs[0].reference_id = "ref-0001"
        link_body_citations_to_grobid(cits, gout([GrobidCitation("Smyth, 2020", "b0", 1)]), refs)
        result = CitationLinker().link(cits, refs)
        link = result.links[0]
        assert link.method == MappingMethod.TEI_LINK
        assert link.reference_id == "ref-0001"
        assert link.confidence >= 0.95

    def test_without_grobid_regex_path_unchanged(self):
        cits = [body("(Smith, 2020)")]
        refs = [bib("Smith, J. (2020). A study of X.", gid="b0", year="2020", authors=["Smith, J."])]
        refs[0].reference_id = "ref-0001"
        result = CitationLinker().link(cits, refs)
        assert result.links[0].method != MappingMethod.TEI_LINK
        assert result.links[0].reference_id == "ref-0001"


# ---------------------------------------------------------------------------
# DocumentParser integration (synthetic GrobidOutput, mocked PyMuPDF)
# ---------------------------------------------------------------------------


class _MockMuPdf:
    def __init__(self, doc: Document) -> None:
        self._doc = doc

    def parse(self, file_path):
        return self._doc


def _text_doc() -> Document:
    return Document(
        file_path="/fake/essay.pdf",
        num_pages=2,
        parser_used="mupdf",
        pages=[
            Page(page_num=1, has_text_layer=True, text=(
                "Introduction\n\nPrior work on X has been influential (Smith, 2020). "
                "Later results extended it considerably (Doe, 2021).\n\n")),
            Page(page_num=2, has_text_layer=True, text=(
                "References\n\n"
                "Smith, J. (2020). A study of X. Journal A.\n"
                "Doe, A. (2021). Another study of Y. Journal B.\n")),
        ],
    )


def _settings(enabled: bool = True) -> Settings:
    return Settings(extraction={"grobid": {"enabled": enabled, "url": "http://localhost:8070",
                                           "timeout_seconds": 5}})


def _grobid() -> GrobidOutput:
    return GrobidOutput(
        is_available=True,
        citations=[GrobidCitation("(Smith, 2020)", "#b0", 1), GrobidCitation("(Doe, 2021)", "#b1", 1)],
        bibliography=[
            GrobidBibEntry(id="b0", authors=[GrobidAuthor(full_name="J. Smith", last_name="Smith")],
                           title="A study of X", year="2020", venue="Journal A"),
            GrobidBibEntry(id="b1", authors=[GrobidAuthor(full_name="A. Doe", last_name="Doe")],
                           title="Another study of Y", year="2021", venue="Journal B"),
        ],
    )


class TestDocumentParserIntegration:
    def _parse(self, tmp_path: Path, grobid: GrobidOutput | None, enabled: bool = True):
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")
        parser = DocumentParser(config=_settings(enabled), mupdf_parser=_MockMuPdf(_text_doc()),
                                grobid_post_fn=lambda *a, **k: None)
        parser._load_grobid_tei = lambda path, *a: grobid  # type: ignore[assignment]
        return parser.parse(str(pdf), use_service_manager=False)

    def test_parsed_body_citations_carry_grobid_targets_and_link_via_tei(self, tmp_path):
        parsed = self._parse(tmp_path, _grobid())
        linked = [c for c in parsed.body_citations if c.is_grobid_linked]
        assert {c.grobid_ref_id for c in linked} == {"b0", "b1"}
        for i, r in enumerate(parsed.references, start=1):
            r.reference_id = f"ref-{i:04d}"
        result = CitationLinker().link(parsed.body_citations, parsed.references)
        tei = [lk for lk in result.links if lk.method == MappingMethod.TEI_LINK]
        assert len(tei) == 2
        assert result.unmatched_reference_ids == []

    def test_regex_path_identical_when_grobid_unavailable(self, tmp_path):
        parsed = self._parse(tmp_path, GrobidOutput(is_available=False, error_message="down"))
        assert parsed.body_citations, "regex must still extract body citations"
        assert all(not c.is_grobid_linked and c.grobid_ref_id is None for c in parsed.body_citations)
        for i, r in enumerate(parsed.references, start=1):
            r.reference_id = f"ref-{i:04d}"
        result = CitationLinker().link(parsed.body_citations, parsed.references)
        assert all(lk.method != MappingMethod.TEI_LINK for lk in result.links)
        assert result.matched_count == len(parsed.body_citations)

    def test_grobid_disabled_leaves_citations_untouched(self, tmp_path):
        parsed = self._parse(tmp_path, _grobid(), enabled=False)
        assert all(c.grobid_ref_id is None for c in parsed.body_citations)
