"""Regression & unit test suite for Track 1 of the Holistic SE Audit Remediation.

Covers:
- CORE-01: ReDoS prevention in ReferenceListParser & NatureFormat + fallback title extraction
- CORE-02: DOCX zip-bomb spoofed file_size header defense on word/footnotes.xml & endnotes.xml
- CORE-03: GROBID TEI bibliography preservation when titles contain References/Bibliography/Primary Sources
- CORE-04: NeuroSymbolicChecker Check 4 fake_domain / inline fake URL guardrail
- CORE-05: IntegrityPipeline deep-cloning SourceResult per bibliography entry
- CORE-06: IntegrityPipeline.run_async offloading sync discovery & report-cache I/O to worker threads
- CORE-07: GrobidServiceManager 127.0.0.1 binding, non-mutating config URL, thread-safe stats, client.close()
- CORE-08: MetricsCalculator accounting for non-4-class predictions (resource, missing_reference, etc.)
- CORE-09: Unicode Latin + Vietnamese uppercase/alpha character classes
- CORE-10: NFD Vietnamese normalization, French/physics accent guard, foreign legal code exemption & leap-year check
- CORE-11: 2020i..z year suffixes, MLA multi-work ambiguity, bib.mapping_status priority, string-author duplicates
- CORE-12: GROBID glued-reference splitter after London., Oxford., Wiley., Ltd.
- CORE-13: True UTC 'Z' timestamp, multi-space whitespace normalization, full report/features cache rehydration
- CORE-14: Non-contradictory known-author guard in SymbolicRules & SemanticMatcher._intent_emb_cache cleanup
- CORE-15: Single-pass regex matching in Citation.from_raw
- QA-08: Direct unit tests for all 8 citation style modules (ACM, ACS, AMA, Chicago, CSE, Harvard, MLA, Nature)
- QA-14: Removal of orphaned matching/consensus.py and decoupling citation_extractor.py from regex_patterns.py
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import struct
import sys
import threading
import time
import unicodedata
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from integrity_checker.config import GrobidConfig
from integrity_checker.evaluation.metrics import MetricsCalculator
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.docx_parser import _MAX_NOTES_XML_BYTES, DocxParser
from integrity_checker.extraction.grobid_parser import (
    _split_single_merged_raw_reference,
    parse_tei,
)
from integrity_checker.extraction.grobid_service import GrobidServiceManager
from integrity_checker.extraction.patterns.acm import ACMFormat
from integrity_checker.extraction.patterns.acs import ACSFormat
from integrity_checker.extraction.patterns.ama import AMAFormat
from integrity_checker.extraction.patterns.chicago import ChicagoFormat
from integrity_checker.extraction.patterns.cse import CSEFormat
from integrity_checker.extraction.patterns.harvard import HarvardFormat
from integrity_checker.extraction.patterns.mla import MLAFormat
from integrity_checker.extraction.patterns.nature import NatureFormat
from integrity_checker.extraction.reference_parser import _INLINE_ENTRY_START_RE
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.duplicate_detector import DuplicateDetector
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.completeness import _is_real_author_entry
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.vn_en_academic_bridge import (
    bridge_vn_to_en,
    is_vietnamese_text,
)
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)
from integrity_checker.pipeline.integrity_pipeline import (
    _ET_AL_NORM_RE,
    AnalysisReport,
    IntegrityPipeline,
    _match_features_from_dict,
)

# =============================================================================
# CORE-01: Catastrophic Regex Backtracking (ReDoS) & Nature Fallback Dead Branch
# =============================================================================


def test_core01_reference_parser_inline_entry_start_no_redos() -> None:
    # Pre-check at N=18 so RED fails fast (< 2s) instead of freezing pytest
    t0 = time.perf_counter()
    assert _INLINE_ENTRY_START_RE.match("Smith, J. K., " * 18 + "!") is None
    dt18 = time.perf_counter() - t0
    assert dt18 < 0.05, f"Exponential backtracking detected at N=18 ({dt18:.3f}s)"

    # Full adversarial payload N=25 must complete in < 100 ms
    t1 = time.perf_counter()
    assert _INLINE_ENTRY_START_RE.match("Smith, J. K., " * 25 + "!") is None
    dt25 = time.perf_counter() - t1
    assert dt25 < 0.10, f"ReDoS at N=25 ({dt25:.3f}s)"

    # Valid multi-author APA head must still match (spaced, unspaced dotted, & hyphenated initials)
    for valid_head in (
        "Smith, J. K., Doe, A. B., & Lee, C. D. (2020). Neural networks.",
        "Smith, J.K. (2020). Neural networks.",
        "Smith, J.K., & Doe, A.B. (2021). Deep learning.",
        "Smith, J., & Doe, A.B. (2020). Neural networks.",
        "Nguyen, V.-A., & Tran, T.B. (2023). Deep learning.",
        "Smith, J.K.L. (2020). Three unspaced initials.",
    ):
        assert _INLINE_ENTRY_START_RE.match(valid_head) is not None, valid_head

    from integrity_checker.extraction.reference_parser import ReferenceListParser

    glued_doc = Document(
        file_path="t.pdf",
        num_pages=1,
        pages=[
            Page(
                page_num=1,
                text=(
                    "References\n"
                    "Vaswani, A., & Shazeer, N. (2017). Attention is all you need. NeurIPS, 30, 1-9. "
                    "Smith, J.K., & Doe, A.B. (2021). Deep learning. MedIA, 70, 102030.\n"
                ),
            )
        ],
    )
    assert len(ReferenceListParser().parse_reference_section(glued_doc)) == 2


def test_core01_nature_fallback_no_redos_and_title_extraction() -> None:
    fmt = NatureFormat()

    # Adversarial initial-author comma block with trailing (Year) hits _parse_nature_fallback
    t0 = time.perf_counter()
    fmt.parse_reference_entry("1. " + "A. B. " * 11 + "Title!, Nature (2020).")
    dt11 = time.perf_counter() - t0
    assert dt11 < 0.05, f"Nature fallback backtracking spike at N=11 ({dt11:.3f}s)"

    t1 = time.perf_counter()
    fmt.parse_reference_entry("1. " + "A. B. " * 25 + "Title!")
    fmt.parse_reference_entry("1. " + "A. B. " * 25 + "Title!, Nature (2020).")
    dt25 = time.perf_counter() - t1
    assert dt25 < 0.10, f"Nature fallback ReDoS at N=25 ({dt25:.3f}s)"

    # Previously dead fallback title branch: second comma segment starting with "A. " + 3 words
    cit = fmt.parse_reference_entry("1. J. Smith, A. Comprehensive Quantum Computing Survey (2020).")
    assert cit is not None
    assert cit.title is not None
    assert "Quantum Computing" in cit.title
    assert cit.matched_pattern == "nature_comma_separated"

    # Vietnamese diacritics & hyphen-before-dot + 4-token surnames in Nature fallback
    cit_vn = fmt.parse_reference_entry("1. Đ. T. Nguyễn, Ư. A. Trần, Học sâu cho xử lý ngôn ngữ (2022).")
    assert cit_vn is not None
    assert cit_vn.title == "Học sâu cho xử lý ngôn ngữ"

    cit_fr = fmt.parse_reference_entry(
        "1. J-P. Changeux, A. B. De La Cruz Martinez, Neural Receptors in Cortex (2020)."
    )
    assert cit_fr is not None
    assert cit_fr.title == "Neural Receptors in Cortex"


# =============================================================================
# CORE-02: DOCX Zip-Bomb Header-Spoof Bypass on word/footnotes.xml
# =============================================================================


def _patch_zip_declared_size(zip_bytes: bytes, target_name: str, spoofed_size: int) -> bytes:
    """Patch uncompressed_size to spoofed_size in both local headers and central directory."""
    buf = bytearray(zip_bytes)
    name_bytes = target_name.encode("utf-8")

    # Patch local file headers: PK\x03\x04 (uncompressed_size at offset 22, name_len at 26)
    pos = 0
    while True:
        idx = buf.find(b"PK\x03\x04", pos)
        if idx < 0:
            break
        fn_len = struct.unpack_from("<H", buf, idx + 26)[0]
        fn = bytes(buf[idx + 30 : idx + 30 + fn_len])
        if fn == name_bytes:
            struct.pack_into("<I", buf, idx + 22, spoofed_size)
        pos = idx + 4

    # Patch central directory headers: PK\x01\x02 (uncompressed_size at offset 24, name_len at 28)
    pos = 0
    while True:
        idx = buf.find(b"PK\x01\x02", pos)
        if idx < 0:
            break
        fn_len = struct.unpack_from("<H", buf, idx + 28)[0]
        fn = bytes(buf[idx + 46 : idx + 46 + fn_len])
        if fn == name_bytes:
            struct.pack_into("<I", buf, idx + 24, spoofed_size)
        pos = idx + 4

    return bytes(buf)


def test_core02_docx_spoofed_footnotes_zip_bomb_rejected(tmp_path: Path) -> None:
    import docx  # type: ignore

    base_docx = tmp_path / "base.docx"
    d = docx.Document()
    d.add_paragraph("Body text citing a source (Smith, 2020).")
    d.save(str(base_docx))

    # Build > _MAX_NOTES_XML_BYTES uncompressed footnotes XML (highly compressible)
    oversized_payload = (
        b'<?xml version="1.0" encoding="UTF-8"?>'
        b'<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b'<w:footnote w:id="1"><w:p><w:r><w:t>'
        + (b"A" * (_MAX_NOTES_XML_BYTES + 1024 * 1024))
        + b"</w:t></w:r></w:p></w:footnote></w:footnotes>"
    )

    raw_zip_path = tmp_path / "raw_oversized.docx"
    with zipfile.ZipFile(base_docx, "r") as zin, zipfile.ZipFile(
        raw_zip_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            if item.filename != "word/footnotes.xml":
                zout.writestr(item, zin.read(item.filename))
        zout.writestr("word/footnotes.xml", oversized_payload)

    spoofed_bytes = _patch_zip_declared_size(
        raw_zip_path.read_bytes(), "word/footnotes.xml", spoofed_size=1024
    )
    spoofed_docx = tmp_path / "spoofed_bomb.docx"
    spoofed_docx.write_bytes(spoofed_bytes)

    with zipfile.ZipFile(spoofed_docx, "r") as zcheck:
        assert zcheck.getinfo("word/footnotes.xml").file_size == 1024

    # 1) Binary-spoofed ZIP header (declared 1024 B, actual 21 MB deflate payload):
    # _extract_xml_notes returns {} safely and DocxParser.parse() rejects with ValueError
    notes = DocxParser._extract_xml_notes(spoofed_docx, "word/footnotes.xml", "footnote")
    assert notes == {}
    with pytest.raises(ValueError, match=r"(?i)exceeds|zip bomb|corrupted"):
        DocxParser().parse(spoofed_docx)

    # 2) Valid 21 MB deflate stream whose ZipInfo.file_size reports 1024 B in infolist()
    # while zf.open() streams the full uncompressed 21 MB payload:
    # exercises chunked stream counting > _MAX_NOTES_XML_BYTES in both _extract_xml_notes and _validate_docx_archive
    import copy as _copy

    orig_infolist = zipfile.ZipFile.infolist
    orig_getinfo = zipfile.ZipFile.getinfo
    orig_open = zipfile.ZipFile.open

    def _spoofed_infolist(zf_self: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
        out: list[zipfile.ZipInfo] = []
        for inf in orig_infolist(zf_self):
            if inf.filename == "word/footnotes.xml":
                cloned = _copy.copy(inf)
                cloned.file_size = 1024
                out.append(cloned)
            else:
                out.append(inf)
        return out

    def _spoofed_open(
        zf_self: zipfile.ZipFile,
        name_or_info: str | zipfile.ZipInfo,
        mode: str = "r",
        pwd: bytes | None = None,
        *,
        force_zip64: bool = False,
    ) -> object:
        fname = name_or_info.filename if isinstance(name_or_info, zipfile.ZipInfo) else name_or_info
        real_info = orig_getinfo(zf_self, fname)
        return orig_open(zf_self, real_info, mode=mode, pwd=pwd, force_zip64=force_zip64)  # type: ignore[arg-type]

    with (
        patch.object(zipfile.ZipFile, "infolist", _spoofed_infolist),
        patch.object(zipfile.ZipFile, "open", _spoofed_open),
    ):
        assert DocxParser._extract_xml_notes(raw_zip_path, "word/footnotes.xml", "footnote") == {}
        with pytest.raises(ValueError, match=r"(?i)exceeds.*limit.*zip bomb"):
            DocxParser().parse(raw_zip_path)


# =============================================================================
# CORE-03 & CORE-12: GROBID TEI Bibliography Wipe & Glued-Reference Splitter
# =============================================================================


def test_core03_parse_tei_preserves_preceding_entries_when_titles_contain_references() -> None:
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <teiHeader><fileDesc><titleStmt><title>Test Manuscript</title></titleStmt></fileDesc></teiHeader>
  <text>
    <body><div><p>Transformers revolutionized NLP <ref type="bibr" target="#b0">(Vaswani, 2017)</ref>.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct xml:id="b0">
            <analytic>
              <title level="a" type="main">Attention Is All You Need</title>
              <author><persName><forename type="first">A</forename><surname>Vaswani</surname></persName></author>
            </analytic>
            <monogr>
              <title level="m">NeurIPS</title>
              <imprint><date type="published" when="2017">2017</date></imprint>
            </monogr>
            <idno type="DOI">10.5555/3295222.3295349</idno>
            <note type="raw_reference">Vaswani, A. (2017). Attention Is All You Need. NeurIPS.</note>
          </biblStruct>
          <biblStruct xml:id="b1">
            <analytic>
              <title level="a" type="main">References Supporting Climate Action</title>
              <author><persName><forename type="first">J</forename><surname>Smith</surname></persName></author>
            </analytic>
            <monogr>
              <title level="j">Nature</title>
              <imprint><date type="published" when="2021">2021</date></imprint>
            </monogr>
            <note type="raw_reference">Smith, J. (2021). References Supporting Climate Action. Nature.</note>
          </biblStruct>
          <biblStruct xml:id="b2">
            <monogr>
              <title level="m">Analyzing Primary Sources Through Digital Archives</title>
              <author><persName><forename type="first">A</forename><surname>Doe</surname></persName></author>
              <imprint><publisher>Oxford University Press</publisher><date type="published" when="2022">2022</date></imprint>
            </monogr>
            <note type="raw_reference">Doe, A. (2022). Analyzing Primary Sources Through Digital Archives. Oxford University Press.</note>
          </biblStruct>
          <biblStruct xml:id="b3">
            <monogr>
              <title level="m">Modern History: An Annotated Bibliography</title>
              <author><persName><forename type="first">M</forename><surname>Jones</surname></persName></author>
              <imprint><date type="published" when="2019">2019</date></imprint>
            </monogr>
            <note type="raw_reference">Jones, M. (2019). Modern History: An Annotated Bibliography</note>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 4
    ids = [b.id for b in out.bibliography]
    assert "b0" in ids and "b1" in ids and "b2" in ids and "b3" in ids
    b1 = next(b for b in out.bibliography if b.id == "b1")
    b2 = next(b for b in out.bibliography if b.id == "b2")
    assert b1.title == "References Supporting Climate Action"
    assert b2.title == "Analyzing Primary Sources Through Digital Archives"

    # Also verify raw-only <biblStruct> (no <title> child) with "Author (YYYY). References ..." does not wipe b0
    tei_raw_only = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body><div><p>Text.</p></div></body>
    <back><div type="references"><listBibl>
      <biblStruct xml:id="b0">
        <monogr><title level="j">Journal of AI</title><imprint><date when="2018">2018</date></imprint></monogr>
        <note type="raw_reference">Alpha, A. 2018. Foundational Models. Journal of AI 10: 1-9.</note>
      </biblStruct>
      <biblStruct xml:id="b1">
        <note type="raw_reference">Beta, B. (2021). References Supporting Climate Action. Nature.</note>
      </biblStruct>
    </listBibl></div></back>
  </text>
</TEI>"""
    out_raw = parse_tei(tei_raw_only)
    assert len(out_raw.bibliography) == 2

    # Chicago NB body footnotes (including journal footnote + parenthetical year) followed by
    # ". Bibliography" MUST still clear preceding footnotes and keep only real bibliography entries
    tei_chicago_nb = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body><div><p>Text.</p></div></body>
    <back><div type="references"><listBibl>
      <biblStruct xml:id="b0">
        <monogr><title level="j">Historical Review</title><imprint><date when="1998">1998</date></imprint></monogr>
        <note type="raw_reference">1. John Doe, "Some Footnote Article," Historical Review 12 (1998): 44.</note>
      </biblStruct>
      <biblStruct xml:id="b1">
        <note type="raw_reference">2. Ibid., 45. Bibliography</note>
      </biblStruct>
      <biblStruct xml:id="b2">
        <monogr><title level="j">Historical Review</title><imprint><date when="1998">1998</date></imprint></monogr>
        <note type="raw_reference">Doe, John. "Some Footnote Article." Historical Review 12 (1998): 40-55.</note>
      </biblStruct>
    </listBibl></div></back>
  </text>
</TEI>"""
    out_chi = parse_tei(tei_chicago_nb)
    assert [e.id for e in out_chi.bibliography] == ["b2"]

    # Preliminary CV / chapter list ending with glued "... https://doi.org/... List of references" clears mini-list
    tei_cv_list = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body><div><p>Text.</p></div></body>
    <back><div type="references"><listBibl>
      <biblStruct xml:id="b0">
        <note type="raw_reference">The 24th World Multi-Conference on Systemics (WMSCI 2020), report.</note>
      </biblStruct>
      <biblStruct xml:id="b1">
        <monogr><title level="j">First Monday</title><imprint><date when="2008">2008</date></imprint></monogr>
        <idno type="DOI">10.5210/fm.v13i4.2127</idno>
        <note type="raw_reference">Nguyen, A. (2008). Online news diffusion. First Monday, 13(4). https://doi.org/10.5210/fm.v13i4.2127 List of references</note>
      </biblStruct>
      <biblStruct xml:id="b2">
        <monogr><title level="j">Nature</title><imprint><date when="2021">2021</date></imprint></monogr>
        <note type="raw_reference">1. Smith, K. (2021). Main Bibliography Entry. Nature, 590, 1-10.</note>
      </biblStruct>
    </listBibl></div></back>
  </text>
</TEI>"""
    out_cv = parse_tei(tei_cv_list)
    assert [e.id for e in out_cv.bibliography] == ["b2"]


@pytest.mark.parametrize(
    "ending_token",
    ["London", "Oxford", "Wiley", "https://gov.ca/report", "Ltd."],
)
def test_core12_split_single_merged_raw_reference_after_blocked_letters(ending_token: str) -> None:
    glued = (
        f"Brown, T. (2019). Foundations of Computing, {ending_token} "
        f"Smith, K. (2020). Modern AI Systems. Nature, 580, 1-10."
    )
    parts = _split_single_merged_raw_reference(glued)
    assert len(parts) == 2, f"Failed to split glued reference ending with {ending_token!r}: {parts}"
    assert parts[0].endswith(ending_token)
    assert parts[1].startswith("Smith, K. (2020)")


# =============================================================================
# CORE-04 & CORE-05: NeuroSymbolicChecker fake_domain & Pipeline Source Cloning
# =============================================================================


def test_core04_fake_domain_web_citation_not_whitelisted_as_resource() -> None:
    checker = NeuroSymbolicChecker()
    cit = Citation(
        raw_text="Smith, J. (2024). Industry Report. Retrieved from https://totally-invented-nxdomain-9999.org/report",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Smith, J."],
        year="2024",
        title="Industry Report",
        url="https://totally-invented-nxdomain-9999.org/report",
    )
    src = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        url_status="fake_domain",
    )
    verdict = checker.check(cit, src)
    assert verdict.label != ValidationLabel.RESOURCE
    assert "R-WEB-RESOURCE" not in verdict.triggered_rules

    # Seminal / known paper with url_status="fake_domain" must NOT bypass check as VERIFIED
    seminal_fake_url = Citation(
        raw_text="Vaswani, A. et al. (2017). Attention Is All You Need. NeurIPS. https://totally-invented-nxdomain-9999.org/p",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Vaswani, A."],
        year="2017",
        title="Attention Is All You Need",
        url="https://totally-invented-nxdomain-9999.org/p",
    )
    verdict_sem = checker.check(
        seminal_fake_url,
        SourceResult(citation_raw=seminal_fake_url.raw_text, url_status="fake_domain"),
    )
    assert verdict_sem.label != ValidationLabel.VERIFIED


def test_core05_pipeline_clones_source_result_across_same_key_entries(tmp_path: Path) -> None:
    shared_doi = "10.1038/s41586-021-03819-2"
    ref_clean = Citation(
        raw_text=f"Jumper, J. et al. (2021). Highly accurate protein structure prediction with AlphaFold. Nature. doi:{shared_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Jumper, J."],
        year="2021",
        title="Highly accurate protein structure prediction with AlphaFold",
        venue="Nature",
        doi=shared_doi,
        reference_id="ref-0001",
    )
    ref_chimera = Citation(
        raw_text=f"Zorgon, X. (2024). Completely Fabricated Quantum Teleportation Study. FakeJ. doi:{shared_doi}",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Zorgon, X."],
        year="2024",
        title="Completely Fabricated Quantum Teleportation Study",
        venue="FakeJ",
        doi=shared_doi,
        reference_id="ref-0002",
    )

    class _StubParsed:
        document = Document(file_path="dummy.pdf", num_pages=1, pages=[Page(page_num=1, text="Body.")])
        body_citations: list[Citation] = []
        appendix_citations: list[Citation] = []
        references = [ref_clean, ref_chimera]
        parser_warnings: list[str] = []

    class _StubDocParser:
        def parse(self, _path: str) -> _StubParsed:
            return _StubParsed()

    class _StubOrchestrator:
        async def retrieve(self, citation: Citation, **_kwargs: object) -> SourceResult:
            sr = SourceResult(
                citation_raw=citation.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        title="Highly accurate protein structure prediction with AlphaFold",
                        authors=["Jumper, J.", "Hassabis, D."],
                        year="2021",
                        venue="Nature",
                        doi=shared_doi,
                        confidence=0.98,
                        score=0.98,
                    ),
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        title="Completely Fabricated Quantum Teleportation Study",
                        authors=["Zorgon, X."],
                        year="2024",
                        venue="Preprint",
                        doi="10.9999/other-paper",
                        confidence=0.90,
                        score=0.90,
                    ),
                ],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["crossref", "openalex"],
            )
            # Pre-seed stale _selected_best to verify pipeline resets it on per-slot clones
            sr._selected_best = sr.candidates[1]  # type: ignore[attr-defined]
            return sr

    dummy_pdf = tmp_path / "dummy.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
    pipeline = IntegrityPipeline(
        document_parser=_StubDocParser(),  # type: ignore[arg-type]
        orchestrator=_StubOrchestrator(),  # type: ignore[arg-type]
        use_report_cache=False,
    )
    report = asyncio.run(pipeline.run_async(str(dummy_pdf)))
    assert len(report.verdicts) == 2
    assert report.verdicts[0].matched_source is not None
    assert report.verdicts[1].matched_source is not None
    assert report.verdicts[0].matched_source is not report.verdicts[1].matched_source


# =============================================================================
# CORE-06 & CORE-07: Async Event-Loop Non-Blocking & GrobidServiceManager Safety
# =============================================================================


def test_core06_run_async_offloads_implicit_discovery_and_cache_io_to_threads(tmp_path: Path) -> None:
    dummy_pdf = tmp_path / "async_check.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4 async test\n")

    ref_uncited = Citation(
        raw_text="Vaswani, A. (2017). Attention Is All You Need. NeurIPS.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Vaswani, A."],
        year="2017",
        title="Attention Is All You Need",
        venue="NeurIPS",
        reference_id="ref-0001",
    )

    class _StubParsed:
        document = Document(
            file_path=str(dummy_pdf),
            num_pages=2,
            pages=[
                Page(
                    page_num=1,
                    text="Self-attention transformer architectures eliminate recurrence in sequence transduction models.",
                ),
                Page(page_num=2, text="References\nVaswani, A. (2017). Attention Is All You Need. NeurIPS."),
            ],
        )
        body_citations: list[Citation] = []
        appendix_citations: list[Citation] = []
        references = [ref_uncited]
        parser_warnings: list[str] = []

    class _StubDocParser:
        def parse(self, _path: str) -> _StubParsed:
            return _StubParsed()

    class _StubOrchestrator:
        async def retrieve(self, citation: Citation, **_kwargs: object) -> SourceResult:
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="local_db",
                        found=True,
                        title="Attention Is All You Need",
                        authors=["Vaswani, A."],
                        year="2017",
                        venue="NeurIPS",
                        confidence=0.98,
                        score=0.98,
                    )
                ],
                sources_queried=["local_db"],
                sources_succeeded=["local_db"],
            )

    pipeline = IntegrityPipeline(
        document_parser=_StubDocParser(),  # type: ignore[arg-type]
        orchestrator=_StubOrchestrator(),  # type: ignore[arg-type]
        use_report_cache=True,
    )
    pipeline._report_cache_dir = tmp_path / "report_cache"

    observed_threads: dict[str, int] = {}
    orig_save = pipeline._save_report_cache

    def _spy_discover(*_args: object, **_kwargs: object) -> tuple[int, str, float]:
        observed_threads["discover"] = threading.get_ident()
        return (1, "Self-attention transformer architectures eliminate recurrence.", 0.82)

    def _spy_save(cache_key: str, report: AnalysisReport) -> None:
        observed_threads["save_cache"] = threading.get_ident()
        orig_save(cache_key, report)

    orig_load = pipeline._load_report_cache

    def _spy_load(cache_key: str) -> AnalysisReport | None:
        observed_threads["load_cache"] = threading.get_ident()
        return orig_load(cache_key)

    pipeline._discover_implicit_body_context_for_reference = _spy_discover  # type: ignore[method-assign]
    pipeline._save_report_cache = _spy_save  # type: ignore[method-assign]
    pipeline._load_report_cache = _spy_load  # type: ignore[method-assign]

    async def _run() -> int:
        loop_tid = threading.get_ident()
        await pipeline.run_async(str(dummy_pdf))
        # Second call hits report cache
        await pipeline.run_async(str(dummy_pdf))
        return loop_tid

    loop_tid = asyncio.run(_run())
    assert "discover" in observed_threads
    assert observed_threads["discover"] != loop_tid, "Implicit body discovery ran synchronously on event loop!"
    assert "save_cache" in observed_threads
    assert observed_threads["save_cache"] != loop_tid, "_save_report_cache ran synchronously on event loop!"
    assert "load_cache" in observed_threads
    assert observed_threads["load_cache"] != loop_tid, "_load_report_cache ran synchronously on event loop!"


def test_core07_grobid_service_loopback_ports_non_mutating_config_and_lock() -> None:
    cfg = GrobidConfig(url="http://localhost:8070")

    class _NotFoundError(Exception):
        pass

    mock_container = MagicMock()
    mock_container.id = "abcdef1234567890"
    mock_container.status = "running"

    mock_client = MagicMock()
    mock_client.containers.get.side_effect = _NotFoundError()
    mock_client.images.get.return_value = MagicMock()
    mock_client.containers.run.return_value = mock_container

    mock_docker = MagicMock()
    mock_docker.errors.NotFound = _NotFoundError
    mock_docker.from_env.return_value = mock_client
    mock_docker.DockerClient.return_value = mock_client

    with (
        patch("os.path.exists", side_effect=lambda p: p == "/.dockerenv"),
        patch.object(GrobidServiceManager, "_check_docker_available", return_value=None),
        patch.object(GrobidServiceManager, "_check_docker_sdk", return_value=True),
    ):
        mgr = GrobidServiceManager(config=cfg)
        mgr._docker = mock_docker
        mgr._detect_environment()

        # 1) Must NOT mutate shared cfg.url in-place, while exposing Docker internal URL via mgr.url
        assert cfg.url == "http://localhost:8070"
        assert mgr.url == "http://grobid:8070"

        # 2) start() binds 127.0.0.1:8070 only (never 8071 or 0.0.0.0) and closes client
        with patch.object(mgr, "is_container_running", return_value=False):
            assert mgr.start() is True

        run_kwargs = mock_client.containers.run.call_args.kwargs
        assert run_kwargs["ports"] == {"8070/tcp": ("127.0.0.1", 8070)}
        assert "8071/tcp" not in run_kwargs["ports"]
        assert mock_client.close.call_count >= 1

        # 3) Manager must carry a Lock for thread-safe stats updates
        assert hasattr(mgr, "_stats_lock")

    # 4) Stopped Docker daemon / unreachable AF_UNIX socket must leak ZERO ResourceWarnings
    # across check_health(), start(), AND stop()!
    import gc
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("error", ResourceWarning)
        warnings.simplefilter("error", pytest.PytestUnraisableExceptionWarning)
        with patch.object(
            GrobidServiceManager,
            "_check_http_health",
            return_value=GrobidServiceManager(config=cfg)._status,
        ):
            mgr_down = GrobidServiceManager(config=cfg)
            mgr_down._docker_daemon_available = False
            mgr_down.check_health()
            assert mgr_down.start() is False
            gc.collect()
            assert mgr_down.stop() is False
            gc.collect()


# =============================================================================
# CORE-08: MetricsCalculator Non-4-Class False Negatives / False Positives
# =============================================================================


def test_core08_metrics_calculator_accounts_for_predictions_outside_four_labels() -> None:
    y_true = (
        ["verified"] * 10
        + ["metadata_error"] * 10
        + ["suspected_hallucination"] * 10
        + ["unresolved"] * 10
    )
    # Only 1 correct per class (4/40 = 10% accuracy); remaining 36 predicted as resource/missing_reference
    y_pred = (
        ["verified"] + ["resource"] * 9
        + ["metadata_error"] + ["missing_reference"] * 9
        + ["suspected_hallucination"] + ["style_inconsistent"] * 9
        + ["unresolved"] + ["resource"] * 9
    )
    res = MetricsCalculator.compute(y_true, y_pred)
    assert res.accuracy == pytest.approx(0.10)
    assert res.recall == pytest.approx(0.10)
    assert res.macro_f1 < 0.25


# =============================================================================
# CORE-09: Unicode & Vietnamese Character-Class Correctness
# =============================================================================


def test_core09_unicode_vietnamese_character_classes() -> None:
    import re as _re

    from integrity_checker.extraction.patterns import utils as pat_utils

    assert hasattr(pat_utils, "_UPPER_LATIN_VN")
    assert hasattr(pat_utils, "_LOWER_LATIN_VN")
    assert hasattr(pat_utils, "_ALPHA_LATIN_VN")
    assert "_LOWER_LATIN_VN" in pat_utils.__all__

    upper_re = _re.compile(rf"^{pat_utils._UPPER_LATIN_VN}$")
    lower_re = _re.compile(rf"^{pat_utils._LOWER_LATIN_VN}$")
    alpha_re = _re.compile(rf"^{pat_utils._ALPHA_LATIN_VN}+$")

    # Lowercase Vietnamese words must NEVER match uppercase-only class
    for lower_ch in ("đ", "ă", "ơ", "ư", "ạ", "ả", "ấ", "ờ", "ỷ", "à", "ÿ", "×", "÷"):
        assert upper_re.match(lower_ch) is None, f"{lower_ch!r} falsely matched _UPPER_LATIN_VN"

    for upper_ch in ("A", "Z", "Đ", "Ă", "Ơ", "Ư", "Ạ", "Ấ", "Ờ", "Ỷ", "Ỹ", "É"):
        assert upper_re.match(upper_ch) is not None, f"{upper_ch!r} failed to match _UPPER_LATIN_VN"
        assert lower_re.match(upper_ch) is None, f"{upper_ch!r} falsely matched _LOWER_LATIN_VN"

    for real_lower in ("a", "z", "đ", "ă", "ơ", "ư", "ạ", "ấ", "ờ", "ỷ", "ỹ", "é"):
        assert lower_re.match(real_lower) is not None, f"{real_lower!r} failed to match _LOWER_LATIN_VN"

    assert _re.search(rf"\b{pat_utils._LOWER_LATIN_VN}{{3,}}\s+{pat_utils._LOWER_LATIN_VN}{{3,}}\b", "Đặng Ước") is None

    assert alpha_re.match("NguyễnTrầnĐặngPhạmƯớc") is not None

    # _ET_AL_NORM_RE must preserve Vietnamese diacritics in author surnames
    m_vn = _ET_AL_NORM_RE.search("(Nguyễn et al., 2021)")
    assert m_vn is not None
    assert m_vn.group(1).strip() == "Nguyễn"

    # completeness._is_real_author_entry must not treat lowercase "đồng" after "&" as uppercase surname
    assert _is_real_author_entry("Making", "Making & đồng sự trong bài viết") is False

    # DuplicateDetector fallback on raw_text preserves Vietnamese surnames
    det = DuplicateDetector()
    cit_vn = Citation(raw_text="Nguyễn, V. A. (2021). Học sâu tiếng Việt.", authors=[])
    assert det._first_author_last_name(cit_vn) == "Nguyễn"


# =============================================================================
# CORE-10: Cross-Lingual NFD / French Guard & Vietnamese Legal Verifier
# =============================================================================


def test_core10_nfd_vietnamese_and_french_physics_guard() -> None:
    nfd_vn = unicodedata.normalize("NFD", "Nghiên cứu ứng dụng trí tuệ nhân tạo trong y tế")
    assert is_vietnamese_text(nfd_vn) is True
    is_xl, bridged, _ = bridge_vn_to_en(nfd_vn, source_title="Artificial intelligence in healthcare")
    assert is_xl is True
    assert "artificial intelligence" in bridged.lower()

    french_physics = "Lévy flights and Schrödinger equations in René Descartes mechanics"
    assert is_vietnamese_text(french_physics) is False


def test_core10_vn_legal_nfd_foreign_statute_exemption_and_leap_year_date() -> None:
    # 1) NFD-encoded Vietnamese Civil Code must match canonical statute registry
    nfd_blds = unicodedata.normalize("NFD", "Bộ luật Dân sự năm 2015 (Luật số 91/2015/QH13)")
    res_nfd = verify_vn_legal_citation(nfd_blds)
    assert res_nfd.is_valid is True
    assert res_nfd.is_verified_statute is True

    # 2) Foreign comparative-law statutes must NOT be flagged as fabricated OR matched as VN statutes
    for foreign_law in (
        "Bộ luật Dân sự Pháp 1804 (Code Napoléon)",
        "Bộ luật Dân sự Pháp 1804",
        "Bộ luật Dân sự Đức (BGB) năm 1896",
        "Bộ luật Dân sự Đức năm 1900",
        "Bộ luật Hình sự Pháp năm 1992",
        "Bộ luật Thương mại Hoa Kỳ (UCC)",
    ):
        res_foreign = verify_vn_legal_citation(foreign_law)
        assert res_foreign.is_valid is True, foreign_law
        assert res_foreign.is_verified_statute is False, foreign_law
        assert res_foreign.triggered_rules == ["R-LEGAL-DOCUMENT"], (foreign_law, res_foreign.triggered_rules)

    # 2b) Domestic Vietnamese fabricated codes containing syllables "pháp", "đức", "ý", "mỹ" MUST fail
    for domestic_fake in (
        "Bộ luật Tư pháp Hình sự năm 2024",
        "Bộ luật Tư pháp Vũ trụ Việt Nam năm 2099",
        "Bộ luật Đạo đức Công vụ năm 2024",
        "Bộ luật Quản lý Ý kiến Công dân năm 2025",
        "Bộ luật Bảo vệ quyền góp ý của công dân năm 2024",
        "Bộ luật Thẩm mỹ Quốc gia năm 2024",
    ):
        res_fake = verify_vn_legal_citation(domestic_fake)
        assert res_fake.is_valid is False, domestic_fake
        assert "R-VN-LEGAL-FABRICATED" in res_fake.triggered_rules, domestic_fake

    # 3) Non-leap-year Feb 29 (2023/2015) & impossible Feb 31 must be caught across non-registry,
    # registered statutes, AND foreign statutes; leap-year 2024 is valid
    for bad_date_cit in (
        "Nghị định số 15/2023/NĐ-CP ngày 29/02/2023 của Chính phủ",
        "Bộ luật Dân sự năm 2015 ngày 29/02/2015",
        "Luật Đất đai số 31/2024/QH15 ngày 31/02/2024",
        "Bộ luật Dân sự Pháp 1804 ngày 29/02/2023",
    ):
        res_bad = verify_vn_legal_citation(bad_date_cit)
        assert res_bad.is_valid is False, bad_date_cit
        assert res_bad.is_verified_statute is False, bad_date_cit
        assert "year" in res_bad.mismatched_fields, bad_date_cit
        assert "R-VN-LEGAL-FABRICATED" in res_bad.triggered_rules, (bad_date_cit, res_bad.triggered_rules)

    res_ok_leap = verify_vn_legal_citation("Nghị định số 15/2024/NĐ-CP ngày 29/02/2024 của Chính phủ")
    assert res_ok_leap.is_valid is True


# =============================================================================
# CORE-11: Linking Suffixes i..z, MLA Multi-Book Ambiguity, Status Priority & Duplicates
# =============================================================================


def test_core11_year_suffix_i_to_z_and_mla_ambiguity_and_status_priority_and_duplicates() -> None:
    linker = CitationLinker()

    # 1) 2020i vs 2020j suffix disambiguation
    in_text_i = Citation(
        raw_text="(WHO, 2020i)",
        citation_type=CitationType.IN_TEXT,
        style=CitationStyle.APA,
    )
    bib_i = Citation(
        raw_text="WHO (2020i). COVID-19 Situation Report 9. World Health Organization.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["WHO"],
        year="2020",
        year_suffix="i",
        title="COVID-19 Situation Report 9",
        reference_id="ref-0001",
    )
    bib_j = Citation(
        raw_text="WHO (2020j). COVID-19 Situation Report 10. World Health Organization.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["WHO"],
        year="2020",
        year_suffix="j",
        title="COVID-19 Situation Report 10",
        reference_id="ref-0002",
    )
    res_who = linker.link([in_text_i], [bib_i, bib_j])
    assert len(res_who.links) == 1
    assert res_who.links[0].status == CitationMappingStatus.MATCHED
    assert res_who.links[0].reference_id == "ref-0001"

    # 2) MLA (Foucault 25) with 2 works by Foucault without title cue -> AMBIGUOUS_MAPPING
    mla_cit = Citation(
        raw_text="(Foucault 25)",
        citation_type=CitationType.IN_TEXT,
        style=CitationStyle.MLA,
    )
    foucault_1 = Citation(
        raw_text="Foucault, Michel. Discipline and Punish. Vintage, 1977.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.MLA,
        authors=["Foucault, Michel"],
        year="1977",
        title="Discipline and Punish",
        title_normalized="discipline and punish",
        reference_id="ref-f1",
    )
    foucault_2 = Citation(
        raw_text="Foucault, Michel. The History of Sexuality. Pantheon, 1978.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.MLA,
        authors=["Foucault, Michel"],
        year="1978",
        title="The History of Sexuality",
        title_normalized="the history of sexuality",
        reference_id="ref-f2",
    )
    res_mla = linker.link([mla_cit], [foucault_1, foucault_2], dominant_style="MLA")
    assert any(lnk.status == CitationMappingStatus.AMBIGUOUS_MAPPING for lnk in res_mla.links)
    assert all(lnk.status != CitationMappingStatus.MATCHED for lnk in res_mla.links)

    # 3) bib.mapping_status preserves IN_TEXT_MISMATCH when not cleanly MATCHED
    mismatch_cit = Citation(
        raw_text="(Smith, 2021)",
        citation_type=CitationType.IN_TEXT,
        style=CitationStyle.APA,
    )
    bib_2020 = Citation(
        raw_text="Smith, J. (2020). Neural Forecasting. Journal of AI.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Smith, J."],
        year="2020",
        title="Neural Forecasting",
        title_normalized="neural forecasting",
        reference_id="ref-s1",
    )
    linker.link([mismatch_cit], [bib_2020], dominant_style="APA")
    assert bib_2020.mapping_status == CitationMappingStatus.IN_TEXT_MISMATCH.value

    # 4) DuplicateDetector matches ["John Smith"] vs ["Smith, J."]
    dup_a = Citation(
        raw_text="John Smith (2020). Deep Neural Architectures for NLP.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["John Smith"],
        year="2020",
        title="Deep Neural Architectures for NLP",
    )
    dup_b = Citation(
        raw_text="Smith, J. (2020). Deep Neural Architectures for NLP.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Smith, J."],
        year="2020",
        title="Deep Neural Architectures for NLP",
    )
    groups = DuplicateDetector().detect([dup_a, dup_b])
    assert len(groups) == 1


# =============================================================================
# CORE-13: Pipeline UTC Timestamp, Whitespace Normalization & Cache Rehydration
# =============================================================================


def test_core13_utc_timestamp_whitespace_lookup_and_full_rehydration(tmp_path: Path) -> None:
    # 1) _match_features_from_dict preserves typed float/str defaults and api_exhausted/doi_ra_status
    mf = _match_features_from_dict({"api_exhausted": True, "doi_ra_status": "crossref"})
    assert mf.abstract_context_sim == 0.0
    assert mf.best_evidence_sentence == ""
    assert mf.best_evidence_score == 0.0
    assert mf.best_cited_sentence == ""
    assert mf.api_exhausted is True
    assert mf.doi_ra_status == "crossref"

    # 2) Multi-space newline lookup in _build_link_lookup / _build_link_lookup_multi
    from integrity_checker.models.validation import CitationLink, MappingMethod

    lnk = CitationLink(
        occurrence_id="occ-1",
        reference_id="ref-1",
        status=CitationMappingStatus.MATCHED,
        confidence=0.95,
        method=MappingMethod.AUTHOR_YEAR,
        evidence={"raw": "(Smith,\n  2020)"},
    )
    lookup = IntegrityPipeline._build_link_lookup([lnk])
    lookup_multi = IntegrityPipeline._build_link_lookup_multi([lnk])
    assert "(smith, 2020)" in lookup
    assert "(smith, 2020)" in lookup_multi

    # 3) AnalysisReport to_dict -> from_dict round-trip preserves override & style_penalty fields
    cit = Citation(
        raw_text="Smith, J. (2020). Paper Title. Nature.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Smith, J."],
        year="2020",
        title="Paper Title",
    )
    verdict = CitationVerdict(
        citation=cit,
        label=ValidationLabel.METADATA_ERROR,
        confidence=0.82,
        mapping_status=CitationMappingStatus.MATCHED,
        mapping_confidence=0.95,
        features=MatchFeatures(
            title_sim_fuzzy=0.95,
            api_exhausted=True,
            doi_ra_status="datacite",
        ),
        style_penalty=0.05,
        archive_url="https://web.archive.org/web/20240101/https://example.org",
        is_retracted=True,
        is_overridden=True,
        overridden_label=ValidationLabel.VERIFIED,
        overridden_by="teacher@tdtu.edu.vn",
        override_note="Confirmed print edition.",
    )
    now_utc = datetime.now(UTC)
    dummy_pdf = tmp_path / "utc.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")

    class _EmptyParsed:
        document = Document(file_path=str(dummy_pdf), num_pages=1, pages=[Page(page_num=1, text="")])
        body_citations: list[Citation] = []
        appendix_citations: list[Citation] = []
        references: list[Citation] = []
        parser_warnings: list[str] = []

    class _EmptyDocParser:
        def parse(self, _path: str) -> _EmptyParsed:
            return _EmptyParsed()

    pipe = IntegrityPipeline(
        document_parser=_EmptyDocParser(),  # type: ignore[arg-type]
        use_report_cache=False,
    )
    rep_live = asyncio.run(pipe.run_async(str(dummy_pdf)))
    assert rep_live.generated_at.endswith("Z")
    parsed_ts = datetime.fromisoformat(rep_live.generated_at.replace("Z", "+00:00"))
    assert abs((parsed_ts - now_utc).total_seconds()) < 30.0

    rep_live.verdicts = [verdict]
    rehydrated = AnalysisReport.from_dict(rep_live.to_dict())
    rv = rehydrated.verdicts[0]
    assert rv.style_penalty == pytest.approx(0.05)
    assert rv.archive_url == "https://web.archive.org/web/20240101/https://example.org"
    assert rv.is_retracted is True
    assert rv.is_overridden is True
    assert rv.overridden_label == ValidationLabel.VERIFIED
    assert rv.overridden_by == "teacher@tdtu.edu.vn"
    assert rv.override_note == "Confirmed print edition."
    assert rv.features.api_exhausted is True
    assert rv.features.doi_ra_status == "datacite"


# =============================================================================
# CORE-14, CORE-15 & QA-14: SymbolicRules Dead Guard, Intent Cache, Citation.from_raw & Cleanup
# =============================================================================


def test_core14_rules_no_contradictory_guard_and_intent_emb_cache_cleanup() -> None:
    rules_src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "integrity_checker"
        / "logic"
        / "rules.py"
    ).read_text(encoding="utf-8")
    low_author_idx = rules_src.index("and author_sim < 0.30")
    low_author_block = rules_src[low_author_idx - 120 : low_author_idx + 260]
    assert "not (is_known_author and author_sim >= 0.50)" not in low_author_block
    assert "not (is_known_author and features.title_sim_fuzzy >= 0.85)" in low_author_block

    matcher = SemanticMatcher(model_name="stub-model")
    fake_model_1 = MagicMock()
    fake_model_2 = MagicMock()
    with patch.object(matcher, "_encode", side_effect=[["emb1"], ["emb2"]]):
        e1 = matcher._get_intent_embeddings(fake_model_1)
        e2 = matcher._get_intent_embeddings(fake_model_2)
    assert e1 == ["emb1"]
    assert e2 == ["emb2"]
    assert len(SemanticMatcher._intent_emb_cache) >= 2

    SemanticMatcher.clear_embedding_cache()
    assert len(SemanticMatcher._intent_emb_cache) == 0


def test_core15_citation_from_raw_single_pass_regex() -> None:
    from integrity_checker.models import citation as cit_mod

    doi_calls = 0
    url_calls = 0
    orig_doi_re = cit_mod._DOI_RE
    orig_url_re = cit_mod._URL_RE

    class _SpyPattern:
        def __init__(self, real: object, kind: str) -> None:
            self._real = real
            self._kind = kind

        def search(self, text: str) -> object:
            nonlocal doi_calls, url_calls
            if self._kind == "doi":
                doi_calls += 1
            else:
                url_calls += 1
            return self._real.search(text)  # type: ignore[attr-defined]

    with (
        patch.object(cit_mod, "_DOI_RE", _SpyPattern(orig_doi_re, "doi")),
        patch.object(cit_mod, "_URL_RE", _SpyPattern(orig_url_re, "url")),
    ):
        c = Citation.from_raw(
            "Vaswani et al. (2017). Attention Is All You Need. https://arxiv.org/abs/1706.03762 doi:10.5555/3295222.3295349"
        )
    assert c.doi == "10.5555/3295222.3295349"
    assert c.url == "https://arxiv.org/abs/1706.03762"
    assert doi_calls == 1
    assert url_calls == 1


def test_qa14_orphaned_consensus_removed_and_citation_extractor_decoupled() -> None:
    assert importlib.util.find_spec("integrity_checker.matching.consensus") is None
    matching_mod = importlib.import_module("integrity_checker.matching")
    assert "ConsensusCalculator" not in matching_mod.__all__
    assert not hasattr(matching_mod, "ConsensusCalculator")

    ce_src = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "integrity_checker"
        / "extraction"
        / "citation_extractor.py"
    ).read_text(encoding="utf-8")
    assert "from integrity_checker.extraction.regex_patterns" not in ce_src
    assert "import regex_patterns" not in ce_src
    sys.modules.pop("integrity_checker.extraction.regex_patterns", None)
    importlib.reload(importlib.import_module("integrity_checker.extraction.citation_extractor"))
    assert "integrity_checker.extraction.regex_patterns" not in sys.modules


# =============================================================================
# QA-08: Direct Unit Suites for All 8 Citation Style Modules
# =============================================================================


def test_qa08_acm_format_unit_suite() -> None:
    fmt = ACMFormat()
    assert fmt.name == "ACM"
    assert fmt.priority == 88
    assert any(p.search("Prior work [1, 2-4] demonstrates") for p in fmt.in_text_patterns)

    c_yr_first = fmt.parse_reference_entry(
        "[1] Ashish Vaswani and Noam Shazeer. 2017. Attention Is All You Need. In Proceedings of NeurIPS."
    )
    assert c_yr_first is not None
    assert c_yr_first.style == CitationStyle.ACM
    assert c_yr_first.numeric_index == 1
    assert c_yr_first.year == "2017"
    assert c_yr_first.title == "Attention Is All You Need"

    c_conf = fmt.parse_reference_entry(
        '[2] J. Smith, "Distributed Graph Systems," in Proc. SIGMOD, Portland, 2020, pp. 10-22.'
    )
    assert c_conf is not None
    assert c_conf.year == "2020"
    assert "Distributed Graph Systems" in (c_conf.title or "")

    # Rejects Nature / Vancouver formats
    assert fmt.parse_reference_entry("1. Smith J. Title. Nature 580, 100-105 (2020).") is None


def test_qa08_acs_format_unit_suite() -> None:
    fmt = ACSFormat()
    assert fmt.name == "ACS"
    assert len(fmt.in_text_patterns) >= 2

    c_art = fmt.parse_reference_entry(
        "(1) Smith, J.; Jones, A. Catalytic Water Splitting on Gold Surfaces. J. Am. Chem. Soc. 2020, 142 (10), 4500-4512."
    )
    assert c_art is not None
    assert c_art.style == CitationStyle.ACS
    assert c_art.numeric_index == 1
    assert c_art.year == "2020"
    assert "Catalytic Water Splitting" in (c_art.title or "")

    c_rsc = fmt.parse_reference_entry(
        "2. Y. Zhang and X. Liu, Chem. Sci., 2021, 12, 1234-1240."
    )
    assert c_rsc is not None
    assert c_rsc.year == "2021"
    assert c_rsc.volume == "12"


def test_qa08_ama_format_unit_suite() -> None:
    fmt = AMAFormat()
    assert fmt.name == "AMA"
    assert fmt.priority == 75
    assert any(p.search("clinical trials^1,2") for p in fmt.in_text_patterns)

    c_doi = fmt.parse_reference_entry(
        "1. Smith J, Jones A. Outcomes of mRNA vaccination in adults. JAMA. 2021;325(15):1534-1545. doi:10.1001/jama.2021.3976"
    )
    assert c_doi is not None
    assert c_doi.style == CitationStyle.AMA
    assert c_doi.numeric_index == 1
    assert c_doi.year == "2021"
    assert c_doi.doi == "10.1001/jama.2021.3976"

    c_book = fmt.parse_reference_entry(
        "2. Fauci AS, Kasper DL. Principles of Internal Medicine. New York: McGraw-Hill; 2018."
    )
    assert c_book is not None
    assert c_book.year == "2018"


def test_qa08_chicago_format_unit_suite() -> None:
    fmt = ChicagoFormat()
    assert fmt.name == "Chicago"
    assert fmt.priority == 70
    assert any(p.search("(Habermas 1989, 42)") for p in fmt.in_text_patterns)

    c_ad = fmt.parse_reference_entry(
        'Smith, John, and Jane Doe. 2020. "Algorithmic Governance in Cities." Urban Studies 57 (4): 712-730.'
    )
    assert c_ad is not None
    assert c_ad.style == CitationStyle.CHICAGO
    assert c_ad.year == "2020"
    assert c_ad.title == "Algorithmic Governance in Cities"

    c_nb = fmt.parse_reference_entry(
        "Anderson, Benedict. Imagined Communities. London: Verso, 2006."
    )
    assert c_nb is not None
    assert c_nb.year == "2006"
    assert c_nb.title == "Imagined Communities"


def test_qa08_cse_format_unit_suite() -> None:
    fmt = CSEFormat()
    assert fmt.name == "CSE"
    assert fmt.priority == 77
    assert any(p.search("(Darwin 1998)") for p in fmt.in_text_patterns)

    c_cs = fmt.parse_reference_entry(
        "1. Meyer R, Chen L. Soil microbiome dynamics under drought. Ecology. 2022;103(5):112-125."
    )
    assert c_cs is not None
    assert c_cs.style == CitationStyle.CSE
    assert c_cs.year == "2022"
    assert "Soil microbiome dynamics" in (c_cs.title or "")

    c_ny = fmt.parse_reference_entry(
        "Campbell NA. 2017. Biology: A Global Approach. Boston: Pearson."
    )
    assert c_ny is not None
    assert c_ny.year == "2017"


def test_qa08_harvard_format_unit_suite() -> None:
    fmt = HarvardFormat()
    assert fmt.name == "Harvard"
    assert fmt.priority == 85
    assert any(p.search("(Giddens 2009, p. 14)") for p in fmt.in_text_patterns)

    c_quoted = fmt.parse_reference_entry(
        "Smith, J. and Doe, B. (2020) 'Deep learning in clinical diagnostics', Nature Medicine, 26(3), pp. 123-135."
    )
    assert c_quoted is not None
    assert c_quoted.style == CitationStyle.HARVARD
    assert c_quoted.year == "2020"
    assert c_quoted.title == "Deep learning in clinical diagnostics"

    c_book = fmt.parse_reference_entry(
        "Bryman, A. (2016) Social Research Methods. 5th edn. Oxford: Oxford University Press."
    )
    assert c_book is not None
    assert c_book.year == "2016"


def test_qa08_mla_format_unit_suite() -> None:
    fmt = MLAFormat()
    assert fmt.name == "MLA"
    assert fmt.priority == 70
    assert any(p.search("(Morrison 142)") for p in fmt.in_text_patterns)

    c_art = fmt.parse_reference_entry(
        'Butler, Judith. "Performative Acts and Gender Constitution." Theatre Journal, vol. 40, no. 4, 1988, pp. 519-531.'
    )
    assert c_art is not None
    assert c_art.style == CitationStyle.MLA
    assert c_art.year == "1988"
    assert c_art.title == "Performative Acts and Gender Constitution"

    c_book = fmt.parse_reference_entry(
        "Said, Edward W. Orientalism. Pantheon Books, 1978."
    )
    assert c_book is not None
    assert c_book.year == "1978"
    assert c_book.title == "Orientalism"


def test_qa08_nature_format_unit_suite() -> None:
    fmt = NatureFormat()
    assert fmt.name == "Nature"
    assert fmt.priority == 78
    assert any(p.search("reported previously^12") for p in fmt.in_text_patterns)

    c_doi = fmt.parse_reference_entry(
        "1. Jumper, J. et al. Highly accurate protein structure prediction with AlphaFold. Nature 596, 583-589 (2021). doi:10.1038/s41586-021-03819-2"
    )
    assert c_doi is not None
    assert c_doi.style == CitationStyle.NATURE
    assert c_doi.numeric_index == 1
    assert c_doi.year == "2021"
    assert c_doi.doi == "10.1038/s41586-021-03819-2"

    c_book = fmt.parse_reference_entry(
        "2. Nielsen, M. A. & Chuang, I. L. Quantum Computation and Quantum Information (Cambridge Univ. Press, 2010)."
    )
    assert c_book is not None
    assert c_book.year == "2010"
    assert c_book.venue == "Cambridge Univ. Press"
