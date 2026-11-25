"""Regression tests for all 12 bugs uncovered by live GROBID uploads of
FinalReport_TDTU/thesis.pdf (ENG) and FinalReport_TDTU_VN/thesis.pdf (VIE).

Covers:
- BUG-THESIS-01: GROBID Docker JVM heap headroom (-Xmx1280m in 3G) + startup orphan
  job recovery skipping jobs created after current server boot / active in tracker.
- BUG-THESIS-02: grobid_parser._split_single_merged_raw_reference must NOT split a
  single bibliography entry before 'Accessed: Nov. 1, 2026. [Online]. Available: https://...'
  or 'Truy cập ngày ... [Trực tuyến]. Địa chỉ: https://...'.
- BUG-THESIS-03: grobid_parser._normalize_raw_ref_text & _extract_url_and_doi_from_raw
  must NOT glue page numbers / Appendix lines ('85 networks: 86 - essay-check-net')
  onto root-slash URLs ('https://fastapi.tiangolo.com/'), and DocumentParser._merge_reference_lists
  must repair bled GROBID URLs from clean section-bounded regex donors.
- BUG-THESIS-04: ACMFormat / ReferenceListParser must NOT parse 'Accessed: Nov' as title
  or access year '2026' as publication year on IEEE unquoted web entries ('[20] OpenAlex, ..., 2024. Accessed: Nov. 1, 2026...').
- BUG-THESIS-05: grobid_parser must reject 'Truy cập ngày ...' / 'Địa chỉ: https: ...' as
  <title level="a"> in favor of <title level="m">, ReferenceListParser._parse_vn_traditional_entry
  must extract single-word corporate authors ('Crossref', 'OpenAlex', 'DataCite') and strip
  trailing 'Truy cập ngày ... [Trực tuyến]. Địa chỉ', and Vietnamese GROBID enrichment must
  never cross-contaminate boilerplate titles across unrelated entries.
- BUG-THESIS-06: compute_url_title_match_score / check_url_content_mismatch must treat
  generic interactive API viewer shell titles ('Swagger UI', 'ReDoc', etc. without citation_title)
  as non-contradictory generic shells instead of R-URL-CONTENT-MISMATCH.
- BUG-THESIS-07: SICI DOIs containing '<0001:VOFEIT>2.0.CO;2', Unicode Greek question mark
  ';' (U+037E), and PDF hyphen line-wraps ('10.1175/1520- 0493...') must extract and
  normalize intact end-to-end.
- BUG-THESIS-08: TechStandardClient._lookup_github_repo must treat years within a repository's
  active lifespan [created_year, max_pushed_year] as valid, and hybrid merge must restore
  dropped 'prefix:' before colon ('pdfplumber: Plumb a PDF...').
- BUG-THESIS-09: Authorless international standards '[44] ISO/IEC/IEEE 29148:2018' (ignoring
  GROBID's 'Iso/Iec' pseudo-author) and '[45] ISO/IEC 25010:2023' (preserving <idno>ISO/IEC 25010:2023</idno>)
  must extract and validate cleanly without false author mismatch or R-FAIL-ALL.
- BUG-THESIS-10: Style-table placeholder entries ('A. Author, "Title," Venue...',
  'Author Name. 2020. Title. In Proc. ACM, 1-10.', 'Author, A. (2020) Title. Place: Publisher.')
  must be filtered as fake entries before GROBID reference indexing.
- BUG-THESIS-11: MLA in-text pattern must NOT match '(Order 0)' (page 0 / 'Order' keyword),
  and parenthesized/meta-linguistic citation syntax illustrations ('([14a, 14b])',
  'An in-text citation marker such as (Vaswani et al., 2017)') must not be extracted as
  real body/appendix citations.
- BUG-THESIS-12: SemanticMatcher._load_multilingual_encoder must keep local_files_only=True
  when onnx_quantized=True so missing local cache never triggers a rogue Hub network lookup.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from integrity_checker.api.job_recovery import recover_orphaned_essay_jobs
from integrity_checker.api.progress import get_tracker
from integrity_checker.db.models import Base, EssayRecord
from integrity_checker.db.session import run_migrations
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.grobid_parser import (
    _normalize_raw_ref_text,
    _split_merged_raw_reference,
    parse_tei,
)
from integrity_checker.extraction.patterns.acm import ACMFormat
from integrity_checker.extraction.patterns.mla import MLAFormat
from integrity_checker.extraction.patterns.utils import extract_doi
from integrity_checker.extraction.reference_parser import ReferenceListParser, _is_fake_entry
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceResult
from integrity_checker.retrieval.html_meta_verifier import (
    HtmlPageMeta,
    compute_url_title_match_score,
)
from integrity_checker.retrieval.normalization import normalize_doi
from integrity_checker.retrieval.tech_standard_client import TechStandardClient

# =============================================================================
# BUG-THESIS-01: GROBID Docker JVM Heap Headroom + Startup Orphan Recovery Race
# =============================================================================


def test_bug_thesis_01_grobid_docker_jvm_heap_leaves_native_headroom() -> None:
    import re

    repo_root = Path(__file__).resolve().parents[2]
    dev_compose = (repo_root / "docker-compose.yml").read_text(encoding="utf-8")
    prod_compose = (repo_root / "docker-compose.prod.yml").read_text(encoding="utf-8")
    setup_sh = (repo_root / "scripts" / "grobid_docker_setup.sh").read_text(encoding="utf-8")
    entrypoint_sh = repo_root / "scripts" / "grobid-entrypoint.sh"

    assert entrypoint_sh.is_file(), "Missing scripts/grobid-entrypoint.sh config wrapper"

    # GROBID 0.9.1-crf Wapiti native CRF models consume ~3.1 GiB RSS; keep JVM heap bounded
    # (512m..1280m, never -Xmx2g) inside a >=4G container so native + heap fit with zero swap.
    for name, txt in (
        ("docker-compose.yml", dev_compose),
        ("docker-compose.prod.yml", prod_compose),
    ):
        assert "-Xmx2g" not in txt, f"{name} must not use -Xmx2g"
        assert "JDK_JAVA_OPTIONS" not in txt, f"{name} must not duplicate JVM flags via JDK_JAVA_OPTIONS"
        m_xmx = re.search(r"-Xmx(\d+)m", txt)
        assert m_xmx is not None, f"{name} missing -Xmx<N>m heap cap for GROBID"
        heap_mb = int(m_xmx.group(1))
        assert 512 <= heap_mb <= 1280, f"{name} GROBID heap {heap_mb}m outside safe [512, 1280] MB range"
        assert "-XX:+ExitOnOutOfMemoryError" in txt, f"{name} missing -XX:+ExitOnOutOfMemoryError"
        assert "./scripts/grobid-entrypoint.sh:/opt/grobid/citra-grobid-entrypoint.sh:ro" in txt, (
            f"{name} missing read-only grobid-entrypoint.sh mount"
        )
        assert "memory: 4G" in txt, f"{name} GROBID container limit must be >= 4G for 0.9.1-crf native models"

    assert "GROBID_MEMORY:-768m" in setup_sh
    assert "GROBID_CONTAINER_MEMORY:-4g" in setup_sh
    assert "-Xmx2g" not in setup_sh


def test_bug_thesis_01_orphan_recovery_skips_jobs_started_after_boot_or_active_in_tracker(
    tmp_path: Path,
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'boot_race.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    (uploads_dir / "1.pdf").write_bytes(b"%PDF-1.4 fake")
    (uploads_dir / "2.pdf").write_bytes(b"%PDF-1.4 fake")

    boot_time = datetime.now(UTC).replace(tzinfo=None)
    pre_boot = boot_time - timedelta(seconds=30)
    post_boot = boot_time + timedelta(seconds=5)

    sess = SessionLocal()
    try:
        # Essay 1: genuine pre-boot orphan
        e1 = EssayRecord(
            id=1,
            filename="old_orphan.pdf",
            job_status="processing",
            job_attempt_count=1,
            uploaded_at=pre_boot,
            job_heartbeat_at=pre_boot,
        )
        # Essay 2: brand-new upload that arrived AFTER server boot while SemanticMatcher was warming
        e2 = EssayRecord(
            id=2,
            filename="live_upload.pdf",
            job_status="processing",
            job_attempt_count=1,
            uploaded_at=post_boot,
            job_heartbeat_at=post_boot,
        )
        sess.add_all([e1, e2])
        sess.commit()
    finally:
        sess.close()

    tracker = get_tracker()
    tracker.init(2)
    try:
        summary = recover_orphaned_essay_jobs(
            lambda: None,
            session_factory=SessionLocal,
            uploads_dir=uploads_dir,
            run_rescheduled=False,
            started_before_utc=boot_time,
        )
        assert summary["rescheduled"] == 1
        check_sess = SessionLocal()
        try:
            rec1 = check_sess.get(EssayRecord, 1)
            rec2 = check_sess.get(EssayRecord, 2)
            assert rec1 is not None and rec1.job_attempt_count == 2
            # Live upload #2 MUST NOT be hijacked or incremented!
            assert rec2 is not None and rec2.job_attempt_count == 1
            assert rec2.job_status == "processing"
        finally:
            check_sess.close()
    finally:
        tracker.clear(2)
        engine.dispose()


# =============================================================================
# BUG-THESIS-02: Do NOT Split Single Ref Before "Accessed: ... [Online]. Available:"
# =============================================================================


@pytest.mark.parametrize(
    "raw_ref",
    [
        (
            "OpenAlex, OpenAlex: An Open Catalogue of Scholarly Papers, Authors, Venues, "
            "and Institutions, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://docs.openalex.org/"
        ),
        (
            "International DOI Foundation, Handbook of the DOI Resolution System, 2023. "
            "Accessed: Nov. 1, 2026. [Online]. Available: https://www.doi.org/doi-handbook/HTML/"
        ),
        (
            "OpenAlex, OpenAlex: An Open Catalogue of Scholarly Papers, Authors, Venues, "
            "and Institutions, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://docs.openalex.org/"
        ),
    ],
)
def test_bug_thesis_02_split_merged_raw_reference_preserves_accessed_online_tail(
    raw_ref: str,
) -> None:
    segments = _split_merged_raw_reference(raw_ref)
    assert segments == [raw_ref]


# =============================================================================
# BUG-THESIS-03: Do NOT Glue Appendix / Page Numbers onto Root-Slash URLs
# =============================================================================


def test_bug_thesis_03_grobid_root_slash_url_not_corrupted_by_appendix_bleed() -> None:
    bled_raw = (
        "S. Ramírez, FastAPI: Modern, High-Performance Python Web Framework for Building APIs, "
        "2024. Accessed: Nov. 1, 2026. [Online]. Available: https://fastapi.tiangolo.com/ "
        "85 networks: 86 - essay-check-net"
    )
    norm = _normalize_raw_ref_text(bled_raw)
    assert "https://fastapi.tiangolo.com/85" not in norm

    tei_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <TEI xmlns="http://www.tei-c.org/ns/1.0">
      <text><back><div type="references"><listBibl>
        <biblStruct xml:id="b45">
          <monogr>
            <author><persName><forename type="first">S</forename><surname>Ramírez</surname></persName></author>
            <title level="m">FastAPI: Modern, High-Performance Python Web Framework for Building APIs</title>
            <ptr target="https://fastapi.tiangolo.com/" />
            <imprint><date type="published" when="2024">2024</date></imprint>
          </monogr>
          <note type="raw_reference">{bled_raw}</note>
        </biblStruct>
      </listBibl></div></back></text>
    </TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 1
    assert out.bibliography[0].url == "https://fastapi.tiangolo.com/"


# =============================================================================
# BUG-THESIS-04: IEEE/ACM Unquoted Web Entry Must Not Parse "Accessed: Nov" as Title
# =============================================================================


@pytest.mark.parametrize(
    ("raw_entry", "expected_year", "expected_url", "title_substr"),
    [
        (
            "[20] OpenAlex, OpenAlex: An Open Catalogue of Scholarly Papers, Authors, Venues, and Institutions, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://docs.openalex.org/",
            "2024",
            "https://docs.openalex.org/",
            "OpenAlex: An Open Catalogue",
        ),
        (
            "[22] International DOI Foundation, Handbook of the DOI Resolution System, 2023. Accessed: Nov. 1, 2026. [Online]. Available: https://www.doi.org/doi-handbook/HTML/",
            "2023",
            "https://www.doi.org/doi-handbook/HTML/",
            "Handbook of the DOI Resolution System",
        ),
        (
            "[23] Directory of Open Access Journals, DOAJ Public API Documentation, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://doaj.org/api/docs",
            "2024",
            "https://doaj.org/api/docs",
            "DOAJ Public API Documentation",
        ),
        (
            "[46] S. Ramírez, FastAPI: Modern, High-Performance Python Web Framework for Building APIs, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://fastapi.tiangolo.com/",
            "2024",
            "https://fastapi.tiangolo.com/",
            "FastAPI: Modern, High-Performance",
        ),
    ],
)
def test_bug_thesis_04_ieee_web_entry_extracts_pub_year_and_real_title(
    raw_entry: str,
    expected_year: str,
    expected_url: str,
    title_substr: str,
) -> None:
    acm_cit = ACMFormat().parse_reference_entry(raw_entry)
    if acm_cit is not None:
        assert not (acm_cit.title or "").lower().startswith("accessed")
        assert acm_cit.year == expected_year

    ref_parser = ReferenceListParser()
    cit = ref_parser._parse_entry_with_dash_inheritance(
        raw_entry, order_index=1, page_num=1, prev_citations=[]
    )
    assert cit is not None
    assert cit.year == expected_year
    assert cit.url == expected_url
    assert cit.title is not None and title_substr.lower() in cit.title.lower()
    assert not cit.title.lower().startswith("accessed")


# =============================================================================
# BUG-THESIS-05: Vietnamese Web Entries + Bogus GROBID <title level="a">Truy cập...</title>
# =============================================================================


def test_bug_thesis_05_grobid_skips_truy_cap_and_dia_chi_analytic_titles() -> None:
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <TEI xmlns="http://www.tei-c.org/ns/1.0">
      <text><back><div type="references"><listBibl>
        <biblStruct xml:id="b23">
          <analytic>
            <title level="a" type="main">Truy cập ngày 01/11/2026</title>
            <author><persName><forename type="first">J</forename><surname>Singer-Vine</surname></persName></author>
            <ptr target="https://github.com/jsvine/pdfplumber" />
          </analytic>
          <monogr>
            <title level="m">Plumb a PDF for Detailed Information About Each Text Character, Rectangle, and Line</title>
            <imprint><date type="published" when="2024">2024</date></imprint>
          </monogr>
          <note type="raw_reference">J. Singer-Vine, pdfplumber: Plumb a PDF for Detailed Information About Each Text Character, Rectangle, and Line, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://github.com/jsvine/pdfplumber</note>
        </biblStruct>
      </listBibl></div></back></text>
    </TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 1
    assert "Plumb a PDF" in (out.bibliography[0].title or "")
    assert "truy cập" not in (out.bibliography[0].title or "").lower()


def test_bug_thesis_05_vn_traditional_entry_extracts_corp_author_and_clean_title() -> None:
    parser = ReferenceListParser()
    entries = [
        "[19] Crossref, Crossref REST API: Metadata Retrieval and Text Mining Documentation, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://api.crossref.org/",
        "[20] OpenAlex, OpenAlex: An Open Catalogue of Scholarly Papers, Authors, Venues, and Institutions, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://docs.openalex.org/",
        "[21] DataCite, DataCite REST API Documentation, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://support.datacite.org/docs/api",
        "[23] Directory of Open Access Journals, DOAJ Public API Documentation, 2024. Truy cập ngày 01/11/2026. [Trực tuyến]. Địa chỉ: https://doaj.org/api/docs",
    ]
    parsed = [
        parser._parse_entry_with_dash_inheritance(
            e, order_index=idx, page_num=1, prev_citations=[]
        )
        for idx, e in enumerate(entries, start=1)
    ]
    assert all(c is not None for c in parsed)
    titles = [c.title or "" for c in parsed if c is not None]
    assert len(set(titles)) == 4
    for c in parsed:
        assert c is not None
        assert c.authors, f"Expected non-empty corporate author for {c.raw_text}"
        assert c.year == "2024"
        assert "truy cập" not in (c.title or "").lower()
        assert "địa chỉ" not in (c.title or "").lower()


# =============================================================================
# BUG-THESIS-06: Generic Interactive API Shell Titles ("Swagger UI", "ReDoc")
# =============================================================================


@pytest.mark.parametrize("shell_title", ["Swagger UI", "ReDoc", "Scalar API Reference", "API Documentation"])
def test_bug_thesis_06_swagger_ui_shell_title_does_not_trigger_url_content_mismatch(
    shell_title: str,
) -> None:
    meta = HtmlPageMeta(page_title=shell_title, citation_title=None)
    assert (
        compute_url_title_match_score(
            "Crossref REST API: Metadata Retrieval and Text Mining Documentation",
            meta,
        )
        is None
    )
    src = SourceResult(
        citation_raw="[19] Crossref, Crossref REST API Documentation, 2024. https://api.crossref.org/",
        url_status="alive",
        html_meta=meta,
    )
    is_mis, _, _ = SymbolicRules.check_url_content_mismatch(
        citation_title="Crossref REST API: Metadata Retrieval and Text Mining Documentation",
        citation_raw=src.citation_raw,
        citation_url="https://api.crossref.org/",
        source=src,
    )
    assert is_mis is False


def test_bug_thesis_06_real_decoy_page_title_still_triggers_url_content_mismatch() -> None:
    meta = HtmlPageMeta(page_title=" Chocolate Chip Cookie Recipe - Allrecipes ", citation_title=None)
    src = SourceResult(
        citation_raw="[19] Crossref, Crossref REST API Documentation, 2024. https://example.com/",
        url_status="alive",
        html_meta=meta,
    )
    is_mis, sim, _ = SymbolicRules.check_url_content_mismatch(
        citation_title="Crossref REST API: Metadata Retrieval and Text Mining Documentation",
        citation_raw=src.citation_raw,
        citation_url="https://example.com/",
        source=src,
    )
    assert is_mis is True
    assert sim < 0.20


# =============================================================================
# BUG-THESIS-07: SICI DOI (<0001:VOFEIT>2.0.CO;2 + Greek ';' U+037E + Line Wrap)
# =============================================================================


def test_bug_thesis_07_sici_doi_extraction_and_normalization() -> None:
    expected_norm = "10.1175/1520-0493(1950)078<0001:vofeit>2.0.co;2"

    # 1. Standard SICI DOI with <...> and ;2
    raw_en = (
        '[36] G. W. Brier, "Verification of forecasts expressed in terms of probability," '
        "Monthly Weather Review, vol. 78, no. 1, pp. 1-3, Jan. 1950, "
        "doi: 10.1175/1520-0493(1950)078<0001:VOFEIT>2.0.CO;2."
    )
    d1 = extract_doi(raw_en)
    assert normalize_doi(d1) == expected_norm

    # 2. Unicode Greek question mark U+037E (';') emitted by LaTeX/GROBID
    raw_greek = "DOI: 10.1175/1520-0493(1950)078<0001:VOFEIT>2.0.CO\u037e2"
    d2 = extract_doi(raw_greek)
    assert normalize_doi(d2) == expected_norm

    # 3. Hyphen line-wrap in PDF ('10.1175/1520- 0493(1950)...')
    raw_vie = (
        "[36] G. W. Brier, “Verification of forecasts expressed in terms of probability,” "
        "Monthly Weather Review, vol. 78, no. 1, pp. 1–3, Jan. 1950, "
        "doi: 10.1175/1520- 0493(1950)078<0001:VOFEIT>2.0.CO;2."
    )
    ref_cit = ReferenceListParser()._parse_entry_with_dash_inheritance(
        raw_vie, order_index=36, page_num=1, prev_citations=[]
    )
    assert ref_cit is not None
    assert normalize_doi(ref_cit.doi) == expected_norm


# =============================================================================
# BUG-THESIS-08: GitHub Repo Active Year Lifespan + Colon-Prefix Title Restore
# =============================================================================


@pytest.mark.asyncio
async def test_bug_thesis_08_github_repo_lifespan_year_and_colon_prefix_restore() -> None:
    client = TechStandardClient()
    fake_repo_json = {
        "full_name": "jsvine/pdfplumber",
        "name": "pdfplumber",
        "owner": {"login": "jsvine"},
        "description": "Plumb a PDF for detailed information about each char, rectangle, line, et cetera — and easily extract text and tables.",
        "created_at": "2015-09-21T00:00:00Z",
        "updated_at": "2026-11-15T00:00:00Z",
        "pushed_at": "2026-10-30T00:00:00Z",
        "stargazers_count": 6500,
        "html_url": "https://github.com/jsvine/pdfplumber",
    }
    cit = Citation(
        raw_text="[8] J. Singer-Vine, pdfplumber: Plumb a PDF for Detailed Information About Each Text Character, Rectangle, and Line, 2024. https://github.com/jsvine/pdfplumber",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Singer-Vine, J"],
        title="pdfplumber: Plumb a PDF for Detailed Information About Each Text Character, Rectangle, and Line",
        year="2024",
        url="https://github.com/jsvine/pdfplumber",
    )
    with (
        patch.object(client, "_fetch_json", return_value=fake_repo_json),
        patch.object(
            client,
            "_fetch_github_citation_cff",
            return_value={"title": "pdfplumber", "year": "2026", "authors": ["Jeremy Singer-Vine"]},
        ),
    ):
        cand = await client._lookup_github_repo("jsvine/pdfplumber", citation=cit)
    assert cand is not None
    assert cand.year == "2024"

    # Also verify pre-creation year (e.g. 2010 < 2015) is NOT falsely accepted
    cit_wrong_year = Citation(
        raw_text=cit.raw_text,
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Singer-Vine, J"],
        title=cit.title,
        year="2010",
        url=cit.url,
    )
    with (
        patch.object(client, "_fetch_json", return_value=fake_repo_json),
        patch.object(client, "_fetch_github_citation_cff", return_value=None),
    ):
        cand_wrong = await client._lookup_github_repo("jsvine/pdfplumber", citation=cit_wrong_year)
    assert cand_wrong is not None
    assert cand_wrong.year != "2010"


# =============================================================================
# BUG-THESIS-09: International Standards [44] ISO/IEC/IEEE 29148:2018 & [45] ISO/IEC 25010:2023
# =============================================================================


def test_bug_thesis_09_grobid_iso_ieee_standards_preserve_idno_and_drop_pseudo_author() -> None:
    tei_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <TEI xmlns="http://www.tei-c.org/ns/1.0">
      <text><back><div type="references"><listBibl>
        <biblStruct xml:id="b43">
          <monogr>
            <title />
            <author><persName><surname>Iso/Iec</surname></persName></author>
            <idno type="DOI">10.1109/IEEESTD.2018.8559686</idno>
            <imprint><date type="published" when="2018-11">Nov. 2018</date></imprint>
            <respStmt><orgName>IEEE International Standard -Systems and Software Engineering -Life Cycle Processes -Requirements Engineering</orgName></respStmt>
          </monogr>
          <note type="raw_reference">ISO/IEC/IEEE International Standard – Systems and Software Engineering – Life Cycle Processes – Requirements Engineering, ISO/IEC/IEEE 29148:2018, Nov. 2018, doi: 10.1109/IEEESTD.2018.8559686.</note>
        </biblStruct>
        <biblStruct xml:id="b44">
          <monogr>
            <idno>ISO/IEC 25010:2023</idno>
            <title level="m">Systems and Software Engineering -Systems and Software Quality Requirements and Evaluation (SQuaRE) -Product Quality Model</title>
            <imprint><date type="published" when="2023-11">Nov. 2023</date></imprint>
          </monogr>
          <note type="raw_reference">Systems and Software Engineering – Systems and Software Quality Requirements and Evaluation (SQuaRE) – Product Quality Model, ISO/IEC 25010:2023, Nov. 2023.</note>
        </biblStruct>
      </listBibl></div></back></text>
    </TEI>"""
    out = parse_tei(tei_xml)
    assert len(out.bibliography) == 2

    b43, b44 = out.bibliography
    # [44] must not have personal surname 'Iso/Iec' and must recover standard title
    assert all("iso/iec" not in (a.full_name or "").lower() for a in b43.authors)
    assert b43.title is not None and "Requirements Engineering" in b43.title

    # [45] must retain 'ISO/IEC 25010:2023' in title or venue so Wikidata/TechStandard resolves it
    combined_44 = f"{b44.title or ''} {b44.venue or ''}"
    assert "ISO/IEC 25010:2023" in combined_44


# =============================================================================
# BUG-THESIS-10: Style-Table Placeholder Rows Filtered as Fake Entries
# =============================================================================


@pytest.mark.parametrize(
    "placeholder_entry",
    [
        'A. Author, "Title," Venue, vol. 1, pp. 1-10, 2020.',
        "ACM 88 [1], [Author 2020] [1] Author Name. 2020. Title. In Proc. ACM, 1-10.",
        "Author, A. (2020) Title. Place: Publisher.",
        "Author AB. Title. Venue. 2020;1(1):1-10.",
    ],
)
def test_bug_thesis_10_style_table_placeholders_detected_as_fake_entries(
    placeholder_entry: str,
) -> None:
    assert _is_fake_entry(placeholder_entry) is True


# =============================================================================
# BUG-THESIS-11: MLA '(Order 0)' & Illustrative Meta-Citations
# =============================================================================


def test_bug_thesis_11_mla_rejects_order_0_and_extractor_skips_meta_syntax_examples() -> None:
    mla = MLAFormat()
    order_0_txt = "Bộ kiểm tra NeuroSymbolicChecker, tầng tiền sàng lọc Bậc 0 (Order 0) kết hợp 16 nhóm luật."
    assert all(p.search(order_0_txt) is None for p in mla.in_text_patterns)
    # Real MLA citations still extract properly
    real_mla_txt = "Prior literary criticism confirms this motif (Nguyen 25)."
    assert any(p.search(real_mla_txt) is not None for p in mla.in_text_patterns)

    extractor = CitationExtractor()
    assert extractor.extract_from_text(order_0_txt, page_num=1) == []
    assert len(extractor.extract_from_text(real_mla_txt, page_num=1)) == 1
    prose = (
        "3. Structural linking errors: An in-text citation marker such as (Vaswani et al., 2017) "
        "may fail to resolve. "
        "3. Lỗi liên kết cấu trúc: Ký hiệu trích dẫn trong thân bài như (Vaswani et al., 2017) "
        "không khớp. "
        "linking/ Bidirectional CitationLinker implementing composite sub-reference splitting ([14a, 14b])."
    )
    extracted = extractor.extract_from_text(prose, page_num=1)
    assert extracted == []


# =============================================================================
# BUG-THESIS-12: SemanticMatcher Multilingual ONNX Loader Never Probes Hub
# =============================================================================


def test_bug_thesis_12_multilingual_onnx_loader_always_passes_local_files_only() -> None:
    matcher = SemanticMatcher()
    matcher.onnx_quantized = True
    calls: list[dict[str, Any]] = []

    def _fake_st(*args: Any, **kwargs: Any) -> Any:
        calls.append(dict(kwargs))
        raise OSError("not in local huggingface cache")

    with patch("sentence_transformers.SentenceTransformer", side_effect=_fake_st):
        res = matcher._load_multilingual_encoder()

    assert res is None
    assert len(calls) >= 1
    assert all(c.get("local_files_only") is True for c in calls)


# =============================================================================
# Round-2 Review + Adversarial Critique Hardening Regressions
# =============================================================================


def test_round2_ieee_unquoted_web_entry_no_redos_and_handles_inverted_and_et_al_authors() -> None:
    import time

    from integrity_checker.extraction.patterns.ieee import IEEEFormat

    ieee = IEEEFormat()
    # 1. 35-author unquoted book entry must finish in < 50 ms (was O(2^n) > 60s before atomic groups)
    many_authors = ", ".join(f"A. Author{i}" for i in range(35))
    adversarial_book = f"[1] {many_authors}, Some Unquoted Book Title, MIT Press, 2024."
    t0 = time.perf_counter()
    _ = ieee.parse_reference_entry(adversarial_book)
    assert (time.perf_counter() - t0) < 0.05

    # 2. Inverted Surname, Initials & hyphenated initials & et al.
    cases = [
        (
            "[20] Ramírez, S., FastAPI: Modern, High-Performance Python Web Framework, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://fastapi.tiangolo.com/",
            "FastAPI: Modern, High-Performance Python Web Framework",
            "2024",
        ),
        (
            "[21] A. Paszke, S. Gross, F. Massa et al., PyTorch: An Imperative Style, High-Performance Deep Learning Library, 2019. Accessed: Nov. 1, 2026. [Online]. Available: https://pytorch.org/",
            "PyTorch: An Imperative Style, High-Performance Deep Learning Library",
            "2019",
        ),
        (
            "[22] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, BERT: Pre-training of Deep Bidirectional Transformers, 2019. Accessed: Nov. 1, 2026. [Online]. Available: https://github.com/google-research/bert",
            "BERT: Pre-training of Deep Bidirectional Transformers",
            "2019",
        ),
    ]
    for raw_txt, exp_title, exp_yr in cases:
        c = ieee.parse_reference_entry(raw_txt)
        assert c is not None
        assert c.title == exp_title
        assert c.year == exp_yr


def test_round2_hijacked_cvpr_doi_with_fake_ieee_or_tcvn_author_is_rejected() -> None:
    from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
    from integrity_checker.logic.rules import ValidationLabel
    from integrity_checker.matching.author_parser import Author
    from integrity_checker.models.source import SourceCandidate

    checker = NeuroSymbolicChecker()
    hijacked_cit = Citation(
        raw_text='[1] IEEE, "Deep Residual Learning for Image Recognition," in Proc. CVPR, 2016, doi: 10.1109/CVPR.2016.90.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=[Author(last_name="ieee", initials=[], full_first_names=[], normalized="ieee", raw="IEEE")],
        title="Deep Residual Learning for Image Recognition",
        year="2016",
        doi="10.1109/cvpr.2016.90",
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.1109/cvpr.2016.90",
        title="Deep Residual Learning for Image Recognition",
        authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
        year="2016",
        venue="2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
        confidence=0.98,
    )
    src = SourceResult(
        citation_raw=hijacked_cit.raw_text,
        candidates=[cand],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"],
    )
    verdict = checker.check(hijacked_cit, src)
    assert verdict.label != ValidationLabel.VERIFIED
    assert "author" in (verdict.mismatched_fields or [])


def test_round2_swagger_ui_decoy_on_unrelated_quantum_paper_triggers_mismatch() -> None:
    meta = HtmlPageMeta(page_title="Swagger UI", citation_title=None)
    src = SourceResult(
        citation_raw='[10] J. Doe, "Quantum Gravity Effects in Supermassive Black Hole Mergers," 2024. [Online]. Available: https://petstore.swagger.io/',
        url_status="alive",
        html_meta=meta,
    )
    is_mis, sim, _ = SymbolicRules.check_url_content_mismatch(
        citation_title="Quantum Gravity Effects in Supermassive Black Hole Mergers",
        citation_raw=src.citation_raw,
        citation_url="https://petstore.swagger.io/",
        source=src,
    )
    assert is_mis is True
    assert sim < 0.20


def test_round2_parenthesized_real_in_text_citations_and_wrapped_arxiv_urls_preserved() -> None:
    from integrity_checker.extraction.document_parser import DocumentParser

    extractor = CitationExtractor()
    real_prose = (
        "Random Forest là thuật toán học kết hợp, được Breiman đề xuất năm 2001([8]). "
        "Outcomes such as academic interest ( [86] ) also improved."
    )
    cits = extractor.extract_from_text(real_prose, page_num=1)
    assert [c.raw_text for c in cits] == ["[8]", "[86]"]

    # Wrapped arXiv URL in regex donor must NOT truncate GROBID's full arXiv URL
    dp = DocumentParser()
    g_cit = Citation(
        raw_text="OpenAI (2023) GPT-4 Technical Report https://arxiv.org/abs/2303.08774",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["OpenAI"],
        title="GPT-4 Technical Report",
        year="2023",
        url="https://arxiv.org/abs/2303.08774",
        source="grobid",
    )
    r_cit = Citation(
        raw_text="[10] OpenAI, GPT-4 Technical Report, 2023. Available: https://arxiv.org/abs/ 2303.08774",
        citation_type=CitationType.REFERENCE_LIST,
        numeric_index=10,
        authors=["OpenAI"],
        title="GPT-4 Technical Report",
        year="2023",
        url="https://arxiv.org/abs/",
        source="regex",
    )
    merged = dp._merge_reference_lists([g_cit], [r_cit])
    assert len(merged) == 1
    assert merged[0].url == "https://arxiv.org/abs/2303.08774"


def test_round2_non_sici_doi_semicolon_and_vn_thang_access_date_and_title_ix() -> None:
    assert extract_doi("10.1007/s00285-014-0812-3;jsessionid=1234567890ABCDEF") == "10.1007/s00285-014-0812-3"
    assert extract_doi("10.1038/nature12373;2013") == "10.1038/nature12373"
    assert _is_fake_entry("Author, J. M. (2019). Title IX and Collegiate Athletics: A Legal History. Harvard Law Review, 132, 100-140.") is False

    parser = ReferenceListParser()
    vn_thang = "[19] Crossref, Crossref REST API: Metadata Retrieval and Text Mining Documentation, 2024. Truy cập ngày 01 tháng 11 năm 2026. [Trực tuyến]. Địa chỉ: https://api.crossref.org/"
    cit = parser._parse_entry_with_dash_inheritance(vn_thang, order_index=19, page_num=1, prev_citations=[])
    assert cit is not None
    assert "truy cập" not in (cit.title or "").lower()
    assert "tháng" not in (cit.title or "").lower()


def test_round3_ieee_two_author_and_multiword_surnames_and_inverted_and() -> None:
    from integrity_checker.extraction.patterns.ieee import IEEEFormat

    ieee = IEEEFormat()
    # 1. Two-author unquoted book separated by "and" must NOT swallow second author into first surname
    c_book = ieee.parse_reference_entry(
        "[1] J. Han and M. Kamber, Data Mining: Concepts and Techniques, Morgan Kaufmann, 2012."
    )
    assert c_book is not None
    assert c_book.title == "Data Mining: Concepts and Techniques"
    assert c_book.year == "2012"
    assert len(c_book.authors) == 2

    # 2. Inverted "Surname, J. and Doe, A." must not starve "\s+and\s+" via trailing space in _pers_init_tok
    c_inv = ieee.parse_reference_entry(
        "[2] Smith, J. and Doe, A., Modern Compiler Implementation, Cambridge University Press, 2020."
    )
    assert c_inv is not None
    assert c_inv.title == "Modern Compiler Implementation"
    assert len(c_inv.authors) == 2

    # 3. Multi-word surname ("Van Rossum, G.") in unquoted web entry
    c_mw = ieee.parse_reference_entry(
        "[3] Van Rossum, G., Python Reference Manual, 2024. Accessed: Nov. 1, 2026. [Online]. Available: https://docs.python.org/"
    )
    assert c_mw is not None
    assert c_mw.title == "Python Reference Manual"
    assert c_mw.year == "2024"


def test_round3_human_surnames_containing_std_substrings_and_framework_2024_decoy_and_grobid_jsessionid() -> None:
    from integrity_checker.extraction.grobid_adapter import _grobid_bib_to_citation
    from integrity_checker.models.source import SourceCandidate

    # 1. Human names containing "iec" (Piech), "cen" (Vincent), "iso" (Morrison), "din" (Medina)
    # must NEVER satisfy _is_standard_or_authorless_doi_match when cited author is a fake std code!
    for human_author in ("Chris Piech", "Pascal Vincent", "Robert Morrison", "Carlos Medina"):
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1145/1234567.1234568",
            title="Deep Knowledge Tracing",
            authors=[human_author],
            year="2015",
            confidence=0.98,
        )
        assert (
            SymbolicRules._is_standard_or_authorless_doi_match(
                ["IEC"], "10.1145/1234567.1234568", "Deep Knowledge Tracing", cand
            )
            is False
        )

    # 2. Paper with "Framework" in title and "/2024/" in decoy Swagger UI URL must STILL trigger mismatch!
    meta = HtmlPageMeta(page_title="Swagger UI", citation_title=None)
    decoy_raw = '[11] J. Doe, "A Unified Theoretical Framework for Quantum Gravity," 2024. [Online]. Available: https://petstore.swagger.io/2024/'
    src = SourceResult(citation_raw=decoy_raw, url_status="alive", html_meta=meta)
    is_mis, sim, _ = SymbolicRules.check_url_content_mismatch(
        citation_title="A Unified Theoretical Framework for Quantum Gravity",
        citation_raw=decoy_raw,
        citation_url="https://petstore.swagger.io/2024/",
        source=src,
    )
    assert is_mis is True
    assert sim < 0.20

    # 3. GROBID <idno type="DOI"> or raw_reference with ;jsessionid=... strips session suffix cleanly
    tei_jsess = """<?xml version="1.0" encoding="UTF-8"?>
    <TEI xmlns="http://www.tei-c.org/ns/1.0">
      <text><back><div type="references"><listBibl>
        <biblStruct xml:id="b0">
          <analytic><title level="a">Mathematical Biology Model</title></analytic>
          <monogr>
            <title level="j">J. Math. Biol.</title>
            <idno type="DOI">10.1007/s00285-014-0812-3;jsessionid=ABCDEF123456</idno>
            <imprint><date type="published" when="2014">2014</date></imprint>
          </monogr>
          <note type="raw_reference">[1] J. Doe, "Mathematical Biology Model," J. Math. Biol., 2014, doi: 10.1007/s00285-014-0812-3;jsessionid=ABCDEF123456.</note>
        </biblStruct>
      </listBibl></div></back></text>
    </TEI>"""
    g_out = parse_tei(tei_jsess)
    assert len(g_out.bibliography) == 1
    assert g_out.bibliography[0].doi == "10.1007/s00285-014-0812-3"
    cit_adapted = _grobid_bib_to_citation(g_out.bibliography[0], order_index=1)
    assert cit_adapted.doi == "10.1007/s00285-014-0812-3"

    # 4. PyMuPDF kerning "tổhợp ([14a, 14b])" without space in Vietnamese prose is skipped as syntax example
    extractor = CitationExtractor()
    kerned_vn = "linking/ CitationLinker hai chiều thực hiện tách tham chiếu con tổhợp ([14a, 14b])."
    assert extractor.extract_from_text(kerned_vn, page_num=142) == []

