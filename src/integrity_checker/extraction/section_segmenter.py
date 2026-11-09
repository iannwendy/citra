"""Section segmenter — phân vùng Document thành body / bibliography / appendix.

Mục đích (v1.2 §3.4):
    Phân vùng PDF trước khi trích citation & detect style. Cần để:
        - CitationLinker loại trừ in-text ở reference section.
        - StyleDetector phân tích tín hiệu trong body vs bibliography tách biệt.
        - ReferenceListParser chỉ chạy trên bibliography section.

Chiến lược:
    1. Tìm header "References / Bibliography / Tài liệu tham khảo" đánh dấu
       bắt đầu bibliography section.
    2. Tìm header "Appendix / Phụ lục" (nếu có) đánh dấu appendix.
    3. Footnote tách riêng (Page footer chứa số footnote).
    4. Figure caption tách riêng (regex "Figure N:" / "Hình N:").
    5. Phần còn lại = body.

Output: list[DocumentSection] có section_type + (start_page, end_page) + text.

References:
    v1.2 §3.4 (Phân vùng tài liệu)
    v1.2 §3.5 (tín hiệu style từ body vs bibliography)
    config.linking.exclude_sections (để CitationLinker dùng)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum

from integrity_checker.extraction.base import Document, Page

logger = logging.getLogger(__name__)


class SectionType(str, Enum):
    """Loại section trong Document.

    Cố ý string Enum để serialize/UI. ORDERING ổn định nhưng không quan trọng.
    """

    BODY = "body"
    BIBLIOGRAPHY = "bibliography"
    APPENDIX = "appendix"
    FOOTNOTE = "footnote"
    FIGURE_CAPTION = "figure_caption"
    UNKNOWN = "unknown"

    @property
    def is_citable(self) -> bool:
        """True nếu CitationExtractor nên chạy trên section này.

        - BODY: có
        - BIBLIOGRAPHY: KHÔNG (chỉ ReferenceListParser chạy)
        - APPENDIX: KHÔNG (out-of-scope MVP)
        - FOOTNOTE: CÓ (footnote có thể trích citation — tuỳ chọn, mặc định False)
        - FIGURE_CAPTION: KHÔNG
        - UNKNOWN: CÓ (mặc định an toàn)
        """
        return self in {
            SectionType.BODY,
            SectionType.UNKNOWN,
        }


# --- Header patterns ---
# Pattern ở ĐẦU dòng (line-start), case-insensitive, cho phép số + whitespace trước.

_BIBLIOGRAPHY_HEADERS = re.compile(
    r"^\s*(?:(?:(?:chương|phần|mục|chapter|section|part)\s+)?(?:\d+(?:\.\d+)*|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X))(?:\s*[\.\):\-–—]+\s*|\s+)|[A-Z][\.\)]\s+)?(?:"
    r"references?|reference\s+list|bibliography|works?\s+cited|literature(?:\s+cited)?|cited\s+literature|"
    r"sources|list\s+of\s+sources|reference\s+sources|sources\s+and\s+literature|literature\s+and\s+sources|"
    r"notes(?:\s+and\s+references)?|endnotes?|"
    r"bibliografia(?:/bibliografía/bibliographie/works?\s+cited)?|bibliografía|bibliographie|"
    r"referências(?:\s+bibliográficas)?|referencias(?:\s+bibliográficas)?|daftar\s+pustaka|"
    r"(?:[^/\n]{2,50}/\s*)?list\s+of\s+references|"
    r"danh\s+mục\s+tài\s+liệu(?:\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?)?|"
    r"(?:các\s+)?(?:tài\s+liệu|bài\s+viết|nguồn|link)\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?|"
    r"tham\s+khảo|tài\s+liệu\s+trích\s+dẫn|tài\s+liệu|"
    r"参考文献|参考文献$"
    r")(?:\s*\(\s*\))?\s*[:.]?\s*$",
    re.IGNORECASE,
)

_APPENDIX_HEADERS = re.compile(
    r"^\s*(?:(?:\d+|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X)|[A-Z])\.?\s+)?(?:"
    r"(?:appendix|appendices|phụ\s*lục|annex)"
    r"(?:\s+for\b[^,;]*|\s+[A-Z0-9]{1,3}(?:\s*[:.\-—–]?\s*[^,;]{1,80})?|\s*[:.\-—–]\s*[^,;]{1,80})?|"
    r"self[- ]?evaluation(?:\s+table|\s+form|\s+rubric)?|bảng\s+tự\s+đánh\s+giá|"
    r"supplementary\s+(?:material|materials|information|appendix|experiments?|results?|details?)|"
    r"附件.*"
    r")\s*$",
    re.IGNORECASE,
)

_POST_BIB_APPENDIX_SINGLE_LINE_RE = re.compile(
    r"^(?:"
    r"[A-C](?:\.1)?\s+(?:Additional|Supplementary|Implementation|Experimental|Training|Model|Dataset|Evaluation|Proof|Proofs|Further|Extended|Detailed|Prompt|Prompts|Hyperparameter|Ablation|Human|Case|Error|More|Ethical|Broader|Limitation|Societal|Installation|Source|Code|Usage|Setup|Configuration|Listing|Listings|Simulation|Software|Hardware|System|Technical|Mathematical|Derivation|Derivations|Questionnaire|Interview|Survey)\b[A-Za-z0-9\s,\-:–—()]{2,70}"
    r"|Attention\s+Visualizations"
    r"|Acknowledge?ments?"
    r"|Extended\s+Data(?:\s+Figures?|\s+Tables?)?"
    r"|(?:Chỉ\s+mục|Index)"
    r"|(?:\d+(?:\.\d+)+[\.\)]?\s+)?(?:Chi\s+tiết\s+phân\s+công(?:\s+công\s+việc)?|Bảng\s+phân\s+công\s+công\s+việc|Đánh\s+giá\s+mức\s+độ\s+hoàn\s+thành)\s*:?"
    r"|Khối\s+li[ệê]u\s+được\s+trích\s+dẫn\s*:?"
    r"|[-•●▪▫\uf0a7\uf0b7\uf0d8\uf0fc\uf076]*\s*(?:Phần\s+mềm\s+và\s+thư\s+viện|Công\s+cụ\s+và\s+thư\s+viện)\s+(?:được\s+)?sử\s+dụng\s*:?"
    r")$",
    re.IGNORECASE,
)

_FOOTNOTE_PATTERN = re.compile(r"^\s*\d{1,3}\.\s+\S")   # "1. Text..."
_FIGURE_CAPTION_PATTERN = re.compile(
    r"^\s*(?:figure|fig\.?|hình|ảnh|table|bảng)\s+\d+",
    re.IGNORECASE,
)


@dataclass
class DocumentSection:
    """Một vùng văn bản trong Document đã được phân loại.

    Attributes:
        section_type: SectionType enum.
        start_page, end_page: 1-indexed inclusive.
        text: ghép text từ tất cả page trong range (đã qua preprocessing nhẹ).
        page_break_used: True nếu section gộp nhiều page, False nếu chỉ 1 page.
    """

    section_type: SectionType
    start_page: int
    end_page: int
    text: str = ""
    page_break_used: bool = False
    metadata: dict = field(default_factory=dict)


class SectionSegmenter:
    """Phân vùng Document thành các DocumentSection.

    Strategy:
        1. Tìm header "References" / "Tài liệu tham khảo" — đánh dấu BIBLIOGRAPHY.
        2. Tìm header "Appendix" / "Phụ lục" — đánh dấu APPENDIX (chỉ khi SAU bibliography).
        3. Các page giữa cover → bibliography = BODY.
        4. Các page giữa bibliography → appendix = BODY (chỉ chứa reference list còn lại).
        5. Footnote / figure caption: tách RIÊNG ở cuối mỗi page nếu regex match.
    """

    def __init__(self) -> None:
        # Có thể config sau; hiện tại dùng hardcoded regex (an toàn)
        pass

    def segment(self, doc: Document) -> list[DocumentSection]:
        """Phân vùng Document.

        Returns:
            list[DocumentSection] theo thứ tự xuất hiện trong Document.
        """
        if not doc.pages:
            return []

        # Bước 1: xác định ranh giới page
        boundaries = self._find_boundaries(doc)

        # Bước 2: tạo sections từ boundaries
        sections: list[DocumentSection] = []

        # BODY từ đầu đến bibliography
        if boundaries["biblio_start"] > 1:
            sections.append(self._build_section(
                SectionType.BODY, 1, boundaries["biblio_start"] - 1, doc
            ))

        # BIBLIOGRAPHY — chỉ tạo nếu thực sự tìm thấy header
        app_start = boundaries["appendix_start"]
        app_line_idx = boundaries.get("appendix_line_idx")
        mid_page_appendix = False
        if app_start and app_line_idx is not None and app_line_idx > 0:
            app_page = next((p for p in doc.pages if p.page_num == app_start), None)
            if app_page and app_page.text:
                app_lines = app_page.text.splitlines()
                start_slice = 0
                if app_start == boundaries["biblio_start"]:
                    b_idx = self._find_bibliography_header_line_idx(app_page)
                    if b_idx is not None:
                        start_slice = b_idx + 1
                pre_app_lines = app_lines[start_slice:app_line_idx]
                pre_app_text = "\n".join(pre_app_lines).strip()
                if app_start == boundaries["biblio_start"] or (
                    len(pre_app_text) >= 40
                    and (
                        sum(1 for ln in pre_app_lines if ln.strip()) >= 3
                        or bool(re.search(r"\b(?:19|20)\d{2}\b|https?://", pre_app_text))
                    )
                ):
                    mid_page_appendix = True

        if boundaries["biblio_start"] > 0:
            biblio_end = (
                (app_start if mid_page_appendix else app_start - 1)
                if app_start
                else doc.num_pages
            )
            if boundaries["biblio_start"] <= biblio_end:
                sections.append(self._build_section(
                    SectionType.BIBLIOGRAPHY,
                    boundaries["biblio_start"],
                    biblio_end,
                    doc,
                    appendix_page=app_start if mid_page_appendix else None,
                    appendix_line_idx=app_line_idx if mid_page_appendix else None,
                ))
        else:
            # Không có bibliography → BODY kéo tới trước APPENDIX (nếu có) hoặc hết document
            body_end = (
                (app_start if mid_page_appendix else max(1, app_start - 1))
                if app_start
                else doc.num_pages
            )
            sections.append(self._build_section(
                SectionType.BODY, 1, body_end, doc
            ))
            fn_bib = self._extract_footnote_bibliography_section(doc)
            if fn_bib is not None:
                sections.append(fn_bib)

        # APPENDIX
        if app_start:
            sections.append(self._build_section(
                SectionType.APPENDIX,
                app_start,
                doc.num_pages,
                doc,
                appendix_page=app_start if mid_page_appendix else None,
                appendix_line_idx=app_line_idx if mid_page_appendix else None,
            ))

        # Bước 3: tách footnote/figure-caption riêng từ body
        body_sections = [s for s in sections if s.section_type == SectionType.BODY]
        if body_sections:
            extras = self._extract_per_page_extras(body_sections[0], doc)
            sections = body_sections[:1] + extras + sections[len(body_sections):]

        return sections

    # -- internals --

    def _find_boundaries(self, doc: Document) -> dict[str, int | None]:
        """Tìm (biblio_start, appendix_start, appendix_line_idx).

        Two-pass approach:
          1. Explicit header scan (original logic).
          2. Implicit-bibliography scan — activates only when no header found.
             Detects pages dominated by IEEE-style [N] reference markers.

        Returns:
            dict có 'biblio_start' (1-indexed), 'appendix_start' (1-indexed hoặc None),
            và 'appendix_line_idx' (0-indexed hoặc None).
        """
        biblio_start = 0
        appendix_start = 0
        appendix_line_idx: int | None = None

        # ── Pass 1: explicit header ──────────────────────────────────────────
        bib_candidates = [
            page.page_num
            for page in doc.pages
            if self._page_has_bibliography_header(page)
        ]
        if bib_candidates:
            # Ignore early TOC / table column header false hits when multiple candidates exist
            if len(bib_candidates) >= 4 and bib_candidates[1] == bib_candidates[0] + 1:
                biblio_start = bib_candidates[0]
            elif len(bib_candidates) > 1:
                later = [p for p in bib_candidates if p > doc.num_pages * 0.35]
                if len(later) > 1:
                    final_block_start = later[-1]
                    while final_block_start - 1 in later:
                        final_block_start -= 1
                    first_pg = next((pg for pg in doc.pages if pg.page_num == later[0]), None)
                    last_pg = next((pg for pg in doc.pages if pg.page_num == final_block_start), None)
                    first_yr_hits = len(re.findall(r"\b(?:18|19|20)\d{2}\b", first_pg.text or "")) if first_pg else 0
                    last_yr_hits = len(re.findall(r"\b(?:18|19|20)\d{2}\b", last_pg.text or "")) if last_pg else 0
                    if (
                        final_block_start - later[0] >= 3
                        and later[0] < doc.num_pages * 0.78
                        and last_yr_hits >= 4
                    ):
                        biblio_start = final_block_start
                    elif later[1] == later[0] + 1 or first_yr_hits >= 4:
                        biblio_start = later[0]
                    else:
                        biblio_start = final_block_start
                else:
                    biblio_start = later[-1] if later else bib_candidates[-1]
            else:
                biblio_start = bib_candidates[0]
            logger.debug("Bibliography starts at page %d (header)", biblio_start)

        # ── Pass 2: implicit bibliography (no header found) ────────────────────
        if biblio_start == 0 and doc.num_pages >= 2:
            implicit = self._find_implicit_bibliography(doc)
            if implicit > 0:
                biblio_start = implicit
                logger.debug("Bibliography starts at page %d (implicit)", biblio_start)

        if biblio_start > 0:
            for page in doc.pages:
                if page.page_num < biblio_start:
                    continue
                min_idx = 0
                if page.page_num == biblio_start:
                    b_hdr_idx = self._find_bibliography_header_line_idx(page)
                    min_idx = (b_hdr_idx + 1) if b_hdr_idx is not None else 1
                app_idx = self._find_appendix_header_line_idx(page, min_line_idx=min_idx)
                if app_idx is not None:
                    appendix_start = page.page_num
                    appendix_line_idx = app_idx
                    logger.debug(
                        "Appendix starts at page %d (line %d)",
                        page.page_num,
                        app_idx,
                    )
                    break
        elif doc.num_pages >= 4:
            for page in doc.pages:
                if page.page_num <= doc.num_pages * 0.5:
                    continue
                if self._is_toc_like_page(page.text or ""):
                    continue
                lines_p = (page.text or "").splitlines()
                import unicodedata

                for idx_l, raw_l in enumerate(lines_p):
                    st_l = unicodedata.normalize("NFC", raw_l.strip())
                    if not st_l or st_l.islower():
                        continue
                    if _APPENDIX_HEADERS.match(st_l):
                        appendix_start = page.page_num
                        appendix_line_idx = idx_l
                        break
                if appendix_start:
                    break

        return {
            "biblio_start": biblio_start,
            "appendix_start": appendix_start or None,
            "appendix_line_idx": appendix_line_idx,
        }

    def _find_implicit_bibliography(self, doc: Document) -> int:
        r"""Tìm trang bắt đầu bibliography ẩn (không có header).

        Heuristic: sau page đầu tiên, tìm trang có ≥3 dòng khớp `^\s*\[\d+\]`
        hoặc `^\s*\d{1,3}\.` tuần tự với IEEE ratio ≥ 0.30.
        """
        # Only scan the second half of the document (avoids abstract pages)
        start_scan_at = max(1, doc.num_pages // 2)

        ieee_line_re = re.compile(r"^\s*(?:\[\d+\](?:\s+\S|\s*$)|\d{1,3}\.(?:\s+[A-ZÀ-Ý]|\s*$))")
        bracket_line_re = re.compile(r"^\s*\[\d+\](?:\s+\S|\s*$)")
        dot_num_re = re.compile(r"^\s*(\d{1,3})\.(?:\s+[A-ZÀ-Ý]|\s*$)")
        prose_end_re = re.compile(r"\.\s+$")   # ends with sentence period

        candidate_start = 0

        sql_code_re = re.compile(
            r"\b(?:INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|SELECT\s+\*\s+FROM|FOREIGN\s+KEY|PRIMARY\s+KEY|UPDATE\s+\w+\s+SET)\b",
            re.IGNORECASE,
        )
        iso_date_re = re.compile(r"\b(?:19|20)\d{2}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}\b")

        for page in doc.pages:
            if page.page_num < start_scan_at:
                continue

            lines = page.text.splitlines()
            if not lines:
                continue

            if len(sql_code_re.findall(page.text or "")) >= 2:
                continue

            # Skip pages where an explicit APPENDIX / PHỤ LỤC heading precedes the first [1]/1. marker
            import unicodedata

            nfc_lines = [unicodedata.normalize("NFC", ln) for ln in lines]
            first_marker_idx = next(
                (i for i, ln in enumerate(nfc_lines) if ieee_line_re.match(ln.strip())),
                None,
            )
            if first_marker_idx is not None and any(
                _APPENDIX_HEADERS.match(ln.strip()) and not ln.strip().islower()
                for ln in nfc_lines[:first_marker_idx]
                if ln.strip()
            ):
                continue

            # Count IEEE / numbered reference lines
            ieee_count = sum(1 for ln in lines if ieee_line_re.match(ln.strip()))
            bracket_count = sum(1 for ln in lines if bracket_line_re.match(ln.strip()))
            if bracket_count < 3 and ieee_count >= 3:
                # For dot-numbered lines without brackets, verify sequential numbers (1, 2, 3...) and years
                dot_nums = [
                    int(m.group(1))
                    for ln in lines
                    if (m := dot_num_re.match(ln.strip())) and not ln.strip().endswith(":")
                ]
                text_no_iso_dates = iso_date_re.sub("", page.text or "")
                yr_hits = len(re.findall(r"\b(?:18|19|20)\d{2}\b", text_no_iso_dates))
                has_seq = any(b == a + 1 for a, b in zip(dot_nums, dot_nums[1:], strict=False))
                if not (has_seq and yr_hits >= 3 and len(dot_nums) >= 4):
                    ieee_count = bracket_count

            # Count prose lines (ends with period, not a reference marker)
            prose_count = sum(
                1 for ln in lines
                if prose_end_re.search(ln.strip()) and not ieee_line_re.match(ln.strip())
            )

            total = ieee_count + prose_count
            if total == 0:
                continue

            ratio = ieee_count / max(1, total)

            if ratio >= 0.30 and ieee_count >= 3:
                candidate_start = page.page_num
                logger.debug(
                    "Implicit bibliography candidate at page %d: "
                    "ieee=%d prose=%d ratio=%.2f",
                    page.page_num, ieee_count, prose_count, ratio,
                )
                break

        # Verify candidate: check it's really bibliography by scanning ahead
        # for the end marker (a page with no [N] markers after we've started)
        if candidate_start > 0:
            end = self._find_implicit_bibliography_end(doc, candidate_start)
            logger.debug("Implicit bibliography ends at page %d", end)
            # Return the actual start (first page with enough [N] markers)
            return candidate_start

        return 0

    def _find_implicit_bibliography_end(
        self, doc: Document, start_page: int
    ) -> int:
        """Tìm trang cuối của implicit bibliography.

        Stop when a page has no `[N]` reference markers and has substantial prose.
        Return start_page if no end is found (treat entire tail as bibliography).
        """
        ieee_line_re = re.compile(r"^\s*(?:\[\d+\](?:\s+\S|\s*$)|\d{1,3}\.(?:\s+[A-ZÀ-Ý]|\s*$))")
        prose_end_re = re.compile(r"\.\s+$")

        for page in doc.pages:
            if page.page_num <= start_page:
                continue

            lines = page.text.splitlines()
            if not lines:
                continue

            ieee_count = sum(1 for ln in lines if ieee_line_re.match(ln.strip()))
            prose_count = sum(
                1 for ln in lines
                if prose_end_re.search(ln.strip()) and not ieee_line_re.match(ln.strip())
            )

            # If page has no [N] markers at all and contains prose → end of bibliography
            if ieee_count == 0 and prose_count >= 2:
                return page.page_num - 1

            # If page has some [N] markers but very few → end
            if 0 < ieee_count < 2 and prose_count >= 2:
                return page.page_num - 1

        # Bibliography extends to end of document
        return doc.num_pages

    @staticmethod
    def _is_toc_like_page(text: str) -> bool:
        """Return True when page text looks like a Table of Contents page."""
        import unicodedata

        nonempty = [
            unicodedata.normalize("NFC", ln.strip())
            for ln in (text or "").splitlines()
            if ln.strip()
        ]
        if not nonempty:
            return False
        has_toc_title = any(
            re.match(
                r"^(?:mục\s+lục|table\s+of\s+contents|contents|danh\s+mục\s+(?:bảng|hình))\s*:?$",
                ln,
                re.IGNORECASE,
            )
            for ln in nonempty[:8]
        )
        dot_leader_count = sum(1 for ln in nonempty if re.search(r"(?:\.\s*){4,}\d+\s*$", ln))
        # LaTeX article/report TOC without dot leaders on \section rows:
        # alternating numbered section/bib heading line + standalone page number line
        standalone_page_pairs = sum(
            1
            for a, b in zip(nonempty, nonempty[1:], strict=False)
            if re.fullmatch(r"\d{1,3}", b)
            and not re.fullmatch(r"\d{1,3}", a)
            and (
                re.match(r"^(?:(?:chương|phần|mục|chapter|section)\s+\d+|\d+(?:\.\d+)*|[IVXLC]+[\.\)])\s+[A-ZÀ-Ý]", a, re.IGNORECASE)
                or bool(_BIBLIOGRAPHY_HEADERS.match(a))
                or bool(_APPENDIX_HEADERS.match(a))
            )
        )
        is_dense_latex_toc = (
            standalone_page_pairs >= 3
            and standalone_page_pairs * 2 >= len(nonempty) * 0.35
        )
        return bool(has_toc_title or dot_leader_count >= 3 or is_dense_latex_toc)

    @staticmethod
    def _find_bibliography_header_line_idx(page: Page) -> int | None:
        """Return 0-indexed line number of bibliography header on `page`, or None."""
        import unicodedata

        lines = [unicodedata.normalize("NFC", ln) for ln in page.text.splitlines()]
        table_col_re = re.compile(
            r"(?:Entities(?:,\s*n)?|Entity|Attribute|Recall|Precision|F1(?:\s*Score)?|Accuracy|Score|Metric|Support|"
            r"Strengths?|Weaknesses|Limitations?|Advantages|Disadvantages|Sensor\s+Type|Aspect|Comparison|Criterion|Criteria|Carbon\s+source)"
            r"(?:\s+(?:Recall|Precision|F1(?:\s*Score)?))*",
            re.IGNORECASE,
        )
        page_is_toc = SectionSegmenter._is_toc_like_page(page.text or "")
        for idx, line in enumerate(lines):
            stripped = line.strip()
            if not stripped or stripped.islower():
                continue
            if _BIBLIOGRAPHY_HEADERS.match(stripped):
                # Ignore "Reference(s)" / "Literature" used as a table column header
                nearby_lines = [
                    ln.strip()
                    for ln in (lines[max(0, idx - 6) : idx] + lines[idx + 1 : idx + 10])
                    if ln.strip()
                ]
                metric_headers = sum(1 for ln in nearby_lines if table_col_re.fullmatch(ln))
                if metric_headers >= 2:
                    continue
                prev_window = "\n".join(lines[max(0, idx - 12) : idx])
                next_nonempty = [ln.strip() for ln in lines[idx + 1 : idx + 14] if ln.strip()]
                # Reject Table-of-Contents entry (e.g. LaTeX TOC "Tài liệu tham khảo\n34" or dot-leader TOC pages)
                if page_is_toc:
                    has_immediate_refs = sum(
                        1
                        for ln in next_nonempty[:6]
                        if re.search(
                            r"^(?:\[\s*\d+\s*\]|\d{1,3}[\.\)]\s+[A-ZÀ-Ý].*\b(?:18|19|20)\d{2}\b)|https?://|doi:",
                            ln,
                            re.IGNORECASE,
                        )
                        or (
                            len(ln) >= 35
                            and not re.search(r"(?:\.\s*){4,}\d+\s*$", ln)
                            and bool(re.search(r"\b(?:18|19|20)\d{2}\b", ln))
                        )
                    )
                    if (
                        (next_nonempty and re.fullmatch(r"\d{1,3}", next_nonempty[0]) and has_immediate_refs == 0)
                        or has_immediate_refs == 0
                    ):
                        continue
                # Guard standalone Vietnamese LaTeX \refname "Tài liệu": require immediate [1] reference entry
                if re.fullmatch(
                    r"(?:(?:\d+(?:\.\d+)*|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X)|[A-Z])[\.\)]?\s+)?tài\s+liệu\s*[:.]?",
                    stripped,
                    re.IGNORECASE,
                ):
                    has_bracket_one = any(re.match(r"^\[\s*1\s*\]\s+\S", ln) for ln in next_nonempty[:2])
                    has_bib_cue_tl = bool(
                        re.search(
                            r"^\[\s*2\s*\]|\b(?:18|19|20)\d{2}\b|https?://|doi:",
                            "\n".join(next_nonempty[:6]),
                            re.IGNORECASE | re.MULTILINE,
                        )
                    )
                    if not (has_bracket_one and has_bib_cue_tl):
                        continue
                m_sub = re.match(r"^\s*(\d+)\.(\d+)\b", stripped)
                if m_sub and next_nonempty:
                    next_sec_prefix = f"{m_sub.group(1)}.{int(m_sub.group(2)) + 1}"
                    if next_nonempty[0].startswith(next_sec_prefix):
                        continue
                if re.fullmatch(r"references?\s*[:.]?", stripped, re.IGNORECASE):
                    if re.search(r"\b[A-Z]{2,}_[A-Z]{2,}\b", "\n".join(nearby_lines)) and not re.search(
                        r"\b(?:18|19|20)\d{2}\b|\[\d+\]|https?://|doi:",
                        "\n".join(next_nonempty[:8]),
                        re.IGNORECASE,
                    ):
                        continue
                    if re.search(r"\b(?:table|bảng)\s+\d+", prev_window, re.IGNORECASE):
                        prev_nonempty = [ln.strip() for ln in lines[max(0, idx - 4) : idx] if ln.strip()]
                        if not prev_nonempty or not prev_nonempty[-1].endswith("."):
                            continue
                    if re.search(
                        r"self[- ]?evaluation|marking\s+scheme|no\s+reference|grading\s+rubric|bảng\s+tự\s+đánh\s+giá",
                        prev_window + "\n" + "\n".join(next_nonempty[:8]),
                        re.IGNORECASE,
                    ):
                        continue
                    if re.fullmatch(r"reference\s*[:.]?", stripped, re.IGNORECASE):
                        next_window = "\n".join(lines[idx + 1 : idx + 16])
                        if len(lines) - idx > 5 and not re.search(
                            r"\b(?:18|19|20)\d{2}\b|\[\d+\]|https?://|doi:",
                            next_window,
                            re.IGNORECASE,
                        ):
                            continue
                if re.fullmatch(
                    r"(?:(?:\d+(?:\.\d+)*|I{1,3}|IV|V|VI{0,3}|IX|X|[A-Z])[\.\)]?\s+)?tham\s+khảo\s*[:.]?",
                    stripped,
                    re.IGNORECASE,
                ):
                    has_ref_items = sum(
                        1
                        for ln in next_nonempty[:8]
                        if re.search(r"^(?:\[\d+\]|\d{1,2}[\.\)])|https?://|\b(?:19|20)\d{2}\b", ln, re.IGNORECASE)
                    )
                    if not stripped.endswith(":") and has_ref_items < 2:
                        continue
                    if has_ref_items < 1:
                        continue
                if re.fullmatch(
                    r"(?:(?:\d+(?:\.\d+)*|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X)|[A-Z])[\.\)]?\s+)?sources\s*[:.]?",
                    stripped,
                    re.IGNORECASE,
                ):
                    if re.search(r"\b(?:table|bảng|figure|hình)\s+\d+", prev_window, re.IGNORECASE):
                        prev_nonempty = [ln.strip() for ln in lines[max(0, idx - 4) : idx] if ln.strip()]
                        if not prev_nonempty or not prev_nonempty[-1].endswith("."):
                            continue
                    has_src_refs = sum(
                        1
                        for ln in next_nonempty[:8]
                        if re.search(r"^(?:\[\d+\]|\d{1,2}[\.\)])|https?://|doi:|\b(?:18|19|20)\d{2}\b", ln, re.IGNORECASE)
                    )
                    if has_src_refs < 1:
                        continue
                if re.fullmatch(r"literature\s*[:.]?", stripped, re.IGNORECASE):
                    if re.search(r"\b(?:table|bảng)\s+\d+", prev_window, re.IGNORECASE):
                        continue
                    prev_nonempty = [ln.strip() for ln in lines[max(0, idx - 3) : idx] if ln.strip()]
                    if prev_nonempty and not prev_nonempty[-1].endswith(".") and len(prev_nonempty[-1].split()) <= 4:
                        continue
                if re.fullmatch(
                    r"(?:(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+)?(?:notes(?:\s+and\s+references)?|endnotes?)\s*[:.]?",
                    stripped,
                    re.IGNORECASE,
                ):
                    next_window = "\n".join(next_nonempty[:10])
                    has_numbered_note = any(
                        re.match(r"^(?:\[\d+\]|\d{1,2}(?:[\.\)]|\s+[A-ZÀ-Ý“\"‘']))", ln)
                        for ln in next_nonempty[:6]
                    )
                    has_bib_cue = bool(
                        re.search(r"\b(?:18|19|20)\d{2}\b|https?://|doi:", next_window, re.IGNORECASE)
                    )
                    if not (has_numbered_note and has_bib_cue):
                        continue
                return idx
        return None

    @staticmethod
    def _page_has_bibliography_header(page: Page) -> bool:
        """True nếu page có dòng khớp bibliography header (English / Vietnamese / Chinese)."""
        return SectionSegmenter._find_bibliography_header_line_idx(page) is not None

    @staticmethod
    def _find_appendix_header_line_idx(page: Page, min_line_idx: int = 0) -> int | None:
        """Return 0-indexed line number of appendix header on `page` (at or after `min_line_idx`), or None."""
        import unicodedata

        lines = [unicodedata.normalize("NFC", ln) for ln in page.text.splitlines()]
        for idx in range(max(0, min_line_idx), len(lines)):
            stripped = lines[idx].strip()
            if not stripped or stripped.islower():
                continue
            if _APPENDIX_HEADERS.match(stripped) or _POST_BIB_APPENDIX_SINGLE_LINE_RE.match(stripped):
                return idx
            # Split-line subsection number before post-bib stop header (e.g. "6.2.\nChi tiết phân công công việc")
            if re.fullmatch(r"(?:\d+(?:\.\d+)+|X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X))[\.\)]?", stripped) and idx + 1 < len(lines):
                for j_nx in range(idx + 1, min(idx + 3, len(lines))):
                    nx_s = lines[j_nx].strip()
                    if nx_s:
                        if _APPENDIX_HEADERS.match(nx_s) or _POST_BIB_APPENDIX_SINGLE_LINE_RE.match(nx_s):
                            return idx
                        break
            # Two-line LaTeX \appendix \section{...}: standalone "A" / "A." followed by section title line
            if stripped in ("A", "A.", "Appendix A") and idx + 1 < len(lines):
                if stripped in ("A", "A."):
                    prev_nonempty = ""
                    for j in range(idx - 1, max(-1, idx - 5), -1):
                        if lines[j].strip():
                            prev_nonempty = lines[j].strip()
                            break
                    # Reject wrapped article "A" or author initial "A." inside bibliography entries
                    if prev_nonempty and (
                        not prev_nonempty.endswith(".")
                        or re.fullmatch(r"\d+\.", prev_nonempty)
                        or len(prev_nonempty.split()) == 1
                    ):
                        continue
                    following_ref_markers = sum(
                        1
                        for ln in lines[idx + 1 : min(len(lines), idx + 25)]
                        if re.match(r"^\s*(?:\[\d{1,3}\]|\d{1,3}\.)(?:\s|$)", ln.strip())
                        and "?" not in ln
                        and not re.match(
                            r"^\s*\d{1,3}\.\s+(?:If|How|What|Why|When|Where|Which|Who|Do|Does|Did|Can|Could|Would|Should)\b",
                            ln.strip(),
                            re.IGNORECASE,
                        )
                    )
                    if following_ref_markers >= 2:
                        continue
                nxt = ""
                for j in range(idx + 1, min(idx + 4, len(lines))):
                    if lines[j].strip():
                        nxt = lines[j].strip()
                        break
                if (
                    nxt
                    and 3 <= len(nxt) <= 80
                    and (len(nxt.split()) >= 2 or stripped == "Appendix A")
                    and nxt[0].isupper()
                    and not re.search(r"\b(?:19|20)\d{2}\b|https?://", nxt)
                    and not nxt.endswith(".")
                ):
                    return idx
        return None

    @staticmethod
    def _page_has_appendix_header(page: Page) -> bool:
        """True nếu page có dòng khớp appendix header."""
        return SectionSegmenter._find_appendix_header_line_idx(page) is not None

    def _build_section(
        self,
        section_type: SectionType,
        start_page: int,
        end_page: int,
        doc: Document,
        *,
        appendix_page: int | None = None,
        appendix_line_idx: int | None = None,
    ) -> DocumentSection:
        """Ghép text của tất cả page trong range."""
        parts: list[str] = []
        metadata: dict = {}
        pages = [p for p in doc.pages if start_page <= p.page_num <= end_page]
        for p in pages:
            if not p.text:
                continue
            if section_type == SectionType.BIBLIOGRAPHY and (
                p.page_num == start_page or (appendix_page == p.page_num and appendix_line_idx is not None)
            ):
                lines = p.text.splitlines()
                slice_start = 0
                slice_end = len(lines)
                if p.page_num == start_page:
                    hdr_idx = self._find_bibliography_header_line_idx(p)
                    if hdr_idx is not None and hdr_idx > 0:
                        # Include standalone section/Roman numeral on preceding line (e.g. "IV.\nTÀI LIỆU THAM KHẢO")
                        for prev_i in range(hdr_idx - 1, max(-1, hdr_idx - 3), -1):
                            prev_s = lines[prev_i].strip()
                            if not prev_s:
                                continue
                            if re.fullmatch(
                                r"(?:X{0,2}(?:I{1,3}|IV|V|VI{0,3}|IX|X)|\d+(?:\.\d+)*)[\.\)]?",
                                prev_s,
                                re.IGNORECASE,
                            ):
                                hdr_idx = prev_i
                            break
                        pre_text = "\n".join(lines[:hdr_idx]).strip()
                        if len(pre_text) >= 60:
                            metadata["pre_header_body_text"] = pre_text
                            metadata["pre_header_page_num"] = p.page_num
                        slice_start = hdr_idx
                    elif hdr_idx is None:
                        first_ref_idx = None
                        for idx_ln, ln_str in enumerate(lines):
                            if re.match(r"^\s*(?:\[1\]|1\.)(?:\s+[A-ZÀ-Ý]|\s*$)", ln_str.strip()):
                                # Verify 2. or [2] follows later on this page
                                if any(
                                    re.match(r"^\s*(?:\[2\]|2\.)(?:\s+[A-ZÀ-Ý]|\s*$)", later_ln.strip())
                                    for later_ln in lines[idx_ln + 1 :]
                                ):
                                    first_ref_idx = idx_ln
                                    break
                        if first_ref_idx is not None and first_ref_idx > 0:
                            pre_text = "\n".join(lines[:first_ref_idx]).strip()
                            if len(pre_text) >= 60:
                                metadata["pre_header_body_text"] = pre_text
                                metadata["pre_header_page_num"] = p.page_num
                            slice_start = first_ref_idx
                if appendix_page == p.page_num and appendix_line_idx is not None:
                    slice_end = max(slice_start, appendix_line_idx)
                parts.append("\n".join(lines[slice_start:slice_end]))
                continue
            if (
                section_type == SectionType.APPENDIX
                and p.page_num == start_page
                and appendix_page == p.page_num
                and appendix_line_idx is not None
                and appendix_line_idx > 0
            ):
                lines = p.text.splitlines()
                parts.append("\n".join(lines[appendix_line_idx:]))
                continue
            parts.append(p.text)
        text = "\n".join(parts)
        return DocumentSection(
            section_type=section_type,
            start_page=start_page,
            end_page=end_page,
            text=text,
            page_break_used=(end_page > start_page),
            metadata=metadata,
        )

    @staticmethod
    def _extract_footnote_bibliography_section(
        doc: Document,
    ) -> DocumentSection | None:
        """Synthesize a BIBLIOGRAPHY section from sequential bottom-of-page footnotes.

        Used only when a multi-page document (≥5 pages) has no explicit or implicit
        bibliography section at the end, but contains ≥8 sequential numbered footnotes
        (1, 2, 3, ...) with publication years across its pages (pure Chicago notes style).
        """
        if doc.num_pages < 5:
            return None

        footer_noise_re = re.compile(
            r"^(?:\d{1,3}|Page\s+\d+\s+of\s+\d+|URL:\s*https?://\S+.*|History\s+of\s+Education)$",
            re.IGNORECASE,
        )
        fn_start_re = re.compile(r"^\s*(\d{1,3})\.?\s+([A-ZÀ-Ý“\"‘'].*)")
        lead_prefix_re = re.compile(
            r"^(?:For\s+example\s*:\s*|See\s+also\s+|See\s+|Including\s+|"
            r"For\s+an\s+overview\s+of\s+[^,]{1,40},\s*see\s+|Cf\.\s+)",
            re.IGNORECASE,
        )

        prev_num = 0
        footnotes: list[tuple[int, str, int]] = []

        for page in doc.pages:
            if not page.text:
                continue
            raw_lines = [
                ln.strip()
                for ln in page.text.splitlines()
                if ln.strip() and not footer_noise_re.match(ln.strip())
            ]
            if not raw_lines:
                continue

            page_starts: list[tuple[int, int, str]] = []
            temp_prev = prev_num
            for idx, ln in enumerate(raw_lines):
                m = fn_start_re.match(ln)
                if not m:
                    continue
                fn_num = int(m.group(1))
                rest = m.group(2).strip()
                if temp_prev < fn_num <= temp_prev + 12:
                    window = " ".join(raw_lines[idx : min(len(raw_lines), idx + 6)])
                    has_cue = bool(
                        re.search(
                            r"\b(?:18|19|20)\d{2}\b|\b(?:Ibid|op\.\s*cit|ed\.|eds\.|pp?\.|Vol\.)\b|[“\"‘']|:.*,",
                            window,
                            re.IGNORECASE,
                        )
                    )
                    if has_cue or (page_starts and fn_num == temp_prev + 1):
                        page_starts.append((idx, fn_num, rest))
                        temp_prev = fn_num

            if not page_starts:
                continue

            prev_num = temp_prev
            for k, (start_idx, fn_num, first_rest) in enumerate(page_starts):
                end_idx = page_starts[k + 1][0] if k + 1 < len(page_starts) else len(raw_lines)
                cont_lines = [first_rest] + raw_lines[start_idx + 1 : end_idx]
                full_fn = " ".join(cont_lines).strip()
                full_fn = lead_prefix_re.sub("", full_fn).strip()
                footnotes.append((fn_num, full_fn, page.page_num))

        if len(footnotes) < 8:
            return None

        combined_text = "\n".join(f"{num}. {txt}" for num, txt, _ in footnotes)
        year_hits = len(re.findall(r"\b(?:18|19|20)\d{2}\b", combined_text))
        if year_hits < 5:
            return None

        return DocumentSection(
            section_type=SectionType.BIBLIOGRAPHY,
            start_page=footnotes[0][2],
            end_page=footnotes[-1][2],
            text="Notes\n" + combined_text,
            page_break_used=True,
            metadata={"synthetic_footnote_bibliography": True},
        )

    @staticmethod
    def _extract_per_page_extras(
        body_section: DocumentSection, doc: Document
    ) -> list[DocumentSection]:
        """Tách footnote / figure-caption RIÊNG từ body.

        Mỗi page trong body: các dòng khớp footnote/figure-caption pattern
        → tách thành section riêng (để CitationExtractor KHÔNG chạy trên đó).

        Hiện tại: trả về 1 placeholder section rỗng nếu có extras,
        hoặc [] nếu không. Full implementation sẽ tách dòng ở tuần 6–7 tiếp
        (cần Page-level extras).
        """
        # TODO: implement per-page extras khi CitationExtractor hỗ trợ
        #       per-section extraction. Hiện tại body đã gộp hết, không cần
        #       tách thêm.
        return []
