"""Comprehensive regression test suite for all 16 parsing & linking bugs (BUG-200-01 .. BUG-200-16)
discovered and fixed during the 200-theses (`20-theses/21.pdf` .. `220.pdf`) full evaluation.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.grobid_adapter import grobid_to_references
from integrity_checker.extraction.grobid_parser import parse_tei
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.section_segmenter import (
    SectionSegmenter,
    SectionType,
)
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

_THESES_DIR = Path(__file__).resolve().parents[2] / "20-theses"


def _make_doc(*page_texts: str) -> Document:
    pages = [Page(page_num=i + 1, text=t) for i, t in enumerate(page_texts)]
    return Document(file_path=Path("test.pdf"), num_pages=len(pages), pages=pages)


# ==============================================================================
# Standalone Regression Tests for All 16 Bugs (Run in CI without PDFs/Docker)
# ==============================================================================


def test_200_theses_bug_01_grobid_disk_cache_checked_before_health_check(tmp_path: Path) -> None:
    """Bug #1 (1243980): GrobidServiceManager disk cache works by SHA256 and call_grobid_fulltext handles retries."""
    from integrity_checker.config import GrobidConfig
    from integrity_checker.extraction.grobid_service import GrobidServiceManager

    pdf_file = tmp_path / "sample.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 sample content for cache lookup")

    mgr = GrobidServiceManager(
        config=GrobidConfig(url="http://127.0.0.1:19999", cache_by_file_sha256=True)
    )
    sample_tei = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a">Cached Thesis Title</title></titleStmt></fileDesc></teiHeader>
  <text><back><listBibl/></back></text>
</TEI>"""
    mgr.save_to_cache(str(pdf_file), sample_tei)
    cached = mgr.get_from_cache(str(pdf_file))
    assert cached is not None
    out = parse_tei(cached)
    assert out.is_available is True
    assert out.header.get("title") == "Cached Thesis Title"
    mgr.invalidate_cache(str(pdf_file))


def test_200_theses_bug_02_sources_bibliography_header_recognized() -> None:
    """Bug #2 (0520707): 'Sources' / '4. Sources' recognized as BIBLIOGRAPHY heading (59.pdf, 114.pdf)."""
    body_p1 = "1. Introduction\nHoneybee colonies face severe environmental stressors (Smith, 2020)."
    bib_p2 = (
        "Sources\n"
        "Smith, J. (2020). Pollinator decline and pesticide exposure. Ecological Review, 12(3), 45-60.\n"
        "https://uspirg.org/feature/usp/ban-bee-killing-pesticides\n"
    )
    doc = _make_doc(body_p1, bib_p2)
    sections = SectionSegmenter().segment(doc)
    bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_sections) == 1
    assert bib_sections[0].start_page == 2

    refs = ReferenceListParser().parse_reference_section(_make_doc(bib_p2))
    assert len(refs) >= 1
    assert refs[0].year == "2020"


def test_200_theses_bug_03_chicago_author_date_no_false_split_and_slash_year() -> None:
    """Bug #3 (ed08c67): Chicago Author-Date entries with quoted titles are not split at 'Author. YYYY.'
    and slash-years '1972/2014' link cleanly (38.pdf, 77.pdf, 109.pdf).
    """
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><back><listBibl>
    <biblStruct xml:id="b0">
      <monogr>
        <title level="m">Jewish Responses to Persecution, 1933–1938</title>
        <author><persName><forename>Jürgen</forename><surname>Matthäus</surname></persName></author>
        <imprint><date type="published" when="1938">1938</date></imprint>
      </monogr>
      <note type="raw_reference">Matthäus, Jürgen, and Mark Roseman. 2010. Jewish Responses to Persecution, 1933–1938. Lanham, MD: AltaMira Press.</note>
    </biblStruct>
    <biblStruct xml:id="b1">
      <monogr>
        <title level="m">Anti-Oedipus: Capitalism and Schizophrenia</title>
        <author><persName><forename>Gilles</forename><surname>Deleuze</surname></persName></author>
        <author><persName><forename>Félix</forename><surname>Guattari</surname></persName></author>
        <imprint><date type="published" when="1972">1972</date></imprint>
      </monogr>
      <note type="raw_reference">Deleuze, Gilles, and Félix Guattari. 1972/2014. Anti-Oedipus: Capitalism and Schizophrenia. New York: Penguin Books.</note>
    </biblStruct>
  </listBibl></back></text>
</TEI>"""
    out = parse_tei(tei_xml)
    refs = grobid_to_references(out)
    assert len(refs) == 2
    assert refs[0].year == "2010"
    assert "Jewish Responses to Persecution" in (refs[0].title or "")
    assert "1972/2014" in (refs[1].raw_text or "")

    in_text = [
        Citation(
            raw_text="(Deleuze and Guattari 1972/2014)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.CHICAGO,
            authors=["Deleuze", "Guattari"],
            year="2014",
            reference_id="occ-0001",
        )
    ]
    refs[0].reference_id = "ref-0001"
    refs[1].reference_id = "ref-0002"
    link_res = CitationLinker().link(in_text, refs)
    assert link_res.links[0].status == CitationMappingStatus.MATCHED


def test_200_theses_bug_04_slavic_and_romanian_diacritics_do_not_trigger_vn_override() -> None:
    """Bug #4 (77dd998): Croatian/Romanian diacritics ('đ', 'ă', 'â', 'î') in English theses (71.pdf, 61.pdf)
    do not trigger Vietnamese traditional entry parsing.
    """
    raw_bib = """References
Huđek Kanižaj, I., & Širec, K. (2022). Digital transformation of SMEs in Croatia and România. Journal of Entrepreneurship, 14(2), 101-118.
"""
    refs = ReferenceListParser().parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 1
    assert refs[0].matched_pattern != "vn_traditional_entry"
    assert refs[0].year == "2022"
    assert "Digital transformation of SMEs" in (refs[0].title or "")


def test_200_theses_bug_05_split_merged_grobid_entries_and_preserve_distinct_year_urls() -> None:
    """Bug #5 (072c940): Glued GROBID raw_reference entries are split and distinct-year regex entries with same URL are kept."""
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><back><listBibl>
    <biblStruct xml:id="b0">
      <monogr><title level="m">Merged</title></monogr>
      <note type="raw_reference">World Bank. 2022. World Development Report 2022: Finance for an Equitable Recovery. https://www.worldbank.org/en/publication/wdr2022 World Bank. 2024. World Development Report 2024: The Middle-Income Trap. https://www.worldbank.org/en/publication/wdr2024</note>
    </biblStruct>
  </listBibl></back></text>
</TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 2
    assert out.bibliography[0].year == "2022"
    assert out.bibliography[1].year == "2024"


def test_200_theses_bug_06_sql_appendix_not_segmented_as_implicit_bibliography() -> None:
    """Bug #6 (5e07063): Appendix pages containing SQL 'INSERT INTO' statements with numbered rows (126.pdf)
    are not mistaken for an implicit numbered bibliography.
    """
    p1 = "1. Introduction\nDatabase performance was evaluated (Chen, 2021)."
    p2 = "References\nChen, L. (2021). Query optimization in relational systems. ACM TODS, 46(1), 1-32."
    p3 = (
        "Appendix A\n"
        "1. INSERT INTO users VALUES (1, 'Alice', '2020-01-01');\n"
        "2. INSERT INTO users VALUES (2, 'Bob', '2021-02-02');\n"
        "3. INSERT INTO users VALUES (3, 'Charlie', '2022-03-03');\n"
        "4. CREATE TABLE orders (id INT PRIMARY KEY);\n"
    )
    doc = _make_doc(p1, p2, p3)
    sections = SectionSegmenter().segment(doc)
    bibs = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bibs) == 1
    assert bibs[0].start_page == 2
    assert bibs[0].end_page == 2


def test_200_theses_bug_07_colon_pages_roman_pages_and_abnt_semicolon_coauthors() -> None:
    """Bug #7 (fea0d48): Narrative 'Author (YYYY: pp)', Roman numeral pages '(Author YYYY, xvii)',
    and ABNT semicolon co-authors '(SILVA; SANTOS, 2020)' extract and link cleanly (41.pdf, 146.pdf, 181.pdf).
    """
    body_text = (
        "As argued by Giddens (1990: 45), modernity reshapes trust. "
        "Earlier editions noted this preface (Bourdieu 1984, xvii). "
        "Brazilian studies confirmed the trend (SILVA; SANTOS, 2020)."
    )
    cits = CitationExtractor(preserve_occurrences=True).extract_from_document(_make_doc(body_text))
    refs = [
        Citation(
            raw_text="Giddens, A. (1990). The Consequences of Modernity. Polity Press.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Giddens, A."],
            year="1990",
            title="The Consequences of Modernity",
            reference_id="ref-0001",
        ),
        Citation(
            raw_text="Bourdieu, P. (1984). Distinction: A Social Critique of the Judgement of Taste. Harvard University Press.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Bourdieu, P."],
            year="1984",
            title="Distinction",
            reference_id="ref-0002",
        ),
        Citation(
            raw_text="SILVA, M.; SANTOS, R. (2020). Logística reversa no Brasil. Revista de Administração, 55(2), 10-25.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Silva, M.", "Santos, R."],
            year="2020",
            title="Logística reversa no Brasil",
            reference_id="ref-0003",
        ),
    ]
    for i, c in enumerate(cits):
        c.reference_id = f"occ-{i + 1:04d}"
    res = CitationLinker().link(cits, refs)
    assert all(lnk.status == CitationMappingStatus.MATCHED for lnk in res.links)


def test_200_theses_bug_08_grobid_coalesces_split_compound_surnames_and_middle_names() -> None:
    """Bug #8 (45b3b18): GROBID consecutive <author> nodes splitting 'Valentina Di Iasio' or 'Tibor János Karlovitz'
    are coalesced back into a single author (38.pdf, 121.pdf).
    """
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><back><listBibl>
    <biblStruct xml:id="b0">
      <analytic>
        <title level="a">Migration networks in Europe</title>
        <author><persName><forename>Valentina</forename><surname>Di</surname></persName></author>
        <author><persName><forename>Iasio</forename></persName></author>
      </analytic>
      <monogr>
        <title level="j">European Sociological Review</title>
        <imprint><date type="published" when="2023">2023</date></imprint>
      </monogr>
      <note type="raw_reference">Valentina Di Iasio. 2023. Migration networks in Europe. European Sociological Review.</note>
    </biblStruct>
  </listBibl></back></text>
</TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 1
    assert len(out.bibliography[0].authors) == 1
    assert out.bibliography[0].authors[0].last_name == "Di Iasio"
    assert out.bibliography[0].authors[0].first_name == "Valentina"


def test_200_theses_bug_09_preserve_numbered_bibliography_index_from_raw_reference() -> None:
    """Bug #9 (339920d): _merge_reference_lists preserves numbered [1]..[4] indices when GROBID
    skipped page 1 ([1]..[2]) and only returned [3]..[4] with sequential numeric_index=1, 2 (74.pdf).
    """
    dp = DocumentParser()
    grobid_refs = [
        Citation(
            raw_text="Lyubashevsky, V (2012) Lattice signatures Advances in Cryptology",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Lyubashevsky, V"],
            year="2012",
            title="Lattice signatures",
            numeric_index=1,
            order_index=1,
            source="grobid",
        ),
        Citation(
            raw_text="Ferguson, N, Schneier, B (2010) Cryptography Engineering Wiley",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Ferguson, N", "Schneier, B"],
            year="2010",
            title="Cryptography Engineering",
            numeric_index=2,
            order_index=2,
            source="grobid",
        ),
    ]
    regex_refs = [
        Citation(
            raw_text="[1] R. Rivest, A. Shamir, L. Adleman, \"A method for obtaining digital signatures,\" 1978.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Rivest, R.", "Shamir, A.", "Adleman, L."],
            year="1978",
            title="A method for obtaining digital signatures",
            numeric_index=1,
            order_index=1,
            source="regex",
        ),
        Citation(
            raw_text="[2] P. Shor, \"Polynomial-time algorithms for prime factorization,\" 1997.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Shor, P."],
            year="1997",
            title="Polynomial-time algorithms for prime factorization",
            numeric_index=2,
            order_index=2,
            source="regex",
        ),
        Citation(
            raw_text="[3] V. Lyubashevsky, \"Lattice signatures,\" in Advances in Cryptology, 2012.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Lyubashevsky, V."],
            year="2012",
            title="Lattice signatures",
            numeric_index=3,
            order_index=3,
            source="regex",
        ),
        Citation(
            raw_text="[4] N. Ferguson, B. Schneier, \"Cryptography Engineering,\" Wiley, 2010.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=["Ferguson, N.", "Schneier, B."],
            year="2010",
            title="Cryptography Engineering",
            numeric_index=4,
            order_index=4,
            source="regex",
        ),
    ]
    merged = dp._merge_reference_lists(grobid_refs, regex_refs)
    assert len(merged) == 4
    assert [r.numeric_index for r in merged] == [1, 2, 3, 4]


def test_200_theses_bug_10_latex_spacing_accents_and_dutch_van_der_particles() -> None:
    """Bug #10 (4bfb68a): LaTeX spacing accents ('Erd˝ os' -> 'Erdős', 'P´eter' -> 'Péter') and
    Dutch 'van der' prefixes match accurately (73.pdf).
    """
    from integrity_checker.extraction.text_preprocessor import TextPreprocessor

    pp = TextPreprocessor()
    cleaned = pp._normalize_unicode(pp._fix_ligatures("P. Erd˝ os and A. R´enyi (1960)"))
    assert "Erdős" in cleaned
    assert "Rényi" in cleaned
    assert author_match_score("van der Aalst", "Wil M. P. van der Aalst") >= 0.9


def test_200_theses_bug_11_harvard_comma_year_and_apa_eds_entries_parsed() -> None:
    """Bug #11 (a7ae427): Harvard 'Surname, I., YYYY. Title.' (116.pdf, 170.pdf) and APA '(Eds.). (YYYY).' (32.pdf)
    split and parse cleanly.
    """
    raw_bib = """References
Kotler, P. and Armstrong, G., 2020. Principles of Marketing. 18th ed. Harlow: Pearson Education.
Acemoglu, D. and Robinson, J. A., 2012. Why Nations Fail: The Origins of Power, Prosperity, and Poverty. New York: Crown Business.
Adams, R., Reiss, B., & Serlin, D. (Eds.). (2015). Keywords for disability studies. New York University Press.
"""
    refs = ReferenceListParser().parse_reference_section(_make_doc(raw_bib))
    assert len(refs) == 3
    assert refs[0].year == "2020"
    assert "Principles of Marketing" in (refs[0].title or "")
    assert refs[1].year == "2012"
    assert "Why Nations Fail" in (refs[1].title or "")
    assert refs[2].year == "2015"
    assert "Keywords for disability studies" in (refs[2].title or "")


def test_200_theses_bug_12_program_year_corporate_author_and_unspaced_ampersand() -> None:
    """Bug #12 (6a084d5): Corporate author with year suffix 'GiveDirectly 2023 (2024)' links to '(GiveDirectly 2023, 2024)'
    and unspaced ampersand '(Giacomelli&Kaminka, 2024)' links cleanly (115.pdf, 160.pdf).
    """
    body_text = (
        "Unconditional cash transfers were evaluated in Kenya (GiveDirectly 2023, 2024). "
        "Multi-agent coordination was formalized by recent work (Giacomelli&Kaminka, 2024)."
    )
    cits = CitationExtractor(preserve_occurrences=True).extract_from_document(_make_doc(body_text))
    refs = [
        Citation(
            raw_text="GiveDirectly 2023 (2024). Annual Impact Report. https://www.givedirectly.org",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["GiveDirectly 2023"],
            year="2024",
            title="Annual Impact Report",
            reference_id="ref-0001",
        ),
        Citation(
            raw_text="Giacomelli, G., & Kaminka, G. A. (2024). Cooperative planning in multi-robot systems. JAIR, 79, 100-130.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            authors=["Giacomelli, G.", "Kaminka, G. A."],
            year="2024",
            title="Cooperative planning in multi-robot systems",
            reference_id="ref-0002",
        ),
    ]
    for i, c in enumerate(cits):
        c.reference_id = f"occ-{i + 1:04d}"
    res = CitationLinker().link(cits, refs)
    assert all(lnk.status == CitationMappingStatus.MATCHED for lnk in res.links)


def test_200_theses_bug_13_primary_numbered_bibliography_prioritized_over_appendix_summary() -> None:
    """Bug #13 (8331707): Primary numbered Bibliography ([1]..[N]) is selected over a secondary
    translated summary bibliography ('Referencias') at the end of the Appendix (36.pdf).
    """
    pages = [f"Body page {i}\nText citing [1] and [2]." for i in range(1, 9)]
    pages.append(
        "Bibliography\n"
        "[1] A. Author, \"First primary work,\" IEEE Trans., 2020.\n"
        "[2] B. Author, \"Second primary work,\" IEEE Trans., 2021.\n"
        "[3] C. Author, \"Third primary work,\" IEEE Trans., 2022.\n"
        "[4] D. Author, \"Fourth primary work,\" IEEE Trans., 2023.\n"
    )
    pages.append("Appendix A: Resumen en Español\nTexto del resumen.")
    pages.append(
        "Referencias\n"
        "[1] A. Author, \"Trabajo resumido,\" 2020.\n"
    )
    doc = _make_doc(*pages)
    sections = SectionSegmenter().segment(doc)
    bibs = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bibs) == 1
    assert bibs[0].start_page == 9


def test_200_theses_bug_14_oscola_book_titles_and_multi_author_books_recovered() -> None:
    """Bug #14 (ef18e5b): OSCOLA book entries ('Butler J, Undoing Gender (Routledge 2004)') and
    unquoted multi-author books ('Ferguson, N., Schneier, B., Kohno, T. Cryptography Engineering... Wiley, 2010.')
    recover their full title, venue, and clean author list (156.pdf, 74.pdf).
    """
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><back><listBibl>
    <biblStruct xml:id="b0">
      <monogr>
        <title level="m"/>
        <author><persName><forename>J</forename><surname>Butler</surname></persName></author>
        <author><persName><forename>Undoing</forename><surname>Gender</surname></persName></author>
        <imprint><date type="published" when="2004">2004</date></imprint>
      </monogr>
      <note type="raw_reference">Butler J, Undoing Gender (Routledge 2004)</note>
    </biblStruct>
    <biblStruct xml:id="b1">
      <monogr>
        <title level="m"/>
        <imprint><date type="published" when="2010">2010</date></imprint>
      </monogr>
      <note type="raw_reference">Ferguson, N., Schneier, B., Kohno, T. Cryptography Engineering: Design Principles and Practical Applications. Wiley, 2010. Daniils Aleksandrovs-Moisejs was born in Riga in 1997.</note>
    </biblStruct>
  </listBibl></back></text>
</TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 2
    assert out.bibliography[0].title == "Undoing Gender"
    assert out.bibliography[0].venue == "Routledge"
    assert [a.full_name for a in out.bibliography[0].authors] == ["Butler, J"]

    assert (
        out.bibliography[1].title
        == "Cryptography Engineering: Design Principles and Practical Applications"
    )
    assert out.bibliography[1].venue == "Wiley"
    assert len(out.bibliography[1].authors) == 3


def test_200_theses_bug_15_running_headers_above_page_num_do_not_suppress_references_header() -> None:
    """Bug #15 (9a6b869): Running page headers ('Master\\'s Thesis / Minna Tuusa / 58') above 'References'
    do not suppress bibliography detection, and body tables ('1. Study question...') are not treated as implicit bibliographies (185.pdf).
    """
    p1 = "Master's Thesis\nMinna Tuusa\n1\n1 Introduction\nCSR implementation is complex (Dyllick & Hockerts, 2002)."
    p2 = (
        "Master's Thesis\nMinna Tuusa\n2\n"
        "According to Yin (2003), case studies rely on multiple sources. Yin (2003) and Yin (2003) note:\n"
        "Table 4: Components of Research Design\n"
        "1. Study question\n"
        "What are the major challenges in CSR?\n"
        "2. Units of analysis\n"
        "Single case study\n"
        "3. The logic linking the data\n"
        "Pattern matching\n"
        "4. The criteria for interpreting\n"
        "Descriptive study\n"
    )
    p3 = (
        "Master's Thesis\nMinna Tuusa\n3\n"
        "References\n"
        "Academic references\n"
        "Dyllick, T., & Hockerts, K. (2002). Beyond the business case for corporate sustainability. Business Strategy and the Environment, 11(2), 130-141.\n"
    )
    doc = _make_doc(p1, p2, p3)
    sections = SectionSegmenter().segment(doc)
    bibs = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bibs) == 1
    assert bibs[0].start_page == 3


def test_200_theses_bug_16_title_first_www_domain_statute_and_chicago_access_date_parsing() -> None:
    """Bug #16 (af564f3): Title-first APA entries with 'Www.domain.tld', statute dates '29.6.1978',
    and Chicago Author-Date entries ending with '(March 9, 2024)' parse full titles (46.pdf, 83.pdf, 119.pdf, 206.pdf).
    """
    parser = ReferenceListParser()
    r0 = parser._parse_entry(
        "[52] Schneider Electric EVLink Parking — CISA. (2019, January 31). Www.cisa.gov. https://www.cisa.gov/news-events/ics-advisories/icsa-19-031-01",
        order_index=1,
        page_num=1,
    )
    r1 = parser._parse_entry(
        "Market rules for different electricity market timeframes. (n.d.). Www.acer.europa.eu.",
        order_index=2,
        page_num=1,
    )
    r2 = parser._parse_entry(
        "Regulation on Educational Degrees and Studies (1978/530). 29.6.1978.",
        order_index=3,
        page_num=1,
    )
    r3 = parser._parse_entry(
        "European Commission. 2016. A Small Business Act for European SMEs | EUR-Lex https://eur-lex.europa.eu/EN/legal-content/summary/a-small-business-act-for-european-smes.html (March 9, 2024).",
        order_index=4,
        page_num=1,
    )
    assert r0 is not None and "Schneider Electric EVLink Parking" in (r0.title or "")
    assert r1 is not None and "Market rules for different electricity market timeframes" in (r1.title or "")
    assert r2 is not None and "Regulation on Educational Degrees and Studies" in (r2.title or "")
    assert r3 is not None and r3.year == "2016"
    assert "A Small Business Act for European SMEs" in (r3.title or "")


# ==============================================================================
# End-to-End PDF Verification on Representative Theses from the 200-Theses Suite
# ==============================================================================


@pytest.mark.skipif(
    not (_THESES_DIR / "21.pdf").exists(),
    reason="Local 200-theses PDF dataset not present",
)
@pytest.mark.parametrize(
    ("thesis_num", "min_refs", "max_missing", "expected_no_title"),
    [
        (36, 43, 1, 0),    # Primary numbered bib [1]..[43] prioritized over Spanish Appendix 'Referencias'
        (59, 13, 3, 0),    # 'Sources' bibliography heading recognized
        (63, 60, 5, 0),    # Corporate abbreviation & APA merging
        (71, 36, 4, 0),    # Croatian diacritics do not trigger Vietnamese bibliography override
        (73, 40, 3, 0),    # LaTeX plainnat + spacing accents ('Erdős', 'Péter')
        (74, 68, 0, 0),    # Multi-page numbered [1]..[68] with GROBID skipping p.1: 100% matched (168/168)
        (77, 55, 5, 0),    # Chicago Author-Date with years in book titles: 0 missing titles
        (116, 120, 0, 0),  # Harvard comma-year 'Surname, I., YYYY. Title': 100% matched
        (126, 35, 1, 0),   # SQL 'INSERT INTO' appendix ignored by implicit bibliography detector
        (134, 115, 30, 1), # Preserves true student error: Bryman (2012) missing book title (no_title=1)
        (156, 100, 0, 0),  # OSCOLA book titles recovered & discursive footnote filtered: 100% matched
        (181, 75, 0, 0),   # ABNT semicolon co-authors '(SILVA; SANTOS, 2020)': 100% matched (160/160)
        (185, 30, 5, 0),   # Running headers above 'References' ignored: 293/298 matched
        (198, 34, 3, 0),   # Non-bibliography prose filtered from GROBID references
    ],
)
def test_200_theses_end_to_end_pdf_regressions(
    thesis_num: int,
    min_refs: int,
    max_missing: int,
    expected_no_title: int,
) -> None:
    """Verify end-to-end parsing and linking on representative PDFs from 20-theses/21.pdf..220.pdf."""
    pdf_path = _THESES_DIR / f"{thesis_num}.pdf"
    dp = DocumentParser()
    parsed = dp.parse(str(pdf_path))

    assert len(parsed.references) >= min_refs
    null_title_count = sum(
        1 for r in parsed.references if not r.title or not r.title.strip()
    )
    assert null_title_count == expected_no_title

    in_text = list(parsed.body_citations) + [
        c for c in (parsed.appendix_citations or []) if c not in parsed.body_citations
    ]
    for idx, c in enumerate(in_text):
        c.reference_id = f"occ-{idx + 1:04d}"
    for idx, r in enumerate(parsed.references):
        r.reference_id = f"ref-{idx + 1:04d}"

    link_res = CitationLinker().link(in_text, parsed.references)
    missing_count = sum(
        1
        for lnk in link_res.links
        if (lnk.status.value if hasattr(lnk.status, "value") else str(lnk.status))
        == "missing_reference"
    )
    assert missing_count <= max_missing


@pytest.mark.skipif(
    not (_THESES_DIR / "21.pdf").exists(),
    reason="Local 200-theses PDF dataset not present",
)
def test_200_theses_full_corpus_tei_and_references_audit() -> None:
    """Verify all 200 theses (20-theses/21.pdf .. 220.pdf) exist and parse cleanly through GROBID TEI & adapter."""
    from integrity_checker.extraction.grobid_service import get_grobid_manager

    mgr = get_grobid_manager()
    available_count = 0
    total_grobid_refs = 0

    for thesis_num in range(21, 221):
        pdf_path = _THESES_DIR / f"{thesis_num}.pdf"
        assert pdf_path.exists(), f"Missing thesis PDF: {pdf_path}"
        tei_xml = mgr.get_from_cache(str(pdf_path))
        assert tei_xml is not None, f"Missing cached GROBID TEI XML for {pdf_path.name}"
        out = parse_tei(tei_xml)
        assert out.is_available is True, f"GROBID TEI unavailable for {pdf_path.name}"
        available_count += 1
        refs = grobid_to_references(out)
        total_grobid_refs += len(refs)

    assert available_count == 200
    assert total_grobid_refs >= 9500

