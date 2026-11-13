"""DocumentParser — orchestrator fuse 3 nguồn: PyMuPDF + GROBID + SectionSegmenter.

Tuần 8 (v1.2 §3.4) — Pipeline:
    1. ``_load_pdf_text(pdf_path)`` — PyMuPDF → Document (text + pages).
    2. ``_load_grobid_tei(pdf_path)`` — GROBID HTTP → GrobidOutput (header, sections,
       citations, bibliography). Graceful fail nếu GROBID không available.
    3. ``_merge(text_doc, grobid)`` — ưu tiên GROBID bibliography (chuẩn hoá từ
       TEI XML), dùng regex parser fallback cho text-only. Trả unified ``Document``
       với body/bibliography/appendix + citations + sections.

References:
    v1.2 §3.4 (Full-text extraction + GROBID)
    v1.2 §5.2 (DocumentParser scaffold — tuần 8)
    config.extraction.grobid.{enabled, url, timeout_seconds}
"""

from __future__ import annotations

import logging
import re
import time
import tracemalloc
from dataclasses import dataclass, field
from pathlib import Path

from integrity_checker.config import Settings, get_settings
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.extraction.grobid_adapter import link_body_citations_to_grobid
from integrity_checker.extraction.grobid_parser import (
    GrobidOutput,
    call_grobid_fulltext,
    parse_tei,
)
from integrity_checker.extraction.grobid_service import get_grobid_manager
from integrity_checker.extraction.mupdf_parser import MuPdfParser
from integrity_checker.extraction.pdfplumber_parser import PdfPlumberParser
from integrity_checker.extraction.reference_parser import (
    ReferenceListParser,
    parse_bib_or_ris_content,
)
from integrity_checker.extraction.section_segmenter import (
    DocumentSection,
    SectionSegmenter,
    SectionType,
)
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

logger = logging.getLogger(__name__)


def _set_fallback_warning(
    grobid_manager, grobid_status: str, warnings: list[str]
) -> str:
    """Set fallback warning and update grobid_status."""
    if grobid_manager:
        status = grobid_manager.check_health()
        if status.value == "unhealthy":
            grobid_status = "unhealthy"
            warnings.append("GROBID unhealthy — container running but API not responding")
        elif status.value == "stopped":
            grobid_status = "stopped"
            warnings.append("GROBID container stopped — fallback to regex")
        else:
            grobid_status = "unknown"
            warnings.append(f"GROBID status: {status.value} — fallback to regex")
    else:
        grobid_status = "unavailable"
        warnings.append("GROBID not available — fallback to regex")
    return grobid_status


@dataclass
class ParsedDocument:
    """Document đã được parse + segment + extract — output chính của DocumentParser.

    Attributes:
        document: raw ``Document`` (text + pages + metadata) từ PyMuPDF.
        sections: ``DocumentSection[]`` từ SectionSegmenter (body / bibliography /
            appendix). Rỗng nếu segment fail.
        body_citations: citation in-text ở body sections (Citation[]).
        references: citation ở bibliography section (Citation[]).
        appendix_citations: citation ở appendix section (Citation[]) — out-of-scope
            MVP nhưng vẫn track.
        grobid: GrobidOutput nếu GROBID available; None nếu fail/disabled.
        parser_warnings: list[str] các vấn đề phát hiện (fallback chain, v.v.).
        parser_used: str — 'grobid', 'regex', 'hybrid' tùy parser nào được dùng.
        grobid_status: str — 'available', 'unavailable', 'disabled', 'unknown'.
    """

    document: Document
    sections: list[DocumentSection] = field(default_factory=list)
    body_citations: list[Citation] = field(default_factory=list)
    references: list[Citation] = field(default_factory=list)
    appendix_citations: list[Citation] = field(default_factory=list)
    grobid: GrobidOutput | None = None
    parser_warnings: list[str] = field(default_factory=list)
    parser_used: str = "unknown"
    grobid_status: str = "unknown"

    @property
    def has_grobid(self) -> bool:
        """True nếu GROBID thành công (không phải fallback)."""
        return self.grobid is not None and self.grobid.is_available

    @property
    def body_text(self) -> str:
        """Ghép text từ body sections (để downstream pipeline đọc)."""
        return "\n\n".join(
            s.text for s in self.sections if s.section_type == SectionType.BODY
        )

    @property
    def bibliography_text(self) -> str:
        """Ghép text từ bibliography section."""
        return "\n\n".join(
            s.text
            for s in self.sections
            if s.section_type == SectionType.BIBLIOGRAPHY
        )


class DocumentParser:
    """Orchestrator fuse PyMuPDF + GROBID + SectionSegmenter → ParsedDocument.

    Strategy (v1.2 §3.4):
        1. PyMuPDF ALWAYS chạy (text layer fallback).
        2. GROBID nếu enabled — ưu tiên cho bibliography (TEI XML chuẩn hoá).
        3. SectionSegmenter dùng text từ PyMuPDF (GROBID section text là bonus).
        4. CitationExtractor chạy trên body sections → body_citations.
        5. ReferenceListParser chạy trên bibliography:
            - ưu tiên GROBID bibliography (nếu có)
            - fallback regex parser trên PyMuPDF text
        6. Nếu cả 2 fail → trả ParsedDocument với warnings + section rỗng.
    """

    def __init__(
        self,
        config: Settings | None = None,
        *,
        mupdf_parser: MuPdfParser | None = None,
        pdfplumber_parser: PdfPlumberParser | None = None,
        docx_parser: DocxParser | None = None,
        grobid_post_fn=None,
    ) -> None:
        """Khởi tạo DocumentParser.

        Args:
            config: Settings instance; mặc định lấy từ ``get_settings()``.
            mupdf_parser: optional MuPdfParser instance (cho test injection).
            pdfplumber_parser: optional PdfPlumberParser instance (fallback khi MuPdfParser fail).
            docx_parser: optional DocxParser instance (cho .docx files).
            grobid_post_fn: optional HTTP POST callable (cho test injection).
        """
        self.config = config or get_settings()
        self._mupdf_parser = mupdf_parser or MuPdfParser()
        self._pdfplumber_parser = pdfplumber_parser or PdfPlumberParser()
        self._docx_parser = docx_parser or DocxParser()
        self._grobid_post_fn = grobid_post_fn
        self._section_segmenter = SectionSegmenter()
        # Preserve every in-text occurrence for report counts.  The pipeline
        # still deduplicates retrieval/verification work separately.
        self._citation_extractor = CitationExtractor(preserve_occurrences=True)
        self._reference_parser = ReferenceListParser()

    # ---------- Public API ----------

    def parse(self, pdf_path: str, use_service_manager: bool = True) -> ParsedDocument:
        """Parse PDF end-to-end → ParsedDocument.

        Args:
            pdf_path: absolute path tới PDF.
            use_service_manager: Nếu True, sử dụng GrobidServiceManager để check
                                 health và sử dụng cache.

        Returns:
            ParsedDocument với sections + citations + grobid (optional).
            Không raise — fail chain được ghi vào ``parser_warnings``.
        """
        warnings: list[str] = []
        parser_used = "unknown"
        grobid_status = "unknown"
        bib_ris_ext = self._is_bib_or_ris_file(pdf_path)
        if bib_ris_ext is not None:
            return self._parse_bib_or_ris_document(pdf_path, bib_ris_ext)
        is_docx = self._is_docx_file(pdf_path)

        t_parse_start = time.perf_counter()
        if tracemalloc.is_tracing():
            tracemalloc.reset_peak()
            mem_parse_base, _ = tracemalloc.get_traced_memory()
        else:
            mem_parse_base = 0

        # 1. Native DOCX or PyMuPDF (with PdfPlumberParser fallback)
        mupdf_failed = False
        try:
            text_doc = self._load_pdf_text(pdf_path)
            if is_docx:
                parser_used = "docx"
                grobid_status = "disabled"
        except Exception as exc:  # noqa: BLE001
            mupdf_failed = True
            logger.warning("Document parse failed: %s", exc)
            warnings.append(f"PyMuPDF failed: {exc}")
            text_doc = None
            if not is_docx:
                try:
                    plumber_doc = self._pdfplumber_parser.parse(pdf_path)
                    if plumber_doc and (plumber_doc.num_pages > 0 or plumber_doc.pages):
                        text_doc = plumber_doc
                        warnings.append("Fallback to PdfPlumberParser succeeded")
                except Exception as plumber_exc:  # noqa: BLE001
                    logger.warning("PdfPlumber fallback failed: %s", plumber_exc)
                    warnings.append(f"PdfPlumber fallback failed: {plumber_exc}")
            if text_doc is None:
                text_doc = Document(
                    file_path=pdf_path,
                    num_pages=0,
                    pages=[],
                    parser_used="mupdf_fallback_empty",
                    errors=[str(exc)],
                )
            parser_used = "regex"  # Fallback to regex since PyMuPDF failed

        total_chars = sum(len((p.text or "").strip()) for p in (text_doc.pages or []))
        doc_meta = dict(text_doc.metadata or {})
        if (
            not is_docx
            and not mupdf_failed
            and not doc_meta.get("is_scanned_pdf")
            and (text_doc.num_pages == 0 or not text_doc.pages or total_chars == 0)
        ):
            try:
                plumber_doc = self._pdfplumber_parser.parse(pdf_path)
                plumber_chars = sum(len((p.text or "").strip()) for p in (plumber_doc.pages or []))
                if plumber_chars > total_chars or (text_doc.num_pages == 0 and plumber_doc.num_pages > 0):
                    text_doc = plumber_doc
                    total_chars = plumber_chars
                    doc_meta = dict(text_doc.metadata or {})
                    warnings.append("PyMuPDF returned empty text — fell back to PdfPlumberParser")
            except Exception as plumber_exc:  # noqa: BLE001
                logger.debug("PdfPlumber fallback on empty document failed: %s", plumber_exc)
        is_scanned_pdf = bool(
            not is_docx
            and (
                doc_meta.get("is_scanned_pdf")
                or (text_doc.num_pages > 0 and total_chars / max(1, len(text_doc.pages or [])) < 55.0)
            )
        )
        is_scanned_empty_pdf = bool(
            not is_docx
            and text_doc.num_pages > 0
            and total_chars == 0
            and self._grobid_post_fn is None
        )
        if is_scanned_pdf:
            scanned_pages = sum(1 for p in (text_doc.pages or []) if len((p.text or "").strip()) < 40)
            avg_chars = round(total_chars / max(1, len(text_doc.pages or [])), 1)
            doc_meta["is_scanned_pdf"] = True
            doc_meta["scanned_pages_count"] = int(doc_meta.get("scanned_pages_count", scanned_pages))
            doc_meta["total_extractable_chars"] = int(doc_meta.get("total_extractable_chars", total_chars))
            doc_meta["avg_chars_per_page"] = float(doc_meta.get("avg_chars_per_page", avg_chars))
            doc_meta["warning_code"] = "SCANNED_PDF_DETECTED"
            doc_meta["warning_message"] = (
                doc_meta.get("warning_message")
                or "Phát hiện tài liệu PDF dạng ảnh quét (Scanned/Image-only PDF) thiếu lớp văn bản số hóa (Text Layer). "
                "Vui lòng chuyển đổi qua OCR hoặc tải lên bản gốc .docx / PDF xuất trực tiếp từ Word/LaTeX để đạt độ chính xác kiểm chứng trích dẫn tối đa."
            )
            text_doc.metadata = doc_meta
            warnings.append(
                f"SCANNED_PDF_DETECTED: Document contains {doc_meta['scanned_pages_count']}/{max(1, len(text_doc.pages or []))} scanned/image-only pages "
                f"(avg {doc_meta['avg_chars_per_page']} chars/page)."
            )
        if is_scanned_empty_pdf:
            warnings.append(
                "SCANNED_PDF_NO_TEXT_LAYER: Document has pages but 0 extractable text characters; OCR is required."
            )
            parser_used = "regex"
            grobid_status = "unavailable"

        # 2. GROBID (optional, skipped for native .docx XML)
        grobid_out: GrobidOutput | None = None

        # Try to use GrobidServiceManager for better integration
        grobid_manager = None
        if (
            not is_docx
            and not is_scanned_empty_pdf
            and use_service_manager
            and self._grobid_post_fn is None
            and self.config.extraction.grobid.enabled
        ):
            try:
                grobid_manager = get_grobid_manager()
            except Exception as exc:
                logger.debug("GrobidServiceManager not available: %s", exc)

        if not is_docx and not is_scanned_empty_pdf and self.config.extraction.grobid.enabled:
            try:
                # 1. Try disk cache first (does not require live container health check)
                cached_tei = grobid_manager.get_from_cache(pdf_path) if grobid_manager else None
                if cached_tei:
                    logger.info("Using cached TEI XML for: %s", pdf_path)
                    grobid_out = parse_tei(cached_tei)
                    if grobid_out and grobid_out.is_available:
                        grobid_status = "available"
                        parser_used = "grobid"

                # 2. If cache miss (or invalid cache), call GROBID service or injected mock
                if grobid_out is None or not grobid_out.is_available:
                    grobid_available = bool(
                        grobid_manager and grobid_manager.check_health().value == "available"
                    )

                    if grobid_available:
                        grobid_status = "available"
                        parser_used = "grobid"
                        grobid_out = self._load_grobid_tei(pdf_path, grobid_manager)

                        # Save to cache if successful
                        if grobid_out and grobid_out.is_available:
                            tei_xml = grobid_out.raw_tei_xml
                            if tei_xml:
                                grobid_manager.save_to_cache(pdf_path, tei_xml)

                    else:
                        # GROBID not available via service manager
                        # Still try via injected grobid_post_fn (for tests/mock)
                        if self._grobid_post_fn is not None:
                            # Use injected mock/test function
                            grobid_out = self._load_grobid_tei(pdf_path)
                            if grobid_out and grobid_out.is_available:
                                grobid_status = "available"
                                parser_used = "grobid"
                            else:
                                grobid_status = _set_fallback_warning(grobid_manager, grobid_status, warnings)
                                parser_used = "regex"
                        else:
                            grobid_status = _set_fallback_warning(grobid_manager, grobid_status, warnings)
                            parser_used = "regex"

                if grobid_out is None or not grobid_out.is_available:
                    if not grobid_out:
                        grobid_out = GrobidOutput(is_available=False, error_message="GROBID processing failed")
                    if not any("GROBID" in w for w in warnings):
                        warnings.append(f"GROBID processing failed: {grobid_out.error_message or 'unknown error'}")
                    if grobid_status == "available":
                        grobid_status = "fallback"
                    parser_used = "regex"

            except Exception as exc:  # noqa: BLE001
                logger.warning("GROBID failed: %s", exc)
                warnings.append(f"GROBID failed: {exc}")
                grobid_out = None
                parser_used = "regex"
                grobid_status = "error"
        elif is_docx:
            parser_used = "docx"
            grobid_status = "disabled"
        else:
            warnings.append("GROBID disabled in config")
            parser_used = "regex"
            grobid_status = "disabled"

        # 3. Merge
        doc_meta_pre = dict(text_doc.metadata or {})
        doc_meta_pre["_t_parse_start"] = t_parse_start
        doc_meta_pre["_mem_parse_base"] = mem_parse_base
        text_doc.metadata = doc_meta_pre
        parsed = self._merge(text_doc, grobid_out)
        parsed.parser_warnings = warnings
        parsed.parser_used = parser_used
        parsed.grobid_status = grobid_status
        return parsed

    # ---------- Step 1: PyMuPDF / DOCX / BibTeX / RIS ----------

    def _is_bib_or_ris_file(self, file_path: str) -> str | None:
        """Detect .bib or .ris files via extension."""
        lower_path = str(file_path).lower()
        if lower_path.endswith(".bib"):
            return ".bib"
        if lower_path.endswith(".ris"):
            return ".ris"
        return None

    def _parse_bib_or_ris_document(self, file_path: str, ext: str) -> ParsedDocument:
        """Parse a .bib or .ris file into a structured ParsedDocument."""
        t0 = time.perf_counter()
        if tracemalloc.is_tracing():
            tracemalloc.reset_peak()
            mem_base, _ = tracemalloc.get_traced_memory()
        else:
            mem_base = 0
        p = Path(file_path)
        raw_text = p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""
        t_after_read = time.perf_counter()
        parsing_peak_mb = 0.0
        if tracemalloc.is_tracing():
            _, peak_parse = tracemalloc.get_traced_memory()
            parsing_peak_mb = max(0.0, (peak_parse - mem_base) / (1024.0 * 1024.0))
            tracemalloc.reset_peak()
            mem_ext_base, _ = tracemalloc.get_traced_memory()
        else:
            mem_ext_base = 0
        all_citations = parse_bib_or_ris_content(raw_text, ext)
        body_citations = [
            c
            for c in all_citations
            if c.citation_type in (CitationType.IN_TEXT, CitationType.NUMERIC)
        ]
        references = [
            c for c in all_citations if c.citation_type == CitationType.REFERENCE_LIST
        ]
        t_after_extract = time.perf_counter()
        extracting_peak_mb = 0.0
        if tracemalloc.is_tracing():
            _, peak_ext = tracemalloc.get_traced_memory()
            extracting_peak_mb = max(0.0, (peak_ext - mem_ext_base) / (1024.0 * 1024.0))
        body_text = "\n".join(c.raw_text for c in body_citations)
        bib_text = "References\n" + "\n".join(c.raw_text for c in references)
        page_text = f"{body_text}\n\n{bib_text}".strip() or raw_text
        parser_name = "bibtex" if ext == ".bib" else "ris"

        text_doc = Document(
            file_path=file_path,
            num_pages=1,
            pages=[Page(page_num=1, text=page_text, has_text_layer=True)],
            metadata={
                "is_scanned_pdf": False,
                "file_format": ext.lstrip("."),
                "_step_telemetry": {
                    "parsing_ms": max(0.001, (t_after_read - t0) * 1000.0),
                    "extracting_ms": max(0.001, (t_after_extract - t_after_read) * 1000.0),
                    "parsing_peak_mb": float(parsing_peak_mb),
                    "extracting_peak_mb": float(extracting_peak_mb),
                },
            },
            parser_used=parser_name,
        )
        sections = [
            DocumentSection(
                section_type=SectionType.BODY,
                start_page=1,
                end_page=1,
                text=body_text,
            ),
            DocumentSection(
                section_type=SectionType.BIBLIOGRAPHY,
                start_page=1,
                end_page=1,
                text=bib_text,
            ),
        ]
        return ParsedDocument(
            document=text_doc,
            sections=sections,
            body_citations=body_citations,
            references=references,
            appendix_citations=[],
            grobid=None,
            parser_warnings=[],
            parser_used=parser_name,
            grobid_status="disabled",
        )

    def _is_docx_file(self, file_path: str) -> bool:
        """Detect .docx files via extension or ZIP magic header."""
        if str(file_path).lower().endswith(".docx"):
            return True
        try:
            p = Path(file_path)
            if p.is_file():
                with p.open("rb") as f:
                    header = f.read(4)
                return header == b"PK\x03\x04"
        except Exception:  # noqa: BLE001
            pass
        return False

    def _load_pdf_text(self, pdf_path: str) -> Document:
        """Load PDF qua PyMuPDF hoặc .docx qua DocxParser → Document."""
        if self._is_docx_file(pdf_path):
            return self._docx_parser.parse(pdf_path)
        return self._mupdf_parser.parse(pdf_path)

    # ---------- Step 2: GROBID ----------

    def _load_grobid_tei(
        self,
        pdf_path: str,
        grobid_manager=None,
    ) -> GrobidOutput | None:
        """Gọi GROBID → parse TEI XML → GrobidOutput.

        Args:
            pdf_path: Path to PDF file.
            grobid_manager: Optional GrobidServiceManager for caching.

        Returns:
            GrobidOutput nếu thành công (``is_available=True``).
            ``None`` nếu GROBID không enabled / fail / empty TEI.
        """
        if not self.config.extraction.grobid.enabled:
            return None

        # Use grobid_manager if provided
        if grobid_manager:
            tei_xml = grobid_manager.process_pdf(pdf_path)
        else:
            tei_xml = call_grobid_fulltext(
                pdf_path,
                self.config.extraction.grobid,
                http_post_fn=self._grobid_post_fn,
            )

        if not tei_xml:
            return GrobidOutput(
                is_available=False,
                error_message="empty TEI XML from GROBID",
            )

        out = parse_tei(tei_xml)
        return out

    # ---------- Step 3: Merge ----------

    def _merge(
        self,
        text_doc: Document,
        grobid: GrobidOutput | None,
    ) -> ParsedDocument:
        """Fuse text + GROBID → ParsedDocument.

        Sections: dùng SectionSegmenter trên text_doc (consistent với sections
        body/bibliography/appendix).
        Citations: CitationExtractor trên body sections.
        References: ưu tiên GROBID bibliography → fallback regex.
        """
        # 3.1 Sections từ text_doc
        raw_meta = dict(text_doc.metadata or {})
        t_parse_start = float(raw_meta.pop("_t_parse_start", time.perf_counter()))
        mem_parse_base = int(raw_meta.pop("_mem_parse_base", 0))
        sections = self._section_segmenter.segment(text_doc)
        t_parse_end = time.perf_counter()
        parsing_peak_mb = 0.0
        if tracemalloc.is_tracing():
            _, peak_parse = tracemalloc.get_traced_memory()
            parsing_peak_mb = max(0.0, (peak_parse - mem_parse_base) / (1024.0 * 1024.0))
            tracemalloc.reset_peak()
            mem_ext_base, _ = tracemalloc.get_traced_memory()
        else:
            mem_ext_base = 0

        t_extract_start = time.perf_counter()
        # 3.2 Body citations (regex trên body sections)
        body_citations = self._extract_body_citations(sections, text_doc)

        # 3.3 References (ưu tiên GROBID, fallback regex)
        references = self._extract_references(sections, grobid, text_doc)

        # 3.3b MLA reference-guided in-text extraction (for MLA documents with page-less
        # parentheticals like "(Felson)", "(Goodreads)", or narrative "George Athas ... (260)")
        mla_body_count = sum(1 for c in body_citations if c.style == CitationStyle.MLA)
        num_body_count = sum(1 for c in body_citations if c.citation_type == CitationType.NUMERIC)
        if (
            references
            and mla_body_count > 0
            and (
                any(r.style == CitationStyle.MLA for r in references)
                or mla_body_count >= num_body_count
            )
        ):
            guided = self._extract_mla_reference_guided_citations(
                sections, text_doc, body_citations, references
            )
            if guided:
                body_citations.extend(guided)

        # 3.3c Chicago Notes & Bibliography footnote extraction (BUG-02 & BUG-18)
        if references:
            body_citations = self._extract_chicago_footnote_citations(
                sections, text_doc, body_citations, references
            )
            body_citations = self._extract_vn_legal_and_footnote_citations(
                sections, text_doc, body_citations, references
            )
            body_citations = self._extract_attached_superscript_citations(
                sections, text_doc, body_citations, references
            )
            body_citations = self._extract_alpha_bracket_citations(
                sections, text_doc, body_citations, references
            )
            comp_guided = self._extract_body_citations_for_composite_refs(
                sections,
                references,
                source_doc=text_doc,
                existing_body=body_citations,
            )
            if comp_guided:
                body_citations.extend(comp_guided)

        # 3.3d GROBID TEI targets → regex body citations (Stage 1 TEI_LINK in
        # CitationLinker). No-op when GROBID output is unavailable.
        if grobid is not None and grobid.is_available and body_citations:
            try:
                link_body_citations_to_grobid(body_citations, grobid, references)
            except Exception as exc:  # noqa: BLE001 — never break parsing
                logger.warning("GROBID TEI body linking failed: %s", exc)

        # 3.4 Appendix citations (chỉ track, không analyse)
        appendix_citations = self._extract_appendix_citations(sections, text_doc)
        t_extract_end = time.perf_counter()
        extracting_peak_mb = 0.0
        if tracemalloc.is_tracing():
            _, peak_ext = tracemalloc.get_traced_memory()
            extracting_peak_mb = max(0.0, (peak_ext - mem_ext_base) / (1024.0 * 1024.0))

        raw_meta["_step_telemetry"] = {
            "parsing_ms": max(0.001, (t_parse_end - t_parse_start) * 1000.0),
            "extracting_ms": max(0.001, (t_extract_end - t_extract_start) * 1000.0),
            "parsing_peak_mb": float(parsing_peak_mb),
            "extracting_peak_mb": float(extracting_peak_mb),
        }
        text_doc.metadata = raw_meta

        return ParsedDocument(
            document=text_doc,
            sections=sections,
            body_citations=body_citations,
            references=references,
            appendix_citations=appendix_citations,
            grobid=grobid,
        )

    # ---------- Helpers ----------

    def _extract_body_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
    ) -> list[Citation]:
        """Run CitationExtractor trên body sections, PAGE BY PAGE.

        ``DocumentSection`` only stores concatenated text, so we rebuild a
        per-page ``Document`` from ``source_doc`` to keep every citation's
        TRUE page number.  A section-wide synthetic page (the previous
        behaviour) reported every body citation as living on page 1, which
        made "cited on pages …" meaningless.  Each real page is passed through
        once, so an occurrence is still emitted once per literal appearance.
        """
        citations: list[Citation] = []
        by_page = {p.page_num: p for p in source_doc.pages}
        has_real_bib_section = any(
            s.section_type == SectionType.BIBLIOGRAPHY
            and not (s.metadata or {}).get("synthetic_footnote_bibliography")
            for s in sections
        )
        for section in sections:
            if section.section_type != SectionType.BODY:
                continue
            try:
                page_nums = [
                    n
                    for n in sorted(by_page)
                    if section.start_page <= n <= section.end_page
                    and by_page[n].text
                ]
                if not page_nums:
                    continue
                doc = Document(
                    file_path="",
                    num_pages=max(page_nums),
                    pages=[by_page[n] for n in page_nums],
                )
                citations.extend(
                    self._citation_extractor.extract_from_document(
                        doc, stop_at_bibliography=not has_real_bib_section
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Body citation extraction failed: %s", exc)

        # Also extract body citations from the top half of a page where the
        # Bibliography header starts mid-page (below the conclusion paragraph).
        for section in sections:
            if section.section_type != SectionType.BIBLIOGRAPHY:
                continue
            pre_body = (section.metadata or {}).get("pre_header_body_text")
            pre_pnum = (section.metadata or {}).get("pre_header_page_num") or section.start_page
            if pre_body:
                try:
                    pre_doc = Document(
                        file_path="",
                        num_pages=pre_pnum,
                        pages=[Page(page_num=pre_pnum, text=pre_body, has_text_layer=True)],
                    )
                    citations.extend(self._citation_extractor.extract_from_document(pre_doc))
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Pre-header body citation extraction failed: %s", exc)
        return citations

    def _extract_body_citations_for_composite_refs(
        self,
        sections: list[DocumentSection],
        references: list[Citation],
        *,
        source_doc: Document | None = None,
        existing_body: list[Citation] | None = None,
    ) -> list[Citation]:
        """Extract parenthetical composite sub-reference callouts like ``(14b)``, ``(14a, 14c)``, ``(14a–c)``
        when the bibliography contains composite sub-references."""
        composite_nums = {
            r.numeric_index
            for r in (references or [])
            if getattr(r, "sub_index", None) and r.numeric_index is not None
        }
        if not composite_nums:
            return []

        all_bib_nums = {
            r.numeric_index for r in (references or []) if r.numeric_index is not None
        }
        comp_labels_in_bib = {
            str(r.composite_label).lower()
            for r in (references or [])
            if getattr(r, "composite_label", None)
        }
        paren_comp_re = re.compile(
            r"(?<![A-Za-z0-9_])\(\s*"
            r"([1-9]\d{0,2}[a-z](?:\s*[-–—−]\s*(?:[1-9]\d{0,2})?[a-z])?"
            r"(?:\s*,\s*(?:[1-9]\d{0,2}[a-z]?|[a-z])(?:\s*[-–—−]\s*(?:[1-9]\d{0,2})?[a-z])?)*)"
            r"\s*\)"
        )
        bracket_comp_re = re.compile(
            r"(?<![A-Za-z0-9_])\[\s*"
            r"([1-9]\d{0,2}[a-z]?(?:\s*[-–—−]\s*(?:[1-9]\d{0,2})?[a-z]?)?"
            r"(?:\s*,\s*(?:[1-9]\d{0,2}[a-z]?|[a-z])(?:\s*[-–—−]\s*(?:[1-9]\d{0,2})?[a-z]?)?)*)"
            r"\s*\]"
        )

        def _has_disallowed_unit_token(spec: str) -> bool:
            if any(
                (m_r.group(2) or m_r.group(4)) and int(m_r.group(1)) != int(m_r.group(3))
                for m_r in re.finditer(r"(\d+)([a-z]?)\s*[-–—−]\s*(\d+)([a-z]?)", spec)
            ):
                return True
            pairs = re.findall(r"(\d+)([a-z])", spec)
            if not pairs:
                return True
            for n_str, sub_ch in pairs:
                n_val = int(n_str)
                lbl = f"{n_val}{sub_ch}"
                if lbl in comp_labels_in_bib:
                    continue
                if n_val not in composite_nums:
                    return True
                if sub_ch in {"h", "m", "s", "v", "w", "k", "l", "n", "p", "t", "u", "x", "z"} or (
                    sub_ch == "g" and n_val <= 6
                ):
                    return True
            return False
        _non_cit_head = (
            r"(?:Figures?|Figs?\.?|Tables?|Tabs?\.?|Schemes?|Schs?\.?|Charts?|"
            r"Compounds?|Compds?\.?|Structures?|Products?|Intermediates?|"
            r"Isomers?|Enantiomers?|Diastereomers?|Conformers?|Tautomers?|"
            r"Ligands?|Catalysts?|Complex(?:es)?|Monomers?|Polymers?|Oligomers?|"
            r"Substrates?|Reagents?|Derivatives?|Analog(?:ue)?s?|Adducts?|Precursors?|"
            r"Salts?|Ketones?|Aldehydes?|Esters?|Amides?|Amines?|Imides?|Imines?|"
            r"Alcohols?|Acids?|Phenols?|Ethers?|Epoxides?|Lactones?|Lactams?|"
            r"Halides?|Fluorides?|Chlorides?|Bromides?|Iodides?|Triflates?|Tosylate|"
            r"Alkenes?|Alkynes?|Alkanes?|Arenes?|Heteroarenes?|Indoles?|Pyridines?|Quinolines?|"
            r"Silanes?|Boranes?|Phosphines?|Thiols?|Sulfides?|Sulfones?|Sulfoxides?|Nitriles?|"
            r"Equations?|Eqs?\.?|Formulas?|Sections?|Secs?\.?|Chapters?|Chaps?\.?|"
            r"Parts?|Steps?|Entries|Entry|Pathways?|Routes?|Cycles?|States?|Modes?|Models?|"
            r"Hình|Bảng|Sơ\s+đồ|Hợp\s+chất|Chất|Dẫn\s+xuất|Công\s+thức|Phương\s+trình)"
        )
        _bracket_non_cit_head = (
            r"(?:Figures?|Figs?\.?|Tables?|Tabs?\.?|Schemes?|Schs?\.?|Charts?|"
            r"Compounds?|Compds?\.?|Structures?|Isomers?|Enantiomers?|Diastereomers?|"
            r"Conformers?|Tautomers?|Equations?|Eqs?\.?|Formulas?|Sections?|Secs?\.?|"
            r"Chapters?|Chaps?\.?|Parts?|Steps?|Entries|Entry|Algorithms?|Algs?\.?|"
            r"Theorems?|Lemmas?|Appendix|"
            r"Hình|Bảng|Sơ\s+đồ|Hợp\s+chất|Công\s+thức|Phương\s+trình)"
        )
        non_cit_prefix_re = re.compile(
            rf"\b{_non_cit_head}\s+"
            rf"(?:(?:\(\s*[1-9]\d{{0,2}}[a-z][^()]*\)|\[\s*[1-9]\d{{0,2}}[a-z][^\[\]]*\])\s*"
            rf"(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or|&|to|vs\.?)\s+|[-–—]\s*))*$",
            flags=re.IGNORECASE,
        )
        bracket_non_cit_prefix_re = re.compile(
            rf"\b{_bracket_non_cit_head}\s+"
            rf"(?:(?:\(\s*[1-9]\d{{0,2}}[a-z][^()]*\)|\[\s*[1-9]\d{{0,2}}[a-z][^\[\]]*\])\s*"
            rf"(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or|&|to|vs\.?)\s+|[-–—]\s*))*$",
            flags=re.IGNORECASE,
        )

        existing_raw_by_page = {
            (c.page_num, re.sub(r"\s+", " ", (c.raw_text or "").strip()))
            for c in (existing_body or [])
        }
        by_page = {p.page_num: p for p in (source_doc.pages if source_doc else [])}
        extracted: list[Citation] = []

        for section in sections:
            page_chunks: list[tuple[int, str]] = []
            if section.section_type == SectionType.BODY:
                if by_page:
                    for pnum in sorted(by_page):
                        if section.start_page <= pnum <= section.end_page and by_page[pnum].text:
                            page_chunks.append((pnum, by_page[pnum].text))
                if not page_chunks and section.text:
                    page_chunks.append((section.start_page, section.text))
            elif section.section_type == SectionType.BIBLIOGRAPHY:
                pre_body = (section.metadata or {}).get("pre_header_body_text")
                pre_pnum = (section.metadata or {}).get("pre_header_page_num") or section.start_page
                if pre_body:
                    page_chunks.append((pre_pnum, pre_body))
            else:
                continue

            for pnum, txt in page_chunks:
                for m in paren_comp_re.finditer(txt):
                    raw_hit = re.sub(r"\s+", " ", m.group(0).strip())
                    if (pnum, raw_hit) in existing_raw_by_page:
                        continue
                    line_start = txt.rfind("\n", 0, m.start()) + 1
                    line_end = txt.find("\n", m.end())
                    if line_end == -1:
                        line_end = len(txt)
                    line_before = txt[line_start : m.start()]
                    line_after = txt[m.end() : line_end]
                    # Guard against display-equation numbering at end of line: "k_obs = k_1 [A]   (1a)"
                    if (
                        not line_after.strip()
                        and re.search(r"[=≈≡≤≥→↔⇌]", line_before)
                        and not re.search(r"[A-Za-z]{3,}(?:\s+[A-Za-z]{3,}){2,}\s*$", line_before)
                    ):
                        continue
                    para_floor = max(0, txt.rfind("\n\n", 0, m.start()))
                    prefix = re.sub(
                        r"\s+",
                        " ",
                        txt[max(para_floor, m.start() - 100) : m.start()],
                    )
                    if non_cit_prefix_re.search(prefix):
                        continue
                    if _has_disallowed_unit_token(m.group(1)):
                        continue
                    nums_in_hit = [int(n) for n in re.findall(r"\d+", m.group(1))]
                    if not nums_in_hit:
                        continue
                    if not any(n in composite_nums for n in nums_in_hit):
                        continue
                    if not all(n in all_bib_nums for n in nums_in_hit):
                        continue
                    extracted.append(
                        Citation(
                            raw_text=raw_hit,
                            citation_type=CitationType.NUMERIC,
                            style=CitationStyle.ACS,
                            page_num=pnum,
                            matched_pattern="acs_parenthesized_composite",
                            confidence=0.9,
                        )
                    )

                for m in bracket_comp_re.finditer(txt):
                    if not re.search(r"[a-z]", m.group(1)):
                        continue
                    raw_hit = re.sub(r"\s+", " ", m.group(0).strip())
                    if (pnum, raw_hit) in existing_raw_by_page:
                        continue
                    line_start = txt.rfind("\n", 0, m.start()) + 1
                    line_end = txt.find("\n", m.end())
                    if line_end == -1:
                        line_end = len(txt)
                    line_before = txt[line_start : m.start()]
                    line_after = txt[m.end() : line_end]
                    if (
                        not line_after.strip()
                        and re.search(r"[=≈≡≤≥→↔⇌]", line_before)
                        and not re.search(r"[A-Za-z]{3,}(?:\s+[A-Za-z]{3,}){2,}\s*$", line_before)
                    ):
                        continue
                    para_floor = max(0, txt.rfind("\n\n", 0, m.start()))
                    prefix = re.sub(
                        r"\s+",
                        " ",
                        txt[max(para_floor, m.start() - 100) : m.start()],
                    )
                    if bracket_non_cit_prefix_re.search(prefix):
                        continue
                    if _has_disallowed_unit_token(m.group(1)):
                        continue
                    nums_in_hit = [int(n) for n in re.findall(r"\d+", m.group(1))]
                    if not nums_in_hit:
                        continue
                    if not any(n in composite_nums for n in nums_in_hit):
                        continue
                    if not all(n in all_bib_nums for n in nums_in_hit):
                        continue
                    extracted.append(
                        Citation(
                            raw_text=raw_hit,
                            citation_type=CitationType.NUMERIC,
                            style=CitationStyle.IEEE,
                            page_num=pnum,
                            matched_pattern="ieee_numeric_composite",
                            confidence=0.92,
                        )
                    )
        return extracted

    def _extract_mla_reference_guided_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
        existing_body: list[Citation],
        references: list[Citation],
    ) -> list[Citation]:
        """Extract MLA page-less parentheticals and narrative author citations guided by bibliography."""
        def _norm_key(s: str) -> str:
            s = s.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'").lower().strip()
            s = re.sub(r"\s*&\s*", " and ", s)
            s = re.sub(r"\s+", " ", s).strip(" .,;:\"'")
            return s

        key_to_ref_author: dict[str, str] = {}
        initial_surname_to_ref_author: dict[tuple[str, str], str] = {}
        narrative_patterns: list[tuple[re.Pattern[str], str, str]] = []

        for ref in references:
            if not ref.authors:
                continue
            first_a = ref.authors[0]
            first_raw = (
                getattr(first_a, "raw", None)
                or getattr(first_a, "last_name", None)
                or str(first_a)
            ).strip()
            if not first_raw:
                continue

            surname = first_raw.split(",", 1)[0].strip()
            given = first_raw.split(",", 1)[1].strip() if "," in first_raw else ""
            norm_surname = _norm_key(surname)
            if len(norm_surname) >= 3:
                key_to_ref_author.setdefault(norm_surname, first_raw)
                if norm_surname == "barnes" and given.lower().startswith("noble"):
                    key_to_ref_author.setdefault("barnes and noble", first_raw)

            if given and len(norm_surname) >= 3:
                given_first = given.split()[0].rstrip(".")
                if len(given_first) >= 1 and given_first[0].isalpha():
                    initial_surname_to_ref_author.setdefault(
                        (given_first[0].lower(), norm_surname), first_raw
                    )
                if len(given_first) >= 2:
                    full_norm = _norm_key(f"{given_first} {surname}")
                    key_to_ref_author.setdefault(full_norm, first_raw)
                    # Also handle inverted corporate name like "Goblin, Bookish" -> "bookish goblin"
                    inv_norm = _norm_key(f"{given} {surname}")
                    key_to_ref_author.setdefault(inv_norm, first_raw)
                    key_to_ref_author.setdefault(f"the {inv_norm}", first_raw)
                    pat = re.compile(
                        rf"\b{re.escape(given_first)}\s+(?:[A-Z]\.\s+)?{re.escape(surname).replace(chr(39), r'[' + chr(39) + chr(8217) + r']')}\b",
                        re.IGNORECASE,
                    )
                    narrative_patterns.append((pat, norm_surname, first_raw))

            if len(ref.authors) >= 2:
                sec_a = ref.authors[1]
                sec_raw = (
                    getattr(sec_a, "raw", None)
                    or getattr(sec_a, "last_name", None)
                    or str(sec_a)
                ).strip()
                sec_surname = _norm_key(sec_raw.split(",", 1)[0].strip())
                if len(sec_surname) >= 4:
                    key_to_ref_author.setdefault(sec_surname, first_raw)

            if ref.venue:
                v_norm = _norm_key(ref.venue.split(".")[0])
                if 4 <= len(v_norm) <= 45:
                    key_to_ref_author.setdefault(v_norm, first_raw)
                    key_to_ref_author.setdefault(v_norm.removeprefix("the "), first_raw)

            if ref.title and "penguin random house" in ref.title.lower():
                key_to_ref_author.setdefault("prh editors", first_raw)
                key_to_ref_author.setdefault("penguin random house", first_raw)

        by_page = {p.page_num: p for p in source_doc.pages}
        existing_by_page: dict[int, set[str]] = {}
        matched_ref_authors: set[str] = set()
        for c in existing_body:
            existing_by_page.setdefault(c.page_num or 0, set()).add((c.raw_text or "").strip())

        added: list[Citation] = []
        body_page_nums: list[int] = []
        for section in sections:
            if section.section_type != SectionType.BODY:
                continue
            for n in sorted(by_page):
                if section.start_page <= n <= section.end_page and by_page[n].text:
                    if n not in body_page_nums:
                        body_page_nums.append(n)

        for p_num in body_page_nums:
            p_text = re.sub(r"\s+", " ", by_page[p_num].text)
            page_existing = existing_by_page.get(p_num, set())
            for m in re.finditer(r"\(([^()]{2,260})\)", p_text):
                full_paren = m.group(0).strip()
                if full_paren in page_existing:
                    continue
                inside = m.group(1).strip()
                parts = [pt.strip() for pt in inside.split(";") if pt.strip()]
                for pt in parts:
                    pt_key = _norm_key(pt)
                    ref_auth = key_to_ref_author.get(pt_key) or key_to_ref_author.get(
                        pt_key.removeprefix("the ")
                    )
                    if not ref_auth:
                        pt_words = pt_key.split()
                        if len(pt_words) == 2 and pt_words[0]:
                            ref_auth = initial_surname_to_ref_author.get(
                                (pt_words[0][0], pt_words[1])
                            )
                    if ref_auth:
                        raw_cit = f"({pt})"
                        if raw_cit not in page_existing:
                            added.append(
                                Citation(
                                    raw_text=raw_cit,
                                    citation_type=CitationType.IN_TEXT,
                                    style=CitationStyle.MLA,
                                    page_num=p_num,
                                    authors=[ref_auth],
                                    matched_pattern="mla_ref_guided",
                                    confidence=0.85,
                                )
                            )
                            page_existing.add(raw_cit)
                            matched_ref_authors.add(_norm_key(ref_auth.split(",", 1)[0]))

        # Also check narrative "FirstName [M.] LastName" mentions for bibliography authors not yet matched
        for pat, norm_sn, ref_auth in narrative_patterns:
            if norm_sn in matched_ref_authors:
                continue
            for p_num in body_page_nums:
                if pat.search(by_page[p_num].text):
                    raw_cit = f"({ref_auth.split(',', 1)[0].strip()})"
                    added.append(
                        Citation(
                            raw_text=raw_cit,
                            citation_type=CitationType.IN_TEXT,
                            style=CitationStyle.MLA,
                            page_num=p_num,
                            authors=[ref_auth],
                            matched_pattern="mla_ref_guided",
                            confidence=0.85,
                        )
                    )
                    matched_ref_authors.add(norm_sn)
                    break

        return added

    @staticmethod
    def _is_non_footnote_student_or_tech_report(
        source_doc: Document, references: list[Citation]
    ) -> bool:
        """Return True when the document is a student/IT/engineering project report
        that does not cite Vietnamese legal statutes or law-journal footnote literature."""
        if not source_doc or not source_doc.pages:
            return False
        has_vn_legal_or_law_pub = any(
            r.matched_pattern == "vn_legal_document"
            or bool(
                re.search(
                    r"\b(?:Bộ\s+luật|Hiến\s+pháp|Pháp\s+lệnh|Nghị\s+định|Thông\s+tư|Tạp\s+chí\s+Khoa\s+học\s+Pháp\s+lý|Tạp\s+chí\s+Tòa\s+án|Tạp\s+chí\s+Luật\s+học|Nxb\.|Nhà\s+xuất\s+bản)\b",
                    r.raw_text or "",
                    re.IGNORECASE,
                )
            )
            for r in references
        )
        if has_vn_legal_or_law_pub:
            return False
        first_pages = "\n".join(
            (p.text or "") for p in source_doc.pages[: min(6, len(source_doc.pages))]
        )
        return bool(
            re.search(
                r"ĐẠI\s+HỌC\s+TÔN\s+ĐỨC\s+THẮNG|TON\s+DUC\s+THANG\s+UNIVERSITY|"
                r"VIETNAM\s+GENERAL\s+CONFEDERATION\s+OF\s+LABOU?R|TỔNG\s+LIÊN\s+ĐOÀN\s+LAO\s+ĐỘNG|"
                r"FACULTY\s+OF\s+(?:INFORMATION\s+TECHNOLOGY|ELECTRICAL)|KHOA\s+(?:CÔNG\s+NGHỆ\s+THÔNG\s+TIN|ĐIỆN|TOÁN)|"
                r"BÁO\s+CÁO\s+(?:CUỐI\s+KỲ|GIỮA\s+KỲ|ĐỒ\s+ÁN|DỰ\s+ÁN|MÔN\s+HỌC|THỰC\s+TẬP)|"
                r"\b(?:MIDTERM|FINAL)\s+(?:PROJECT|REPORT)\b|MSSV\s*:|Instructing\s+Lecturer|Giảng\s+viên\s+hướng\s+dẫn",
                first_pages,
                re.IGNORECASE,
            )
        )

    def _extract_chicago_footnote_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
        existing_body: list[Citation],
        references: list[Citation],
    ) -> list[Citation]:
        """Extract Chicago Notes & Bibliography bottom-of-page footnotes and linkable citations."""
        import unicodedata

        if self._is_non_footnote_student_or_tech_report(source_doc, references):
            return existing_body

        has_numbered_refs = sum(1 for r in references if r.numeric_index is not None) >= 3
        is_notes_bib = any(
            s.section_type == SectionType.BIBLIOGRAPHY
            and (
                (s.metadata or {}).get("synthetic_footnote_bibliography")
                or bool(
                    re.match(
                        r"^\s*(?:(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+)?(?:notes(?:\s+and\s+references)?|endnotes?)\b",
                        (s.text or "").strip(),
                        re.IGNORECASE,
                    )
                )
            )
            for s in sections
        )
        if has_numbered_refs and sum(1 for c in existing_body if c.citation_type == CitationType.NUMERIC) >= 3:
            return existing_body

        def _fold(s: str) -> str:
            if not s:
                return ""
            s = s.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'")
            s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
            return re.sub(r"\s+", " ", s.lower()).strip()

        by_page = {p.page_num: p for p in source_doc.pages}
        body_page_nums: list[int] = []
        for section in sections:
            if section.section_type != SectionType.BODY:
                continue
            for n in sorted(by_page):
                if section.start_page <= n <= section.end_page and by_page[n].text:
                    if n not in body_page_nums:
                        body_page_nums.append(n)
        if not body_page_nums:
            return existing_body

        # Build reference profiles for footnote matching
        _STOP = {"the", "and", "for", "with", "from", "into", "that", "this", "what", "when", "where", "how", "why"}
        ref_profiles = []
        surname_counts: dict[str, int] = {}
        for idx, ref in enumerate(references):
            first_raw = ""
            clean_last = ""
            if ref.authors:
                a0 = ref.authors[0]
                first_raw = (getattr(a0, "raw", None) or getattr(a0, "last_name", None) or str(a0)).strip()
                clean_last = (getattr(a0, "last_name", None) or "").strip()
            if clean_last and "," not in clean_last:
                surname = clean_last
            elif "," in first_raw:
                surname = first_raw.split(",", 1)[0].strip()
                surname = re.sub(r"\s+[A-Z\.]{1,5}$", "", surname).strip()
            else:
                stripped_init = re.sub(r"\s+[A-Z\.]{1,5}$", "", first_raw).strip()
                if stripped_init != first_raw and stripped_init:
                    surname = stripped_init
                else:
                    parts_raw = first_raw.split()
                    surname = parts_raw[-1] if parts_raw else ""
            given = first_raw.split(",", 1)[1].strip() if "," in first_raw else ""
            sn_fold = _fold(surname)
            gv_fold = _fold(given.split()[0].rstrip(".")) if given else ""
            if sn_fold:
                surname_counts[sn_fold] = surname_counts.get(sn_fold, 0) + 1
            t_fold = _fold(ref.title or "")
            t_words = [
                w for w in re.findall(r"[a-z0-9]{4,}", t_fold)
                if w not in _STOP
            ]
            ref_profiles.append({
                "idx": idx,
                "ref": ref,
                "first_raw": first_raw or (ref.title or ""),
                "surname": surname or (ref.title or ""),
                "sn_fold": sn_fold,
                "gv_fold": gv_fold,
                "t_fold": t_fold,
                "t_words": t_words[:8],
                "url": (ref.url or "").strip().lower(),
                "doi": (ref.doi or "").strip().lower(),
            })

        # Extract numbered footnote blocks from body pages
        fn_blocks: list[tuple[int, int, str]] = []
        fn_starter_re = re.compile(
            r"^\s*(\d{1,3})(?:[\s\u00a0\u202f]+|(?=[A-Z\u201c\"]))(Ibid\.?.*|[A-Z\u201c\"].*)$"
        )
        has_ibid = False
        has_pub_city = 0

        for p_num in body_page_nums:
            lines = [ln.strip() for ln in by_page[p_num].text.splitlines() if ln.strip()]
            in_fn_zone = False
            curr_num: int | None = None
            curr_lines: list[str] = []

            for l_idx, ln in enumerate(lines):
                if re.search(r"\.{4,}", ln):
                    continue
                m = fn_starter_re.match(ln)
                if m:
                    num_val = int(m.group(1))
                    rest_txt = m.group(2).strip()
                    is_ibid_line = bool(re.match(r"^Ibid\b", rest_txt, re.I))
                    looks_like_fn = (
                        is_ibid_line
                        or in_fn_zone
                        or l_idx >= max(2, len(lines) // 3)
                        or "," in rest_txt
                        or "\u201c" in rest_txt
                        or '"' in rest_txt
                        or "http" in rest_txt
                    )
                    if looks_like_fn and not re.match(r"^(?:Introduction|Conclusion|Chapter|Section|Abstract|Methodology|Results|Discussion|Bibliography|References)\b", rest_txt, re.I):
                        if curr_num is not None and curr_lines:
                            fn_blocks.append((p_num, curr_num, " ".join(curr_lines)))
                        in_fn_zone = True
                        curr_num = num_val
                        curr_lines = [rest_txt]
                        if is_ibid_line:
                            has_ibid = True
                        if re.search(r"\([^()]+:\s+[^()]+,\s*(?:18|19|20)\d{2}\)", rest_txt):
                            has_pub_city += 1
                        continue
                if in_fn_zone and curr_num is not None:
                    if re.match(r"^\d{1,3}$", ln):
                        continue
                    curr_lines.append(ln)
                    if re.search(r"\([^()]+:\s+[^()]+,\s*(?:18|19|20)\d{2}\)", ln):
                        has_pub_city += 1

            if curr_num is not None and curr_lines:
                fn_blocks.append((p_num, curr_num, " ".join(curr_lines)))

        # Check how many existing_body citations already match a bibliography author
        existing_matched_count = sum(
            1
            for c in existing_body
            if c.citation_type != CitationType.NUMERIC
            and any(
                prof["sn_fold"] and len(prof["sn_fold"]) >= 3 and prof["sn_fold"] in _fold(c.raw_text)
                for prof in ref_profiles
            )
        )
        min_ad_matches = int(len(references) * 0.90) if len(references) >= 12 else 6
        if existing_matched_count >= max(10, min_ad_matches) or (
            existing_matched_count >= min_ad_matches and not has_ibid and has_pub_city < 2
        ):
            return existing_body

        if not (has_ibid or has_pub_city >= 2 or len(fn_blocks) >= 5 or (len(references) >= 5 and existing_matched_count < min_ad_matches)):
            return existing_body

        def _match_fn_text(fn_txt: str) -> list[dict]:
            f_fold = _fold(fn_txt)
            f_low = fn_txt.lower()
            matched: list[dict] = []
            for prof in ref_profiles:
                if prof["doi"] and prof["doi"] in f_low:
                    matched.append(prof)
                    continue
                if prof["url"] and len(prof["url"]) >= 18 and prof["url"][:36] in f_low:
                    matched.append(prof)
                    continue
                sn = prof["sn_fold"]
                tw = prof["t_words"]
                tf = prof["t_fold"]
                sn_in = bool(sn and len(sn) >= 3 and re.search(rf"\b{re.escape(sn)}\b", f_fold))
                if not sn_in and sn and " " in sn:
                    last_tok = sn.split()[-1]
                    if len(last_tok) >= 4 and re.search(rf"\b{re.escape(last_tok)}\b", f_fold):
                        sn_in = True
                tw_hits = sum(1 for w in tw[:5] if re.search(rf"\b{re.escape(w)}\b", f_fold))
                if sn_in and (
                    tw_hits >= 1
                    or (surname_counts.get(sn, 0) == 1 and len(sn) >= 4)
                    or (prof["gv_fold"] and len(prof["gv_fold"]) >= 2 and re.search(rf"\b{re.escape(prof['gv_fold'])}\b", f_fold))
                ):
                    matched.append(prof)
                    continue
                if tf and len(tf) >= 12:
                    prefix_tf = tf[:min(len(tf), 38)].strip()
                    if len(prefix_tf) >= 12 and prefix_tf in f_fold:
                        matched.append(prof)
                        continue
                    if len(tw) >= 3 and tw_hits >= min(3, len(tw)):
                        matched.append(prof)
                        continue
            return matched

        chicago_cits: list[Citation] = []
        matched_ref_indices: set[int] = set()
        last_matched: list[dict] = []

        for p_num, _fn_num, fn_txt in fn_blocks:
            if re.match(r"^Ibid\b", fn_txt, re.I):
                curr_matched = last_matched[:1]
            else:
                curr_matched = _match_fn_text(fn_txt)
                if curr_matched:
                    last_matched = curr_matched
            for prof in curr_matched:
                ref = prof["ref"]
                matched_ref_indices.add(prof["idx"])
                sn_disp = prof["surname"]
                if is_notes_bib and ref.numeric_index is not None:
                    raw_cit = f"[{ref.numeric_index}]"
                    c_type = CitationType.NUMERIC
                else:
                    raw_cit = f"({sn_disp}, {ref.year})" if ref.year else f"({sn_disp})"
                    c_type = CitationType.IN_TEXT
                chicago_cits.append(
                    Citation(
                        raw_text=raw_cit,
                        citation_type=c_type,
                        style=CitationStyle.CHICAGO,
                        page_num=p_num,
                        authors=[prof["first_raw"]],
                        year=ref.year,
                        year_suffix=ref.year_suffix,
                        title=ref.title,
                        title_normalized=ref.title_normalized,
                        numeric_index=ref.numeric_index if is_notes_bib else None,
                        matched_pattern="chicago_footnote",
                        confidence=0.90,
                    )
                )

        # Pre-mark bibliography profiles already matched by existing in-text citations
        for prof in ref_profiles:
            if prof["sn_fold"] and len(prof["sn_fold"]) >= 3:
                ref_yr_str = str(prof["ref"].year or "")
                if any(
                    prof["sn_fold"] in _fold(c.raw_text)
                    and (not ref_yr_str or not c.year or str(c.year) == ref_yr_str)
                    for c in existing_body
                ):
                    matched_ref_indices.add(prof["idx"])

        # Fallback page scan for bibliography entries whose footnote wrapped across pages or lost its leading number
        for prof in ref_profiles:
            if prof["idx"] in matched_ref_indices:
                continue
            sn = prof["sn_fold"]
            tw = prof["t_words"]
            tf = prof["t_fold"]
            ref_yr_str = str(prof["ref"].year or "")
            for p_num in body_page_nums:
                p_fold = _fold(by_page[p_num].text)
                sn_in = bool(sn and len(sn) >= 3 and re.search(rf"\b{re.escape(sn)}\b", p_fold))
                if not sn_in and sn and " " in sn:
                    last_tok = sn.split()[-1]
                    if len(last_tok) >= 4 and re.search(rf"\b{re.escape(last_tok)}\b", p_fold):
                        sn_in = True
                yr_in = bool(ref_yr_str and len(ref_yr_str) == 4 and re.search(rf"\b{re.escape(ref_yr_str)}\b", p_fold))
                tw_hits = sum(1 for w in tw[:5] if re.search(rf"\b{re.escape(w)}\b", p_fold))
                prefix_tf = tf[:min(len(tf), 35)].strip() if tf else ""
                if (
                    (sn_in and (yr_in or tw_hits >= 1 or (prof["gv_fold"] and len(prof["gv_fold"]) >= 3 and prof["gv_fold"] in p_fold) or (surname_counts.get(sn, 0) == 1 and len(sn) >= 5)))
                    or (len(prefix_tf) >= 14 and prefix_tf in p_fold)
                    or (len(tw) >= 3 and tw_hits >= 3)
                ):
                    ref = prof["ref"]
                    matched_ref_indices.add(prof["idx"])
                    sn_disp = prof["surname"]
                    if is_notes_bib and ref.numeric_index is not None:
                        raw_cit = f"[{ref.numeric_index}]"
                        c_type = CitationType.NUMERIC
                    else:
                        raw_cit = f"({sn_disp}, {ref.year})" if ref.year else f"({sn_disp})"
                        c_type = CitationType.IN_TEXT
                    chicago_cits.append(
                        Citation(
                            raw_text=raw_cit,
                            citation_type=c_type,
                            style=CitationStyle.CHICAGO,
                            page_num=p_num,
                            authors=[prof["first_raw"]],
                            year=ref.year,
                            year_suffix=ref.year_suffix,
                            title=ref.title,
                            title_normalized=ref.title_normalized,
                            numeric_index=ref.numeric_index if is_notes_bib else None,
                            matched_pattern="chicago_footnote",
                            confidence=0.88,
                        )
                    )
                    break

        if not chicago_cits:
            return existing_body

        if existing_matched_count >= 6:
            return existing_body + chicago_cits

        # Keep existing_body citations that are numeric or match a known bibliography author surname
        valid_existing = [
            c for c in existing_body
            if c.citation_type == CitationType.NUMERIC
            or any(
                prof["sn_fold"] and len(prof["sn_fold"]) >= 3 and prof["sn_fold"] in _fold(c.raw_text)
                for prof in ref_profiles
            )
        ]
        return valid_existing + chicago_cits

    def _extract_vn_legal_and_footnote_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
        existing_body: list[Citation],
        references: list[Citation],
    ) -> list[Citation]:
        """Extract in-text Vietnamese legal citations (cited by law name/code in prose)
        and Vietnamese law-journal footnote citations."""
        has_vn_legal = any(r.matched_pattern == "vn_legal_document" for r in references)
        has_vn_trad = any(r.matched_pattern == "vn_traditional_entry" for r in references)
        has_vn_bib = any(
            "tài liệu tham khảo" in (s.text or "").lower()
            for s in sections
            if s.section_type == SectionType.BIBLIOGRAPHY
        )
        if not (has_vn_legal or has_vn_trad or has_vn_bib):
            return existing_body

        by_page = {p.page_num: p for p in source_doc.pages}
        body_page_texts: dict[int, str] = {}
        for section in sections:
            if section.section_type == SectionType.BODY:
                for n in sorted(by_page):
                    if section.start_page <= n <= section.end_page and by_page[n].text:
                        body_page_texts.setdefault(n, by_page[n].text)
            elif section.section_type == SectionType.BIBLIOGRAPHY:
                pre_body = (section.metadata or {}).get("pre_header_body_text")
                pre_pnum = (section.metadata or {}).get("pre_header_page_num") or section.start_page
                if pre_body and pre_pnum:
                    body_page_texts[pre_pnum] = (body_page_texts.get(pre_pnum, "") + "\n" + pre_body).strip()
                # Also include bottom-of-page footnote lines on the bibliography page itself
                # (e.g. "13 Maurice Cozian, Alian Viandier (1988), ..., p.165." below the reference list)
                for n in range(section.start_page, section.end_page + 1):
                    if n in by_page and by_page[n].text:
                        fn_lines = [
                            ln.strip()
                            for ln in by_page[n].text.splitlines()
                            if re.match(r"^\d{1,2}\s+[A-ZÀ-Ý].*(?:\bp\.|\btr\.)\s*\d+", ln.strip(), re.I)
                        ]
                        if fn_lines:
                            body_page_texts[n] = (body_page_texts.get(n, "") + "\n" + "\n".join(fn_lines)).strip()

        if not body_page_texts:
            return existing_body

        _GENERIC_VN_AGENCY_RE = re.compile(
            r"^(?:quốc\s+hội|chính\s+phủ|thủ\s+tướng(?:\s+chính\s+phủ)?|bộ\s+chính\s+trị"
            r"|ban\s+chấp\s+hành\s+trung\s+ương|đảng\s+cộng\s+sản\s+việt\s+nam"
            r"|tòa\s+án\s+nhân\s+dân(?:\s+tối\s+cao|\s+cấp\s+cao)?|viện\s+kiểm\s+sát\s+nhân\s+dân(?:\s+tối\s+cao)?"
            r"|thanh\s+tra\s+chính\s+phủ|văn\s+phòng\s+quốc\s+hội|ủy\s+ban\s+thường\s+vụ\s+quốc\s+hội"
            r"|bộ\s+[\wà-ỹ\s]+|ủy\s+ban\s+[\wà-ỹ\s]+|tổng\s+cục\s+[\wà-ỹ\s]+|ngân\s+hàng\s+nhà\s+nước(?:\s+việt\s+nam)?)$",
            re.IGNORECASE,
        )

        existing_raw_by_page: dict[int, set[str]] = {}
        for c in existing_body:
            p = c.page_num or 0
            existing_raw_by_page.setdefault(p, set()).add((c.raw_text or "").strip().lower())

        added: list[Citation] = []

        for ref in references:
            ref_yr = str(ref.year) if ref.year else None
            if ref.matched_pattern == "vn_legal_document":
                # Collect non-agency legal document names and codes from ref.authors
                legal_terms: list[str] = []
                for a in ref.authors or []:
                    a_raw = (getattr(a, "raw", None) or getattr(a, "last_name", None) or str(a)).strip()
                    if not a_raw or len(a_raw) < 3 or _GENERIC_VN_AGENCY_RE.match(a_raw):
                        continue
                    if a_raw not in legal_terms:
                        legal_terms.append(a_raw)

                if not legal_terms:
                    continue

                for p_num, p_text in sorted(body_page_texts.items()):
                    p_flat = re.sub(r"\s+", " ", p_text)
                    p_low = p_flat.lower()
                    page_existing = existing_raw_by_page.setdefault(p_num, set())
                    # Skip if an existing citation on this page already mentions one of the legal_terms
                    if any(
                        any(t.lower() in ex_raw for t in legal_terms)
                        for ex_raw in page_existing
                    ):
                        continue

                    matched_term: str | None = None
                    for term in legal_terms:
                        has_doc_code = bool(re.search(r"\d+/\d+|\d+\s*-[A-ZĐ]{2,}|\d+/[A-ZĐ]{2,}", term, re.I))
                        if has_doc_code:
                            # Match code with optional "số", interchangeable NQ/TW <-> NQ/TƯ, and optional hyphen in QĐ-TTg
                            code_pat = re.sub(r"\bsố\s+", r"(?:số\\s+)?", re.escape(term), flags=re.I)
                            code_pat = re.sub(r"NQ/(?:TW|TƯ)", r"NQ/(?:TW|TƯ)", code_pat, flags=re.I)
                            code_pat = re.sub(r"QĐ\\-?TTg", r"QĐ-?TTg", code_pat, flags=re.I)
                            if re.search(code_pat, p_flat, re.IGNORECASE):
                                matched_term = term
                                break
                            raw_code_m = re.search(
                                r"\b(\d+/\d+(?:/[A-ZĐ0-9\-]+)?|\d+/[A-ZĐ0-9\-]{2,}|\d+\s*-[A-ZĐ]{2,}/[A-ZĐ0-9\-]+)\b",
                                term,
                                re.I,
                            )
                            if raw_code_m:
                                bare_pat = re.escape(raw_code_m.group(1))
                                bare_pat = re.sub(r"NQ/(?:TW|TƯ)", r"NQ/(?:TW|TƯ)", bare_pat, flags=re.I)
                                bare_pat = re.sub(r"QĐ\\-?TTg", r"QĐ-?TTg", bare_pat, flags=re.I)
                                if re.search(bare_pat, p_flat, re.IGNORECASE):
                                    matched_term = term
                                    break
                        elif ref_yr:
                            # Match "Luật X năm 2020" or "Luật X (2020)" or "Luật X 2020"
                            yr_pat = rf"\b{re.escape(term)}\s*(?:năm\s+|\(\s*|,\s*)?{re.escape(ref_yr)}\b"
                            if re.search(yr_pat, p_flat, re.IGNORECASE):
                                matched_term = term
                                break
                            # Also match standalone law name if it is not followed by a conflicting year
                            if len(term) >= 8 and re.search(rf"\b{re.escape(term)}\b(?!\s*(?:năm\s+|\(\s*)?(?:19|20)\d{{2}})", p_flat, re.IGNORECASE):
                                matched_term = term
                                break
                        else:
                            if len(term) >= 8 and re.search(rf"\b{re.escape(term)}\b", p_flat, re.IGNORECASE):
                                matched_term = term
                                break

                    if matched_term:
                        raw_cit = f"({matched_term}, {ref_yr})" if ref_yr else f"({matched_term})"
                        if raw_cit.lower() not in page_existing:
                            added.append(
                                Citation(
                                    raw_text=raw_cit,
                                    citation_type=CitationType.IN_TEXT,
                                    style=CitationStyle.APA,
                                    page_num=p_num,
                                    authors=[matched_term],
                                    year=ref_yr,
                                    title=ref.title,
                                    title_normalized=ref.title_normalized,
                                    matched_pattern="vn_legal_intext_guided",
                                    confidence=0.90,
                                )
                            )
                            page_existing.add(raw_cit.lower())

            elif (
                not self._is_non_footnote_student_or_tech_report(source_doc, references)
                and (
                    has_vn_trad
                    or len(existing_body) <= 4
                    or (has_vn_bib and len(source_doc.pages or []) >= 4 and len(existing_body) <= 28)
                )
            ):
                # For Vietnamese footnote-style articles, match bibliography author/title in page text/footnotes
                first_raw = ""
                if ref.authors:
                    a0 = ref.authors[0]
                    first_raw = (getattr(a0, "raw", None) or getattr(a0, "last_name", None) or str(a0)).strip()
                title_snip = (
                    ref.title
                    or re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d+[\.\)])\s*", "", ref.raw_text or "")
                ).strip()
                title_prefix = title_snip[:min(len(title_snip), 32)].strip().lower() if len(title_snip) >= 6 else ""
                url_snip = (ref.url or "").strip().lower()[:35] if ref.url and len(ref.url) >= 18 else ""

                for p_num, p_text in sorted(body_page_texts.items()):
                    p_flat = re.sub(r"\s+", " ", p_text)
                    p_low = p_flat.lower()
                    page_existing = existing_raw_by_page.setdefault(p_num, set())
                    auth_hit = False
                    if first_raw and len(first_raw) >= 3:
                        auth_cand = first_raw.split(",")[0].strip() if "," in first_raw else first_raw
                        if (
                            len(auth_cand) >= 3
                            and auth_cand.lower() not in {
                                "wikipedia", "viblo", "geeksforgeeks", "medium", "github",
                                "kaggle", "google", "microsoft", "opencv", "unity", "python",
                                "nodejs", "fastapi", "docker", "undefined", "tác giả: chưa xác định",
                            }
                            and re.search(rf"\b{re.escape(auth_cand.lower())}\b", p_low)
                        ):
                            auth_hit = True
                    title_hit = bool(
                        title_prefix
                        and (
                            title_prefix in p_low if len(title_prefix) >= 14 else re.search(rf"\b{re.escape(title_prefix)}\b", p_low)
                        )
                    )
                    url_hit = bool(url_snip and url_snip in p_low)

                    if auth_hit or title_hit or url_hit:
                        if not first_raw and ref.numeric_index is not None:
                            raw_cit = f"[{ref.numeric_index}]"
                            if raw_cit.lower() not in page_existing:
                                added.append(
                                    Citation(
                                        raw_text=raw_cit,
                                        citation_type=CitationType.NUMERIC,
                                        style=CitationStyle.IEEE,
                                        page_num=p_num,
                                        numeric_index=ref.numeric_index,
                                        title=ref.title,
                                        title_normalized=ref.title_normalized,
                                        matched_pattern="vn_footnote_guided",
                                        confidence=0.88,
                                    )
                                )
                                page_existing.add(raw_cit.lower())
                            continue
                        disp_auth = first_raw or (title_snip[:35] if title_snip else "")
                        if not disp_auth:
                            continue
                        if any(disp_auth.lower() in ex_raw for ex_raw in page_existing):
                            continue
                        raw_cit = f"({disp_auth}, {ref_yr})" if ref_yr else f"({disp_auth})"
                        if raw_cit.lower() not in page_existing:
                            added.append(
                                Citation(
                                    raw_text=raw_cit,
                                    citation_type=CitationType.IN_TEXT,
                                    style=CitationStyle.APA,
                                    page_num=p_num,
                                    authors=[disp_auth],
                                    year=ref_yr,
                                    title=ref.title,
                                    title_normalized=ref.title_normalized,
                                    matched_pattern="vn_footnote_guided",
                                    confidence=0.88,
                                )
                            )
                            page_existing.add(raw_cit.lower())

        return existing_body + added

    def _extract_attached_superscript_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
        existing_body: list[Citation],
        references: list[Citation],
    ) -> list[Citation]:
        """Extract superscript numeric citations flattened by PDF text extraction
        (e.g. 'motility1–9.', 'pathway10.', 'manner14, 15.', 'sepsis.1,2' in Nature/AMA/ACS)."""
        if self._is_non_footnote_student_or_tech_report(source_doc, references):
            return existing_body
        numbered_refs = [r for r in references if r.numeric_index is not None]
        if len(numbered_refs) < 3 or len(numbered_refs) < len(references) // 2:
            return existing_body
        existing_numeric_count = sum(
            1
            for c in existing_body
            if c.citation_type == CitationType.NUMERIC and c.matched_pattern != "chicago_footnote"
        )
        if existing_numeric_count >= 5:
            return existing_body

        max_ref_num = max((r.numeric_index or 0) for r in numbered_refs)
        if max_ref_num < 3:
            return existing_body

        by_page = {p.page_num: p for p in source_doc.pages}
        body_page_texts: dict[int, str] = {}
        for section in sections:
            if section.section_type == SectionType.BODY:
                for n in sorted(by_page):
                    if section.start_page <= n <= section.end_page and by_page[n].text:
                        body_page_texts.setdefault(n, by_page[n].text)
            elif section.section_type == SectionType.BIBLIOGRAPHY:
                pre_body = (section.metadata or {}).get("pre_header_body_text")
                pre_pnum = (section.metadata or {}).get("pre_header_page_num") or section.start_page
                if pre_body and pre_pnum:
                    body_page_texts[pre_pnum] = (body_page_texts.get(pre_pnum, "") + "\n" + pre_body).strip()
                # Also include bottom-of-page footnote lines on the bibliography page itself
                # (e.g. "13 Maurice Cozian, Alian Viandier (1988), ..., p.165." below the reference list)
                for n in range(section.start_page, section.end_page + 1):
                    if n in by_page and by_page[n].text:
                        fn_lines = [
                            ln.strip()
                            for ln in by_page[n].text.splitlines()
                            if re.match(r"^\d{1,2}\s+[A-ZÀ-Ý].*(?:\bp\.|\btr\.)\s*\d+", ln.strip(), re.I)
                        ]
                        if fn_lines:
                            body_page_texts[n] = (body_page_texts.get(n, "") + "\n" + "\n".join(fn_lines)).strip()

        if not body_page_texts:
            return existing_body

        _EXCLUDED_WORDS = {
            "table", "tables", "figure", "figures", "scheme", "schemes", "chart", "charts",
            "model", "models", "step", "steps", "phase", "phases", "stage", "stages",
            "type", "types", "group", "groups", "case", "cases", "part", "parts",
            "page", "pages", "line", "lines", "item", "items", "rule", "rules",
            "test", "tests", "task", "tasks", "user", "users", "node", "nodes",
            "layer", "layers", "block", "blocks", "level", "levels", "class", "classes",
            "grade", "grades", "year", "years", "week", "weeks", "month", "months",
            "appendix", "supplement", "note", "notes", "version", "chapter", "chapters",
            "section", "sections", "cohort", "cluster", "factor", "component", "channel",
            "sample", "subject", "patient", "person", "trial", "visit", "cycle", "round",
            "wave", "tier", "zone", "area", "site", "room", "lane", "port", "slot",
            "core", "mode", "state", "axis", "band", "peak", "form", "code", "file",
            "list", "tree", "grid", "mesh", "cell", "gene", "exon", "intron", "codon",
            "allele", "strain", "clone", "virus", "phage", "motif", "domain", "chain",
            "helix", "sheet", "loop", "turn", "fold", "unit", "ring", "bond", "atom",
            "mpeg", "utf", "int", "uint", "float", "base", "sha", "resnet", "vgg",
            "gpt", "llama", "bert", "http", "https", "html", "xxxx",
            "qwen", "yolo", "yolov", "glucose", "glocose", "router", "switch", "printer",
            "server", "client", "host", "vlan", "giga", "fast", "serial", "loopback",
            "duration", "pin", "pins", "led", "motor", "sensor", "servo", "relay",
            "button", "timer", "spea", "nsga", "moea", "atmega", "arduino", "iperf",
            "sqlite", "urllib", "dhcp", "dhcpv", "icmp", "ospf", "eigrp",
            "overlay", "backend", "worker", "frontend", "replica", "container", "service",
            "instance", "redis", "mysql", "mongo", "postgres", "kafka",
            "broker", "queue", "ports", "fig", "tab", "sec", "vol", "ver", "rgb", "bgr", "hsv", "hex", "cpu", "gpu",
            "ram", "rom", "usb", "lan", "wan", "mac", "tcp", "udp", "dns", "ssh", "ssl",
            "tls", "api", "url", "uri", "sql", "csv", "xml", "yml", "pdf", "png", "jpg",
            "gif", "mp3", "mp4", "wav", "zip", "tar", "jar", "exe", "dll", "lib", "bin",
            "src", "doc", "txt", "log", "cfg", "ini", "env", "opt", "var", "val", "idx",
            "cnt", "num", "len", "min", "max", "avg", "std", "sum", "abs", "cos", "sin",
            "tan", "exp", "pow", "mod", "div", "mul", "add", "sub", "xor", "and", "not",
            "for", "the", "are", "was", "has", "had", "can", "may", "one", "two", "six",
            "ten",
        }

        sup_re = re.compile(
            r"(?<![A-Za-z0-9\-/_])(?P<word>[A-Za-z]{4,}|[a-z]{3}(?=[1-9]\d{0,2}[.,;:]))(?P<punct>[.,])?(?P<nums>[1-9]\d{0,2}(?:\s*[,–\-]\s*[1-9]\d{0,2})*)(?=[.,;:\s)\]]|$)"
        )
        paren_num_re = re.compile(
            r"(?<![A-Za-z0-9\-/_])(?P<word>[a-z]{4,})\s+\((?P<nums>[1-9]\d{0,2}(?:\s*[,–\-]\s*[1-9]\d{0,2})*)\)(?=\s*[.,;:])"
        )

        dominant_style = CitationStyle.NATURE
        style_counts: dict[CitationStyle, int] = {}
        for r in numbered_refs:
            if r.style and r.style != CitationStyle.UNKNOWN:
                style_counts[r.style] = style_counts.get(r.style, 0) + 1
        if style_counts:
            dominant_style = max(style_counts.items(), key=lambda kv: kv[1])[0]

        candidates: list[Citation] = []
        has_multi_or_range = False

        for p_num, p_text in sorted(body_page_texts.items()):
            if re.search(r"^\s*(?:LIST\s+OF\s+(?:FIGURES|TABLES)|TABLE\s+OF\s+CONTENTS|DANH\s+MỤC\s+(?:HÌNH|BẢNG)|MỤC\s+LỤC)\b", p_text, re.IGNORECASE | re.MULTILINE):
                continue
            for pat_re in (sup_re, paren_num_re):
                for m in pat_re.finditer(p_text):
                    word_raw = m.group("word")
                    word = word_raw.lower()
                    if (
                        word in _EXCLUDED_WORDS
                        or word.endswith("pin")
                        or word
                        in {
                            "equation", "equations", "formula", "formulas", "theorem", "lemma",
                            "corollary", "definition", "proposition", "condition", "hypothesis",
                            "expression", "inequality", "relation", "constraint", "problem",
                            "example", "remark", "property", "axiom", "where", "from", "into",
                            "with", "than", "over", "under", "between", "through",
                        }
                    ):
                        continue
                    nums_raw = re.sub(r"\s+", "", m.group("nums"))
                    # Parse all numbers and ranges in nums_raw
                    tokens = [t for t in nums_raw.split(",") if t]
                    if not tokens:
                        continue
                    valid_tokens = True
                    prev_val = 0
                    for tok in tokens:
                        if "–" in tok or "-" in tok:
                            sep = "–" if "–" in tok else "-"
                            parts = tok.split(sep)
                            if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
                                valid_tokens = False
                                break
                            a, b = int(parts[0]), int(parts[1])
                            if not (1 <= a < b <= max_ref_num and (b - a) <= 25):
                                valid_tokens = False
                                break
                            prev_val = b
                        else:
                            if not tok.isdigit():
                                valid_tokens = False
                                break
                            v = int(tok)
                            if not (1 <= v <= max_ref_num) or (prev_val > 0 and v <= prev_val):
                                valid_tokens = False
                                break
                            prev_val = v
                    if not valid_tokens:
                        continue
                    if len(tokens) > 1 or "–" in nums_raw or "-" in nums_raw:
                        has_multi_or_range = True
                    candidates.append(
                        Citation(
                            raw_text=f"[{nums_raw}]",
                            citation_type=CitationType.NUMERIC,
                            style=dominant_style,
                            page_num=p_num,
                            matched_pattern="attached_superscript_numeric",
                            confidence=0.88,
                        )
                    )

        distinct_raws = len({c.raw_text for c in candidates})
        if (len(candidates) >= 3 and distinct_raws >= 2) or (has_multi_or_range and len(candidates) >= 1):
            return existing_body + candidates
        return existing_body

    def _extract_alpha_bracket_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document,
        existing_body: list[Citation],
        references: list[Citation],
    ) -> list[Citation]:
        """Extract LaTeX alpha-style in-text citations (e.g. [ADG+16], [VSP+17, DCLT18])."""
        alpha_key_re = re.compile(r"^\s*\[\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9+\-]{1,10}\d{2}[a-z]?)\s*\]")
        alpha_map: dict[str, Citation] = {}
        for ref in references:
            m = alpha_key_re.match(ref.raw_text or "")
            if m:
                key = re.sub(r"\s+", "", m.group(1))
                alpha_map.setdefault(key, ref)

        if len(alpha_map) < 2:
            return existing_body

        by_page = {p.page_num: p for p in source_doc.pages}
        body_page_texts: dict[int, str] = {}
        for section in sections:
            if section.section_type == SectionType.BODY:
                for n in sorted(by_page):
                    if section.start_page <= n <= section.end_page and by_page[n].text:
                        body_page_texts.setdefault(n, by_page[n].text)
            elif section.section_type == SectionType.BIBLIOGRAPHY:
                pre_body = (section.metadata or {}).get("pre_header_body_text")
                pre_pnum = (section.metadata or {}).get("pre_header_page_num") or section.start_page
                if pre_body and pre_pnum:
                    body_page_texts[pre_pnum] = (body_page_texts.get(pre_pnum, "") + "\n" + pre_body).strip()
                # Also include bottom-of-page footnote lines on the bibliography page itself
                # (e.g. "13 Maurice Cozian, Alian Viandier (1988), ..., p.165." below the reference list)
                for n in range(section.start_page, section.end_page + 1):
                    if n in by_page and by_page[n].text:
                        fn_lines = [
                            ln.strip()
                            for ln in by_page[n].text.splitlines()
                            if re.match(r"^\d{1,2}\s+[A-ZÀ-Ý].*(?:\bp\.|\btr\.)\s*\d+", ln.strip(), re.I)
                        ]
                        if fn_lines:
                            body_page_texts[n] = (body_page_texts.get(n, "") + "\n" + "\n".join(fn_lines)).strip()

        if not body_page_texts:
            return existing_body

        added: list[Citation] = []
        for p_num, raw_p_text in sorted(body_page_texts.items()):
            p_text = re.sub(r"\s+", " ", raw_p_text)
            for m in re.finditer(r"\[([^\[\]]{2,180})\]", p_text):
                inside = m.group(1).strip()
                parts = [pt.strip() for pt in re.split(r"[,;]", inside) if pt.strip()]
                for pt in parts:
                    norm_key = re.sub(r"\s+", "", pt)
                    ref = alpha_map.get(norm_key)
                    if ref is not None:
                        added.append(
                            Citation(
                                raw_text=f"[{norm_key}]",
                                citation_type=CitationType.IN_TEXT,
                                style=ref.style or CitationStyle.ACM,
                                page_num=p_num,
                                authors=list(ref.authors[:1]) if ref.authors else [],
                                year=ref.year,
                                year_suffix=ref.year_suffix,
                                title=ref.title,
                                title_normalized=ref.title_normalized,
                                matched_pattern="alpha_bracket",
                                confidence=0.92,
                            )
                        )

        return existing_body + added if added else existing_body

    def _extract_references(
        self,
        sections: list[DocumentSection],
        grobid: GrobidOutput | None,
        source_doc: Document | None = None,
    ) -> list[Citation]:
        """Trích references — GROBID + regex merge với deduplication.

        Phase 3 (GROBID adapter): Ưu tiên GROBID bibliography (structured),
        bổ sung regex entries bị GROBID bỏ sót. Deduplicate theo DOI →
        title+author+year → raw text similarity.

        Returns:
            list[Citation] với merged references và provenance tracking.
        """
        from integrity_checker.extraction.reference_parser import _is_fake_entry

        # Lấy references từ GROBID (primary) và lọc bỏ fake/appendix entries + gộp các entry
        # bị GROBID tách đôi TRƯỚC khi đánh lại order_index / numeric_index.
        bib_text_norm = re.sub(
            r"\s+",
            " ",
            " ".join((s.text or "") for s in sections if s.section_type == SectionType.BIBLIOGRAPHY),
        ).lower()
        appendix_text_norm = re.sub(
            r"\s+",
            " ",
            " ".join((s.text or "") for s in sections if s.section_type == SectionType.APPENDIX),
        ).lower()
        body_text_norm = re.sub(
            r"\s+",
            " ",
            " ".join((s.text or "") for s in sections if s.section_type == SectionType.BODY),
        ).lower()
        non_bib_text_norm = f"{body_text_norm} {appendix_text_norm}".strip()

        # If a multi-page document (3+ pages) has no BIBLIOGRAPHY section at all (e.g. 3.pdf screenplay),
        # ignore any GROBID-hallucinated references from body text.
        has_no_bib_section = bool(
            source_doc is not None
            and len(source_doc.pages or []) >= 3
            and not bib_text_norm.strip()
        )

        bib_words_norm = re.sub(r"\W+", " ", bib_text_norm).strip()
        non_bib_words_norm = re.sub(r"\W+", " ", non_bib_text_norm).strip()
        appendix_words_norm = re.sub(r"\W+", " ", appendix_text_norm).strip()

        grobid_refs: list[Citation] = []
        if not has_no_bib_section and grobid is not None and grobid.is_available and grobid.bibliography:
            from integrity_checker.extraction.grobid_adapter import _is_duplicate_reference

            raw_grobid_refs = self._grobid_to_citations(grobid)
            for ref in raw_grobid_refs:
                if _is_fake_entry(ref.raw_text):
                    logger.debug(
                        f"Filtered fake GROBID entry before indexing: {ref.raw_text[:50]}..."
                    )
                    continue

                ref_auth_join = " ".join(str(a) for a in (ref.authors or []))
                if (
                    re.search(r"\.{5,}", ref.raw_text or "")
                    or re.search(r"\.{5,}", ref_auth_join)
                    or re.match(
                        r"^(?:Gr[áa]fico|Tabla|Figura|Figure|Table|Graph)\s+\d+\b",
                        (ref.raw_text or ref.title or "").strip(),
                        re.IGNORECASE,
                    )
                ):
                    continue

                # Filter out duplicate GROBID entries extracted from a secondary bibliography in APPENDIX
                # (e.g. a translated summary 'Referencias' at the back of the thesis) when the primary
                # BIBLIOGRAPHY section contains at most 1 copy of the entry.
                if (
                    appendix_words_norm
                    and bib_words_norm
                    and grobid_refs
                    and _is_duplicate_reference(ref, grobid_refs)
                ):
                    dup_probe_words = re.sub(
                        r"\W+",
                        " ",
                        (ref.title or ref.raw_text or "").lower(),
                    ).split()
                    dup_snip = " ".join(dup_probe_words[:6]) if len(dup_probe_words) >= 4 else ""
                    if (
                        dup_snip
                        and dup_snip in appendix_words_norm
                        and bib_words_norm.count(dup_snip) <= 1
                    ):
                        logger.debug(
                            f"Filtered secondary-appendix duplicate GROBID entry: {ref.raw_text[:50]}..."
                        )
                        continue

                # Filter out GROBID entries hallucinated from Author Biographies (ORCID / e-mail / research interests prose)
                if not ref.doi and (
                    "orcid.org/" in (ref.url or "").lower()
                    or re.search(
                        r"\b(?:(?:his|her|their)\s+research\s+(?:interests?\s+include|focuses\s+on)|(?:he|she)\s+is\s+currently\s+an?\s+(?:undergraduate|graduate|postdoctoral|ph\.?d\.?|master)|received\s+the\s+(?:b\.?s\.?|m\.?s\.?|m\.?sc\.?|ph\.?d\.?)\s+degree|\(e-?mail\s*:\s*\S+@\S+)\b",
                        f"{ref.raw_text or ''} {ref.title or ''} {ref_auth_join}",
                        re.IGNORECASE,
                    )
                ):
                    if not (
                        ref.url
                        and "orcid.org/" not in (ref.url or "").lower()
                        and ref.title
                        and not re.search(
                            r"\b(?:(?:he|she)\s+is\s+interested\s+in|(?:his|her|their)\s+research\s+(?:interests?\s+include|focuses\s+on)|\(e-?mail\s*:)\b",
                            ref.title,
                            re.IGNORECASE,
                        )
                    ):
                        logger.debug(
                            f"Filtered author-biography GROBID entry before indexing: {ref.raw_text[:50]}..."
                        )
                        continue

                # Filter out unstructured GROBID hallucinations (no year, no DOI, no URL, and no real author)
                # when the document has NO bibliography section at all (e.g. 086_uit) or first-person 'I'
                # questionnaire items from an appendix (e.g. 57.pdf 'I could not get going').
                has_pronoun_i_author = bool(
                    ref.authors
                    and len(ref.authors) == 1
                    and str(ref.authors[0]).strip().rstrip(".") in {"I", "We"}
                )
                is_unstructured_hallucination = bool(
                    not ref.year
                    and not ref.doi
                    and not ref.url
                    and (not bib_words_norm or has_pronoun_i_author)
                    and (
                        not ref.authors
                        or all(len(re.sub(r"[^A-Za-zÀ-ỹ]", "", str(a))) <= 2 for a in ref.authors)
                    )
                    and non_bib_words_norm
                )
                if is_unstructured_hallucination:
                    u_words = re.sub(
                        r"\W+",
                        " ",
                        (ref.title or ref.venue or ref.raw_text or "").lower(),
                    ).split()
                    u_snip = " ".join(u_words[:4]) if len(u_words) >= 4 else ""
                    if u_snip and u_snip in non_bib_words_norm and (not bib_words_norm or u_snip not in bib_words_norm):
                        logger.debug(
                            f"Filtered unstructured GROBID body/appendix hallucination: {ref.raw_text[:50]}..."
                        )
                        continue

                # Filter out DOI-less/URL-less GROBID entries extracted from outside BIBLIOGRAPHY
                # (e.g. Author Contributions / Acknowledgments / Chapter Summaries / Appendix prompts / discursive footnotes in BODY or APPENDIX)
                if (
                    not ref.doi
                    and (
                        not ref.url
                        or not ref.authors
                        or "orcid.org/" in (ref.url or "").lower()
                        or "target:" in (ref.raw_text or "").lower()
                        or "provided insight into" in (ref.raw_text or "").lower()
                    )
                    and non_bib_words_norm
                    and bib_words_norm
                ):
                    probe_words = re.sub(
                        r"\W+",
                        " ",
                        (ref.title or ref.venue or ref.raw_text or "").lower(),
                    ).split()
                    probe_snip = " ".join(probe_words[:7]) if len(probe_words) >= 5 else ""
                    if (
                        probe_snip
                        and probe_snip in non_bib_words_norm
                        and probe_snip not in bib_words_norm
                    ):
                        logger.debug(
                            f"Filtered non-bibliography GROBID entry before indexing: {ref.raw_text[:50]}..."
                        )
                        continue
                    # Also check if the trailing segment of raw_text (e.g. "conducted pre-training experiments")
                    # is prose from BODY/APPENDIX and absent from BIBLIOGRAPHY
                    raw_words = re.sub(r"\W+", " ", (ref.raw_text or "").lower()).split()
                    tail_snip = " ".join(raw_words[-7:]) if len(raw_words) >= 6 else ""
                    if (
                        tail_snip
                        and tail_snip in non_bib_words_norm
                        and tail_snip not in bib_words_norm
                    ):
                        logger.debug(
                            f"Filtered non-bibliography GROBID prose entry before indexing: {ref.raw_text[:50]}..."
                        )
                        continue

                # Coalesce standalone URL/DOI/Retrieved fragment split by GROBID from the preceding entry
                if (
                    not ref.authors
                    and (
                        not ref.title
                        or (
                            not ref.year
                            and (ref.title or "").strip().lower()
                            in {
                                "jstor",
                                "ebscohost",
                                "proquest",
                                "sciencedirect",
                                "pubmed",
                                "researchgate",
                                "url",
                            }
                        )
                    )
                    and not ref.venue
                    and (
                        ref.doi
                        or ref.url
                        or re.match(
                            r"^(?:URL(?:\s+https?://\S+)?|https?://\S+)$",
                            (ref.raw_text or "").strip(),
                            re.IGNORECASE,
                        )
                    )
                ):
                    if grobid_refs:
                        prev_g = grobid_refs[-1]
                        if ref.doi and not prev_g.doi:
                            prev_g.doi = ref.doi
                        if ref.url and not prev_g.url:
                            prev_g.url = ref.url
                        elif not prev_g.url:
                            from integrity_checker.retrieval.link_validator import (
                                clean_extracted_url,
                            )

                            extracted_u = clean_extracted_url(ref.raw_text or "")
                            if extracted_u.lower().startswith(("http://", "https://")):
                                prev_g.url = extracted_u
                    continue

                # Skip bogus URL-slug pseudo-author fragments with no title/venue/doi/url (e.g. "Pre_And_Post_Crisis_Study_On_Bahrain (2020)")
                if (
                    not ref.title
                    and not ref.venue
                    and not ref.doi
                    and not ref.url
                    and ref.authors
                    and any("_" in str(a) for a in ref.authors)
                ):
                    continue

                # Coalesce consecutive split GROBID entries where the first half has only
                # authors + year (no title/venue/doi/url) and the second half has no authors
                # but carries the title/venue (e.g. when title contains a year like "Europe PMC in 2020").
                if (
                    grobid_refs
                    and grobid_refs[-1].authors
                    and grobid_refs[-1].title is None
                    and grobid_refs[-1].venue is None
                    and not grobid_refs[-1].doi
                    and not grobid_refs[-1].url
                    and not ref.authors
                    and (ref.title or ref.venue)
                    and (
                        ref.year is None
                        or grobid_refs[-1].year is None
                        or str(ref.year) in (ref.title or "")
                        or str(ref.year) in (ref.venue or "")
                    )
                ):
                    prev_ref = grobid_refs[-1]
                    prev_ref.title = ref.title
                    prev_ref.title_normalized = ref.title_normalized
                    prev_ref.venue = ref.venue
                    prev_ref.doi = prev_ref.doi or ref.doi
                    prev_ref.url = prev_ref.url or ref.url
                    prev_ref.year = prev_ref.year or ref.year
                    parts = [
                        ", ".join(str(a) for a in prev_ref.authors),
                        f"({prev_ref.year})" if prev_ref.year else "",
                        prev_ref.title or "",
                        prev_ref.venue or "",
                    ]
                    prev_ref.raw_text = " ".join(p for p in parts if p).strip()
                    logger.debug(
                        f"Coalesced split GROBID bibliography fragment into: {prev_ref.raw_text[:70]}..."
                    )
                    continue

                grobid_refs.append(ref)
            for idx, ref in enumerate(grobid_refs, start=1):
                ref.order_index = idx
                ref.numeric_index = idx
            from integrity_checker.extraction.composite_splitter import (
                expand_composite_references,
            )

            grobid_refs = expand_composite_references(
                grobid_refs, ref_parser=self._reference_parser
            )

        # Lấy references từ regex (secondary/supplemental)
        regex_refs = self._extract_references_from_sections(sections)

        # For Vietnamese bibliographies (containing 'tài liệu tham khảo' or Vietnamese legal/traditional
        # entries), regex_refs preserves exact Vietnamese names, titles, legal document codes, and
        # sequential numbering without GROBID's body-footnote bleed or [trans: ...] English duplication.
        vn_matched_count = sum(
            1
            for r in regex_refs
            if r.matched_pattern in ("vn_legal_document", "vn_traditional_entry")
        )
        is_vietnamese_bib = bool(
            regex_refs
            and len(bib_text_norm.strip()) >= 40
            and (
                "tài liệu tham khảo" in bib_text_norm
                or vn_matched_count >= max(2, int(len(regex_refs) * 0.25))
                or (len(regex_refs) <= 3 and vn_matched_count >= 1)
            )
        )
        if is_vietnamese_bib:
            for r in regex_refs:
                if r.title and r.authors and r.year:
                    continue
                r_raw_low = (r.raw_text or "").lower()
                for g in grobid_refs:
                    g_title = (g.title or "").strip()
                    if g_title and len(g_title) >= 8 and g_title.lower() in r_raw_low:
                        if (
                            not r.title
                            or r.title.startswith(",")
                            or (not r.authors and len(r.title) > len(g_title) + 15)
                        ):
                            r.title = g_title
                            r.title_normalized = g.title_normalized
                        if not r.authors and g.authors:
                            r.authors = g.authors
                        if not r.venue and g.venue:
                            r.venue = g.venue
                        if not r.year and g.year:
                            r.year = g.year
                        if not r.doi and g.doi:
                            r.doi = g.doi
                        if not r.url and g.url:
                            r.url = g.url
                        break
            merged_refs = regex_refs
        else:
            # Merge: GROBID primary + regex supplemental
            merged_refs = self._merge_reference_lists(grobid_refs, regex_refs)

        # FIX v1.11: Filter out fake/non-citation entries from merged references
        filtered_refs = []
        for ref in merged_refs:
            if not _is_fake_entry(ref.raw_text):
                filtered_refs.append(ref)
            else:
                logger.debug(f"Filtered fake entry from merged refs: {ref.raw_text[:50]}...")

        if len(filtered_refs) < len(merged_refs):
            logger.info(f"Filtered {len(merged_refs) - len(filtered_refs)} fake entries from merged references")

        return filtered_refs

    def _extract_references_from_sections(
        self,
        sections: list[DocumentSection],
    ) -> list[Citation]:
        """Trích references từ bibliography section bằng regex.

        Used as secondary/supplemental extraction khi GROBID available
        nhưng bỏ sót một số entries.
        """
        from integrity_checker.extraction.reference_parser import (
            _is_essay_title_entry,
            is_vn_legal_reference,
        )

        all_citations: list[Citation] = []
        for section in sections:
            if section.section_type == SectionType.BIBLIOGRAPHY and section.text:
                try:
                    pp = self._citation_extractor.preprocessor
                    section_text = pp._normalize_unicode(pp._fix_ligatures(section.text))

                    entries = self._reference_parser._split_entries(section_text)
                    for idx, entry in enumerate(entries, start=len(all_citations) + 1):
                        if (
                            len(entry) < 20
                            and not is_vn_legal_reference(entry.strip())
                            and not re.match(
                                r"^\s*\[\d{1,3}\]\s*(?:EN|ISO|IEC|ASTM|DIN|UNE|BS|IEEE|ANSI)\s+\d",
                                entry.strip(),
                                re.IGNORECASE,
                            )
                        ):
                            continue
                        if _is_essay_title_entry(entry):
                            continue
                        citation = self._reference_parser._parse_entry_with_dash_inheritance(
                            entry,
                            order_index=idx,
                            page_num=section.start_page,
                            prev_citations=all_citations,
                        )
                        if citation:
                            # Mark as regex source
                            citation.source = "regex"
                            citation.source_confidence = citation.confidence
                            all_citations.append(citation)
                        else:
                            from integrity_checker.extraction.composite_splitter import (
                                expand_composite_reference,
                            )

                            comp_probe = Citation(
                                raw_text=entry.strip(),
                                citation_type=CitationType.REFERENCE_LIST,
                                order_index=idx,
                                page_num=section.start_page,
                                source="regex",
                            )
                            comp_pieces = expand_composite_reference(
                                comp_probe, ref_parser=self._reference_parser
                            )
                            if len(comp_pieces) > 1:
                                for piece in comp_pieces:
                                    piece.source = "regex"
                                    piece.source_confidence = piece.confidence
                                    all_citations.append(piece)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Reference parser failed: %s", exc)
        if all_citations:
            # If the bibliography is predominantly numbered (1..N) and inline splitting
            # produced an entry with numeric_index=None (e.g. two entries glued without
            # a newline in PDF extraction), assign sequential 1..N numeric_index values.
            has_pre_expanded_composite = any(
                getattr(c, "sub_index", None) is not None for c in all_citations
            )
            num_count = sum(1 for c in all_citations if c.numeric_index is not None)
            if (
                not has_pre_expanded_composite
                and num_count >= max(3, int(len(all_citations) * 0.6))
                and num_count < len(all_citations)
            ):
                for idx, c in enumerate(all_citations, start=1):
                    c.numeric_index = idx
            from integrity_checker.extraction.composite_splitter import (
                expand_composite_references,
            )

            all_citations = expand_composite_references(
                all_citations, ref_parser=self._reference_parser
            )
            logger.info(f"Extracted {len(all_citations)} references from regex")
        return all_citations

    def _merge_reference_lists(
        self,
        grobid_refs: list[Citation],
        regex_refs: list[Citation],
    ) -> list[Citation]:
        """Merge GROBID và regex references với deduplication.

        Strategy:
            1. GROBID refs primary (structured, reliable)
            2. Regex refs bổ sung entries không trùng
            3. Mark merged entries với provenance

        Args:
            grobid_refs: References từ GROBID (primary)
            regex_refs: References từ regex (secondary)

        Returns:
            list[Citation] merged với deduplication
        """
        from integrity_checker.extraction.grobid_adapter import _is_duplicate_reference

        def _enrich_grobid_ref(target: Citation, donor: Citation) -> None:
            """Fill in missing fields on a GROBID reference from its regex counterpart."""
            years_conflict = bool(
                target.year
                and donor.year
                and str(target.year)[:4].isdigit()
                and str(donor.year)[:4].isdigit()
                and str(target.year)[:4] != str(donor.year)[:4]
            )
            is_single_bracketed_entry = bool(
                re.match(r"^\s*\[\s*\d+\s*\]", donor.raw_text or "")
                and not re.search(r"\[\s*\d+\s*\]", (donor.raw_text or "")[8:])
            )
            donor_is_multi_chunk = (
                (
                    not is_single_bracketed_entry
                    and len(donor.raw_text or "") > max(len(target.raw_text or "") * 2.2, 320)
                )
                or years_conflict
            )
            donor_first_author = (
                (getattr(donor.authors[0], "raw", None) or str(donor.authors[0]))
                if donor.authors
                else ""
            )
            if not target.authors and donor.authors and not donor_is_multi_chunk:
                donor_auth_strs = [
                    getattr(a, "raw", None) or str(a) for a in donor.authors
                ]
                target.authors = donor_auth_strs
                # If GROBID placed the author/organization name into target.title when authors=[]
                # (e.g. "[13] Engineering Archives. (1/05/2019). Tensile Test." -> GROBID title="Engineering Archives"),
                # replace target.title with donor.title and rebuild raw_text.
                if (
                    target.title
                    and donor.title
                    and target.title.strip().lower() != donor.title.strip().lower()
                    and target.title.strip().lower() in " ".join(donor_auth_strs).lower()
                ):
                    target.title = donor.title
                    target.title_normalized = donor.title_normalized
                auth_prefix = ", ".join(donor_auth_strs)
                if auth_prefix and not (target.raw_text or "").lower().startswith(auth_prefix.lower()):
                    raw_body = re.sub(r"^\s*\[\s*\d+\s*\]\s*", "", target.raw_text or "").strip()
                    target.raw_text = f"{auth_prefix} {raw_body}".strip()
            elif (
                donor.authors
                and len(donor.authors) == 1
                and "," not in donor_first_author
                and (
                    len(target.authors) > 1
                    or (
                        len(target.authors) == 1
                        and "," in (getattr(target.authors[0], "raw", None) or str(target.authors[0]))
                    )
                )
                and any(
                    kw in donor_first_author.lower()
                    for kw in (
                        "institute", "foundation", "association", "organization",
                        "ministry", "department", "committee", "commission",
                        "council", "society", "team", "center", "centre",
                        "university", "group", "bank", "health", "archive",
                        "library", "corporation", "company", "inc", "ltd",
                        "project", "consortium", "press", "agency", "bureau",
                        "office", "board", "authority", "laboratory", "labs",
                    )
                )
            ):
                old_auth_str = ", ".join(
                    getattr(a, "raw", None) or str(a) for a in target.authors
                )
                target.authors = [donor_first_author]
                if old_auth_str and old_auth_str in (target.raw_text or ""):
                    target.raw_text = (target.raw_text or "").replace(
                        old_auth_str, donor_first_author, 1
                    )

            # Fix bleeding co-author or hyphenated initial into target.title (e.g. Welling, L., & Thomson, L., [2008]
            # where GROBID sets title=", & Thomson, L", or C.-W. Wu, Y.-L. Chen [2019] where GROBID sets title="-L")
            if (
                target.title
                and donor.title
                and len(donor.title.strip()) >= 5
                and (
                    re.match(r"^[,;\s]*(?:&\s*|and\b)", target.title.strip(), re.IGNORECASE)
                    or re.match(r"^[-–.,;\s]*[A-Za-z]{1,3}\.?$", target.title.strip())
                    or len(target.title.strip(" -–.,;:")) < 4
                )
            ):
                target.title = donor.title
                target.title_normalized = donor.title_normalized
                if donor.authors:
                    target.authors = [
                        getattr(a, "raw", None) or str(a) for a in donor.authors
                    ]
                if donor.venue:
                    target.venue = donor.venue
                parts = []
                if target.authors:
                    parts.append(", ".join(str(a) for a in target.authors))
                if target.year:
                    parts.append(f"({target.year})")
                if target.title:
                    parts.append(target.title)
                if target.venue:
                    parts.append(target.venue)
                target.raw_text = " ".join(parts)

            # Fix GROBID dropping main title before bracketed section tag (e.g. "Docker [IT infrastructure]"
            # where GROBID sets title="IT infrastructure"), hallucinating Appendix code into title,
            # stripping compound hyphens across line breaks (e.g. "Scikitlearn" vs "Scikit-learn"),
            # or mistaking a colon-prefix acronym of the title (e.g. "UIT-VSFC: ...") for the author
            if target.title and donor.title and len(donor.title.strip()) >= 5:
                t_clean = target.title.strip()
                d_clean = donor.title.strip()
                is_colon_prefix_drop = (
                    ":" in d_clean
                    and d_clean.lower().endswith(t_clean.lower())
                    and len(d_clean) > len(t_clean) + 2
                )
                is_bio_bleed_title = bool(
                    re.search(
                        r"\b(?:(?:he|she)\s+is\s+(?:currently\b|interested\s+in\b)|(?:his|her|their)\s+research\s+(?:interests?\b|focuses\b))",
                        t_clean,
                        re.IGNORECASE,
                    )
                    and not re.search(
                        r"\b(?:(?:he|she)\s+is\s+(?:currently\b|interested\s+in\b)|(?:his|her|their)\s+research\s+(?:interests?\b|focuses\b))",
                        d_clean,
                        re.IGNORECASE,
                    )
                )
                if (
                    f"[{t_clean.lower()}]" in d_clean.lower()
                    or re.search(r"',\s*'", t_clean)
                    or is_colon_prefix_drop
                    or is_bio_bleed_title
                    or (
                        d_clean.count("-") > t_clean.count("-")
                        and re.sub(r"[\s\-–]+", "", t_clean.lower())
                        == re.sub(r"[\s\-–]+", "", d_clean.lower())
                    )
                ):
                    old_t = target.title
                    target.title = donor.title
                    target.title_normalized = donor.title_normalized
                    if is_colon_prefix_drop and donor.authors and len(donor.authors) > len(target.authors or []):
                        old_auth_str = ", ".join(
                            getattr(a, "raw", None) or str(a) for a in (target.authors or [])
                        )
                        target.authors = [
                            getattr(a, "raw", None) or str(a) for a in donor.authors
                        ]
                        new_auth_str = ", ".join(target.authors)
                        if old_auth_str and old_auth_str in (target.raw_text or ""):
                            target.raw_text = (target.raw_text or "").replace(
                                old_auth_str, new_auth_str, 1
                            )
                    if old_t and old_t in (target.raw_text or ""):
                        target.raw_text = (target.raw_text or "").replace(old_t, donor.title, 1)

            # Fix GROBID concatenating "Title. Venue" into target.title when target.venue is None
            # (e.g. Settles (2012): title="Active learning. Synthesis Lectures on...")
            if (
                not target.venue
                and donor.venue
                and target.title
                and donor.title
                and len(donor.title.strip()) >= 8
            ):
                d_title_clean = donor.title.strip().rstrip(".")
                t_title_clean = target.title.strip()
                if (
                    t_title_clean.lower().startswith(d_title_clean.lower() + ".")
                    and len(t_title_clean) > len(d_title_clean) + 3
                ):
                    target.title = donor.title
                    target.title_normalized = donor.title_normalized

            years_conflict = bool(
                target.year
                and donor.year
                and str(target.year)[:4].isdigit()
                and str(donor.year)[:4].isdigit()
                and str(target.year)[:4] != str(donor.year)[:4]
            )
            is_single_bracketed_entry = bool(
                re.match(r"^\s*\[\s*\d+\s*\]", donor.raw_text or "")
                and not re.search(r"\[\s*\d+\s*\]", (donor.raw_text or "")[8:])
            )
            donor_is_multi_chunk = (
                (
                    not is_single_bracketed_entry
                    and len(donor.raw_text or "") > max(len(target.raw_text or "") * 2.2, 320)
                )
                or years_conflict
            )
            donor_idx_taken = bool(
                donor.numeric_index is not None
                and any(
                    g is not target
                    and g.numeric_index == donor.numeric_index
                    and (
                        getattr(donor, "sub_index", None) is None
                        or getattr(g, "sub_index", None) == getattr(donor, "sub_index", None)
                    )
                    and (
                        getattr(g, "_num_idx_confirmed", False)
                        or bool(re.match(r"^\s*\[\s*\d+\s*\]", g.raw_text or ""))
                    )
                    for g in grobid_refs
                )
            )
            # Preserve APA 7th author-list ellipsis ('... &' / '… &') when GROBID TEI stripped '...'
            if not donor_is_multi_chunk and donor.raw_text:
                donor_head = (
                    donor.raw_text.split(donor.title, 1)[0]
                    if donor.title and donor.title in donor.raw_text
                    else donor.raw_text[:200]
                )
                if re.search(
                    r"(?:\.\s*\.\s*\.|…)\s*(?:&|\band\b|[A-ZÀ-ÖØ-ÞĐ])",
                    donor_head,
                ):
                    target._has_et_al_ellipsis = True  # type: ignore[attr-defined]
            # Restore dropped leading or trailing authors when GROBID missed co-authors on a line/hyphen break,
            # or when GROBID mistook a hyphenated/digit acronym in the title (e.g. 'SOCS-3') for the sole author.
            donor_auth_clean: list[str] = []
            seen_auth_fold: set[str] = set()
            for a_obj in donor.authors or []:
                a_raw = (getattr(a_obj, "raw", None) or str(a_obj)).strip()
                a_fold = re.sub(r"\s+", " ", a_raw.lower().rstrip("."))
                if a_raw and a_fold not in seen_auth_fold:
                    seen_auth_fold.add(a_fold)
                    donor_auth_clean.append(a_raw)

            donor_authors_look_polluted = bool(
                donor.matched_pattern == "apa_fallback"
                or any(
                    ":" in a_str
                    or re.search(r"\d", a_str)
                    or len(a_str.split()) > 5
                    or (
                        target.title
                        and len(target.title.strip()) >= 10
                        and target.title.strip().lower()[:12] in a_str.lower()
                    )
                    for a_str in donor_auth_clean
                )
            )
            target_author_is_title_acronym = bool(
                target.authors
                and len(target.authors) == 1
                and target.title
                and re.search(r"[\d\-]", str(target.authors[0]))
                and str(target.authors[0]).strip().lower() in target.title.lower()
            )
            if (
                donor_auth_clean
                and target.authors
                and not donor_is_multi_chunk
                and not donor_authors_look_polluted
                and (len(donor_auth_clean) > len(target.authors) or target_author_is_title_acronym)
            ):
                first_d = donor_auth_clean[0].rstrip(".").lower()
                t_first = (getattr(target.authors[0], "last_name", None) or str(target.authors[0])).split(",")[0].strip().lower()
                d_first = (getattr(donor.authors[0], "last_name", None) or str(donor.authors[0])).split(",")[0].strip().lower()
                t_last = (getattr(target.authors[-1], "last_name", None) or str(target.authors[-1])).split(",")[0].strip().lower()
                d_last = (getattr(donor.authors[-1], "last_name", None) or str(donor.authors[-1])).split(",")[0].strip().lower()
                if (
                    (
                        target_author_is_title_acronym
                        or (t_last and t_last == d_last)
                        or (t_first and t_first == d_first)
                    )
                    and first_d not in {"iii", "ii", "iv", "jr", "sr"}
                ):
                    old_auth_str = ", ".join(
                        getattr(a, "raw", None) or str(a) for a in target.authors
                    )
                    target.authors = list(donor_auth_clean)
                    new_auth_str = ", ".join(target.authors)
                    if old_auth_str and old_auth_str in (target.raw_text or ""):
                        target.raw_text = (target.raw_text or "").replace(
                            old_auth_str, new_auth_str, 1
                        )
            if (
                target.raw_text
                and target.title
                and re.search(r"\(\d{4}[a-z]?\)\s+-[A-Za-z]{1,3}\b", target.raw_text)
            ):
                target.raw_text = re.sub(
                    r"(\(\d{4}[a-z]?\))\s+-[A-Za-z]{1,3}\b\s*",
                    r"\1 ",
                    target.raw_text,
                )

            def _clean_doi_value(raw_doi: str) -> str:
                d_val = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", raw_doi).strip()
                if re.match(r"^(?:https?://|(?:dx\.)?doi\.org/)", d_val, re.IGNORECASE):
                    m_doi = re.search(r"10\.\d{4,9}/(?:[^\s\]\)\,;()<>]|\([^\s\]\)\,;()<>]*\))+", d_val)
                    if not m_doi:
                        return ""
                    d_val = m_doi.group(0)
                d_val = re.sub(r"[?#].*$", "", d_val)
                d_val = re.sub(r"&[A-Za-z_][A-Za-z0-9_]*=.*$", "", d_val)
                d_val = re.sub(
                    r"[\(\[]?\s*(?:ac-?\s*cessed|re-?\s*trieved)\b.*$",
                    "",
                    d_val,
                    flags=re.IGNORECASE,
                )
                d_val = re.sub(r"\.pdf$", "", d_val, flags=re.IGNORECASE)
                d_val = re.sub(r"(?<=\d)[A-Z][a-z]{2,}.*$", "", d_val)
                return d_val.rstrip(".,;:>)")

            if donor.doi and not donor_is_multi_chunk:
                clean_donor_doi = _clean_doi_value(donor.doi)
                clean_target_doi = _clean_doi_value(target.doi) if target.doi else ""
                if clean_target_doi and target.doi != clean_target_doi:
                    target.doi = clean_target_doi
                if clean_donor_doi and (
                    not target.doi
                    or target.doi.endswith("-")
                    or (
                        clean_donor_doi.lower().startswith(target.doi.lower())
                        and len(clean_donor_doi) > len(target.doi)
                        and not re.fullmatch(r"\.\d{1,3}", clean_donor_doi[len(target.doi):])
                    )
                ):
                    target.doi = clean_donor_doi
            if donor.url and (
                not donor_is_multi_chunk
                or (donor.numeric_index is not None and donor.numeric_index == target.numeric_index)
            ):
                if not target.url or (
                    donor.url.lower().startswith(target.url.lower())
                    and len(donor.url) > len(target.url)
                ):
                    target.url = donor.url
            if not target.venue and donor.venue:
                target.venue = donor.venue
            if not target.year and donor.year:
                d_yr_str = str(donor.year).strip()
                if len(d_yr_str) > 4 and d_yr_str[:4].isdigit() and d_yr_str[4:].isalpha():
                    target.year = d_yr_str[:4]
                    if not target.year_suffix:
                        target.year_suffix = d_yr_str[4:].lower()
                else:
                    target.year = donor.year
            if not target.year_suffix and not donor_is_multi_chunk:
                donor_sfx = (getattr(donor, "year_suffix", None) or "").strip().lower()
                if not donor_sfx and donor.year:
                    d_yr_str = str(donor.year).strip()
                    if len(d_yr_str) > 4 and d_yr_str[:4].isdigit() and d_yr_str[4:].isalpha():
                        donor_sfx = d_yr_str[4:].lower()
                if donor_sfx and target.year and str(target.year)[:4] == str(donor.year or target.year)[:4]:
                    target.year_suffix = donor_sfx
                    if target.raw_text and f"({target.year})" in target.raw_text:
                        target.raw_text = target.raw_text.replace(
                            f"({target.year})",
                            f"({target.year}{donor_sfx})",
                            1,
                        )
            if not target.title and donor.title:
                donor_t_clean = re.sub(
                    r"[,\s]+(?:18|19|20)\d{2}[a-z]?\.?$", "", donor.title.strip()
                ).strip()
                is_publisher_only_title = bool(
                    target.venue
                    and donor_t_clean.lower() == target.venue.strip().lower()
                )
                if not is_publisher_only_title:
                    target.title = donor.title
                    target.title_normalized = donor.title_normalized
                    if donor.authors and not donor_is_multi_chunk:
                        target.authors = [
                            getattr(a, "raw", None) or str(a) for a in donor.authors
                        ]
                    if donor.year and (not target.year or str(target.year).startswith("190")):
                        target.year = donor.year
                    if donor.venue and not target.venue:
                        target.venue = donor.venue
                    if donor.title not in (target.raw_text or ""):
                        target.raw_text = f"{(target.raw_text or '').rstrip('. ')}. {donor.title}"
                        if target.venue and target.venue not in target.raw_text:
                            target.raw_text = f"{target.raw_text.rstrip('. ')}. {target.venue}"
            target_author_key = self._citation_key(target)[2]
            donor_author_key = self._citation_key(donor)[2]
            authors_conflict = bool(
                target_author_key
                and donor_author_key
                and len(re.findall(r"[a-z]", target_author_key)) >= 2
                and len(re.findall(r"[a-z]", donor_author_key)) >= 2
                and target_author_key != donor_author_key
                and target_author_key not in donor_author_key
                and donor_author_key not in target_author_key
            )
            shared_same_doi = bool(
                target.doi
                and donor.doi
                and target.doi.strip().lower() == donor.doi.strip().lower()
            )
            target_already_confirmed = bool(
                target.numeric_index is not None
                and donor.numeric_index is not None
                and target.numeric_index != donor.numeric_index
                and (
                    getattr(target, "_num_idx_confirmed", False)
                    or (shared_same_doi and authors_conflict)
                )
            )
            if (
                donor.numeric_index is not None
                and not donor_is_multi_chunk
                and not donor_idx_taken
                and not target_already_confirmed
            ):
                target.numeric_index = donor.numeric_index
                target._num_idx_confirmed = True  # type: ignore[attr-defined]
                if getattr(donor, "sub_index", None) and not getattr(target, "sub_index", None):
                    target.sub_index = donor.sub_index
                if getattr(donor, "composite_label", None) and not getattr(
                    target, "composite_label", None
                ):
                    target.composite_label = donor.composite_label
            if (
                donor.style
                and donor.style.value != "unknown"
                and not donor_is_multi_chunk
                and not donor_idx_taken
            ):
                target.style = donor.style
            if donor.matched_pattern and not target.matched_pattern and not donor_is_multi_chunk:
                target.matched_pattern = donor.matched_pattern
            if (
                not donor_is_multi_chunk
                and not donor_idx_taken
                and not target_already_confirmed
                and donor.raw_text
                and re.match(r"^\s*\[\s*\d+\s*\]", donor.raw_text)
            ):
                if not re.match(r"^\s*\[\s*\d+\s*\]", target.raw_text or ""):
                    idx_label = donor.numeric_index or target.numeric_index
                    if idx_label is not None:
                        target.raw_text = f"[{idx_label}] {target.raw_text}"
            elif donor.raw_text:
                alpha_m = re.match(
                    r"^\s*\[\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9+\-]{1,10}\d{2}[a-z]?)\s*\]",
                    donor.raw_text,
                )
                if alpha_m and not re.match(
                    r"^\s*\[\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9+\-]{1,10}\d{2}[a-z]?\s*\]",
                    target.raw_text or "",
                ):
                    alpha_label = re.sub(r"\s+", "", alpha_m.group(1))
                    target.raw_text = f"[{alpha_label}] {target.raw_text}"
            if donor.raw_text:
                arxiv_m = re.search(
                    r"\barXiv\s*:\s*\d{4}\.\d{4,5}(?:v\d+)?\b",
                    donor.raw_text,
                    re.IGNORECASE,
                )
                if arxiv_m and arxiv_m.group(0).lower() not in (target.raw_text or "").lower():
                    target.raw_text = f"{target.raw_text}. {arxiv_m.group(0)}"
                if target.url and target.url not in (target.raw_text or ""):
                    target.raw_text = f"{target.raw_text}. Retrieved from {target.url}"

        # Coalesce adjacent split GROBID <biblStruct> fragments when GROBID split a
        # single bibliography entry across two consecutive items (e.g., author(+year)
        # header in b8 and title+DOI in b9, or author+title in b20 and trailing
        # publisher/DOI in b21).
        if len(grobid_refs) >= 2:
            coalesced_grobid: list[Citation] = []
            gi = 0
            while gi < len(grobid_refs):
                cur = grobid_refs[gi]
                if gi + 1 < len(grobid_refs):
                    nxt = grobid_refs[gi + 1]
                    cur_has_title = bool((cur.title or "").strip())
                    nxt_has_title = bool((nxt.title or "").strip())
                    # Split Pattern A: cur has authors(+optional year) only (no title/venue/DOI/URL), nxt has title
                    if (
                        not cur_has_title
                        and not cur.venue
                        and not cur.doi
                        and not cur.url
                        and cur.authors
                        and nxt_has_title
                        and (not cur.year or not nxt.year or nxt.year == cur.year)
                        and len(nxt.authors or []) <= 1
                    ):
                        if not cur.year and nxt.authors:
                            nxt.authors = list(cur.authors) + list(nxt.authors)
                        else:
                            nxt.authors = list(cur.authors)
                        nxt.year = nxt.year or cur.year
                        auth_str = ", ".join(str(a) for a in nxt.authors)
                        nxt.raw_text = f"{auth_str} ({nxt.year}) {nxt.title}" + (
                            f" DOI: {nxt.doi}" if nxt.doi else ""
                        )
                        coalesced_grobid.append(nxt)
                        gi += 2
                        continue
                    # Split Pattern B: cur has authors+title (no DOI), nxt has DOI/URL only (no title, no year)
                    if (
                        cur_has_title
                        and cur.authors
                        and not cur.doi
                        and not nxt_has_title
                        and not nxt.year
                        and (nxt.doi or nxt.url)
                    ):
                        cur.doi = nxt.doi
                        cur.url = cur.url or nxt.url
                        cur.raw_text = f"{(cur.raw_text or '').rstrip('. ')}. {(nxt.raw_text or '').strip()}"
                        coalesced_grobid.append(cur)
                        gi += 2
                        continue
                    # Split Pattern D1: line-wrapped DOI registrant+suffix fragment (e.g. 'https://doi.org/10.' + '1186/ s12882-022-02869-6 (2022).')
                    nxt_raw_s = (nxt.raw_text or "").strip()
                    nxt_first_auth = str(nxt.authors[0]).strip() if nxt.authors else ""
                    m_doi_frag = re.match(
                        r"^(\d{4,9}/\s*[^\s()]+)",
                        nxt_first_auth if re.match(r"^\d{4,9}/", nxt_first_auth) else nxt_raw_s,
                    )
                    if (
                        cur_has_title
                        and not cur.doi
                        and not nxt_has_title
                        and (
                            m_doi_frag is not None
                            or bool(re.search(r"(?:doi\.org/|doi:\s*)10\.?$", (cur.raw_text or "").strip(), re.I))
                        )
                    ):
                        if m_doi_frag is not None:
                            doi_tail = re.sub(r"\s+", "", m_doi_frag.group(1)).rstrip(".,;)")
                            cur.doi = f"10.{doi_tail}"
                        else:
                            cur.doi = nxt.doi
                        cur.year = cur.year or nxt.year
                        cur.raw_text = f"{(cur.raw_text or '').rstrip('. ')} {nxt_raw_s}".strip()
                        coalesced_grobid.append(cur)
                        gi += 2
                        continue
                    # Split Pattern D2: line-wrapped URL filename + 'Accessed YYYY' fragment (e.g. TDTU_PDF/064_hcmus)
                    if (
                        cur_has_title
                        and len(nxt.authors or []) == 1
                        and nxt_first_auth.lower().rstrip(".:,") in {"accessed", "retrieved", "visited", "online"}
                        and not nxt.doi
                    ):
                        if cur.url and cur.url.endswith("/") and nxt.title and " " not in nxt.title.strip():
                            cur.url = f"{cur.url}{nxt.title.strip()}"
                        cur.year = cur.year or nxt.year
                        cur.raw_text = f"{(cur.raw_text or '').rstrip('. ')} {nxt_raw_s}".strip()
                        coalesced_grobid.append(cur)
                        gi += 2
                        continue
                    # Split Pattern D3: authorless trailing standard/publisher + year fragment split from preceding entry (e.g. ACS/hard_01 RFC 8446)
                    if (
                        cur_has_title
                        and cur.authors
                        and not cur.year
                        and not nxt.authors
                        and nxt.year
                        and not nxt.doi
                        and not nxt.url
                        and any(
                            (cur.title or "").lower()[:20] in (rx.raw_text or "").lower()
                            and (nxt.title or nxt_raw_s).lower()[:18] in (rx.raw_text or "").lower()
                            for rx in regex_refs
                        )
                    ):
                        cur.year = nxt.year
                        if nxt.title:
                            cur.venue = f"{cur.venue}; {nxt.title}" if cur.venue else nxt.title
                        cur.raw_text = f"{(cur.raw_text or '').rstrip('. ')}. {nxt_raw_s}".strip()
                        coalesced_grobid.append(cur)
                        gi += 2
                        continue
                    # Split Pattern C: cur has title, nxt has no title, no year, no venue, no DOI, no URL (trailing publisher/editor/org tail)
                    if (
                        cur_has_title
                        and not nxt_has_title
                        and not nxt.year
                        and not nxt.venue
                        and not nxt.doi
                        and not nxt.url
                    ):
                        tail_txt = (nxt.raw_text or "").strip()
                        if tail_txt:
                            cur.raw_text = f"{(cur.raw_text or '').rstrip('. ')}. {tail_txt}"
                        coalesced_grobid.append(cur)
                        gi += 2
                        continue
                coalesced_grobid.append(cur)
                gi += 1

            if len(coalesced_grobid) < len(grobid_refs):
                for new_idx, g_cit in enumerate(coalesced_grobid, start=1):
                    if not re.match(r"^\s*\[\s*\d+\s*\]", g_cit.raw_text or ""):
                        g_cit.numeric_index = new_idx
                grobid_refs = coalesced_grobid

        orig_grobid_count = len(grobid_refs)
        regex_comp_by_num: dict[int, list[Citation]] = {}
        for rc in regex_refs:
            if rc.numeric_index is not None and getattr(rc, "sub_index", None):
                regex_comp_by_num.setdefault(rc.numeric_index, []).append(rc)
        regex_comp_by_num = {
            num: subs for num, subs in regex_comp_by_num.items() if len(subs) >= 2
        }
        if regex_comp_by_num:
            filtered_grobid: list[Citation] = []
            for g in grobid_refs:
                if getattr(g, "sub_index", None) is None:
                    matched_comp_num: int | None = None
                    if g.numeric_index in regex_comp_by_num:
                        matched_comp_num = g.numeric_index
                    elif g.numeric_index is None:
                        for c_num, c_subs in regex_comp_by_num.items():
                            if any(
                                (
                                    g.doi
                                    and sc.doi
                                    and g.doi.strip().rstrip(".").lower()
                                    == sc.doi.strip().rstrip(".").lower()
                                )
                                or _is_duplicate_reference(sc, [g])
                                for sc in c_subs
                            ):
                                matched_comp_num = c_num
                                break
                    if matched_comp_num is not None:
                        for sc in regex_comp_by_num[matched_comp_num]:
                            if g.grobid_ref_id and not sc.grobid_ref_id:
                                sc.grobid_ref_id = g.grobid_ref_id
                            if (
                                g.title
                                and not sc.title
                                and (
                                    (
                                        g.doi
                                        and sc.doi
                                        and g.doi.strip().rstrip(".").lower()
                                        == sc.doi.strip().rstrip(".").lower()
                                    )
                                    or _is_duplicate_reference(sc, [g])
                                )
                            ):
                                sc.title = g.title
                                sc.title_normalized = g.title_normalized
                        continue
                filtered_grobid.append(g)
            grobid_refs = filtered_grobid

        merged: list[Citation] = []

        # Track GROBID ref IDs để avoid duplicate (store list per DOI so chimera/duplicate DOIs
        # never overwrite earlier or later entries in the map).
        grobid_by_doi: dict[str, list[Citation]] = {}
        grobid_by_key: dict[tuple, Citation] = {}
        grobid_by_num: dict[int, Citation] = {}

        for c in grobid_refs:
            if c.doi:
                grobid_by_doi.setdefault(c.doi.lower(), []).append(c)
            key = self._citation_key(c)
            grobid_by_key[key] = c
            if c.numeric_index is not None and c.numeric_index not in grobid_by_num:
                grobid_by_num[c.numeric_index] = c
            merged.append(c)

        def _authors_conflict_pair(a: Citation, b: Citation) -> bool:
            ka = self._citation_key(a)[2]
            kb = self._citation_key(b)[2]
            return bool(
                ka
                and kb
                and len(re.findall(r"[a-z]", ka)) >= 2
                and len(re.findall(r"[a-z]", kb)) >= 2
                and ka != kb
                and ka not in kb
                and kb not in ka
            )

        def _sub_index_conflicts(a: Citation, b: Citation) -> bool:
            sa = getattr(a, "sub_index", None)
            sb = getattr(b, "sub_index", None)
            if bool(sa) != bool(sb):
                return True
            return bool(sa and sb and sa != sb)

        def _would_clobber_numbered_slot(c_ref: Citation, g_ref: Citation) -> bool:
            if _sub_index_conflicts(c_ref, g_ref):
                return True
            if (
                c_ref.numeric_index is None
                or g_ref.numeric_index is None
                or c_ref.numeric_index == g_ref.numeric_index
            ):
                return False
            has_explicit_marker = bool(
                getattr(c_ref, "sub_index", None) is not None
                or re.match(r"^\s*(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\d+\.\s)", c_ref.raw_text or "")
            )
            if not has_explicit_marker:
                return False
            confirmed_nums = {
                m.numeric_index
                for m in merged
                if m.numeric_index is not None
                and (
                    getattr(m, "_num_idx_confirmed", False)
                    or getattr(m, "source", "") == "merged"
                )
            }
            if c_ref.numeric_index in confirmed_nums:
                return False
            return bool(
                getattr(g_ref, "_num_idx_confirmed", False)
                or _authors_conflict_pair(c_ref, g_ref)
            )

        # Add regex entries không trùng với GROBID
        for c in regex_refs:
            key = self._citation_key(c)

            # Check DOI match (only if publication years and numbered slots/authors do not conflict)
            if c.doi and c.doi.lower() in grobid_by_doi:
                doi_candidates = [
                    g
                    for g in grobid_by_doi[c.doi.lower()]
                    if (
                        not c.year
                        or not g.year
                        or str(c.year)[:4] == str(g.year)[:4]
                    )
                    and not _authors_conflict_pair(c, g)
                    and not _would_clobber_numbered_slot(c, g)
                ]
                g_doi_ref = next(
                    (g for g in doi_candidates if c.numeric_index is not None and g.numeric_index == c.numeric_index),
                    doi_candidates[0] if doi_candidates else None,
                )
                if g_doi_ref is not None:
                    _enrich_grobid_ref(g_doi_ref, c)
                    logger.debug(f"Skipping regex duplicate by DOI: {c.raw_text[:50]}")
                    continue

            # Check key match (prefer an unconfirmed GROBID duplicate when c has a distinct numeric_index)
            if key in grobid_by_key:
                g_key_target = grobid_by_key[key]
                if (
                    c.numeric_index is not None
                    and getattr(g_key_target, "_num_idx_confirmed", False)
                    and g_key_target.numeric_index != c.numeric_index
                ):
                    alt_g = next(
                        (
                            g
                            for g in grobid_refs
                            if self._citation_key(g) == key
                            and (
                                not getattr(g, "_num_idx_confirmed", False)
                                or g.numeric_index == c.numeric_index
                            )
                        ),
                        None,
                    )
                    if alt_g is not None:
                        g_key_target = alt_g
                if not _would_clobber_numbered_slot(c, g_key_target):
                    _enrich_grobid_ref(g_key_target, c)
                    logger.debug(f"Skipping regex duplicate by key: {c.raw_text[:50]}")
                    continue

            # Check URL exact match before fuzzy duplicate scan (only if years do not conflict)
            c_url_norm = (c.url or "").strip().rstrip("/.,;").lower()
            if c_url_norm:
                url_match_g = next(
                    (
                        g
                        for g in grobid_refs
                        if (g.url or "").strip().rstrip("/.,;").lower() == c_url_norm
                        and (not c.year or not g.year or str(c.year)[:4] == str(g.year)[:4])
                        and not _would_clobber_numbered_slot(c, g)
                        and (
                            c.numeric_index is None
                            or not getattr(g, "_num_idx_confirmed", False)
                            or g.numeric_index == c.numeric_index
                        )
                    ),
                    None,
                ) or next(
                    (
                        g
                        for g in grobid_refs
                        if (g.url or "").strip().rstrip("/.,;").lower() == c_url_norm
                        and (not c.year or not g.year or str(c.year)[:4] == str(g.year)[:4])
                        and not _would_clobber_numbered_slot(c, g)
                    ),
                    None,
                )
                if url_match_g is not None:
                    _enrich_grobid_ref(url_match_g, c)
                    logger.debug(f"Skipping regex duplicate by exact URL: {c.raw_text[:50]}")
                    continue

            # Check GROBID refs directly
            dup_match = next(
                (
                    g
                    for g in grobid_refs
                    if _is_duplicate_reference(c, [g])
                    and not _would_clobber_numbered_slot(c, g)
                    and (
                        c.numeric_index is None
                        or not getattr(g, "_num_idx_confirmed", False)
                        or g.numeric_index == c.numeric_index
                    )
                ),
                None,
            ) or next(
                (
                    g
                    for g in grobid_refs
                    if _is_duplicate_reference(c, [g])
                    and not _would_clobber_numbered_slot(c, g)
                ),
                None,
            )
            if dup_match is not None:
                _enrich_grobid_ref(dup_match, c)
                logger.debug(f"Skipping regex duplicate: {c.raw_text[:50]}")
                continue

            # Check same numeric_index slot (e.g. [10] in GROBID vs [10] in regex
            # when GROBID and regex parsed slightly different title/author boundaries
            # from the exact same numbered bibliography entry)
            if (
                c.numeric_index is not None
                and c.numeric_index in grobid_by_num
                and not _sub_index_conflicts(c, grobid_by_num[c.numeric_index])
                and (
                    abs(len(grobid_refs) - len(regex_refs)) <= 2
                    or bool(re.match(r"^\s*\[\s*\d+\s*\]", grobid_by_num[c.numeric_index].raw_text or ""))
                )
            ):
                g_num = grobid_by_num[c.numeric_index]
                g_num_url_norm = (g_num.url or "").strip().rstrip("/.,;").lower()
                g_num_author = self._citation_key(g_num)[2]
                c_author = self._citation_key(c)[2]
                if (
                    g_num.year == c.year
                    or (g_num.doi and c.doi and g_num.doi.lower() == c.doi.lower())
                    or (c_url_norm and g_num_url_norm and c_url_norm == g_num_url_norm)
                    or (g_num_author and c_author and g_num_author == c_author)
                ):
                    _enrich_grobid_ref(g_num, c)
                    logger.debug(
                        f"Skipping regex duplicate at same numeric_index={c.numeric_index}: {c.raw_text[:50]}"
                    )
                    continue

            # Check URL match or title/raw_text substring overlap against GROBID entries (BUG-15)
            c_url_norm = (c.url or "").strip().rstrip("/.,;").lower()
            c_title_norm = re.sub(r"[^\w\s]", " ", (c.title or "").lower())
            c_title_norm = re.sub(r"\s+", " ", c_title_norm).strip()
            overlap_g: Citation | None = None
            for g in grobid_refs:
                if _would_clobber_numbered_slot(c, g):
                    continue
                if c.year and g.year and str(c.year)[:4] != str(g.year)[:4]:
                    continue
                g_url_norm = (g.url or "").strip().rstrip("/.,;").lower()
                if c_url_norm and g_url_norm and (c_url_norm == g_url_norm or c_url_norm in g_url_norm or g_url_norm in c_url_norm):
                    overlap_g = g
                    break
                if c.doi and g.doi and (c.doi.lower().startswith(g.doi.lower()) or g.doi.lower().startswith(c.doi.lower())):
                    overlap_g = g
                    break
                g_title_norm = re.sub(r"[^\w\s]", " ", (g.title or "").lower())
                g_title_norm = re.sub(r"\s+", " ", g_title_norm).strip()
                g_raw_norm = re.sub(r"[^\w\s]", " ", (g.raw_text or "").lower())
                g_raw_norm = re.sub(r"\s+", " ", g_raw_norm).strip()
                c_raw_norm = re.sub(r"[^\w\s]", " ", (c.raw_text or "").lower())
                c_raw_norm = re.sub(r"\s+", " ", c_raw_norm).strip()
                if len(c_title_norm) >= 12 and (c_title_norm in g_title_norm or c_title_norm in g_raw_norm):
                    overlap_g = g
                    break
                if len(g_title_norm) >= 12 and (g_title_norm in c_title_norm or g_title_norm in c_raw_norm):
                    overlap_g = g
                    break
                g_venue_norm = re.sub(r"[^\w\s]", " ", (g.venue or "").lower())
                g_venue_norm = re.sub(r"\s+", " ", g_venue_norm).strip()
                if (
                    not g.title
                    and len(c_title_norm) >= 3
                    and (
                        c_title_norm in g_raw_norm
                        or (
                            len(g_venue_norm) >= 5
                            and g_venue_norm in c_title_norm
                            and self._citation_key(g)[2] == self._citation_key(c)[2]
                        )
                    )
                    and (not g.year or not c.year or str(g.year) == str(c.year))
                ):
                    overlap_g = g
                    break
                if (
                    c.authors
                    and len(c.authors) >= 2
                    and (
                        not g.title
                        or (
                            c.year
                            and g.year
                            and str(c.year)[:4] == str(g.year)[:4]
                            and self._citation_key(g)[2]
                            and self._citation_key(g)[2] == self._citation_key(c)[2]
                        )
                    )
                ):
                    c_surnames = []
                    for a in c.authors[:5]:
                        a_str = (getattr(a, "last_name", None) or getattr(a, "raw", None) or str(a)).strip()
                        sn = a_str.split(",")[0].strip().split()[-1].lower() if a_str else ""
                        sn = re.sub(r"[^\w]", "", sn)
                        if len(sn) >= 4:
                            c_surnames.append(sn)
                    if len(c_surnames) >= 2 and sum(1 for sn in c_surnames if sn in g_raw_norm) >= min(3, len(c_surnames)):
                        overlap_g = g
                        break
            if overlap_g is not None:
                _enrich_grobid_ref(overlap_g, c)
                logger.debug(f"Skipping overlapping regex entry: {c.raw_text[:50]}")
                continue

            # When GROBID has already extracted a substantive bibliography (>= 5 entries),
            # do not append noisy cross-style fallback fragments or unsplit multi-entry chunks.
            is_missing_numbered_slot = bool(
                c.numeric_index is not None
                and 1 <= c.numeric_index <= len(regex_refs) + 2
                and c.numeric_index not in {m.numeric_index for m in merged if m.numeric_index is not None}
                and re.match(r"^\s*(?:\[\s*\d+\s*\]|\d+\.\s)", c.raw_text or "")
                and len(c.raw_text or "") <= 420
            )
            is_missing_composite_sub_slot = bool(
                c.numeric_index is not None
                and getattr(c, "sub_index", None) is not None
                and (c.numeric_index, getattr(c, "sub_index", None))
                not in {
                    (m.numeric_index, getattr(m, "sub_index", None))
                    for m in merged
                    if m.numeric_index is not None
                }
            )
            if (
                orig_grobid_count >= 5
                and not is_missing_numbered_slot
                and not is_missing_composite_sub_slot
            ):
                is_noisy_vancouver = (
                    (c.matched_pattern or "") == "vancouver_reference_entry"
                    and (not c.authors or len(grobid_refs) >= len(regex_refs) - 2)
                )
                is_clean_harvard_or_apa = (
                    (c.matched_pattern or "") in {"harvard_article", "harvard_book", "apa_fallback"}
                    and bool(c.authors)
                    and bool(c.year)
                    and bool(c.title and len(c.title.strip()) >= 5)
                    and len(c.raw_text or "") <= 350
                    and bool(
                        re.match(
                            r"^(?:[A-ZÀ-Ý][A-Za-zÀ-ỹ'\u2019\-]+,\s+[A-Z]|(?:[A-Z]{2,12}|[A-ZÀ-Ý][A-Za-zÀ-ỹ0-9.'\u2019\-]+(?:\s+[A-ZÀ-Ýa-z][A-Za-zÀ-ỹ0-9.'\u2019\-]+){0,3})\s*[.,]*\s*(?:\(\s*(?:18|19|20)\d{2}|\s+(?:18|19|20)\d{2}\.))",
                            (c.raw_text or "").strip(),
                        )
                    )
                )
                if (
                    (
                        (c.matched_pattern or "")
                        in {
                            "harvard_article",
                            "harvard_book",
                            "apa_fallback",
                            "chicago_fallback",
                            "mla_fallback",
                            "vancouver_fallback",
                            "nature_book",
                            "acm_fallback",
                            "unquoted_book_entry",
                        }
                        and not is_clean_harvard_or_apa
                    )
                    or is_noisy_vancouver
                    or len(c.raw_text or "") > 420
                ):
                    logger.debug(
                        f"Skipping noisy regex fallback ({c.matched_pattern}) when GROBID is present: {c.raw_text[:50]}"
                    )
                    continue

            # Mark as merged source and normalize Author objects to strings
            if c.authors:
                c.authors = [
                    getattr(a, "raw", None) or str(a) for a in c.authors
                ]
            c.source = "merged"
            c.source_confidence = c.confidence
            merged.append(c)

        # Drop any remaining title-less GROBID fragment whose (first_author, year)
        # already matches another merged entry that has a title (e.g. 83.pdf, 176.pdf).
        titled_author_years = {
            (self._citation_key(m)[2], str(m.year or ""))
            for m in merged
            if (m.title or "").strip() and self._citation_key(m)[2]
        }
        if titled_author_years:
            merged = [
                m
                for m in merged
                if (m.title or "").strip()
                or m.doi
                or m.url
                or getattr(m, "sub_index", None) is not None
                or (self._citation_key(m)[2], str(m.year or "")) not in titled_author_years
            ]

        # If all merged references have unique numeric_index values (e.g. when
        # regex filled in a numbered entry [16] that GROBID skipped), sort by
        # numeric_index so the bibliography order matches the paper's [1]..[N].
        if (
            merged
            and all(c.numeric_index is not None for c in merged)
            and len({(c.numeric_index, getattr(c, "sub_index", None) or "") for c in merged})
            == len(merged)
        ):
            merged.sort(
                key=lambda c: (c.numeric_index or 0, getattr(c, "sub_index", None) or "")
            )
            for idx_ord, c in enumerate(merged, start=1):
                c.order_index = idx_ord

        # Re-index order_index
        for idx, c in enumerate(merged, start=1):
            c.order_index = idx

        logger.info(
            f"Merged references: {len(grobid_refs)} GROBID + "
            f"{len(regex_refs)} regex → {len(merged)} unique"
        )
        return merged

    @staticmethod
    def _citation_key(c: Citation) -> tuple:
        """Tạo deduplication key từ citation."""
        title_norm = (c.title or "").lower().strip() if c.title else ""
        year = c.year or ""

        # Handle both string authors and Author objects
        first_author = ""
        if c.authors:
            first = c.authors[0]
            if isinstance(first, str):
                first_author = first.split(",")[0].strip().lower()
            elif hasattr(first, "last_name") and first.last_name:
                first_author = first.last_name.lower()
            elif hasattr(first, "full_name") and first.full_name:
                first_author = first.full_name.split(",")[0].strip().lower()

        comp_label = (getattr(c, "composite_label", None) or "").strip().lower()
        return (title_norm, year, first_author, comp_label)

    def _extract_appendix_citations(
        self,
        sections: list[DocumentSection],
        source_doc: Document | None = None,
    ) -> list[Citation]:
        """Trích citations ở appendix (out-of-scope MVP, nhưng track)."""
        citations: list[Citation] = []
        by_page = {p.page_num: p for p in (source_doc.pages if source_doc else [])}
        dot_leader_re = re.compile(r"(?:\.\s*){4,}\d+\s*$")
        for section in sections:
            if section.section_type != SectionType.APPENDIX:
                continue
            if not section.text:
                continue
            page_nums = [
                n
                for n in sorted(by_page)
                if section.start_page <= n <= section.end_page and by_page[n].text
            ]
            # If the appendix contains a translated summary with its own separate bibliography
            # header (e.g. 'Referencias' [1]..[16] renumbering citations differently from the
            # main thesis), do not extract citations from that secondary summary block.
            if page_nums and any(
                self._section_segmenter._page_has_bibliography_header(by_page[n])
                for n in page_nums
            ):
                continue
            if page_nums:
                clean_pages: list[Page] = []
                for n in page_nums:
                    raw_lines = (by_page[n].text or "").splitlines()
                    kept_lines = [ln for ln in raw_lines if not dot_leader_re.search(ln.strip())]
                    cleaned_txt = "\n".join(kept_lines).strip()
                    if cleaned_txt:
                        clean_pages.append(Page(page_num=n, text=cleaned_txt, has_text_layer=True))
                if not clean_pages:
                    continue
                doc = Document(
                    file_path="",
                    num_pages=max(p.page_num for p in clean_pages),
                    pages=clean_pages,
                )
            else:
                kept_lines = [
                    ln
                    for ln in section.text.splitlines()
                    if not dot_leader_re.search(ln.strip())
                ]
                cleaned_txt = "\n".join(kept_lines).strip()
                if not cleaned_txt:
                    continue
                doc = Document(
                    file_path="",
                    num_pages=section.end_page - section.start_page + 1,
                    pages=[
                        Page(page_num=section.start_page, text=cleaned_txt, has_text_layer=True)
                    ],
                )
            citations.extend(self._citation_extractor.extract_from_document(doc))
        return citations

    @staticmethod
    def _grobid_to_citations(grobid: GrobidOutput) -> list[Citation]:
        """Convert GrobidOutput.bibliography → Citation[] với provenance tracking.

        Sử dụng grobid_adapter để chuẩn hóa structured extraction,
        với provenance fields cho downstream tracking.
        """
        from integrity_checker.extraction.grobid_adapter import grobid_to_references

        citations = grobid_to_references(grobid)

        # Set provenance fields on each citation (canonical fields from Citation model)
        for c in citations:
            c.source = "grobid"
            c.source_confidence = c.confidence
            # grobid_ref_id is already set by grobid_adapter (canonical field)
            # Check if this ref is linked from in-text citations
            if grobid.is_available and grobid.citations:
                linked_refs = {cit.ref_id for cit in grobid.citations if cit.ref_id}
                c.is_grobid_linked = c.grobid_ref_id in linked_refs if c.grobid_ref_id else False

        return citations
