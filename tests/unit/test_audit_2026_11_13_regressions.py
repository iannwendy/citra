"""Regression tests for the comprehensive 1,064-PDF live-stack audit (2026-11-13).

Covers P0 -> P1 -> P2 system bugs documented in:
docs/BAO_CAO_AUDIT_PARSING_LINKING_TOAN_DIEN_2026-11-13.md
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.document_parser import DocumentParser, ParsedDocument
from integrity_checker.extraction.grobid_parser import GrobidAuthor, GrobidBibEntry, GrobidOutput
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.matching.author_parser import Author
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline
from integrity_checker.retrieval.normalization import citation_key


class _OfflineOrchestrator:
    async def retrieve(self, citation: Citation) -> SourceResult:
        return SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=[],
            sources_succeeded=[],
            sources_failed={},
        )


class _OfflineChecker:
    def check(self, citation: Citation, source: SourceResult, **kwargs) -> CitationVerdict:
        return CitationVerdict(
            citation=citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.5,
            matched_source=source,
        )


# ============================================================================
# P0 — SYS-BUG-01: Silent loss of bibliography verdicts on citation_key collision
# ============================================================================


class TestSysBug01BibliographyVerdictPreservation:
    def test_citation_key_distinguishes_year_suffixes_and_urls(self):
        """Distinct same-year works (2019a/2019b/2019c tweets with distinct URLs, e.g. 20-theses/30.pdf)
        must not collapse into the exact same citation_key."""
        t_a = Citation(
            raw_text="Trump, D. (2019a, May 5). [Tweet]. Twitter. https://x.com/realDonaldTrump/status/111",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Trump, D."],
            year="2019",
            year_suffix="a",
            title="Tweet",
            url="https://x.com/realDonaldTrump/status/111",
        )
        t_b = Citation(
            raw_text="Trump, D. (2019b, Aug 1). [Tweet]. Twitter. https://x.com/realDonaldTrump/status/222",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Trump, D."],
            year="2019",
            year_suffix="b",
            title="Tweet",
            url="https://x.com/realDonaldTrump/status/222",
        )
        assert citation_key(t_a) != citation_key(t_b)

    @pytest.mark.asyncio
    async def test_pipeline_preserves_every_bibliography_verdict_even_when_citation_keys_collide(self):
        """Even when two distinct non-duplicate bibliography entries produce identical citation_key()
        (e.g. different editions/volumes excluded from duplicate_reference_ids), report.verdicts must
        never silently drop a bibliography entry."""
        refs = [
            Citation(
                raw_text="Smith, J. (2020a). Economic Report. https://example.org/rep-1",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="a",
                title="Economic Report",
                url="https://example.org/rep-1",
            ),
            Citation(
                raw_text="Smith, J. (2020b). Economic Report. https://example.org/rep-2",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Smith, J."],
                year="2020",
                year_suffix="b",
                title="Economic Report",
                url="https://example.org/rep-2",
            ),
            Citation(
                raw_text="Doe, A. (2021). Market Analysis, Vol. 1. Oxford Press.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Doe, A."],
                year="2021",
                title="Market Analysis",
                venue="Vol. 1",
            ),
            Citation(
                raw_text="Doe, A. (2021). Market Analysis, Vol. 2. Oxford Press.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Doe, A."],
                year="2021",
                title="Market Analysis",
                venue="Vol. 2",
            ),
        ]
        body = [
            Citation(raw_text="(Smith, 2020a)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
            Citation(raw_text="(Smith, 2020b)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
            Citation(raw_text="(Doe, 2021)", citation_type=CitationType.IN_TEXT, style=CitationStyle.APA),
        ]
        parsed = ParsedDocument(
            document=Document(file_path="/fake/30.pdf", num_pages=2, pages=[]),
            body_citations=body,
            references=refs,
            appendix_citations=[],
            sections=[],
            parser_warnings=[],
        )
        parser = MagicMock()
        parser.parse.return_value = parsed
        pipe = IntegrityPipeline(
            document_parser=parser,
            use_document_parser=True,
            orchestrator=_OfflineOrchestrator(),
            checker=_OfflineChecker(),
            cis_calc=CISCalculator(),
        )

        report = await pipe.run_async("/fake/30.pdf", essay_id=30)
        ref_ids_in_verdicts = [v.citation.reference_id for v in report.verdicts]
        assert len(report.verdicts) == 4
        assert sorted(ref_ids_in_verdicts) == ["ref-0001", "ref-0002", "ref-0003", "ref-0004"]


# ============================================================================
# P0 — SYS-BUG-02: Compound citation drops 2nd+ MISSING_REFERENCE edge in lookup
# ============================================================================


class TestSysBug02CompoundMissingReferenceEdges:
    def test_compound_citation_preserves_all_missing_reference_edges_in_lookup(self):
        """In `(Chiricos & Eschholz, 2002; Surrette, 1992; Young, 1985)` where 1 matches and
        2 are missing (e.g. 20-theses/33.pdf & 64.pdf), _build_link_lookup_multi must preserve
        all 3 edges (1 MATCHED + 2 MISSING_REFERENCE), not deduplicate the 2nd missing edge."""
        bibs = [
            Citation(
                raw_text="Chiricos, T., & Eschholz, S. (2002). The racial and ethnic typification of crime. Journal of Research in Crime and Delinquency, 39(4), 400-420.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Chiricos, T.", "Eschholz, S."],
                year="2002",
                title="The racial and ethnic typification of crime",
                reference_id="ref-0001",
            )
        ]
        body = [
            Citation(
                raw_text="(Chiricos & Eschholz, 2002; Surrette, 1992; Young, 1985)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-0001",
            )
        ]
        lr = CitationLinker().link(body, bibs)
        assert len(lr.links) == 3

        lookup = IntegrityPipeline._build_link_lookup_multi(lr.links)
        occ_edges = lookup["occ-0001"]
        assert len(occ_edges) == 3
        missing_edges = [e for e in occ_edges if e.status == CitationMappingStatus.MISSING_REFERENCE]
        assert len(missing_edges) == 2


# ============================================================================
# P0 — SYS-BUG-03: grobid_by_doi & overlap_g destroying numeric_index slots
# ============================================================================


class TestSysBug03NumericIndexPreservationInHybridMerge:
    def test_shared_chimera_doi_does_not_overwrite_distinct_numeric_index(self):
        """Reproduces IEEE/ACM/ACS/AMA/Nature/Vancouver hard_02:
        [2] Devlin (2019) and [4] Sutskever (2014) share chimera DOI 10.18653/v1/N19-1423.
        Hybrid merge must NOT overwrite [4]'s numeric_index with 2."""
        bib_text = (
            "References\n"
            "[1] A. Vaswani et al., \"Attention is all you need,\" in NeurIPS, 2017.\n"
            "[2] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, \"BERT: Pre-training of deep bidirectional transformers,\" NAACL, 2019, doi: 10.18653/v1/N19-1423.\n"
            "[3] K. He, X. Zhang, S. Ren, and J. Sun, \"Deep residual learning for image recognition,\" in CVPR, 2016.\n"
            "[4] I. Sutskever, O. Vinyals, and Q. V. Le, \"Sequence to sequence learning with neural networks,\" in NeurIPS, 2014, doi: 10.18653/v1/N19-1423.\n"
        )
        doc = Document(
            file_path="/fake/hard_02.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=bib_text)],
            metadata={},
        )
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="Attention is all you need",
                    authors=[GrobidAuthor(full_name="Vaswani, A", last_name="Vaswani", first_name="A")],
                    year="2017",
                    raw_reference="[1] A. Vaswani et al., Attention is all you need, NeurIPS, 2017.",
                ),
                GrobidBibEntry(
                    id="b1",
                    title="BERT: Pre-training of deep bidirectional transformers",
                    authors=[GrobidAuthor(full_name="Devlin, J", last_name="Devlin", first_name="J")],
                    year="2019",
                    doi="10.18653/v1/N19-1423",
                    raw_reference="[2] J. Devlin et al., BERT: Pre-training of deep bidirectional transformers, NAACL, 2019, doi: 10.18653/v1/N19-1423.",
                ),
                GrobidBibEntry(
                    id="b2",
                    title="Deep residual learning for image recognition",
                    authors=[GrobidAuthor(full_name="He, K", last_name="He", first_name="K")],
                    year="2016",
                    raw_reference="[3] K. He et al., Deep residual learning for image recognition, CVPR, 2016.",
                ),
                GrobidBibEntry(
                    id="b3",
                    title="Sequence to sequence learning with neural networks",
                    authors=[GrobidAuthor(full_name="Sutskever, I", last_name="Sutskever", first_name="I")],
                    year=None,  # GROBID often drops year on chimera line, making `not g.year` True!
                    doi="10.18653/v1/N19-1423",
                    raw_reference="I. Sutskever, O. Vinyals, and Q. V. Le, Sequence to sequence learning with neural networks, NeurIPS, 2014, doi: 10.18653/v1/N19-1423.",
                ),
            ]
        )

        dp = DocumentParser()
        merged = dp._merge(doc, grobid_out).references
        by_num = {r.numeric_index: r for r in merged if r.numeric_index is not None}
        assert set(by_num.keys()) == {1, 2, 3, 4}
        assert "BERT" in (by_num[2].title or "")
        assert "Sequence to sequence" in (by_num[4].title or "")

    def test_grobid_merged_consecutive_numbered_refs_restores_missing_slot(self):
        """Reproduces 20-theses/85.pdf [24]+[25] (and 72.pdf [7]+[8]):
        GROBID glued [25] Riggio's title+URL onto [24] Ng, leaving slot 25 missing.
        Regex cleanly split [24] and [25]; Hybrid merge must NOT swallow [25] into [24]."""
        bib_text = (
            "References\n"
            "[1] A. Author, 2020. First paper. Journal, 1(1), 1-5.\n"
            "[2] B. Author, 2020. Second paper. Journal, 1(2), 6-10.\n"
            "[3] C. Author, 2020. Third paper. Journal, 1(3), 11-15.\n"
            "[4] Ng, A., 2020. Coursera. [Online] Available at: https://www.coursera.org/learn/machine-learning\n"
            "[5] Riggio, C., 2019. Towards data science. [Online] Available at: https://towardsdatascience.com/whats-a-confusion-matrix\n"
            "[6] Seif, G., 2019. A Beginner's guide to XGBoost. [Online] Available at: https://towardsdatascience.com/xgboost-guide\n"
        )
        doc = Document(
            file_path="/fake/85.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=bib_text)],
            metadata={},
        )
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(id="b0", title="First paper", authors=[GrobidAuthor(full_name="Author, A", last_name="Author", first_name="A")], year="2020", raw_reference="[1] A. Author, 2020. First paper."),
                GrobidBibEntry(id="b1", title="Second paper", authors=[GrobidAuthor(full_name="Author, B", last_name="Author", first_name="B")], year="2020", raw_reference="[2] B. Author, 2020. Second paper."),
                GrobidBibEntry(id="b2", title="Third paper", authors=[GrobidAuthor(full_name="Author, C", last_name="Author", first_name="C")], year="2020", raw_reference="[3] C. Author, 2020. Third paper."),
                # GROBID glued [4] and [5] into [4]!
                GrobidBibEntry(
                    id="b3",
                    title="Coursera Towards data science",
                    authors=[GrobidAuthor(full_name="Ng, A", last_name="Ng", first_name="A")],
                    year="2020",
                    url="https://towardsdatascience.com/whats-a-confusion-matrix",
                    raw_reference="[4] Ng, A (2020) Coursera Towards data science https://towardsdatascience.com/whats-a-confusion-matrix",
                ),
                GrobidBibEntry(
                    id="b5",
                    title="A Beginner's guide to XGBoost",
                    authors=[GrobidAuthor(full_name="Seif, G", last_name="Seif", first_name="G")],
                    year="2019",
                    url="https://towardsdatascience.com/xgboost-guide",
                    raw_reference="[6] Seif, G (2019) A Beginner's guide to XGBoost https://towardsdatascience.com/xgboost-guide",
                ),
            ]
        )

        dp = DocumentParser()
        merged = dp._merge(doc, grobid_out).references
        nums = {r.numeric_index for r in merged if r.numeric_index is not None}
        assert {1, 2, 3, 4, 5, 6}.issubset(nums)


# ============================================================================
# P0 — SYS-BUG-09: Vietnamese legal codes of same year falsely linked as person names
# ============================================================================


class TestSysBug09VietnameseLegalDistinctCodesNotFuzzyMatched:
    def test_bo_luat_to_tung_dan_su_does_not_fuzzy_match_bo_luat_dan_su(self):
        """Reproduces vn_legal_reports/hard_cases/hard_04:
        Orphan 'Bộ luật Tố tụng dân sự (2015)' must be MISSING_REFERENCE when Bibliography
        only has 'Bộ luật Dân sự (2015)' — never fuzzy-matched via person-name author_match_score."""
        bibs = [
            Citation(
                raw_text="Quốc hội (2015), Bộ luật Dân sự số 91/2015/QH13.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=[Author(raw="Bộ luật Dân sự", last_name="bộ luật dân sự")],
                year="2015",
                title="Bộ luật Dân sự số 91/2015/QH13",
                matched_pattern="vn_legal_document",
                reference_id="ref-0001",
            )
        ]
        body = [
            Citation(
                raw_text="Bộ luật Tố tụng dân sự (2015)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-0001",
            )
        ]
        lr = CitationLinker().link(body, bibs)
        assert len(lr.links) == 1
        assert lr.links[0].status == CitationMappingStatus.MISSING_REFERENCE


# ============================================================================
# P1 — SYS-BUG-04: Year-suffixed entries (2026a vs 2026) duplicated in Hybrid Merge
# ============================================================================


class TestSysBug04YearSuffixDeduplicationInHybridMerge:
    def test_hybrid_merge_deduplicates_2026a_regex_against_2026_grobid_and_preserves_suffix(self):
        """Reproduces 20-theses/32.pdf: GROBID extracts year='2026' (no suffix) while Regex
        extracts year='2026a' / year_suffix='a' for the exact same URL+title entry.
        Must merge into 1 entry with year_suffix='a', not append a 2nd phantom duplicate."""
        bib_text = (
            "References\n"
            "IEA. (2026a). Global Critical Minerals Outlook 2026. https://www.iea.org/reports/critical-minerals-2026\n"
            "IEA. (2026b). World Energy Investment 2026. https://www.iea.org/reports/world-energy-investment-2026\n"
        )
        doc = Document(file_path="/fake/32.pdf", num_pages=1, pages=[Page(page_num=1, text=bib_text)])
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="Global Critical Minerals Outlook",
                    authors=[GrobidAuthor(full_name="IEA", last_name="IEA")],
                    year="2026",
                    url="https://www.iea.org/reports/critical-minerals-2026",
                    raw_reference="IEA. (2026). Global Critical Minerals Outlook. https://www.iea.org/reports/critical-minerals-2026",
                ),
                GrobidBibEntry(
                    id="b1",
                    title="World Energy Investment",
                    authors=[GrobidAuthor(full_name="IEA", last_name="IEA")],
                    year="2026",
                    url="https://www.iea.org/reports/world-energy-investment-2026",
                    raw_reference="IEA. (2026). World Energy Investment. https://www.iea.org/reports/world-energy-investment-2026",
                ),
            ]
        )
        merged = DocumentParser()._merge(doc, grobid_out).references
        assert len(merged) == 2
        suffixes = sorted((r.year_suffix or "") for r in merged)
        assert suffixes == ["a", "b"]


# ============================================================================
# P1 — SYS-BUG-05: Neighbor DOI bleed in GROBID <biblStruct>
# ============================================================================


class TestSysBug05GrobidNeighborDoiBleed:
    def test_grobid_doi_absent_from_raw_reference_and_bled_from_neighbor_is_cleared(self):
        """Reproduces 20-theses/30.pdf p.29: Fox (2024) CRAN package has no DOI in its raw_reference,
        but GROBID bled Fama & French (2015)'s DOI 10.1016/j.jfineco.2014.10.010 onto Fox."""
        from integrity_checker.extraction.grobid_adapter import grobid_to_references

        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="A five-factor asset pricing model",
                    authors=[GrobidAuthor(full_name="Fama, E F", last_name="Fama")],
                    year="2015",
                    doi="10.1016/j.jfineco.2014.10.010",
                    raw_reference="Fama, E. F., & French, K. R. (2015). A five-factor asset pricing model. Journal of Financial Economics, 116(1), 1-22. https://doi.org/10.1016/j.jfineco.2014.10.010",
                ),
                GrobidBibEntry(
                    id="b1",
                    title="car: Companion to Applied Regression",
                    authors=[GrobidAuthor(full_name="Fox, J", last_name="Fox")],
                    year="2024",
                    doi="10.1016/j.jfineco.2014.10.010",  # Bled from b0!
                    url="https://cran.r-project.org/package=car",
                    raw_reference="Fox, J., & Weisberg, S. (2024). car: Companion to Applied Regression. R package version 3.1-3. https://cran.r-project.org/package=car",
                ),
            ]
        )
        refs = grobid_to_references(grobid_out)
        assert refs[0].doi == "10.1016/j.jfineco.2014.10.010"
        assert refs[1].doi is None


# ============================================================================
# P1 — SYS-BUG-06: GROBID line-wrapped DOI / Accessed URL / RFC tail fragment coalescing
# ============================================================================


class TestSysBug06GrobidWrappedDoiAndUrlFragmentCoalescing:
    def test_coalesces_wrapped_doi_suffix_and_accessed_url_fragments_without_index_shift(self):
        """Reproduces AMA/real/20 ('1186/ s12882-022-02869-6 (2022)') and TDTU_PDF/064_hcmus
        ('Accessed (2025) d39400a_tilelink-spec-1.7.1.pdf') and ACS/hard_01 RFC tail."""
        bib_text = (
            "References\n"
            "1. Smith J, Doe A. Clinical outcomes of COVID-19. BMC Nephrol. https://doi.org/10.\n"
            "1186/s12882-022-02869-6 (2022).\n"
            "2. SiFive Inc. SiFive TileLink Specification, https://static.dev.sifive.com/\n"
            "d39400a_tilelink-spec-1.7.1.pdf, Accessed 2025.\n"
            "3. Rescorla, E.; Dierks, T. The Transport Layer Security (TLS) Protocol Version 1.3; RFC 8446; (2018) Internet Engineering Task Force Standards Track.\n"
        )
        doc = Document(file_path="/fake/split.pdf", num_pages=1, pages=[Page(page_num=1, text=bib_text)])
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="Clinical outcomes of COVID-19",
                    authors=[GrobidAuthor(full_name="Smith, J", last_name="Smith")],
                    venue="BMC Nephrol",
                    raw_reference="1. Smith J, Doe A. Clinical outcomes of COVID-19. BMC Nephrol. https://doi.org/10.",
                ),
                GrobidBibEntry(
                    id="b1",
                    title=None,
                    authors=[GrobidAuthor(full_name="1186/ s12882-022-02869-6", last_name="1186/ s12882-022-02869-6")],
                    year="2022",
                    raw_reference="1186/ s12882-022-02869-6 (2022).",
                ),
                GrobidBibEntry(
                    id="b2",
                    title="SiFive TileLink Specification",
                    authors=[GrobidAuthor(full_name="SiFive Inc", last_name="SiFive Inc")],
                    url="https://static.dev.sifive.com/",
                    raw_reference="2. SiFive Inc. SiFive TileLink Specification, https://static.dev.sifive.com/",
                ),
                GrobidBibEntry(
                    id="b3",
                    title="d39400a_tilelink-spec-1.7.1.pdf",
                    authors=[GrobidAuthor(full_name="Accessed", last_name="Accessed")],
                    year="2025",
                    raw_reference="d39400a_tilelink-spec-1.7.1.pdf, Accessed 2025.",
                ),
                GrobidBibEntry(
                    id="b4",
                    title="The Transport Layer Security (TLS) Protocol Version 1.3",
                    authors=[GrobidAuthor(full_name="Rescorla, E", last_name="Rescorla")],
                    venue="RFC 8446",
                    raw_reference="3. Rescorla, E.; Dierks, T. The Transport Layer Security (TLS) Protocol Version 1.3; RFC 8446;",
                ),
                GrobidBibEntry(
                    id="b5",
                    title="Internet Engineering Task Force Standards Track",
                    authors=[],
                    year="2018",
                    raw_reference="(2018) Internet Engineering Task Force Standards Track.",
                ),
            ]
        )
        merged = DocumentParser()._merge(doc, grobid_out).references
        assert len(merged) == 3
        assert [r.numeric_index for r in merged] == [1, 2, 3]
        assert merged[0].doi == "10.1186/s12882-022-02869-6"
        assert merged[0].year == "2022"
        assert merged[2].year == "2018"


# ============================================================================
# P1 — SYS-BUG-07: _enrich_grobid_ref author/DOI pollution & SOCS-3 acronym recovery
# ============================================================================


class TestSysBug07EnrichGrobidAuthorAndDoiSanitization:
    def test_apa_fallback_dirty_authors_and_polluted_doi_do_not_corrupt_grobid_and_socs3_recovers(self):
        """Reproduces 6_ICCIES_2027/main.pdf Ref #10 (apa_fallback overwriting ['Mckie, J X']),
        20-theses/203.pdf & 213.pdf ('10.1080/...04Nokia', '10.1080/...51.73'), and
        20-theses/19.pdf ref-0069 ('Socs-3' acronym in title recovered from clean donor)."""
        bib_text = (
            "References\n"
            "[1] McKie, J.X., Artifex Software Inc.: PyMuPDF: Python Bindings for MuPDF (2024). https://github.com/pymupdf/PyMuPDF\n"
            "[2] Ueki, K., Kondo, T., & Kahn, C. R. (2004). Suppressor of Cytokine Signaling 1 (SOCS-1) and SOCS-3 Cause Insulin Resistance. PNAS, 101(28), 10422-10427. https://doi.org/10.1080/09603101003636204Nokia\n"
        )
        doc = Document(file_path="/fake/enrich.pdf", num_pages=1, pages=[Page(page_num=1, text=bib_text)])
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="PyMuPDF: Python Bindings for MuPDF",
                    authors=[GrobidAuthor(full_name="Mckie, J X", last_name="Mckie", first_name="J X")],
                    year="2024",
                    url="https://github.com/pymupdf/PyMuPDF",
                    raw_reference="[1] McKie, J.X., Artifex Software Inc.: PyMuPDF: Python Bindings for MuPDF (2024). https://github.com/pymupdf/PyMuPDF",
                ),
                GrobidBibEntry(
                    id="b1",
                    title="Suppressor of Cytokine Signaling 1 (SOCS-1) and SOCS-3 Cause Insulin Resistance",
                    authors=[GrobidAuthor(full_name="Socs-3", last_name="Socs-3")],
                    year="2004",
                    doi="10.1080/09603101003636204",
                    raw_reference="[2] Ueki, K., Kondo, T., & Kahn, C. R. (2004). Suppressor of Cytokine Signaling 1 (SOCS-1) and SOCS-3 Cause Insulin Resistance.",
                ),
            ]
        )
        merged = DocumentParser()._merge(doc, grobid_out).references
        assert len(merged) == 2
        assert all("PyMuPDF" not in str(a) for a in merged[0].authors)
        assert any("Ueki" in str(a) for a in merged[1].authors)
        assert merged[1].doi == "10.1080/09603101003636204"


# ============================================================================
# P1 — SYS-BUG-08: Acronym label before semicolon `(SEIS; Schutte et al., 2009)`
# ============================================================================


class TestSysBug08SemicolonAcronymPrefixInParenthetical:
    def test_acronym_prefix_before_semicolon_links_to_author_year(self):
        """Reproduces 20-theses/5.pdf `(SEIS; Schutte et al., 2009)` and 19.pdf `(AVP; Rusch et al., 2023)`."""
        bibs = [
            Citation(
                raw_text="Schutte, N. S., Malouff, J. M., & Bhullar, N. (2009). The Assessing Emotions Scale.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Schutte, N. S.", "Malouff, J. M.", "Bhullar, N."],
                year="2009",
                title="The Assessing Emotions Scale",
                reference_id="ref-0001",
            )
        ]
        body = [
            Citation(
                raw_text="(SEIS; Schutte et al., 2009)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-0001",
            )
        ]
        lr = CitationLinker().link(body, bibs)
        assert len(lr.links) == 1
        assert lr.links[0].status == CitationMappingStatus.MATCHED
        assert lr.links[0].reference_id == "ref-0001"


# ============================================================================
# P1 — SYS-BUG-12: Bluebook footnotes + synthetic footnote gap mismatch (+12 vs +2)
# ============================================================================


class TestSysBug12BluebookSyntheticFootnotesNoMonsterMerge:
    def test_synthetic_footnote_bibliography_handles_bluebook_statutes_and_number_gaps(self):
        """Reproduces 20-theses/3.pdf: Bluebook volume-leading footnotes (`5 21 U.S.C. § 355 (2018)`)
        and number gaps > +2 (`4 -> 8`) must split into individual entries instead of gluing into 1 monster ref."""
        fn_pairs = [(1, 2), (3, 4), (8, 9), (10, 11), (15, 16)]
        pages = [
            Page(
                page_num=p,
                text=(
                    f"Body prose on page {p} discussing pharmaceutical regulation.\n"
                    f"{fn_pairs[p - 1][0]} Peter Barton Hutt, Food and Drug Law 112 (2014).\n"
                    f"{fn_pairs[p - 1][1]} 21 U.S.C. § 355 (2018).\n"
                ),
            )
            for p in range(1, 6)
        ]
        doc = Document(file_path="/fake/3.pdf", num_pages=5, pages=pages)
        parsed = DocumentParser()._merge(doc, None)
        assert len(parsed.references) >= 8
        assert max(len(r.raw_text or "") for r in parsed.references) < 300


# ============================================================================
# P1 — SYS-BUG-13: Standalone `[1].` after REFERENCES & GROBID prose hallucinations
# ============================================================================


class TestSysBug13StandaloneBracketOneAndGrobidHallucinationFilter:
    def test_references_header_with_running_header_and_standalone_bracket_1_dot_is_segmented(self):
        """Reproduces tdtu_github_reports/061_tdtu p.49: running header + `REFERENCES` + standalone `[1].` line."""
        from integrity_checker.extraction.section_segmenter import SectionSegmenter, SectionType

        p1 = Page(page_num=1, text="CHAPTER 1 INTRODUCTION\nThis system uses ESP32-S3 for object detection [1].")
        p2 = Page(
            page_num=2,
            text=(
                "Midterm Report\n"
                "Page 49/50\n"
                "REFERENCES\n"
                "[1].\n"
                "Espressif Systems, ESP32-S3 Technical Reference Manual, 2023. https://espressif.com/esp32s3\n"
                "[2].\n"
                "Glenn Jocher, Ultralytics YOLOv8 Documentation, 2023. https://docs.ultralytics.com\n"
            ),
        )
        doc = Document(file_path="/fake/061.pdf", num_pages=2, pages=[p1, p2])
        sections = SectionSegmenter().segment(doc)
        bib_secs = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
        assert len(bib_secs) == 1
        assert "Espressif Systems" in bib_secs[0].text

    def test_grobid_yearless_authorless_prose_bullets_filtered_when_no_bib_section(self):
        """Reproduces TDTU_PDF/086_uit (8 Vietnamese feature bullets hallucinated as refs when document
        has no bibliography) and 20-theses/57.pdf ('I could not get going' CES-D appendix item)."""
        doc = Document(
            file_path="/fake/086.pdf",
            num_pages=2,
            pages=[
                Page(
                    page_num=1,
                    text=(
                        "BÁO CÁO ĐỒ ÁN MÔN HỌC\n"
                        "- Quản lý danh sách sản phẩm và giỏ hàng trực tuyến cho khách hàng.\n"
                        "- I could not get 'going' during the past week.\n"
                    ),
                ),
                Page(page_num=2, text="KẾT LUẬN\nHệ thống đã hoàn thiện các chức năng cơ bản."),
            ],
        )
        grobid_out = GrobidOutput(
            bibliography=[
                GrobidBibEntry(
                    id="b0",
                    title="Quản lý danh sách sản phẩm và giỏ hàng trực tuyến cho khách hàng",
                    authors=[],
                    year=None,
                    raw_reference="- Quản lý danh sách sản phẩm và giỏ hàng trực tuyến cho khách hàng.",
                ),
                GrobidBibEntry(
                    id="b1",
                    title="could not get 'going' during the past week",
                    authors=[GrobidAuthor(full_name="I", last_name="I")],
                    year=None,
                    raw_reference="I could not get 'going' during the past week.",
                ),
            ]
        )
        parsed = DocumentParser()._merge(doc, grobid_out)
        assert parsed.references == []


# ============================================================================
# P2 — SYS-BUG-10: Multi-year same author `(Beck et al., 1979 & 2005)` & `all cited by`
# ============================================================================


class TestSysBug10MultiYearSameAuthorAndAllCitedBy:
    def test_same_author_ampersand_years_links_both_references(self):
        """Reproduces 20-theses/57.pdf occ-0047: `(Beck et al., 1979 & 2005; Clark & Beck, 1999)`
        must link to BOTH Beck (1979) and Beck (2005), leaving 0 uncited references."""
        bibs = [
            Citation(
                raw_text="Beck, A. T., Rush, A. J., Shaw, B. F., & Emery, G. (1979). Cognitive therapy of depression.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=[Author(raw="Beck, A. T.", last_name="beck")],
                year="1979",
                title="Cognitive therapy of depression",
                reference_id="ref-0001",
            ),
            Citation(
                raw_text="Beck, A. T., Freeman, A., & Davis, D. D. (2005). Cognitive therapy of personality disorders.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=[Author(raw="Beck, A. T.", last_name="beck")],
                year="2005",
                title="Cognitive therapy of personality disorders",
                reference_id="ref-0002",
            ),
            Citation(
                raw_text="Clark, D. A., & Beck, A. T. (1999). Scientific foundations of cognitive theory.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=[
                    Author(raw="Clark, D. A.", last_name="clark"),
                    Author(raw="Beck, A. T.", last_name="beck"),
                ],
                year="1999",
                title="Scientific foundations of cognitive theory",
                reference_id="ref-0003",
            ),
        ]
        body = [
            Citation(
                raw_text="(Beck et al., 1979 & 2005; Clark & Beck, 1999)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-0001",
            )
        ]
        lr = CitationLinker().link(body, bibs)
        matched_ids = {lnk.reference_id for lnk in lr.links if lnk.status == CitationMappingStatus.MATCHED}
        assert matched_ids == {"ref-0001", "ref-0002", "ref-0003"}
        assert lr.unmatched_reference_ids == []

    def test_all_cited_by_secondary_citation_does_not_emit_false_missing(self):
        """Reproduces style_corpora/APA/real/18: `(Van der Doef & Maes, 1999; Siegrist, 1996; all cited by Fox et al., 2023)`
        must link to secondary source Fox et al. (2023) without emitting MISSING_REFERENCE for primary sources."""
        bibs = [
            Citation(
                raw_text="Fox, K. E., Johnson, S. T., & Berkman, L. F. (2023). Organizational interventions.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=[Author(raw="Fox, K. E.", last_name="fox")],
                year="2023",
                title="Organizational interventions",
                reference_id="ref-0001",
            )
        ]
        body = [
            Citation(
                raw_text="(Van der Doef & Maes, 1999; Siegrist, 1996; all cited by Fox et al., 2023)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                reference_id="occ-0001",
            )
        ]
        lr = CitationLinker().link(body, bibs)
        missing = [lnk for lnk in lr.links if lnk.status == CitationMappingStatus.MISSING_REFERENCE]
        matched = [lnk for lnk in lr.links if lnk.status == CitationMappingStatus.MATCHED]
        assert missing == []
        assert len(matched) == 1
        assert matched[0].reference_id == "ref-0001"


# ============================================================================
# P2 — SYS-BUG-11: DuplicateDetector misses identical specific URLs when authors=[]
# ============================================================================


class TestSysBug11DuplicateDetectorSpecificUrlWithoutAuthors:
    def test_authorless_entries_with_identical_specific_url_are_flagged_as_duplicates_but_root_domains_are_not(self):
        """Reproduces 20-theses/99.pdf ref-0096 & ref-0097: identical specific Wikipedia URL
        with `authors=[]` must be grouped as duplicate, while root domain `https://www.who.int/` is not."""
        from integrity_checker.linking.duplicate_detector import DuplicateDetector

        c1 = Citation(
            raw_text="[96] IKEA (2020) https://en.wikipedia.org/wiki/IKEA#cite_note-19",
            citation_type=CitationType.REFERENCE_LIST,
            authors=[],
            year="2020",
            title="IKEA",
            url="https://en.wikipedia.org/wiki/IKEA#cite_note-19",
            reference_id="ref-0096",
        )
        c2 = Citation(
            raw_text="[97] IKEA (2020) https://en.wikipedia.org/wiki/IKEA#cite_note-19",
            citation_type=CitationType.REFERENCE_LIST,
            authors=[],
            year="2020",
            title="IKEA",
            url="https://en.wikipedia.org/wiki/IKEA#cite_note-19",
            reference_id="ref-0097",
        )
        r1 = Citation(
            raw_text="World Health Organization. (2021). Malaria fact sheet. https://www.who.int/",
            citation_type=CitationType.REFERENCE_LIST,
            authors=[],
            year="2021",
            title="Malaria fact sheet",
            url="https://www.who.int/",
            reference_id="ref-0098",
        )
        r2 = Citation(
            raw_text="World Health Organization. (2022). Tuberculosis report. https://www.who.int/",
            citation_type=CitationType.REFERENCE_LIST,
            authors=[],
            year="2022",
            title="Tuberculosis report",
            url="https://www.who.int/",
            reference_id="ref-0099",
        )
        groups = DuplicateDetector().detect([c1, c2, r1, r2])
        assert len(groups) == 1
        assert {c.reference_id for c in groups[0].citations} == {"ref-0096", "ref-0097"}


# ============================================================================
# P2 — SYS-BUG-14: Running headers/footers & standalone page number glued to DOI/URL dot
# ============================================================================


class TestSysBug14PageFurnitureAndUrlTrailingPageNumber:
    def test_running_headers_spaced_page_footer_plos_doi_footer_and_trailing_page_number_after_doi_dot(self):
        """Reproduces 20-theses/34.pdf ('Honors Thesis: | N. Alice Droeger 49'),
        20-theses/134.pdf ('62 | P a g e'), 20-theses/213.pdf ('...1354551.\\n73'),
        and PLOS ONE repeated self-DOI footers."""
        bib_text = (
            "References\n"
            "PLOS ONE | DOI:10.1371/journal.pone.0173000 March 9, 2020 12 / 15\n"
            "Bouri, E., Molnar, P., Azzi, G., Roubaud, D., & Hagfors, L. I. (2017). On the hedge and safe haven properties of Bitcoin. Finance Research Letters, 20, 192-198. https://doi.org/10.1080/09603107.2016.1354551.\n"
            "73\n"
            "Honors Thesis: | N. Alice Droeger 49\n"
            "62 | P a g e\n"
            "PLOS ONE | DOI:10.1371/journal.pone.0173000 March 9, 2020 13 / 15\n"
            "Fama, E. F., & French, K. R. (2015). A five-factor asset pricing model. Journal of Financial Economics, 116(1), 1-22.\n"
        )
        doc = Document(file_path="/fake/furniture.pdf", num_pages=1, pages=[Page(page_num=1, text=bib_text)])
        refs = DocumentParser()._merge(doc, None).references
        assert len(refs) == 2
        assert refs[0].doi == "10.1080/09603107.2016.1354551"
        assert all("droeger" not in (r.raw_text or "").lower() for r in refs)
        assert all("p a g e" not in (r.raw_text or "").lower() for r in refs)
        assert all((r.doi or "") != "10.1371/journal.pone.0173000" for r in refs)


# ============================================================================
# P2 — SYS-BUG-15: URL domain split into title, 4-digit issue year, www./<http>/doi.org
# ============================================================================


class TestSysBug15UrlDomainSplitFourDigitIssueYearAndWwwAngleUrlExtraction:
    def test_apa_entry_with_bare_url_after_year_does_not_split_domain_into_title(self):
        """Reproduces 20-theses/15.pdf & 6_ICCIES_2027/main.pdf: `OpenAI. (2024). https://x.com/openai/status/123`
        must NEVER produce `title == 'https://x'`."""
        from integrity_checker.extraction.patterns.apa import APAFormat

        cit = APAFormat().parse_reference_entry("OpenAI. (2024). https://x.com/openai/status/123")
        assert cit is not None
        assert cit.title != "https://x"
        assert cit.url == "https://x.com/openai/status/123"

    def test_apa_patterns_reject_non_calendar_4_digit_issue_7553_as_year(self):
        """Reproduces ACS/hard_01 regex path: non-calendar 4-digit parenthetical `(7553)` must never parse `year == '7553'`."""
        from integrity_checker.extraction.patterns.apa import APAFormat

        cit = APAFormat().parse_reference_entry(
            "[3] Nature (7553). Deep learning review. Macmillan, 436-444."
        )
        assert cit is None or cit.year != "7553"

    def test_reference_parser_extracts_www_url_angle_bracket_url_and_doi_from_doi_org_url(self):
        """Reproduces 20-theses/73, 98, 138, 197 & tdtu_github_reports/026:
        `www.unb.ca/...`, `<http://...>`, and `https://doi.org/10....` must populate `url` / `doi` cleanly."""
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        rp = ReferenceListParser()
        c_www = rp._parse_entry(
            "University of New Brunswick. (2021). Faculty of Arts. www.unb.ca/fredericton/arts/",
            1,
            1,
        )
        assert c_www is not None
        assert c_www.url == "https://www.unb.ca/fredericton/arts/"

        c_angle = rp._parse_entry(
            "World Trade Organization. (2020). Annual Report 2020. <http://www.wto.org/english/res_e/anrep20_e.pdf>.",
            2,
            1,
        )
        assert c_angle is not None
        assert c_angle.url == "http://www.wto.org/english/res_e/anrep20_e.pdf"

        c_doi_url = rp._parse_entry(
            '[1] A. Vaswani et al., "Attention Is All You Need," in NeurIPS, 2017, https://doi.org/10.48550/arXiv.1706.03762.',
            3,
            1,
        )
        assert c_doi_url is not None
        assert c_doi_url.doi == "10.48550/arXiv.1706.03762"


# ============================================================================
# P2 — SYS-BUG-16: Historical work titles / revolutions with `(Year)` in prose
# ============================================================================


class TestSysBug16HistoricalWorkTitlesNotExtractedAsNarrativeCitations:
    def test_work_titles_and_historical_revolutions_with_years_are_not_extracted_while_real_authors_are(self):
        """Reproduces style_corpora/Chicago/real/02 & 20-theses/72.pdf:
        `The Machiavellian Moment (1975)`, `Feudal Law (1957)`, `History (1944)`, `Roman Empire’ (2018)`,
        and `The Second Industrial Revolution (1870)` must NOT be extracted as narrative Author (Year) citations."""
        prose = (
            "Pocock published The Machiavellian Moment (1975) after studying Feudal Law (1957), "
            "History (1944), and ‘Decline of the Roman Empire’ (2018). "
            "During The Second Industrial Revolution (1870) and The Third Industrial Revolution (1950), "
            "Smith (2020) and Van Der Berg (2019) analyzed long-run productivity."
        )
        doc = Document(file_path="/fake/pocock.pdf", num_pages=1, pages=[Page(page_num=1, text=prose)])
        extracted = [c.raw_text for c in DocumentParser()._merge(doc, None).body_citations]
        assert "Smith (2020)" in extracted
        assert "Van Der Berg (2019)" in extracted
        for forbidden in ("Machiavellian", "Feudal Law", "History (1944)", "Roman Empire", "Industrial Revolution"):
            assert all(forbidden not in raw for raw in extracted), f"False positive still extracted: {extracted}"


# ============================================================================
# Live-Stack Verification Side-Effect Guards (103.pdf, AMA/20, ACS/17, MLA/17)
# ============================================================================


class TestLiveStackVerificationSideEffectGuards:
    def test_doi_inside_query_string_extracts_canonical_doi_not_base_url(self):
        """Reproduces 20-theses/103.pdf: PLOS ONE printable URLs in `bib.doi` must resolve to
        individual `10.1371/journal.pone.*` DOIs, never `https://journals.plos.org/plosone/article/file`."""
        from integrity_checker.extraction.grobid_adapter import grobid_to_references

        b1 = GrobidBibEntry(
            id="b1",
            title="Burden and determinants of malnutrition among pregnant women in Africa",
            authors=[GrobidAuthor(full_name="H D Desyibelew", last_name="Desyibelew")],
            year="2019",
            venue="PLoS ONE",
            doi="https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0221712&type=printable",
            url="https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0221712&type=printable",
            raw_reference="Desyibelew, H D (2019) PloS one https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0221712&type=printable",
        )
        b2 = GrobidBibEntry(
            id="b2",
            title="Local guidelines for admission to UK midwifery units",
            authors=[GrobidAuthor(full_name="C Glenister", last_name="Glenister")],
            year="2020",
            venue="PLoS ONE",
            doi="https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0239311&type=printable",
            url="https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0239311&type=printable",
            raw_reference="Glenister, C (2020) PloS one https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0239311&type=printable",
        )
        refs = grobid_to_references(GrobidOutput(bibliography=[b1, b2]))
        assert refs[0].doi == "10.1371/journal.pone.0221712"
        assert refs[1].doi == "10.1371/journal.pone.0239311"

    def test_zero_width_spaces_in_doi_and_url_are_stripped_preventing_stub_doi_truncation(self):
        """Reproduces style_corpora/AMA/real/20: `\u200b` inside `https://\u200bdoi.\u200borg/\u200b10.\u200b1016/j.\u200bekir...`
        must yield full clean DOI and URL, never truncated `10.1016/j`."""
        from integrity_checker.extraction.grobid_adapter import grobid_to_references
        from integrity_checker.extraction.patterns.utils import extract_doi, extract_url

        zw_url = "https://\u200bdoi.\u200borg/\u200b10.\u200b1016/j.\u200bekir.\u200b2022.\u200b02.\u200b016"
        assert extract_doi(zw_url) == "10.1016/j.ekir.2022.02.016"
        assert extract_url(zw_url) == "https://doi.org/10.1016/j.ekir.2022.02.016"

        b1 = GrobidBibEntry(
            id="b18",
            title="Mortality trends after transfer from peritoneal dialysis to hemodialysis",
            authors=[GrobidAuthor(full_name="A.-C. Nadeau-Fredette", last_name="Nadeau-Fredette")],
            year="2022",
            venue="Kidney Int. Rep.",
            doi="10.1016/j",
            url=zw_url,
            raw_reference=f"18. Nadeau-Fredette, A.-C. et al. Kidney Int. Rep. 2022. {zw_url}",
        )
        refs = grobid_to_references(GrobidOutput(bibliography=[b1]))
        assert refs[0].doi == "10.1016/j.ekir.2022.02.016"
        assert refs[0].url == "https://doi.org/10.1016/j.ekir.2022.02.016"

    def test_numeric_author_artifact_on_regex_ref_does_not_block_same_doi_grobid_dedup(self):
        """Reproduces style_corpora/ACS/real/17 & MLA/real/17: when GROBID shifted numeric_index due to
        multi-part chemistry refs (`14a, 14b`) and Regex parsed `20. Dolbier...` with `authors=['20']`,
        exact-DOI dedup must NOT treat `'20'` vs `'dolbier'` as conflicting authors."""
        grobid_refs = [
            Citation(
                raw_text="Dolbier, W R (1996) Chem. Rev DOI: 10.1021/cr941142c",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["Dolbier, W R"],
                year="1996",
                title="Chem. Rev",
                doi="10.1021/cr941142c",
                numeric_index=24,
                order_index=24,
                source="grobid",
                grobid_ref_id="b23",
            )
        ]
        regex_refs = [
            Citation(
                raw_text="20. Dolbier, W. R., Jr. Chem. Rev. 1996, 1557–1584. doi:10.1021/cr941142c",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                authors=["20"],
                year="1996",
                title="Dolbier, W. R., Jr. Chem. Rev. 1996, 1557–1584",
                doi="10.1021/cr941142c",
                numeric_index=20,
                order_index=20,
                source="regex",
            )
        ]
        merged = DocumentParser()._merge_reference_lists(grobid_refs, regex_refs)
        assert len(merged) == 1
        assert merged[0].doi == "10.1021/cr941142c"


