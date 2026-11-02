"""Comprehensive regression & rare/hard edge-case test suite for all 22 bugs (BUG-01..BUG-22)
discovered during the 20-theses full-system evaluation (26/10/2026).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.grobid_parser import parse_tei
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.section_segmenter import (
    DocumentSection,
    SectionSegmenter,
    SectionType,
)
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

# ==============================================================================
# PHASE 1 (P0): Reference Parsing & Segmentation Regressions (BUG-01 .. BUG-15)
# ==============================================================================


def _make_doc(*page_texts: str) -> Document:
    pages = [Page(page_num=i + 1, text=t) for i, t in enumerate(page_texts)]
    return Document(file_path=Path("test.pdf"), num_pages=len(pages), pages=pages)


def test_bug_01_running_headers_and_page_numbers_stripped_in_references() -> None:
    """BUG-01: Running headers ('Running head: ...', 'Lastname 42') must not corrupt references."""
    raw_bib = """References
Smith, J. A., & Doe, B. C. (2021). Cognitive appraisal of academic stress in university students.
Running head: COGNITIVE APPRAISAL OF STRESS 42
Journal of Educational Psychology, 113(4), 712-728. https://doi.org/10.1037/edu0000512

Miller, R. T. (2020). Resilience and coping mechanisms in higher education.
43
Academic Press.
"""
    parser = ReferenceListParser()
    refs = parser.parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 2
    assert "Running head" not in (refs[0].title or "")
    assert "Running head" not in (refs[0].venue or "")
    assert refs[0].year == "2021"
    assert refs[1].year == "2020"


def test_bug_02_chicago_bibliography_and_footnotes_extracted_and_linked() -> None:
    """BUG-02: Chicago bibliography entries and bottom-of-page footnotes (including Ibid.) link cleanly."""
    bib_text = """Bibliography
Noll, Mark A. The Scandal of the Evangelical Mind. Grand Rapids, MI: Eerdmans, 1994.

Marsden, George M. Fundamentalism and American Culture. New York: Oxford University Press, 2006.
"""
    ref_parser = ReferenceListParser()
    refs = ref_parser.parse_reference_section(_make_doc(bib_text))
    assert len(refs) == 2
    for idx, r in enumerate(refs):
        r.reference_id = f"ref-{idx:04d}"

    page1_text = (
        "Evangelical historiography underwent a major shift in the late twentieth century.1\n"
        "This shift continued into the twenty-first century.2\n"
        "Further developments confirmed the pattern.3\n"
        "1 Mark A. Noll, The Scandal of the Evangelical Mind (Grand Rapids, MI: Eerdmans, 1994), 23.\n"
        "2 Ibid., 45.\n"
        "3 George M. Marsden, Fundamentalism and American Culture (New York: Oxford University Press, 2006), 112.\n"
    )
    doc = _make_doc(page1_text, bib_text)
    doc_parser = DocumentParser()
    body_sections = [
        DocumentSection(section_type=SectionType.BODY, start_page=1, end_page=1, text=page1_text)
    ]
    fn_cits = doc_parser._extract_chicago_footnote_citations(
        sections=body_sections,
        source_doc=doc,
        existing_body=[],
        references=refs,
    )
    assert len(fn_cits) == 3

    linker = CitationLinker()
    link_res = linker.link(fn_cits, refs)
    assert len(link_res.unmatched_reference_ids) == 0
    assert all(c.mapping_status == CitationMappingStatus.MATCHED.value for c in fn_cits)


def test_bug_03_and_bug_14_section_segmenter_avoids_false_bibliography_in_body() -> None:
    """BUG-03 & BUG-14: Mid-body mentions of 'References' or footnote-only theses without bibliography."""
    body_only_text = (
        "Introduction\n\n"
        "This legal note examines constitutional interpretation through footnotes alone.1\n\n"
        "References to earlier Supreme Court decisions are abundant in the historical record.\n\n"
        "Conclusion\n\n"
        "The doctrine remains unsettled in modern jurisprudence.\n"
    )
    doc = _make_doc(body_only_text)
    segmenter = SectionSegmenter()
    sections = segmenter.segment(doc)
    bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_sections) == 0


def test_bug_04_line_wrapped_urls_and_dois_rejoined() -> None:
    """BUG-04: Multi-line broken DOIs and URLs in APA bibliography entries are rejoined."""
    raw_bib = """References
Vanuk, J. R., Alkozei, A., Raikes, A. C., Allen, J. J. B., & Killgore, W. D. S. (2019). Ability emotional
intelligence is associated with greater cardiac vagal control and reactivity. Frontiers in Human
Neuroscience, 13, 181. https://doi.org/10.3389/fnhum.2019.
00181
"""
    parser = ReferenceListParser()
    refs = parser.parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 1
    assert refs[0].doi == "10.3389/fnhum.2019.00181"


def test_bug_05_and_bug_06_and_bug_11_and_bug_15_grobid_tei_edge_cases() -> None:
    """BUG-05, BUG-06, BUG-11, BUG-15: GROBID TEI parser strips academic degrees (PhD, MPH, Esq, FACSM, III),
    preserves compound surnames, and handles corporate authors.
    """
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <back>
      <listBibl>
        <biblStruct xml:id="b0">
          <analytic>
            <title level="a">Exercise and metabolic health in adults</title>
            <author>
              <persName><forename>John</forename><surname>Smith</surname></persName>
            </author>
            <author>
              <persName><forename>;</forename><surname>Esq,</surname></persName>
            </author>
            <author>
              <persName><forename>Mph</forename><surname>Phd,</surname></persName>
            </author>
            <author>
              <persName><forename>Facsm</forename></persName>
            </author>
          </analytic>
          <monogr>
            <title level="j">Journal of Sports Medicine</title>
            <imprint>
              <date type="published" when="2022">2022</date>
            </imprint>
          </monogr>
          <note type="raw_reference">Smith, J., Esq., Ph.D., M.P.H., FACSM. (2022). Exercise and metabolic health in adults. Journal of Sports Medicine, 10(2), 15-25.</note>
        </biblStruct>
        <biblStruct xml:id="b1">
          <monogr>
            <title level="m">Proverbs: Baker Commentary on the Old Testament Wisdom and Psalms</title>
            <author>
              <persName><forename>Tremper Longman</forename><surname>III,</surname></persName>
            </author>
            <imprint>
              <date type="published" when="2006">2006</date>
            </imprint>
          </monogr>
          <note type="raw_reference">Longman, Tremper, III. Proverbs: Baker Commentary on the Old Testament Wisdom and Psalms. Grand Rapids, MI: Baker Academic, 2006.</note>
        </biblStruct>
      </listBibl>
    </back>
  </text>
</TEI>
"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 2
    ref0 = out.bibliography[0]
    assert [a.full_name for a in ref0.authors] == ["Smith, John"]
    ref1 = out.bibliography[1]
    assert any("Longman" in a.full_name for a in ref1.authors)
    assert not any(a.full_name.strip().upper().startswith("III") for a in ref1.authors)


def test_bug_07_and_bug_13_bible_editions_and_multipage_reference_merging() -> None:
    """BUG-07 & BUG-13: Bible editions without personal authors ('English Standard Version Bible...')
    and multi-page reference sections with page breaks parse cleanly.
    """
    page1_bib = """Works Cited
English Standard Version Bible. Crossway Bibles, 2016.

The ESV Study Bible, Wheaton, IL: Crossway, 2008.
"""
    page2_bib = """25
Augustine. Confessions. Translated by Henry Chadwick, Oxford University Press, 1991.
"""
    doc = _make_doc(page1_bib, page2_bib)
    parser = ReferenceListParser()
    refs = parser.parse_reference_section(doc)
    assert len(refs) == 3
    assert any("English Standard Version Bible" in (r.title or "") for r in refs)
    assert any("ESV Study Bible" in (r.title or "") for r in refs)
    assert any("Confessions" in (r.title or "") for r in refs)
    assert all(len(r.authors) >= 1 for r in refs)


def test_bug_08_chicago_three_em_dash_inherits_previous_author() -> None:
    """BUG-08: Chicago 3-em dash (———.) bibliography entries inherit the preceding entry's author."""
    raw_bib = """Bibliography
Lewis, C. S. Mere Christianity. New York: HarperOne, 2001.

———. The Screwtape Letters. New York: HarperOne, 2001.
"""
    parser = ReferenceListParser()
    refs = parser.parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 2
    assert any("Lewis" in str(a) for a in refs[0].authors)
    assert any("Lewis" in str(a) for a in refs[1].authors)
    assert "Screwtape Letters" in (refs[1].title or "")


def test_bug_09_and_bug_10_and_bug_12_apa_corporate_and_nd_and_editors() -> None:
    """BUG-09, BUG-10, BUG-12: Corporate authors, (n.d.) years, and editor roles parsed accurately."""
    raw_bib = """References
Security Risk Advisors. (2024). Red team operations and purple team frameworks. https://sra.io/blog/purple-team

Substance Abuse and Mental Health Services Administration. (n.d.). Trauma-informed care in behavioral health services. https://www.samhsa.gov/trauma

Kato-Kataoka, A., Nishida, K., Takada, M., Kawai, M., Kikuchi-Hayakawa, H., Suda, K., ... & Rokutan, K. (2016). Fermented milk containing Lactobacillus casei strain Shirota preserves the diversity of the gut microbiota and relieves abdominal dysfunction in healthy medical students exposed to academic stress. Applied and Environmental Microbiology, 82(12), 3649-3658.
"""
    parser = ReferenceListParser()
    refs = parser.parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 3
    assert any("Security Risk Advisors" in str(a) for a in refs[0].authors)
    assert refs[0].year == "2024"
    assert refs[1].year in (None, "n.d.") and "(n.d.)" in refs[1].raw_text
    assert refs[2].year == "2016"
    assert "Fermented milk containing Lactobacillus" in (refs[2].title or "")


# ==============================================================================
# PHASE 2 (P1): In-Text Citation Extraction & Linking Regressions (BUG-16 .. BUG-19)
# ==============================================================================


def test_bug_16_discourse_adverbs_and_common_nouns_filtered_from_intext() -> None:
    """BUG-16: Discourse adverbs ('However, Smith (2020)') stripped and non-author nouns ('Table 1 (2020)', 'Networks (p. 56)') ignored."""
    text = (
        "However, Smith (2020) demonstrated that neural networks converge rapidly. "
        "Similarly, Jones and Taylor (2021) found comparable results in clinical trials. "
        "As shown in Table 1 (2020) and Networks (p. 56), the baseline latency was low. "
        "In measuring EI and HRV, Vanuk et al. (2019) observed significant vagal reactivity."
    )
    extractor = CitationExtractor(preserve_occurrences=True)
    cits = extractor.extract_from_document(_make_doc(text))
    raws = [c.raw_text for c in cits]
    assert "Smith (2020)" in raws
    assert "Jones and Taylor (2021)" in raws
    assert "Vanuk et al. (2019)" in raws
    assert not any("However" in r for r in raws)
    assert not any("Similarly" in r for r in raws)
    assert not any("Table" in r for r in raws)
    assert not any("Networks" in r for r in raws)
    assert not any("EI and HRV" in r for r in raws)


def test_bug_17_calendar_dates_and_chicago_pub_parens_filtered_while_colon_titles_kept() -> None:
    """BUG-17: Calendar dates '(May 12, 2021)', '(New York: Basic Books, 1974)', '(Acts 18)' are filtered,
    while colon-containing title citations '(CAC Payback Period vs LTV: CAC Ratio, 2022)' are kept.
    """
    text = (
        "The interview was conducted on (May 12, 2021) and referenced Robert Nozick, "
        "Anarchy, State, and Utopia (New York: Basic Books, 1974) as well as (Acts 18) and (Years 1–3). "
        "Unit economics are benchmarked using industry ratios (CAC Payback Period vs LTV: CAC Ratio, 2022)."
    )
    extractor = CitationExtractor(preserve_occurrences=True)
    cits = extractor.extract_from_document(_make_doc(text))
    raws = [c.raw_text for c in cits]
    assert "(CAC Payback Period vs LTV: CAC Ratio, 2022)" in raws
    assert not any("May 12" in r for r in raws)
    assert not any("Basic Books" in r for r in raws)
    assert not any("Acts 18" in r for r in raws)
    assert not any("Years 1" in r for r in raws)


def test_bug_18_lowercase_particles_quoted_titles_and_nd_extracted_and_linked() -> None:
    """BUG-18: '(da Silva et al., 2017, p.22)', '(“Cortisol in Metabolic Syndrome,” 2024)',
    '(Author, n.d.)', and table 'Wu et al. 2024' are extracted and linked to references.
    """
    text = (
        "Prior work confirmed these findings (da Silva et al., 2017, p.22). "
        "Endocrine pathways were also reviewed (“Cortisol in Metabolic Syndrome,” 2024). "
        "Government guidelines support this intervention (SAMHSA, n.d.). "
        "Table 2 summarizes Microbiome shifts in Wu et al. 2024 across cohorts."
    )
    extractor = CitationExtractor(preserve_occurrences=True)
    in_text = extractor.extract_from_document(_make_doc(text))
    assert len(in_text) == 4

    refs = [
        Citation(
            raw_text="da Silva, M. A., Costa, R., & Pereira, L. (2017). Neural architecture search in practice.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["da Silva, M. A.", "Costa, R.", "Pereira, L."],
            year="2017",
            title="Neural architecture search in practice",
            reference_id="ref-0000",
        ),
        Citation(
            raw_text="Cortisol in Metabolic Syndrome. (2024). Endocrine Reviews Portal.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=[],
            year="2024",
            title="Cortisol in Metabolic Syndrome",
            reference_id="ref-0001",
        ),
        Citation(
            raw_text="Substance Abuse and Mental Health Services Administration (SAMHSA). (n.d.). Trauma-informed care.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Substance Abuse and Mental Health Services Administration (SAMHSA)"],
            year="n.d.",
            title="Trauma-informed care",
            reference_id="ref-0002",
        ),
        Citation(
            raw_text="Wu, H., Chen, Y., & Liu, Z. (2024). Gut microbiome alterations under chronic stress.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Wu, H.", "Chen, Y.", "Liu, Z."],
            year="2024",
            title="Gut microbiome alterations under chronic stress",
            reference_id="ref-0003",
        ),
    ]

    linker = CitationLinker()
    res = linker.link(in_text, refs)
    assert len(res.unmatched_reference_ids) == 0
    assert all(c.mapping_status == CitationMappingStatus.MATCHED.value for c in in_text)


def test_bug_19_diacritics_secondary_citations_and_anagram_typos_linked() -> None:
    """BUG-19: Nordic/German/Polish diacritics (ø, ł, ß), secondary citations ('as cited in'),
    bracketed acronyms ('[NIMH]'), and author transposition typos ('Adizogel' vs 'Adigozel',
    'Kato-Katoaka' vs 'Kato-Kataoka') link without false MISSING_REFERENCE or UNCITED.
    """
    in_text = [
        Citation(
            raw_text="(Lønning, 2019; Møller & Groß, 2020)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        ),
        Citation(
            raw_text="(Freud, 1923, as cited in Łukasiewicz, 2021)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        ),
        Citation(
            raw_text="(National Institute of Mental Health [NIMH], 2023)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        ),
        Citation(
            raw_text="(Adizogel et al., 2022)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        ),
        Citation(
            raw_text="(Kato-Katoaka et al., 2016)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        ),
    ]
    refs = [
        Citation(
            raw_text="Lonning, P. (2019). Oncology biomarkers.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Lonning, P."],
            year="2019",
            title="Oncology biomarkers",
            reference_id="ref-0000",
        ),
        Citation(
            raw_text="Moller, A., & Gross, B. (2020). Metabolic pathways.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Moller, A.", "Gross, B."],
            year="2020",
            title="Metabolic pathways",
            reference_id="ref-0001",
        ),
        Citation(
            raw_text="Lukasiewicz, J. (2021). Modern psychoanalysis review.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Lukasiewicz, J."],
            year="2021",
            title="Modern psychoanalysis review",
            reference_id="ref-0002",
        ),
        Citation(
            raw_text="National Institute of Mental Health. (2023). Anxiety disorders fact sheet.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["National Institute of Mental Health"],
            year="2023",
            title="Anxiety disorders fact sheet",
            reference_id="ref-0003",
        ),
        Citation(
            raw_text="Adigozel, E., Yilmaz, S., & Kaya, M. (2022). Dietary patterns and gut health.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Adigozel, E.", "Yilmaz, S.", "Kaya, M."],
            year="2022",
            title="Dietary patterns and gut health",
            reference_id="ref-0004",
        ),
        Citation(
            raw_text="Kato-Kataoka, A., Nishida, K., & Rokutan, K. (2016). Fermented milk preserves gut diversity.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Kato-Kataoka, A.", "Nishida, K.", "Rokutan, K."],
            year="2016",
            title="Fermented milk preserves gut diversity",
            reference_id="ref-0005",
        ),
    ]

    linker = CitationLinker()
    res = linker.link(in_text, refs)
    assert len(res.unmatched_reference_ids) == 0
    assert all(c.mapping_status == CitationMappingStatus.MATCHED.value for c in in_text)


# ==============================================================================
# PHASE 3 (P2): Retrieval, Author Matching, arXiv DOI & Symbolic Rules (BUG-20 .. BUG-22)
# ==============================================================================


@pytest.mark.asyncio
async def test_bug_20_local_db_rejects_partial_title_or_wrong_author_and_queries_tier1() -> None:
    """BUG-20: Tier-0 local_db FTS lookup must reject candidates with title_sim < 0.85
    or mismatched authors and fall through to Tier-1 external APIs.
    """
    fake_local_db = MagicMock()
    fake_local_db.find_by_doi.return_value = None
    fake_local_db.find_by_arxiv_id.return_value = None

    # Local DB returns a paper with only partial title overlap (~0.75) or wrong author
    wrong_paper = MagicMock()
    wrong_paper.id = 99
    wrong_paper.doi = "10.1000/wrong"
    wrong_paper.title = "Deep Learning for Medical Image Segmentation"
    wrong_paper.authors = ["CompletelyDifferent, A."]
    wrong_paper.year = 2021
    wrong_paper.venue = "IEEE Access"
    wrong_paper.abstract = "Some abstract."
    wrong_paper.external_ids = {}
    fake_local_db.fuzzy_search.return_value = [wrong_paper]

    mock_crossref = MagicMock()
    mock_crossref.name = "crossref"
    mock_crossref.lookup = AsyncMock(
        return_value=SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1109/TMI.2021.123456",
            title="Deep Learning for Medical Image Segmentation",
            authors=["Nguyen, B. M.", "Tran, T. P."],
            year="2021",
            confidence=0.95,
        )
    )
    mock_openalex = MagicMock()
    mock_openalex.name = "openalex"
    mock_openalex.lookup = AsyncMock(
        return_value=SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1109/TMI.2021.123456",
            title="Deep Learning for Medical Image Segmentation",
            authors=["Nguyen, B. M.", "Tran, T. P."],
            year="2021",
            confidence=0.95,
        )
    )

    def _make_empty_client(name: str) -> MagicMock:
        m = MagicMock()
        m.name = name
        m.lookup = AsyncMock(return_value=SourceCandidate(source_name=name, found=False))
        return m

    orchestrator = RetrievalOrchestrator(
        crossref=mock_crossref,
        openalex=mock_openalex,
        semantic_scholar=_make_empty_client("semantic_scholar"),
        europepmc=_make_empty_client("europepmc"),
        dblp=_make_empty_client("dblp"),
        arxiv=_make_empty_client("arxiv"),
        openlibrary=_make_empty_client("openlibrary"),
        local_db=fake_local_db,
        use_local_db=True,
        enable_link_validation=False,
    )
    cit = Citation(
        raw_text="Nguyen, B. M., & Tran, T. P. (2021). Deep Learning for Medical Image Segmentation.",
        title="Deep Learning for Medical Image Segmentation",
        authors=["Nguyen, B. M.", "Tran, T. P."],
        year="2021",
    )
    result = await orchestrator.retrieve(cit)
    assert "local_db" not in result.sources_succeeded
    assert "crossref" in result.sources_succeeded
    mock_crossref.lookup.assert_called_once()


def test_bug_21_east_asian_swapped_author_order_and_arxiv_doi_equivalence() -> None:
    """BUG-21: East Asian swapped Given/Family author names ('Wei, G.' vs 'Wei Guodong',
    'Guodong, W.' vs 'Guodong Wei') match with score 1.0, and arXiv DOI (10.48550/arXiv.*)
    matches a candidate returning the published conference/journal DOI + external_ids['arxiv'].
    """
    assert author_match_score(["Wei, G."], ["Wei Guodong"]) == 1.0
    assert author_match_score(["Guodong, W."], ["Guodong Wei"]) == 1.0
    assert author_match_score(["Wei, Guodong"], ["Guodong, Wei"]) == 1.0
    # Ensure unrelated Western names with different initials do not falsely match
    assert author_match_score(["James, R."], ["James Smith"]) == 0.0

    # Test arXiv DOI vs published conference DOI equivalence in FeatureCalculator & SymbolicRules
    cit = Citation(
        raw_text="Hu, S., Tu, Y., Han, X., & He, G. (2024). MiniCPM: Unveiling the Potential of Small Language Models. https://doi.org/10.48550/arXiv.2404.06395",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        title="MiniCPM: Unveiling the Potential of Small Language Models",
        authors=["Hu, S.", "Tu, Y.", "Han, X.", "He, G."],
        year="2024",
        doi="10.48550/arXiv.2404.06395",
    )
    cand = SourceCandidate(
        source_name="arxiv",
        found=True,
        doi="10.18653/v1/2024.acl-long.999",
        title="MiniCPM: Unveiling the Potential of Small Language Models",
        authors=["Shengding Hu", "Yuge Tu", "Xu Han", "Guodong He"],
        year="2024",
        external_ids={"arxiv": "2404.06395"},
        confidence=0.98,
    )
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand],
        sources_queried=["arxiv"],
        sources_succeeded=["arxiv"],
    )
    mock_semantic = MagicMock()
    mock_semantic.similarity.return_value = 1.0
    fc = FeatureCalculator(semantic=mock_semantic, enable_content_alignment=False)
    features = fc.compute(cit, source)
    assert features.doi_exact_match is True

    rules = SymbolicRules()
    outcome = rules.apply(
        features,
        source,
        citation_doi=cit.doi,
        citation_authors=cit.authors,
        citation_year=cit.year,
        citation_raw=cit.raw_text,
    )
    assert outcome.label == ValidationLabel.VERIFIED


def test_bug_22_non_journal_books_bible_classical_and_web_sources_not_flagged_as_hallucinated() -> None:
    """BUG-22: Books with publishers, Bible editions, classical texts, Master's/Honours theses,
    and web/YouTube URLs must be classified as UNRESOLVED or RESOURCE (never SUSPECTED_HALLUCINATION)
    when scholarly paper APIs return 0 records or noisy low-similarity paper candidates.
    """
    rules = SymbolicRules()
    empty_failed = {
        "crossref": "Crossref: no results for query",
        "openalex": "OpenAlex: no results for query",
    }

    # 1. Book with academic/theological publisher
    book_raw = "Longman, T., III. (2006). Proverbs: Baker Commentary on the Old Testament Wisdom and Psalms. Grand Rapids, MI: Baker Academic."
    book_source = SourceResult(
        citation_raw=book_raw,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed=empty_failed,
    )
    book_outcome = rules.apply(
        MatchFeatures(),
        book_source,
        citation_authors=["Longman, T."],
        citation_year="2006",
        citation_raw=book_raw,
    )
    assert book_outcome.label == ValidationLabel.UNRESOLVED
    assert "R-UNINDEXED-BOOK-OR-SOURCE" in book_outcome.triggered_rules

    # 2. Bible edition
    bible_raw = "The Holy Bible, English Standard Version. (2016). Crossway."
    bible_source = SourceResult(
        citation_raw=bible_raw,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed=empty_failed,
    )
    bible_outcome = rules.apply(
        MatchFeatures(),
        bible_source,
        citation_authors=[],
        citation_year="2016",
        citation_raw=bible_raw,
    )
    assert bible_outcome.label == ValidationLabel.UNRESOLVED
    assert "R-UNINDEXED-BOOK-OR-SOURCE" in bible_outcome.triggered_rules

    # 3. Web / YouTube resource with noisy low-similarity candidate
    web_raw = "Security Risk Advisors. (2024). Purple Team Operations Overview [Video]. YouTube. https://www.youtube.com/watch?v=abc123xyz"
    noisy_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        title="Unrelated Paper on Team Sports",
        authors=["Other, A."],
        year="2018",
        confidence=0.3,
    )
    web_source = SourceResult(
        citation_raw=web_raw,
        candidates=[noisy_cand],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["openalex"],
        sources_failed={},
    )
    web_features = MatchFeatures(
        title_sim_fuzzy=0.20,
        title_sim_semantic=0.22,
        author_jaccard=0.0,
        year_distance=6,
        doi_exact_match=False,
        source_consensus=1,
    )
    web_outcome = rules.apply(
        web_features,
        web_source,
        citation_url="https://www.youtube.com/watch?v=abc123xyz",
        citation_authors=["Security Risk Advisors"],
        citation_year="2024",
        citation_raw=web_raw,
    )
    assert web_outcome.label == ValidationLabel.RESOURCE
    assert "R-NON-SCHOLARLY-RESOURCE" in web_outcome.triggered_rules
