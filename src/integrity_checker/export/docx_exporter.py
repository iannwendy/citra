"""DOCX export functionality for analysis reports."""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from io import BytesIO
from typing import IO, Any, Literal

from defusedxml.ElementTree import fromstring as safe_fromstring
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import Pt, RGBColor

_MAX_DOCX_PART_BYTES = 50 * 1024 * 1024
_MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
_MAX_DOCX_ARCHIVE_ENTRIES = 2048
_HEX_COLOR_RE = re.compile(r"^[0-9A-Fa-f]{6}$")
_XML_ILLEGAL_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def _sanitize_xml_text(val: Any) -> str:
    """Strip XML 1.0 illegal ASCII control chars (e.g. PDF \\x0c form-feed) before lxml writes."""
    if val is None:
        return ""
    return _XML_ILLEGAL_CTRL_RE.sub("", str(val))


def _sanitize_xml_value(obj: Any) -> Any:
    """Recursively strip XML-illegal control characters from strings/dicts/lists."""
    if isinstance(obj, str):
        return _XML_ILLEGAL_CTRL_RE.sub("", obj)
    if isinstance(obj, dict):
        return {_sanitize_xml_value(k): _sanitize_xml_value(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_xml_value(item) for item in obj]
    if isinstance(obj, tuple):
        return tuple(_sanitize_xml_value(item) for item in obj)
    return obj


def _has_xml_magic_prefix(head_bytes: bytes) -> bool:
    """Return True if raw entry header begins (after BOM/whitespace) with XML/comment/DTD/ENTITY markers."""
    raw = head_bytes
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    elif raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            decoded = raw.decode("utf-16", errors="ignore").lstrip()
            return decoded.lower().startswith(("<?xml", "<!--", "<!doctype", "<!entity"))
        except Exception:
            return False
    stripped = raw.lstrip(b" \t\r\n").lower()
    return stripped.startswith((b"<?xml", b"<!--", b"<!doctype", b"<!entity"))


def _window_has_dtd_or_entity(window: bytes, *, is_utf16: bool = False) -> bool:
    """Return True if a byte window contains DTD or ENTITY declarations (ASCII/UTF-8 or UTF-16)."""
    low = window.lower()
    if b"<!doctype" in low or b"<!entity" in low:
        return True
    if is_utf16 or b"<\x00!" in window or b"\x00<\x00!" in window:
        for enc in ("utf-16-le", "utf-16-be"):
            try:
                dec_low = window.decode(enc, errors="ignore").lower()
                if "<!doctype" in dec_low or "<!entity" in dec_low:
                    return True
            except Exception:
                continue
    return False


def _docx_xml_is_safe(docx_path: str | os.PathLike[str] | IO[bytes]) -> bool:
    """Validate every XML part of an untrusted .docx with defusedxml.

    Rejects packages missing [Content_Types].xml or word/document.xml, containing duplicate
    archive member names (central-directory shadowing), exceeding entry-count caps, declaring
    DTDs/entities (billion laughs, XXE — including disguised non-.xml or comment-prefixed parts),
    malformed XML, or oversized parts/archives (zip bomb, including spoofed info.file_size headers)
    before python-docx opens them.
    """
    import zipfile

    chunk_size = 65536
    try:
        with zipfile.ZipFile(docx_path, "r") as zf:
            infos = zf.infolist()
            if len(infos) > _MAX_DOCX_ARCHIVE_ENTRIES:
                return False

            seen_names: set[str] = set()
            ct_info: zipfile.ZipInfo | None = None
            for info in infos:
                if info.is_dir():
                    continue
                norm = info.filename.replace("\\", "/").lstrip("/").rstrip("/").lower()
                if not norm or norm in seen_names:
                    return False
                seen_names.add(norm)
                if norm == "[content_types].xml":
                    ct_info = info

            if (
                ct_info is None
                or "word/document.xml" not in seen_names
                or "[content_types].xml" not in seen_names
            ):
                return False

            total_uncompressed = 0
            declared_total = max(0, int(ct_info.file_size or 0))
            if (
                declared_total > _MAX_DOCX_PART_BYTES
                or declared_total > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
            ):
                return False

            ct_chunks: list[bytes] = []
            ct_bytes_len = 0
            ct_tail = b""
            ct_is_utf16 = False
            with zf.open(ct_info, "r") as ct_fp:
                while True:
                    chunk = ct_fp.read(chunk_size)
                    if not chunk:
                        break
                    if ct_bytes_len == 0 and chunk.startswith((b"\xff\xfe", b"\xfe\xff")):
                        ct_is_utf16 = True
                    chunk_len = len(chunk)
                    ct_bytes_len += chunk_len
                    total_uncompressed += chunk_len
                    if (
                        ct_bytes_len > _MAX_DOCX_PART_BYTES
                        or total_uncompressed > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
                    ):
                        return False
                    if _window_has_dtd_or_entity(ct_tail + chunk, is_utf16=ct_is_utf16):
                        return False
                    ct_tail = chunk[-64:]
                    ct_chunks.append(chunk)

            ct_root = safe_fromstring(
                b"".join(ct_chunks),
                forbid_dtd=True,
                forbid_entities=True,
                forbid_external=True,
            )
            xml_extensions: set[str] = {"xml", "rels"}
            xml_part_names: set[str] = set()
            for elem in ct_root.iter():
                local_tag = elem.tag.rsplit("}", 1)[-1].lower() if isinstance(elem.tag, str) else ""
                ctype_base = (elem.attrib.get("ContentType") or "").split(";", 1)[0].strip().lower()
                is_xml_ctype = (
                    ctype_base
                    in (
                        "application/xml",
                        "text/xml",
                        "application/vnd.openxmlformats-officedocument.vmldrawing",
                    )
                    or ctype_base.endswith("+xml")
                )
                if not is_xml_ctype:
                    continue
                if local_tag == "default":
                    ext = (elem.attrib.get("Extension") or "").strip().lstrip(".").lower()
                    if ext:
                        xml_extensions.add(ext)
                elif local_tag == "override":
                    pname = (
                        (elem.attrib.get("PartName") or "")
                        .replace("\\", "/")
                        .lstrip("/")
                        .rstrip("/")
                        .lower()
                    )
                    if pname:
                        xml_part_names.add(pname)

            for info in infos:
                if info is ct_info or info.is_dir():
                    continue
                declared_size = max(0, int(info.file_size or 0))
                declared_total += declared_size
                if (
                    declared_size > _MAX_DOCX_PART_BYTES
                    or declared_total > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
                ):
                    return False

                lower_name = info.filename.replace("\\", "/").lstrip("/").rstrip("/").lower()
                ext = lower_name.rsplit(".", 1)[-1] if "." in lower_name else ""
                is_declared_xml = (ext in xml_extensions) or (lower_name in xml_part_names)

                xml_chunks: list[bytes] = []
                head_buf = bytearray()
                tail_buf = b""
                entry_is_utf16 = False
                should_parse_xml = is_declared_xml
                part_bytes = 0
                with zf.open(info, "r") as entry_fp:
                    while True:
                        chunk = entry_fp.read(chunk_size)
                        if not chunk:
                            break
                        if part_bytes == 0 and chunk.startswith((b"\xff\xfe", b"\xfe\xff")):
                            entry_is_utf16 = True
                        chunk_len = len(chunk)
                        part_bytes += chunk_len
                        total_uncompressed += chunk_len
                        if (
                            part_bytes > _MAX_DOCX_PART_BYTES
                            or total_uncompressed > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
                        ):
                            return False
                        if _window_has_dtd_or_entity(tail_buf + chunk, is_utf16=entry_is_utf16):
                            return False
                        tail_buf = chunk[-64:]
                        if not should_parse_xml and len(head_buf) < 512:
                            head_buf.extend(chunk[: 512 - len(head_buf)])
                            if _has_xml_magic_prefix(bytes(head_buf)):
                                should_parse_xml = True
                        if should_parse_xml:
                            xml_chunks.append(chunk)

                if should_parse_xml:
                    safe_fromstring(
                        b"".join(xml_chunks),
                        forbid_dtd=True,
                        forbid_entities=True,
                        forbid_external=True,
                    )
    except Exception:
        return False
    return True


def _set_cell_background(cell, hex_color: str) -> None:
    """Apply background shading color (e.g. 'FEE2E2') to a python-docx table cell."""
    if not _HEX_COLOR_RE.match(str(hex_color or "")):
        return
    try:
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        cell._tc.get_or_add_tcPr().append(shading)
    except Exception:
        pass


_CIS_WEIGHT_KEYS = (
    "verified_ratio",
    "metadata_accuracy",
    "in_text_bib_consistency",
    "format_consistency",
    "identifier_validity",
)


def _resolve_cis_weights(cis_weights: dict[str, float] | None) -> dict[str, float]:
    """Effective CIS weights: explicit (e.g. report ``weights_used``) else settings."""
    from integrity_checker.config import get_settings

    resolved = dict(get_settings().cis.weights.model_dump())
    if cis_weights and isinstance(cis_weights, dict):
        for key in _CIS_WEIGHT_KEYS:
            val = cis_weights.get(key)
            if isinstance(val, int | float):
                resolved[key] = float(val)
    return resolved


def _format_weight(value: float) -> str:
    pct = float(value) * 100.0
    return f"{pct:.0f}%" if abs(pct - round(pct)) < 1e-6 else f"{pct:.1f}%"


_RULE_DESCRIPTIONS_EN: dict[str, str] = {
    "R-CONSENSUS-FULL": "Confirmed across multiple academic libraries",
    "R-CONSENSUS-PARTIAL": "Partially confirmed across academic libraries",
    "R-SINGLE-SOURCE-VERIFIED": "Confirmed in an academic library",
    "R-SINGLE-SOURCE-PARTIAL": "Partially matched in an academic library",
    "R-DOI-TITLE-AUTHOR": "DOI, title, and authors match official record",
    "R-GLOBAL-DOI-RA-VERIFIED": "Valid DOI registered in global DOI registry",
    "R-KNOWN-PAPER": "Matched standard academic reference catalog",
    "R-LOCAL_DB_VERIFIED": "Matched indexed academic library",
    "R-LOCAL_DB_GOOD_MATCH": "Strong match in indexed academic library",
    "R-LOCAL_DB_METADATA_ERROR": "Details differ from indexed academic library record",
    "R-BOOK-EDITION-VERIFIED": "Matched published book or edition",
    "R-VN-TEXTBOOK-VERIFIED": "Matched Vietnamese textbook or academic curriculum",
    "R-VN-STANDARD-VERIFIED": "Matched Vietnamese technical standard",
    "R-VN-LEGAL-VERIFIED": "Verified Vietnamese legal statute",
    "R-VN-LEGAL-SUPERSEDED": "Vietnamese legal statute superseded by newer legislation",
    "R-VN-LEGAL-MISMATCH": "Vietnamese legal statute details differ from official registry",
    "R-VN-LEGAL-FABRICATED": "Vietnamese legal document not found in official registry",
    "R-LEGAL-DOCUMENT": "Recognized legal or regulatory document",
    "R-GITHUB-VERIFIED": "Verified software repository source",
    "R-HF-VERIFIED": "Verified dataset or model source",
    "R-PACKAGE-VERIFIED": "Verified software package reference",
    "R-RFC-VERIFIED": "Verified technical standard document",
    "R-WIKIDATA-VERIFIED": "Verified reference in open knowledge catalog",
    "R-WEB-RESOURCE": "Web page or online resource",
    "R-URL-RESOURCE": "Online link reference",
    "R-NON-SCHOLARLY-RESOURCE": "Non-journal reference source",
    "R-WAYBACK-ARCHIVED": "Archived copy found on Wayback Machine",
    "R-DEAD-URL": "Web link is currently unreachable",
    "R-BROKEN-LINK": "Web link could not be opened",
    "R-FAKE-URL": "Placeholder or invalid web domain",
    "R-URL-CONTENT-MISMATCH": "Web page content differs from citation details",
    "R-INCOMPLETE-METADATA": "Incomplete citation details",
    "R-YEAR-MISMATCH": "Publication year differs from official record",
    "R-FUTURE-YEAR": "Cited publication year is in the future",
    "R-FUTURE-YEAR-KNOWN-AUTHOR": "Publication year error for matched author",
    "R-TITLE-MISMATCH": "Title differs from official record",
    "R-VENUE-MISMATCH": "Journal or publisher differs from official record",
    "R-DOI-CONFLICT": "DOI points to a different publication",
    "R-DOI-METADATA-MISMATCH": "DOI matched, but citation details differ",
    "R-DOI-TITLE-MISMATCH": "DOI matched, but title differs from official record",
    "R-DOI-RA-NO-CSL": "DOI registered, but full bibliographic details unavailable",
    "R-DOMAIN-EXCEPTION": "DOI matched with domain-specific title variation",
    "R-FABRICATED-DOI": "Invalid or unregistered placeholder DOI",
    "R-NONEXISTENT-DOI": "DOI not found in global DOI registry",
    "R-CHIMERIC-DOI-MISMATCH": "DOI does not match the cited title and authors",
    "R-NO-SCHOLARLY-RECORD": "No matching record found in academic libraries",
    "R-NO-CANDIDATE": "No matching source found",
    "R-FAIL-ALL": "No matching record found across checked libraries",
    "R-HALLUCINATED-SOURCE": "Source not found in indexed academic libraries",
    "R-FAKE-AUTHOR": "Author list does not match the matched publication",
    "R-KNOWN-AUTHOR-TITLE-MISMATCH": "Author found, but cited title could not be confirmed",
    "R-KNOWN-AUTHOR-WEAK-EVIDENCE": "Limited matching details for cited author",
    "R-RETRACTED-PAPER": "Publication flagged as retracted",
    "R-CONTENT-ALIGNMENT": "Citation context aligns with source abstract",
    "R-CONTENT-MISMATCH": "Citation context differs from source topic",
    "R-CROSS-LINGUAL-ALIGNMENT": "Vietnamese citation aligns with English source",
    "R-CROSS-LINGUAL-TITLE-MATCH": "Translated title matches original source",
    "R-RATE-LIMITED-ABSTAIN": "Academic libraries temporarily busy; manual review needed",
    "R-ABSTENTION-BORDER": "Borderline match; manual check recommended",
    "R-WEAK-EVIDENCE": "Insufficient matching details; manual check recommended",
    "R-UNINDEXED-BOOK-OR-SOURCE": "Book or local source not indexed online",
    "R-AMBIGUOUS-MAPPING": "Ambiguous match between in-text citation and reference list",
    "R-STYLE-INCONSISTENT": "Citation formatting differs from document style",
    "R-WELL-LINKED": "In-text citation matches reference list",
    "R-WELL-LINKED-MODERATE": "In-text citation linked to reference list",
}

_RULE_DESCRIPTIONS_VI: dict[str, str] = {
    "R-CONSENSUS-FULL": "Đã xác minh trùng khớp trên nhiều thư viện học thuật",
    "R-CONSENSUS-PARTIAL": "Đã đối chiếu khớp một phần trên các thư viện học thuật",
    "R-SINGLE-SOURCE-VERIFIED": "Đã xác minh khớp trên thư viện học thuật",
    "R-SINGLE-SOURCE-PARTIAL": "Khớp một phần trên thư viện học thuật",
    "R-DOI-TITLE-AUTHOR": "Mã DOI, tiêu đề và tác giả khớp với bản gốc",
    "R-GLOBAL-DOI-RA-VERIFIED": "Mã DOI hợp lệ trên hệ thống đăng ký DOI toàn cầu",
    "R-KNOWN-PAPER": "Khớp với danh mục tài liệu học thuật tiêu chuẩn",
    "R-LOCAL_DB_VERIFIED": "Khớp với thư viện học thuật tích hợp",
    "R-LOCAL_DB_GOOD_MATCH": "Độ khớp cao trên thư viện học thuật tích hợp",
    "R-LOCAL_DB_METADATA_ERROR": "Thông tin có sai lệch so với bản ghi học thuật",
    "R-BOOK-EDITION-VERIFIED": "Khớp với đầu sách hoặc ấn bản đã xuất bản",
    "R-VN-TEXTBOOK-VERIFIED": "Khớp với giáo trình / tài liệu học thuật Việt Nam",
    "R-VN-STANDARD-VERIFIED": "Khớp với tiêu chuẩn kỹ thuật Việt Nam",
    "R-VN-LEGAL-VERIFIED": "Đã xác minh văn bản quy phạm pháp luật Việt Nam",
    "R-VN-LEGAL-SUPERSEDED": "Văn bản pháp luật đã được thay thế bởi văn bản mới hơn",
    "R-VN-LEGAL-MISMATCH": "Thông tin văn bản pháp luật chưa khớp với cơ sở dữ liệu chính thức",
    "R-VN-LEGAL-FABRICATED": "Chưa tìm thấy văn bản pháp luật khớp trong cơ sở dữ liệu",
    "R-LEGAL-DOCUMENT": "Tài liệu pháp lý / quy phạm pháp luật",
    "R-GITHUB-VERIFIED": "Đã xác minh nguồn mã nguồn phần mềm",
    "R-HF-VERIFIED": "Đã xác minh nguồn dữ liệu hoặc mô hình",
    "R-PACKAGE-VERIFIED": "Đã xác minh nguồn thư viện phần mềm",
    "R-RFC-VERIFIED": "Đã xác minh tài liệu tiêu chuẩn kỹ thuật",
    "R-WIKIDATA-VERIFIED": "Đã xác minh trên danh mục tri thức mở",
    "R-WEB-RESOURCE": "Trang web hoặc tài nguyên trực tuyến",
    "R-URL-RESOURCE": "Tài liệu dạng liên kết web",
    "R-NON-SCHOLARLY-RESOURCE": "Nguồn tham khảo ngoài tạp chí học thuật",
    "R-WAYBACK-ARCHIVED": "Tìm thấy bản lưu trữ trên Wayback Machine",
    "R-DEAD-URL": "Liên kết web hiện không truy cập được",
    "R-BROKEN-LINK": "Không thể mở đường dẫn liên kết",
    "R-FAKE-URL": "Tên miền đường dẫn không hợp lệ hoặc giả định",
    "R-URL-CONTENT-MISMATCH": "Nội dung trang web không khớp với trích dẫn",
    "R-INCOMPLETE-METADATA": "Thiếu thông tin trích dẫn quan trọng",
    "R-YEAR-MISMATCH": "Năm xuất bản khác với bản gốc",
    "R-FUTURE-YEAR": "Năm xuất bản ghi nhận ở tương lai",
    "R-FUTURE-YEAR-KNOWN-AUTHOR": "Sai lệch năm xuất bản của tác giả tìm thấy",
    "R-TITLE-MISMATCH": "Tiêu đề khác với bản ghi chính thức",
    "R-VENUE-MISMATCH": "Tên tạp chí / nơi xuất bản khác với bản gốc",
    "R-DOI-CONFLICT": "Mã DOI trỏ tới một tài liệu khác",
    "R-DOI-METADATA-MISMATCH": "Mã DOI khớp nhưng thông tin trích dẫn có sai lệch",
    "R-DOI-TITLE-MISMATCH": "Mã DOI khớp nhưng tiêu đề khác với bản gốc",
    "R-DOI-RA-NO-CSL": "Mã DOI có đăng ký nhưng chưa đủ thông tin thư mục chi tiết",
    "R-DOMAIN-EXCEPTION": "Mã DOI khớp nhưng tiêu đề có biến thể đặc thù ngành",
    "R-FABRICATED-DOI": "Mã DOI không hợp lệ hoặc thuộc tiền tố thử nghiệm",
    "R-NONEXISTENT-DOI": "Không tìm thấy mã DOI trên hệ thống đăng ký toàn cầu",
    "R-CHIMERIC-DOI-MISMATCH": "Mã DOI không khớp với tiêu đề và tác giả được trích dẫn",
    "R-NO-SCHOLARLY-RECORD": "Không tìm thấy tài liệu khớp trên thư viện học thuật",
    "R-NO-CANDIDATE": "Chưa tìm thấy nguồn tài liệu tương ứng",
    "R-FAIL-ALL": "Chưa tìm thấy bản ghi khớp trên các thư viện đã tra cứu",
    "R-HALLUCINATED-SOURCE": "Không tìm thấy nguồn trên các thư viện học thuật trực tuyến",
    "R-FAKE-AUTHOR": "Danh sách tác giả không khớp với bản gốc tìm thấy",
    "R-KNOWN-AUTHOR-TITLE-MISMATCH": "Tìm thấy tác giả nhưng chưa xác minh được tiêu đề trích dẫn",
    "R-KNOWN-AUTHOR-WEAK-EVIDENCE": "Thiếu thông tin đối chiếu cho tác giả được trích dẫn",
    "R-RETRACTED-PAPER": "Bài báo có thông báo đã bị rút bài (retracted)",
    "R-CONTENT-ALIGNMENT": "Ngữ cảnh trích dẫn phù hợp với tóm tắt bài gốc",
    "R-CONTENT-MISMATCH": "Ngữ cảnh trích dẫn chưa sát với nội dung bài gốc",
    "R-CROSS-LINGUAL-ALIGNMENT": "Trích dẫn tiếng Việt phù hợp với bài gốc tiếng Anh",
    "R-CROSS-LINGUAL-TITLE-MATCH": "Tiêu đề dịch khớp với bài gốc tiếng Anh",
    "R-RATE-LIMITED-ABSTAIN": "Thư viện tra cứu tạm thời bận; cần kiểm tra thủ công",
    "R-ABSTENTION-BORDER": "Mức độ khớp ở ngưỡng biên; nên kiểm tra thủ công",
    "R-WEAK-EVIDENCE": "Chưa đủ thông tin để xác minh tự động",
    "R-UNINDEXED-BOOK-OR-SOURCE": "Sách hoặc tài liệu nội bộ chưa được số hóa trực tuyến",
    "R-AMBIGUOUS-MAPPING": "Đối chiếu giữa trích dẫn trong bài và danh mục chưa rõ ràng",
    "R-STYLE-INCONSISTENT": "Định dạng trích dẫn chưa đồng nhất với chuẩn của tài liệu",
    "R-WELL-LINKED": "Trích dẫn trong bài khớp với danh mục cuối bài",
    "R-WELL-LINKED-MODERATE": "Trích dẫn trong bài đã liên kết với danh mục cuối bài",
}

_RAW_RULE_CODE_PREFIX_RE = re.compile(r"^R(?:\d+[_-]?|-)", re.IGNORECASE)
_NEURAL_BLOCK_RE = re.compile(r"\s*\[Neural:[^\]]*\]", re.IGNORECASE)
_PROVENANCE_BLOCK_RE = re.compile(r"\s*\[provenance penalty:[^\]]*\]", re.IGNORECASE)
_ML_METRIC_RE = re.compile(
    r"\b(?:author_jaccard|fuzzy_title_sim|title_sim(?:_fuzzy|_semantic)?|semantic_sim|"
    r"author_sim|venue_sim|year_distance|evidence_sim|neural\s*score|"
    r"content\s+alignment\s+score)\s*[=<>!]+\s*[^,;.)\]]+",
    re.IGNORECASE,
)
_GREY_ZONE_INTERVAL_RE = re.compile(r"\s*\(?[\d.]+\s+in\s*\[\s*[\d.]+\s*,\s*[\d.]+\s*\)\)?", re.IGNORECASE)
_DOI_MATCH_BOOL_RE = re.compile(r",?\s*DOI\s+match\s*=\s*(?:True|False)", re.IGNORECASE)
_INLINE_RULE_CODE_RE = re.compile(r"\bR-[A-Z0-9_-]+\b")


def _humanize_rule_code(rule: Any, *, is_vi: bool = False) -> str:
    """Convert an internal rule code (e.g. R-YEAR-MISMATCH, R02) into a plain-language check description."""
    code = str(rule or "").strip()
    if not code:
        return ""
    table = _RULE_DESCRIPTIONS_VI if is_vi else _RULE_DESCRIPTIONS_EN
    if code in table:
        return table[code]
    upper = code.upper()
    if upper in table:
        return table[upper]
    # Generic fallback for numbered codes (e.g. R01, R02) or unknown R-* codes
    if re.fullmatch(r"R\d{1,3}", upper):
        return "Kiểm tra thông tin trích dẫn" if is_vi else "Citation metadata check"
    cleaned = _RAW_RULE_CODE_PREFIX_RE.sub("", code).replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return "Kiểm tra trích dẫn" if is_vi else "Citation verification check"
    return cleaned[0].upper() + cleaned[1:].lower()


def _humanize_rules(rules: list[Any], *, is_vi: bool = False) -> list[str]:
    """Deduplicate and convert internal rule codes into plain-language check items."""
    out: list[str] = []
    seen: set[str] = set()
    for r in rules or []:
        desc = _humanize_rule_code(r, is_vi=is_vi)
        if desc and desc not in seen:
            seen.add(desc)
            out.append(desc)
    return out


def _human_verdict_label(lbl_lower: str, rules: list[Any] | None = None, *, is_vi: bool = False) -> str:
    """Map internal verdict enum to calm, non-accusatory academic status label."""
    rules_set = {str(r) for r in (rules or [])}
    if lbl_lower == "verified":
        return "Đã xác minh" if is_vi else "Verified"
    if lbl_lower == "metadata_error":
        if "R-INCOMPLETE-METADATA" in rules_set:
            return "Thiếu thông tin trích dẫn" if is_vi else "Incomplete Details"
        return "Sai lệch thông tin" if is_vi else "Details Mismatch"
    if lbl_lower == "suspected_hallucination":
        return "Không tìm thấy nguồn" if is_vi else "Source Not Found"
    if lbl_lower == "resource":
        return "Nguồn Web / Văn bản" if is_vi else "Web / Legal Source"
    return "Cần kiểm tra thủ công" if is_vi else "Needs Manual Check"


def _human_mapping_status(status: Any, *, is_vi: bool = False) -> str:
    """Map internal Layer-1 mapping status key into natural display text."""
    key = str(status or "").strip().lower()
    en_map = {
        "matched": "Linked",
        "missing_reference": "Missing from References",
        "uncited_reference": "Not Cited in Text",
        "in_text_mismatch": "In-Text Mismatch",
        "duplicate_reference": "Duplicate Entry",
        "ambiguous_mapping": "Ambiguous Match",
        "style_inconsistent": "Style Issue",
        "not_applicable": "Not Applicable",
        "unresolved": "Needs Review",
        "reference_list": "Reference List",
        "in_text": "In-Text",
    }
    vi_map = {
        "matched": "Đã khớp danh mục",
        "missing_reference": "Thiếu ở danh mục",
        "uncited_reference": "Chưa trích dẫn trong bài",
        "in_text_mismatch": "Lệch với danh mục",
        "duplicate_reference": "Trùng lặp danh mục",
        "ambiguous_mapping": "Khớp chưa rõ ràng",
        "style_inconsistent": "Khác chuẩn trích dẫn",
        "not_applicable": "Không áp dụng",
        "unresolved": "Cần kiểm tra",
        "reference_list": "Danh mục tham khảo",
        "in_text": "Trích dẫn trong bài",
    }
    mapping = vi_map if is_vi else en_map
    if key in mapping:
        return mapping[key]
    return key.replace("_", " ").title() if key else ("Không rõ" if is_vi else "Unknown")


def _sanitize_export_reasoning(reasoning: Any, *, is_vi: bool = False) -> str:
    """Strip ML telemetry, rule codes, and accusatory wording from reasoning before Word export."""
    text = _sanitize_xml_text(reasoning).strip()
    if not text:
        return ""
    text = _NEURAL_BLOCK_RE.sub("", text)
    text = _PROVENANCE_BLOCK_RE.sub("", text)
    text = _ML_METRIC_RE.sub("", text)
    text = _GREY_ZONE_INTERVAL_RE.sub("", text)
    text = _DOI_MATCH_BOOL_RE.sub("", text)
    text = _INLINE_RULE_CODE_RE.sub("", text)
    # Soften accusatory / raw enum phrases
    replacements = [
        (r"Suspected\s+AI-hallucinated\s+or\s+fabricated\s+citation", "Source not found in academic libraries"),
        (r"Suspected\s+AI-hallucinated\s+or\s+non-existent\s+reference", "Source not found in academic libraries"),
        (r"Suspected\s+hallucinated\s+link/reference", "Source or link could not be verified"),
        (r"Suspected\s+hallucination", "Source Not Found"),
        (r"SUSPECTED_HALLUCINATION", "Source Not Found"),
        (r"METADATA_ERROR", "Details Mismatch"),
        (r"DOMAIN-EXCEPTION:\s*", ""),
        (r"nghi\s+vấn\s+(?:nguồn\s+)?(?:bịa\s+đặt|ngụy\s+tạo)", "không tìm thấy nguồn khớp"),
        (r"bịa\s+đặt", "chưa được xác minh"),
        (r"ngụy\s+tạo", "không hợp lệ"),
        (r"\bhallucinated\b", "unverified"),
        (r"\bhallucination\b", "unverified source"),
    ]
    for pat, repl in replacements:
        text = re.sub(pat, repl, text, flags=re.IGNORECASE)
    # Clean leftover empty parens / duplicate separators
    text = re.sub(r"\(\s*[,;:\s]*\)", "", text)
    text = re.sub(r"\s*,\s*,+", ",", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;—-")
    if not text:
        return (
            "Không tìm thấy đủ thông tin đối chiếu tự động."
            if is_vi
            else "Automated verification completed; please review details."
        )
    return text


def export_report_to_docx(
    filename: str,
    cis_score: float,
    num_citations: int,
    num_verified: int,
    num_metadata_error: int,
    num_suspected: int,
    num_unresolved: int,
    num_resource: int,
    verdicts: list[dict],
    generated_at: str | None = None,
    *,
    essay_id: int = 1,
    cis_components: dict[str, float] | None = None,
    linking_summary: dict[str, int] | None = None,
    style_profile: dict | None = None,
    cis_weights: dict[str, float] | None = None,
    document_diagnostics: dict[str, Any] | None = None,
    lang: str = "en",
) -> bytes:
    """Generate a DOCX report from analysis results.

    Args:
        filename: Name of the analyzed essay
        cis_score: Citation Integrity Score (0-100)
        num_citations: Total number of citations
        num_verified: Number of verified citations
        num_metadata_error: Number with metadata errors
        num_suspected: Number of sources not found
        num_unresolved: Number of unresolved citations
        num_resource: Number of URL/Resource citations
        verdicts: List of verdict dictionaries
        generated_at: Timestamp string
        cis_weights: CIS weights actually used (report ``weights_used``);
            defaults to ``settings.cis.weights`` so labels never drift.
        lang: Target report language (``"en"`` or ``"vi"``).

    Returns:
        bytes: DOCX file content
    """
    is_vi = str(lang or "en").strip().lower().startswith("vi")
    filename = _sanitize_xml_text(filename)
    generated_at = _sanitize_xml_text(generated_at) if generated_at is not None else None
    verdicts = _sanitize_xml_value(verdicts) or []
    linking_summary = _sanitize_xml_value(linking_summary)
    style_profile = _sanitize_xml_value(style_profile)
    document_diagnostics = _sanitize_xml_value(document_diagnostics)

    doc = Document()

    # Title
    title = doc.add_heading(
        "Báo cáo kiểm tra trích dẫn học thuật" if is_vi else "Citation Integrity Check Report",
        0,
    )
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Metadata
    utc_ts = generated_at or datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    doc.add_paragraph()
    meta = doc.add_paragraph()
    meta.add_run("Tài liệu: " if is_vi else "Document: ").bold = True
    meta.add_run(filename)
    meta = doc.add_paragraph()
    meta.add_run("Thời gian tạo: " if is_vi else "Generated: ").bold = True
    meta.add_run(utc_ts)
    meta = doc.add_paragraph()
    meta.add_run("Hệ thống: " if is_vi else "System: ").bold = True
    meta.add_run("CITRA — Kiểm tra trích dẫn học thuật" if is_vi else "CITRA Academic Citation Checker")

    # Digital Verification Receipt — Task 6.2
    from integrity_checker.api.routes.essays import create_essay_share_token

    share_info = create_essay_share_token(int(essay_id or 1))
    receipt_id = str(share_info["receipt_id"])
    sig_prefix = str(share_info.get("signature_prefix") or "")
    verification_url = str(
        share_info.get("verification_url")
        or f"https://citra.io.vn/verify/share/{share_info['share_token']}"
    )

    doc.add_heading(
        "Chứng nhận kiểm tra trích dẫn CITRA" if is_vi else "CITRA Digital Verification Receipt",
        level=2,
    )
    receipt_summary_p = doc.add_paragraph()
    r_rec_lbl = receipt_summary_p.add_run("Mã chứng nhận: " if is_vi else "Receipt ID: ")
    r_rec_lbl.bold = True
    receipt_summary_p.add_run(f"{receipt_id}  |  ")
    r_url_lbl = receipt_summary_p.add_run("Liên kết xác thực: " if is_vi else "Verification URL: ")
    r_url_lbl.bold = True
    receipt_summary_p.add_run(verification_url)

    receipt_table = doc.add_table(rows=5, cols=2)
    receipt_table.style = "Table Grid"
    receipt_rows = (
        [
            ("Mã chứng nhận", receipt_id),
            ("Thời gian (UTC)", utc_ts),
            ("Điểm toàn vẹn (CIS)", f"{cis_score:.2f}%"),
            ("Mã xác thực", sig_prefix),
            ("Liên kết xác thực", verification_url),
        ]
        if is_vi
        else [
            ("Receipt ID", receipt_id),
            ("UTC Timestamp", utc_ts),
            ("CIS Score", f"{cis_score:.2f}%"),
            ("HMAC-SHA256 Signature Prefix", sig_prefix),
            ("Verification URL", verification_url),
        ]
    )
    for r_idx, (r_label, r_val) in enumerate(receipt_rows):
        row = receipt_table.rows[r_idx]
        row.cells[0].text = r_label
        row.cells[1].text = r_val
        _set_cell_background(row.cells[0], "EEF2FF")
        for paragraph in row.cells[0].paragraphs:
            for run in paragraph.runs:
                run.font.bold = True

    # CIS Score Section
    doc.add_heading(
        "Điểm toàn vẹn trích dẫn (CIS)" if is_vi else "Citation Integrity Score (CIS)",
        level=1,
    )

    score_para = doc.add_paragraph()
    score_run = score_para.add_run(f"{cis_score:.2f}%")
    score_run.font.size = Pt(36)
    score_run.font.bold = True

    # Determine score color
    if cis_score >= 90:
        score_run.font.color.rgb = RGBColor(34, 197, 94)  # Green
    elif cis_score >= 70:
        score_run.font.color.rgb = RGBColor(234, 179, 8)  # Yellow
    else:
        score_run.font.color.rgb = RGBColor(239, 68, 68)  # Red

    doc.add_paragraph(
        "(Điểm phản ánh tỷ lệ nguồn đã xác minh và độ chính xác thông tin trích dẫn)"
        if is_vi
        else "(Score reflects verified sources, citation detail accuracy, and reference list consistency)"
    )

    if style_profile and isinstance(style_profile, dict) and style_profile.get("style"):
        sp_para = doc.add_paragraph()
        sp_para.add_run(
            "Chuẩn trích dẫn nhận diện: " if is_vi else "Detected Citation Style: "
        ).bold = True
        conf_pct = float(style_profile.get("confidence", 0.0) or 0.0) * 100.0
        sp_para.add_run(
            f"{style_profile.get('style')} (độ tin cậy {conf_pct:.0f}%)"
            if is_vi
            else f"{style_profile.get('style')} ({conf_pct:.0f}% confidence)"
        )

    if cis_components and isinstance(cis_components, dict):
        doc.add_heading(
            "Chi tiết 5 thành phần điểm CIS" if is_vi else "5-Component CIS Formula Breakdown",
            level=2,
        )
        comp_table = doc.add_table(rows=1, cols=3)
        comp_table.style = "Table Grid"
        comp_hdr = comp_table.rows[0].cells
        comp_hdr[0].text = "Thành phần CIS" if is_vi else "CIS Component"
        comp_hdr[1].text = "Trọng số" if is_vi else "Weight"
        comp_hdr[2].text = "Điểm" if is_vi else "Score"
        for cell in comp_hdr:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True

        weights = _resolve_cis_weights(cis_weights)
        comp_labels = (
            {
                "verified_ratio": "Tỷ lệ nguồn đã xác minh",
                "metadata_accuracy": "Độ chính xác thông tin (Tác giả/Năm/Tiêu đề)",
                "in_text_bib_consistency": "Đối chiếu trích dẫn trong bài & danh mục",
                "format_consistency": "Độ đồng nhất chuẩn trích dẫn",
                "identifier_validity": "Tính hợp lệ mã định danh (DOI)",
            }
            if is_vi
            else {
                "verified_ratio": "Verified Sources",
                "metadata_accuracy": "Citation Details Accuracy (Author/Year/Title)",
                "in_text_bib_consistency": "In-Text & Bibliography Match",
                "format_consistency": "Citation Style Consistency",
                "identifier_validity": "Identifier Validity (DOI / CrossRef)",
            }
        )
        comp_rows = [
            (
                comp_labels[key],
                _format_weight(weights.get(key, 0.0)),
                float(cis_components.get(key, 0.0) or 0.0),
            )
            for key in _CIS_WEIGHT_KEYS
        ]
        for label_txt, weight_txt, val in comp_rows:
            r_cells = comp_table.add_row().cells
            r_cells[0].text = label_txt
            r_cells[1].text = weight_txt
            r_cells[2].text = f"{val * 100.0:.1f}%"

    if linking_summary and isinstance(linking_summary, dict):
        doc.add_heading(
            "Đối chiếu trích dẫn trong bài & danh mục tài liệu tham khảo"
            if is_vi
            else "In-Text & Bibliography Match Summary",
            level=2,
        )
        link_table = doc.add_table(rows=1, cols=2)
        link_table.style = "Table Grid"
        lh = link_table.rows[0].cells
        lh[0].text = "Trạng thái đối chiếu" if is_vi else "Reference Match Status"
        lh[1].text = "Số lượng" if is_vi else "Count"
        for cell in lh:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True
        for k, v_cnt in linking_summary.items():
            rc = link_table.add_row().cells
            rc[0].text = _human_mapping_status(k, is_vi=is_vi)
            rc[1].text = str(v_cnt)

    resolved_diag = document_diagnostics
    if (
        not resolved_diag
        and isinstance(style_profile, dict)
        and isinstance(style_profile.get("document_diagnostics"), dict)
    ):
        resolved_diag = style_profile.get("document_diagnostics")
    if isinstance(resolved_diag, dict):
        diag_notes: list[str] = []
        ocr_pages = resolved_diag.get("ocr_pages_recovered") or []
        if ocr_pages:
            pages_str = ", ".join(str(p) for p in ocr_pages)
            diag_notes.append(
                f"Đã nhận dạng chữ (OCR) cho các trang ảnh: {pages_str} ({len(ocr_pages)} trang)"
                if is_vi
                else f"Scanned pages processed via OCR: {pages_str} ({len(ocr_pages)} page(s))"
            )
        leg_enc = resolved_diag.get("legacy_encoding_detected")
        leg_cnt = int(resolved_diag.get("legacy_encoding_pages_count") or 0)
        if leg_enc:
            diag_notes.append(
                (
                    f"Đã chuyển đổi font tiếng Việt cũ: {leg_enc}"
                    + (f" ({leg_cnt} trang)" if leg_cnt else "")
                )
                if is_vi
                else (
                    f"Legacy Vietnamese font converted: {leg_enc}"
                    + (f" ({leg_cnt} page(s) converted to Unicode)" if leg_cnt else "")
                )
            )
        if resolved_diag.get("is_scanned_pdf"):
            warn_msg = (
                resolved_diag.get("warning_message_vi")
                or resolved_diag.get("warning_message")
                or "Phát hiện tệp PDF dạng ảnh quét (không có lớp văn bản)."
                if is_vi
                else resolved_diag.get("warning_message_en")
                or "Scanned or image-only PDF detected (no searchable text layer)."
            )
            diag_notes.append(
                f"Lưu ý PDF ảnh quét: {warn_msg}" if is_vi else f"Scanned PDF Notice: {warn_msg}"
            )
        if diag_notes:
            doc.add_heading(
                "Ghi chú xử lý tài liệu" if is_vi else "Document Processing Notes",
                level=2,
            )
            for note in diag_notes:
                p_diag = doc.add_paragraph(style="List Bullet")
                p_diag.add_run(note)

    # Summary Statistics
    doc.add_heading("Thống kê tổng quan" if is_vi else "Summary Statistics", level=1)

    num_incomplete = sum(
        1
        for v in verdicts
        if "R-INCOMPLETE-METADATA" in (v.get("triggered_rules") or [])
    )

    stats_data = (
        [
            ("Tổng số trích dẫn", str(num_citations)),
            ("Đã xác minh", f"{num_verified} ({num_verified * 100 / max(num_citations, 1):.1f}%)"),
            ("Sai lệch thông tin", f"{num_metadata_error} ({num_metadata_error * 100 / max(num_citations, 1):.1f}%)"),
            (
                "  └─ Thiếu thông tin trích dẫn",
                f"{num_incomplete} ({num_incomplete * 100 / max(num_citations, 1):.1f}%)",
            ),
            ("Không tìm thấy nguồn", f"{num_suspected} ({num_suspected * 100 / max(num_citations, 1):.1f}%)"),
            ("Cần kiểm tra thủ công", f"{num_unresolved} ({num_unresolved * 100 / max(num_citations, 1):.1f}%)"),
            ("Nguồn Web / Văn bản", f"{num_resource} ({num_resource * 100 / max(num_citations, 1):.1f}%)"),
            ("", ""),
            ("Điểm toàn vẹn trích dẫn (CIS)", f"{cis_score:.2f}%"),
        ]
        if is_vi
        else [
            ("Total Citations", str(num_citations)),
            ("Verified", f"{num_verified} ({num_verified * 100 / max(num_citations, 1):.1f}%)"),
            ("Details Mismatch", f"{num_metadata_error} ({num_metadata_error * 100 / max(num_citations, 1):.1f}%)"),
            (
                "  └─ Incomplete Citation Details",
                f"{num_incomplete} ({num_incomplete * 100 / max(num_citations, 1):.1f}%)",
            ),
            ("Source Not Found", f"{num_suspected} ({num_suspected * 100 / max(num_citations, 1):.1f}%)"),
            ("Needs Manual Check", f"{num_unresolved} ({num_unresolved * 100 / max(num_citations, 1):.1f}%)"),
            ("Web / Legal Source", f"{num_resource} ({num_resource * 100 / max(num_citations, 1):.1f}%)"),
            ("", ""),
            ("Citation Integrity Score", f"{cis_score:.2f}%"),
        ]
    )

    stats_table = doc.add_table(rows=len(stats_data), cols=2)
    stats_table.style = "Table Grid"

    for i, (label, value) in enumerate(stats_data):
        row = stats_table.rows[i]
        row.cells[0].text = label
        row.cells[1].text = value
        if label in ("Citation Integrity Score", "Điểm toàn vẹn trích dẫn (CIS)"):
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.bold = True

    # Verdicts Detail Section
    doc.add_heading(
        "Kết quả kiểm tra từng trích dẫn" if is_vi else "Citation Check Results",
        level=1,
    )

    if verdicts:
        # Verdicts table
        table = doc.add_table(rows=1, cols=4)
        table.style = "Table Grid"

        # Header row
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = "Trích dẫn" if is_vi else "Citation"
        hdr_cells[1].text = "Đối chiếu danh mục" if is_vi else "Reference Match"
        hdr_cells[2].text = "Trạng thái" if is_vi else "Status"
        hdr_cells[3].text = "Độ tin cậy" if is_vi else "Confidence"

        for cell in hdr_cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True

        # Data rows
        for v in verdicts:
            row_cells = table.add_row().cells
            raw_v_feats = v.get("features")
            feats: dict[str, Any] = raw_v_feats if isinstance(raw_v_feats, dict) else {}
            raw_cit = str(v.get("citation_raw", "") or "")
            comp_lbl = v.get("composite_label") or feats.get("composite_label")
            if comp_lbl and f"[{comp_lbl}]" not in raw_cit:
                raw_cit = f"[{comp_lbl}] {raw_cit}"

            mismatched = v.get("mismatched_fields") or []
            rules = v.get("triggered_rules") or []
            raw_lbl_lower = str(v.get("label", "") or "").lower()
            lbl_lower = "unresolved" if raw_lbl_lower in ("", "unverified") else raw_lbl_lower

            url_status = v.get("url_status") or feats.get("url_status")
            archive_url = v.get("archive_url") or feats.get("archive_url")
            raw_v_html = v.get("html_meta")
            html_meta = raw_v_html if isinstance(raw_v_html, dict) else feats.get("html_meta")
            obs_title = html_meta.get("title") if isinstance(html_meta, dict) else None

            parts: list[str] = []
            human_checks = _humanize_rules(rules, is_vi=is_vi)
            if human_checks:
                checks_prefix = "Tiêu chí" if is_vi else "Checks"
                parts.append(f"{checks_prefix}: {', '.join(human_checks)}")
            if mismatched:
                mm_prefix = "Thông tin lệch" if is_vi else "Mismatched"
                parts.append(f"{mm_prefix}: {', '.join(str(m) for m in mismatched)}")
            if url_status:
                url_prefix = "Trạng thái liên kết" if is_vi else "Link Status"
                parts.append(f"{url_prefix}: {url_status}")
            if archive_url:
                arch_prefix = "Bản lưu trữ" if is_vi else "Archive"
                parts.append(f"{arch_prefix}: {archive_url}")
            if obs_title:
                title_prefix = "Tiêu đề trang web" if is_vi else "Web Page Title"
                parts.append(f"{title_prefix}: {obs_title[:80]}")
            details_suffix = f"\n[{' | '.join(parts)}]" if parts else ""

            display_lbl = _human_verdict_label(lbl_lower, rules, is_vi=is_vi)

            row_cells[0].text = raw_cit + details_suffix
            row_cells[1].text = _human_mapping_status(
                v.get("mapping_status") or v.get("citation_type", "unknown"),
                is_vi=is_vi,
            )
            row_cells[2].text = display_lbl
            row_cells[3].text = f"{float(v.get('confidence', 0) or 0):.0%}"

            if lbl_lower == "suspected_hallucination":
                for cell in row_cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.font.color.rgb = RGBColor(220, 38, 38)
                            run.font.bold = True
            elif lbl_lower == "metadata_error":
                err_color = (
                    RGBColor(180, 83, 9)
                    if "R-INCOMPLETE-METADATA" in rules
                    else RGBColor(220, 38, 38)
                )
                for cell in row_cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.font.color.rgb = err_color
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.bold = True
            elif lbl_lower == "unresolved":
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.color.rgb = RGBColor(180, 83, 9)
                        run.font.bold = True
            elif lbl_lower == "resource":
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.color.rgb = RGBColor(3, 105, 161)
                        run.font.bold = True
            elif lbl_lower == "verified":
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.color.rgb = RGBColor(22, 163, 74)
                        run.font.bold = True

        # Verification Summary & Evidence Section for Flagged / Detailed Verdicts
        detailed_items = [
            v
            for v in verdicts
            if v.get("reasoning")
            or v.get("triggered_rules")
            or v.get("mismatched_fields")
            or v.get("url_status")
            or v.get("archive_url")
            or v.get("html_meta")
            or (v.get("features") or {}).get("best_evidence_sentence")
            or (v.get("features") or {}).get("url_status")
            or (v.get("features") or {}).get("archive_url")
            or (v.get("features") or {}).get("html_meta")
        ]
        if detailed_items:
            doc.add_heading(
                "Tóm tắt kết quả đối chiếu & bằng chứng"
                if is_vi
                else "Verification Summary & Evidence",
                level=1,
            )
            for idx, v in enumerate(detailed_items, 1):
                p = doc.add_paragraph()
                raw_det_feats = v.get("features")
                feats = raw_det_feats if isinstance(raw_det_feats, dict) else {}
                raw_lbl_str = str(v.get("label", "unresolved") or "unresolved")
                lbl_lower = "unresolved" if raw_lbl_str.lower() in ("", "unverified") else raw_lbl_str.lower()
                rules = v.get("triggered_rules") or []
                human_lbl = _human_verdict_label(lbl_lower, rules, is_vi=is_vi)
                comp_lbl = v.get("composite_label") or feats.get("composite_label")
                marker_str = str(comp_lbl) if comp_lbl else str(idx)
                r_num = p.add_run(f"[{marker_str}] {v.get('citation_raw', '')}\n")
                r_num.bold = True
                if lbl_lower in ("suspected_hallucination", "metadata_error"):
                    r_num.font.color.rgb = RGBColor(220, 38, 38)
                elif lbl_lower == "unresolved":
                    r_num.font.color.rgb = RGBColor(180, 83, 9)
                elif lbl_lower == "resource":
                    r_num.font.color.rgb = RGBColor(3, 105, 161)

                map_str = _human_mapping_status(v.get("mapping_status", "matched"), is_vi=is_vi)
                conf_val = float(v.get("confidence", 0) or 0)
                r_verdict = p.add_run(

                        f"Trạng thái: {human_lbl} (Độ tin cậy: {conf_val:.0%}) | Đối chiếu danh mục: {map_str}\n"
                        if is_vi
                        else f"Status: {human_lbl} (Confidence: {conf_val:.0%}) | Reference Match: {map_str}\n"

                )
                if lbl_lower in ("suspected_hallucination", "metadata_error"):
                    r_verdict.font.color.rgb = RGBColor(220, 38, 38)
                    r_verdict.bold = True
                elif lbl_lower == "unresolved":
                    r_verdict.font.color.rgb = RGBColor(180, 83, 9)
                    r_verdict.bold = True
                elif lbl_lower == "resource":
                    r_verdict.font.color.rgb = RGBColor(3, 105, 161)
                    r_verdict.bold = True

                human_checks = _humanize_rules(rules, is_vi=is_vi)
                if human_checks:
                    p.add_run(

                            f"Các tiêu chí đã kiểm tra: {', '.join(human_checks)}\n"
                            if is_vi
                            else f"Checks Performed: {', '.join(human_checks)}\n"

                    )
                mismatched = v.get("mismatched_fields") or []
                if mismatched:
                    r_mm = p.add_run(

                            f"Thông tin chưa khớp: {', '.join(str(m) for m in mismatched)}\n"
                            if is_vi
                            else f"Mismatched Details: {', '.join(str(m) for m in mismatched)}\n"

                    )
                    r_mm.font.color.rgb = RGBColor(185, 28, 28)
                clean_reason = _sanitize_export_reasoning(v.get("reasoning"), is_vi=is_vi)
                if clean_reason:
                    p.add_run(
                        f"Giải thích: {clean_reason}\n"
                        if is_vi
                        else f"Explanation: {clean_reason}\n"
                    )

                url_status = v.get("url_status") or feats.get("url_status")
                archive_url = v.get("archive_url") or feats.get("archive_url")
                raw_det_html = v.get("html_meta")
                html_meta = raw_det_html if isinstance(raw_det_html, dict) else feats.get("html_meta")
                if url_status:
                    p.add_run(
                        f"Trạng thái liên kết: {url_status}\n"
                        if is_vi
                        else f"Link Status: {url_status}\n"
                    )
                if archive_url:
                    p.add_run(
                        f"Liên kết lưu trữ (Wayback): {archive_url}\n"
                        if is_vi
                        else f"Archived Link (Wayback): {archive_url}\n"
                    )
                if isinstance(html_meta, dict) and html_meta.get("title"):
                    p.add_run(
                        f"Tiêu đề trang web: \"{html_meta.get('title')}\"\n"
                        if is_vi
                        else f"Web Page Title: \"{html_meta.get('title')}\"\n"
                    )

                ev_sent = feats.get("best_evidence_sentence")
                if ev_sent:
                    p.add_run(
                        f"Đoạn trích liên quan nhất: \"{ev_sent}\"\n"
                        if is_vi
                        else f"Closest Matching Passage: \"{ev_sent}\"\n"
                    )
                intent = feats.get("citation_intent")
                stance = feats.get("stance_label") or feats.get("citation_stance")
                xl_det = feats.get("cross_lingual_detected")
                bridged = feats.get("bridged_concepts") or []
                xl_title_det = feats.get("cross_lingual_title_detected")
                xl_title_sim = float(feats.get("cross_lingual_title_sim", 0.0) or 0.0)
                if intent or stance or xl_det:
                    xl_note = (
                        (
                            f" | Đối chiếu song ngữ (VI↔EN): {', '.join(str(b) for b in bridged[:4])}"
                            if is_vi
                            else f" | Cross-Language Match (VI↔EN): {', '.join(str(b) for b in bridged[:4])}"
                        )
                        if xl_det and bridged
                        else (
                            (" | Đối chiếu song ngữ (VI↔EN): Có" if is_vi else " | Cross-Language Match (VI↔EN): Active")
                            if xl_det
                            else ""
                        )
                    )
                    p.add_run(

                            f"Ngữ cảnh trích dẫn: Vai trò={intent or 'background'}, Mức độ phù hợp={stance or 'neutral'}{xl_note}\n"
                            if is_vi
                            else f"Citation Context: Role={intent or 'background'}, Alignment={stance or 'neutral'}{xl_note}\n"

                    )
                if xl_title_det:
                    p.add_run(

                            f"Khớp tiêu đề song ngữ (VI↔EN): tương đồng {xl_title_sim * 100:.0f}% với bản gốc tiếng Anh\n"
                            if is_vi
                            else f"Cross-Language Title Match (VI↔EN): {xl_title_sim * 100:.0f}% similarity to original English title\n"

                    )

        # Updated Bibliography & BibTeX Section
        try:
            from integrity_checker.export.bibliography_formatter import (
                build_remediated_bibliography,
            )

            rem_data = _sanitize_xml_value(
                build_remediated_bibliography(essay_id=0, verdicts=verdicts, style="apa")
            )
            rem_entries = rem_data.get("entries") or []
            if rem_entries:
                doc.add_heading(
                    "Danh mục tài liệu đã chuẩn hóa & BibTeX"
                    if is_vi
                    else "Standardized Bibliography & BibTeX",
                    level=1,
                )
                for e in rem_entries:
                    p_rem = doc.add_paragraph()
                    e_lbl = str(e.get("label", "")).lower()
                    e_status = str(e.get("remediation_status", "")).lower()
                    e_rules = e.get("triggered_rules") or []
                    disp_idx = e.get("display_index") or e.get("composite_label") or e.get("index")
                    if e.get("is_hallucination") or e_lbl == "suspected_hallucination":
                        r_warn = p_rem.add_run(
                            f"[{disp_idx}] [CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]\n"
                            if is_vi
                            else f"[{disp_idx}] [NEEDS REVIEW — SOURCE NOT FOUND]\n"
                        )
                        r_warn.bold = True
                        r_warn.font.color.rgb = RGBColor(220, 38, 38)
                        orig_prefix = "Bản gốc trong tài liệu" if is_vi else "Original in Document"
                        r_orig = p_rem.add_run(f"{orig_prefix}: {e.get('original_raw', '')}\n")
                        r_orig.font.color.rgb = RGBColor(220, 38, 38)
                    elif "R-INCOMPLETE-METADATA" in e_rules and not e.get("was_modified"):
                        r_inc = p_rem.add_run(
                            f"[{disp_idx}] [THIẾU THÔNG TIN — CẦN BỔ SUNG THỦ CÔNG]\n"
                            if is_vi
                            else f"[{disp_idx}] [INCOMPLETE DETAILS — MANUAL COMPLETION NEEDED]\n"
                        )
                        r_inc.bold = True
                        r_inc.font.color.rgb = RGBColor(180, 83, 9)
                        orig_prefix = "Bản gốc trong tài liệu" if is_vi else "Original in Document"
                        p_rem.add_run(f"{orig_prefix}: {e.get('original_raw', '')}\n")
                    elif (e.get("is_error") or e_lbl == "metadata_error") and e.get("was_modified"):
                        fields_str = ", ".join(e.get("diff_fields") or ["details"])
                        r_fix = p_rem.add_run(
                            f"[{disp_idx}] [ĐÃ CẬP NHẬT THÔNG TIN — Các mục đã sửa: {fields_str}]\n"
                            if is_vi
                            else f"[{disp_idx}] [DETAILS UPDATED — Corrected fields: {fields_str}]\n"
                        )
                        r_fix.bold = True
                        r_fix.font.color.rgb = RGBColor(185, 28, 28)
                        r_before = p_rem.add_run(
                            f"Bản gốc: {e.get('original_raw', '')}\n"
                            if is_vi
                            else f"Before (Original): {e.get('original_raw', '')}\n"
                        )
                        r_before.font.color.rgb = RGBColor(220, 38, 38)
                        r_after = p_rem.add_run(
                            f"Sau khi chuẩn hóa (APA): {e.get('apa', '')}\n"
                            if is_vi
                            else f"After (Standardized APA): {e.get('apa', '')}\n"
                        )
                        r_after.bold = True
                        r_after.font.color.rgb = RGBColor(22, 163, 74)
                        r_bib = p_rem.add_run(
                            f"BibTeX:\n{_sanitize_bibtex_comments(e.get('bibtex'), is_vi=is_vi)}"
                        )
                        r_bib.font.size = Pt(8.5)
                    elif e_lbl in ("unresolved", "unverified") or e_status == "manual_review":
                        r_unres = p_rem.add_run(
                            f"[{disp_idx}] [CẦN KIỂM TRA THỦ CÔNG]\n"
                            if is_vi
                            else f"[{disp_idx}] [NEEDS MANUAL CHECK]\n"
                        )
                        r_unres.bold = True
                        r_unres.font.color.rgb = RGBColor(180, 83, 9)
                        p_rem.add_run(f"{e.get('original_raw') or e.get('apa', '')}\n")
                    elif e_lbl == "resource" or e_status == "resource":
                        r_res = p_rem.add_run(
                            f"[{disp_idx}] [NGUỒN WEB / VĂN BẢN]\n"
                            if is_vi
                            else f"[{disp_idx}] [WEB / LEGAL SOURCE]\n"
                        )
                        r_res.bold = True
                        r_res.font.color.rgb = RGBColor(3, 105, 161)
                        p_rem.add_run(f"{e.get('apa', '')}\n")
                    else:
                        r_ok = p_rem.add_run(
                            f"[{disp_idx}] [ĐÃ XÁC MINH & CHUẨN HÓA]\n"
                            if is_vi
                            else f"[{disp_idx}] [VERIFIED & FORMATTED]\n"
                        )
                        r_ok.bold = True
                        r_ok.font.color.rgb = RGBColor(22, 163, 74)
                        p_rem.add_run(f"{e.get('apa', '')}\n")
                        r_bib = p_rem.add_run(
                            f"BibTeX:\n{_sanitize_bibtex_comments(e.get('bibtex'), is_vi=is_vi)}"
                        )
                        r_bib.font.size = Pt(8.5)
        except Exception:
            pass

    else:
        doc.add_paragraph(
            "Chưa có kết quả kiểm tra trích dẫn." if is_vi else "No citation results available."
        )

    # Legend
    doc.add_heading("Giải thích nhãn trạng thái" if is_vi else "Status Legend", level=1)

    legend_table = doc.add_table(rows=5, cols=2)
    legend_table.style = "Table Grid"

    legend_data = (
        [
            ("Đã xác minh", "Nguồn tài liệu đã được tìm thấy và xác nhận khớp trên thư viện học thuật", RGBColor(34, 197, 94)),
            ("Sai lệch thông tin", "Đã tìm thấy nguồn nhưng tác giả, năm, tiêu đề hoặc thông tin khác có sai lệch hoặc thiếu", RGBColor(234, 179, 8)),
            ("Không tìm thấy nguồn", "Chưa tìm thấy bản ghi khớp trên các thư viện học thuật trực tuyến; cần tự kiểm tra lại bản gốc", RGBColor(239, 68, 68)),
            ("Cần kiểm tra thủ công", "Chưa đủ dữ liệu để xác minh tự động; khuyến nghị kiểm tra thủ công", RGBColor(180, 83, 9)),
            ("Nguồn Web / Văn bản", "Liên kết trang web, tài nguyên trực tuyến hoặc văn bản quy phạm pháp luật", RGBColor(3, 105, 161)),
        ]
        if is_vi
        else [
            ("Verified", "Source confirmed in indexed academic libraries with matching details", RGBColor(34, 197, 94)),
            ("Details Mismatch", "Source found, but one or more details (author, title, year) differ or are incomplete", RGBColor(234, 179, 8)),
            ("Source Not Found", "No matching record was found in indexed academic libraries; please double-check the original source", RGBColor(239, 68, 68)),
            ("Needs Manual Check", "Not enough data to verify automatically; manual review is recommended", RGBColor(180, 83, 9)),
            ("Web / Legal Source", "Web page, online resource, or official legal/regulatory document", RGBColor(3, 105, 161)),
        ]
    )

    for i, (label, desc, color_rgb) in enumerate(legend_data):
        if i >= len(legend_table.rows):
            break
        row = legend_table.rows[i]
        row.cells[0].text = label
        row.cells[1].text = desc
        if row.cells[0].paragraphs and row.cells[0].paragraphs[0].runs:
            row.cells[0].paragraphs[0].runs[0].font.color.rgb = color_rgb
            row.cells[0].paragraphs[0].runs[0].font.bold = True

    # Disclaimer
    doc.add_paragraph()
    disclaimer = doc.add_paragraph()
    disclaimer_run = disclaimer.add_run(
        (
            "LƯU Ý QUAN TRỌNG: Báo cáo này chỉ mang tính chất hỗ trợ rà soát trích dẫn. "
            "Nhãn 'Không tìm thấy nguồn' không đồng nghĩa với kết luận tài liệu giả mạo — "
            "đánh giá cuối cùng luôn cần sự xem xét trực tiếp của tác giả hoặc giảng viên."
        )
        if is_vi
        else (
            "DISCLAIMER: This report is a decision-support tool only. "
            "A 'Source Not Found' label is a review flag and does not prove a source is invalid — "
            "final judgment on citation integrity always requires human review."
        )
    )
    disclaimer_run.font.size = Pt(9)
    disclaimer_run.font.italic = True

    # Save to bytes
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def _strip_docx_entry_prefix(text: str) -> str:
    s = " ".join((text or "").split()).strip()
    s = re.sub(r"^\s*(?:\[\s*\d+[a-z]?\s*\]|\d+[a-z]?[\.\)])\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^\s*(?:\([a-z]\)|[a-z]\))\s*", "", s, flags=re.IGNORECASE)
    return s.strip()


def _entry_matches_docx_paragraph(
    entry: dict[str, Any],
    p_text: str,
    p_lower: str,
    para_num_idx: int | None,
    para_has_composite_markers: bool,
) -> bool:
    orig_raw = str(entry.get("original_raw") or "").strip()
    clean_orig = _strip_docx_entry_prefix(orig_raw)
    canon_title = str((entry.get("canonical_metadata") or {}).get("title") or "").strip()
    cited_title = str((entry.get("cited") or {}).get("title") or "").strip()

    if orig_raw and len(orig_raw) >= 15 and orig_raw[:42].lower() in p_lower:
        return True
    if clean_orig and len(clean_orig) >= 12 and clean_orig[:38].lower() in p_lower:
        return True
    if cited_title and len(cited_title) >= 15 and cited_title.lower() in p_lower:
        return True
    if canon_title and len(canon_title) >= 15 and canon_title.lower() in p_lower:
        return True

    if para_has_composite_markers and para_num_idx is not None:
        e_num = entry.get("numeric_index")
        e_comp = str(entry.get("composite_label") or "")
        if e_num == para_num_idx or (
            e_comp and re.match(rf"^{para_num_idx}[a-z]$", e_comp, flags=re.IGNORECASE)
        ):
            return True
    return False


def _sanitize_bibtex_comments(bib_text: Any, *, is_vi: bool = False) -> str:
    """Replace any accusatory comment banners inside BibTeX blocks with neutral review notices."""
    text = _sanitize_xml_text(bib_text).strip()
    if not text:
        return ""
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("%") and any(
            tok in stripped.upper()
            for tok in ("HALLUCINATION", "BỊA ĐẶT", "CẢNH BÁO ĐỎ", "NGHI VẤN", "NGỤY TẠO")
        ):
            lines.append(
                "% [CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]"
                if is_vi
                else "% [NEEDS REVIEW — SOURCE NOT FOUND]"
            )
        else:
            lines.append(line)
    return "\n".join(lines)


def _entry_status_badge_and_table_label(
    entry: dict[str, Any], *, is_vi: bool = False
) -> tuple[str, str]:
    """Return (inline_badge, table_status_label) honestly distinguishing all verdict states."""
    e_lbl = str(entry.get("label") or "").lower()
    e_status = str(entry.get("remediation_status") or "").lower()
    e_rules = entry.get("triggered_rules") or []

    if entry.get("is_hallucination") or e_lbl == "suspected_hallucination":
        return (
            ("[CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]", "KHÔNG TÌM THẤY NGUỒN")
            if is_vi
            else ("[NEEDS REVIEW — SOURCE NOT FOUND]", "SOURCE NOT FOUND")
        )
    if entry.get("was_modified"):
        return ("", "ĐÃ CẬP NHẬT" if is_vi else "UPDATED")
    if "R-INCOMPLETE-METADATA" in e_rules:
        return (
            ("[THIẾU THÔNG TIN — CẦN BỔ SUNG THỦ CÔNG]", "[THIẾU THÔNG TIN — CẦN BỔ SUNG THỦ CÔNG]")
            if is_vi
            else (
                "[INCOMPLETE DETAILS — MANUAL COMPLETION NEEDED]",
                "[INCOMPLETE DETAILS — MANUAL COMPLETION NEEDED]",
            )
        )
    if e_lbl in ("unresolved", "unverified") or e_status == "manual_review":
        return (
            ("[CẦN KIỂM TRA THỦ CÔNG]", "[CẦN KIỂM TRA THỦ CÔNG]")
            if is_vi
            else ("[NEEDS MANUAL CHECK]", "[NEEDS MANUAL CHECK]")
        )
    if e_lbl == "resource" or e_status == "resource":
        return (
            ("[NGUỒN WEB / VĂN BẢN]", "[NGUỒN WEB / VĂN BẢN]")
            if is_vi
            else ("[WEB / LEGAL SOURCE]", "[WEB / LEGAL SOURCE]")
        )
    return (
        ("[ĐÃ XÁC MINH & CHUẨN HÓA]", "ĐÃ XÁC MINH")
        if is_vi
        else ("[VERIFIED & FORMATTED]", "VERIFIED")
    )


def export_auto_healed_docx(
    essay_filename: str,
    verdicts: list[dict[str, Any]],
    style: Literal["apa", "ieee", "tdtu"] | str = "apa",
    original_docx_path: str | None = None,
    *,
    lang: str = "en",
) -> bytes:
    """Export a fixed Word (.docx) document or standardized bibliography package.

    Supports ``apa``, ``ieee``, and ``tdtu`` bibliography styles. Preserves all sibling
    sub-entries inside composite bibliography paragraphs (e.g. ``[14] (a) Ref A; (b) Ref B``)
    in a single pass without wiping siblings.
    """
    from pathlib import Path

    from integrity_checker.export.bibliography_formatter import build_remediated_bibliography

    is_vi = str(lang or "en").strip().lower().startswith("vi")
    essay_filename = _sanitize_xml_text(essay_filename)
    verdicts = _sanitize_xml_value(verdicts) or []
    s_low = (style or "apa").strip().lower()
    norm_style = s_low if s_low in ("apa", "ieee", "tdtu") else "apa"
    rem_data = _sanitize_xml_value(
        build_remediated_bibliography(essay_id=0, verdicts=verdicts, style=norm_style)
    )
    entries: list[dict[str, Any]] = rem_data.get("entries") or []

    def _select_style_text(e: dict[str, Any]) -> str:
        if norm_style == "tdtu":
            return str(e.get("tdtu") or e.get("remediated_text") or "")
        if norm_style == "ieee":
            return str(e.get("ieee") or e.get("remediated_text") or "")
        return str(e.get("apa") or e.get("remediated_text") or "")

    not_found_stamp = (
        "[CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]"
        if is_vi
        else "[NEEDS REVIEW — SOURCE NOT FOUND]"
    )
    incomplete_stamp = (
        "[THIẾU THÔNG TIN — CẦN BỔ SUNG THỦ CÔNG]"
        if is_vi
        else "[INCOMPLETE DETAILS — MANUAL COMPLETION NEEDED]"
    )
    manual_check_stamp = "[CẦN KIỂM TRA THỦ CÔNG]" if is_vi else "[NEEDS MANUAL CHECK]"
    web_source_stamp = "[NGUỒN WEB / VĂN BẢN]" if is_vi else "[WEB / LEGAL SOURCE]"

    in_place_healed_count = 0
    used_original_docx = False
    doc = None

    if original_docx_path:
        orig_path = Path(original_docx_path)
        if (
            orig_path.is_file()
            and orig_path.suffix.lower() == ".docx"
            and _docx_xml_is_safe(str(orig_path))
        ):
            try:
                doc = Document(str(orig_path))
                used_original_docx = True
            except Exception:
                doc = None
                used_original_docx = False

    if doc is None:
        doc = Document()
        title = doc.add_heading(
            "Danh mục tài liệu đã chuẩn hóa & Nhật ký thay đổi CITRA"
            if is_vi
            else "CITRA Updated Bibliography & Change Log",
            level=0,
        )
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sub = doc.add_paragraph()
        sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_sub = sub.add_run(

                f"Tài liệu gốc: {essay_filename}  |  Chuẩn trích dẫn: {norm_style.upper()}"
                if is_vi
                else f"Source Document: {essay_filename}  |  Target Style: {norm_style.upper()}"

        )
        r_sub.italic = True
        r_sub.font.color.rgb = RGBColor(100, 116, 139)
    else:
        processed_entry_idxs: set[int] = set()
        for para in doc.paragraphs:
            p_text = _sanitize_xml_text(para.text or "").strip()
            if len(p_text) < 12:
                continue
            p_lower = p_text.lower()
            m_lead_num = re.match(r"^\s*(?:\[\s*(\d+)\s*\]|(\d+)[\.\)])", p_text)
            para_num_idx = int(m_lead_num.group(1) or m_lead_num.group(2)) if m_lead_num else None
            para_has_composite = bool(
                re.search(r"\([a-z]\)", p_text, flags=re.IGNORECASE)
                and (";" in p_text or re.search(r"\([b-z]\)", p_text, flags=re.IGNORECASE))
            )

            matching: list[tuple[int, dict[str, Any]]] = []
            for e_idx, entry in enumerate(entries):
                if e_idx in processed_entry_idxs:
                    continue
                if _entry_matches_docx_paragraph(
                    entry, p_text, p_lower, para_num_idx, para_has_composite
                ):
                    matching.append((e_idx, entry))

            if not matching:
                continue

            for e_idx, _ in matching:
                processed_entry_idxs.add(e_idx)

            if len(matching) >= 2:
                # Composite paragraph containing multiple sibling sub-entries (e.g. [14] (a) ...; (b) ...)
                any_actionable = any(
                    sub_e.get("is_hallucination")
                    or sub_e.get("was_modified")
                    or "R-INCOMPLETE-METADATA" in (sub_e.get("triggered_rules") or [])
                    or sub_e.get("remediation_status") == "manual_review"
                    or str(sub_e.get("label") or "").lower() in ("unresolved", "unverified")
                    for _, sub_e in matching
                )
                if any_actionable:
                    para.clear()
                    for pos, (_, sub_e) in enumerate(matching):
                        if pos > 0:
                            para.add_run("; ")
                        comp_lbl = sub_e.get("composite_label") or sub_e.get("display_index") or str(sub_e.get("index", ""))
                        sub_let = sub_e.get("sub_index")
                        if not sub_let and isinstance(comp_lbl, str):
                            m_sl = re.fullmatch(r"\d+([a-z])", comp_lbl, flags=re.IGNORECASE)
                            if m_sl:
                                sub_let = m_sl.group(1).lower()
                        sub_prefix = (
                            f"[{comp_lbl}] ({sub_let}) "
                            if sub_let
                            else f"[{comp_lbl}] "
                        )
                        styled_text = _select_style_text(sub_e)
                        body_styled = _strip_docx_entry_prefix(styled_text) or styled_text
                        clean_orig = _strip_docx_entry_prefix(str(sub_e.get("original_raw") or ""))
                        sub_rules = sub_e.get("triggered_rules") or []
                        sub_lbl = str(sub_e.get("label") or "").lower()

                        if sub_e.get("is_hallucination") or sub_lbl == "suspected_hallucination":
                            r_flag = para.add_run(f"{sub_prefix}{not_found_stamp}: {clean_orig}")
                            r_flag.bold = True
                            r_flag.font.color.rgb = RGBColor(220, 38, 38)
                        elif sub_e.get("was_modified"):
                            r_healed = para.add_run(f"{sub_prefix}{body_styled}")
                            r_healed.font.color.rgb = RGBColor(21, 128, 61)
                            diff_str = ", ".join(sub_e.get("diff_fields") or ["details"])
                            r_tag = para.add_run(
                                f" [CITRA đã cập nhật: {diff_str}]"
                                if is_vi
                                else f" [Updated by CITRA: {diff_str}]"
                            )
                            r_tag.bold = True
                            r_tag.font.size = Pt(9)
                            r_tag.font.color.rgb = RGBColor(22, 163, 74)
                        elif "R-INCOMPLETE-METADATA" in sub_rules:
                            r_inc = para.add_run(f"{sub_prefix}{clean_orig} {incomplete_stamp}")
                            r_inc.bold = True
                            r_inc.font.color.rgb = RGBColor(180, 83, 9)
                        elif sub_lbl in ("unresolved", "unverified") or sub_e.get("remediation_status") == "manual_review":
                            r_unres = para.add_run(f"{sub_prefix}{clean_orig} {manual_check_stamp}")
                            r_unres.font.color.rgb = RGBColor(180, 83, 9)
                        else:
                            para.add_run(f"{sub_prefix}{body_styled or clean_orig}")
                    in_place_healed_count += 1
            else:
                entry = matching[0][1]
                healed_text = _select_style_text(entry)
                e_rules = entry.get("triggered_rules") or []
                e_lbl = str(entry.get("label") or "").lower()
                if entry.get("is_hallucination") or e_lbl == "suspected_hallucination":
                    para.clear()
                    r_flag = para.add_run(f"{not_found_stamp}: {p_text}")
                    r_flag.bold = True
                    r_flag.font.color.rgb = RGBColor(220, 38, 38)
                    in_place_healed_count += 1
                elif entry.get("was_modified") and healed_text:
                    para.clear()
                    r_healed = para.add_run(healed_text)
                    r_healed.font.color.rgb = RGBColor(21, 128, 61)
                    diff_str = ", ".join(entry.get("diff_fields") or ["details"])
                    r_tag = para.add_run(
                        f"  [CITRA đã cập nhật: {diff_str}]"
                        if is_vi
                        else f"  [Updated by CITRA: {diff_str}]"
                    )
                    r_tag.bold = True
                    r_tag.font.size = Pt(9)
                    r_tag.font.color.rgb = RGBColor(22, 163, 74)
                    in_place_healed_count += 1
                elif "R-INCOMPLETE-METADATA" in e_rules:
                    r_tag = para.add_run(f"  {incomplete_stamp}")
                    r_tag.bold = True
                    r_tag.font.size = Pt(9)
                    r_tag.font.color.rgb = RGBColor(180, 83, 9)
                    in_place_healed_count += 1

        doc.add_page_break()
        doc.add_heading(
            "Phụ lục rà soát trích dẫn & Nhật ký thay đổi CITRA"
            if is_vi
            else "CITRA Citation Review Appendix & Change Log",
            level=1,
        )

    # Summary KPI paragraph (honest breakdown across all states)
    total_cnt = len(entries)
    repaired_cnt = sum(1 for e in entries if e.get("was_modified"))
    not_found_cnt = sum(1 for e in entries if e.get("is_hallucination"))
    manual_cnt = sum(
        1
        for e in entries
        if not e.get("was_modified")
        and not e.get("is_hallucination")
        and (
            e.get("remediation_status") == "manual_review"
            or str(e.get("label") or "").lower() in ("unresolved", "unverified", "metadata_error")
        )
    )
    resource_cnt = sum(1 for e in entries if str(e.get("label") or "").lower() == "resource")
    verified_cnt = sum(
        1
        for e in entries
        if str(e.get("label") or "").lower() == "verified" and not e.get("was_modified")
    )

    if is_vi:
        kpi_parts = [
            f"{total_cnt} Tổng số tài liệu tham khảo",
            f"{verified_cnt} Đã xác minh",
            f"{repaired_cnt} Đã cập nhật",
            f"{not_found_cnt} Không tìm thấy nguồn",
        ]
        if manual_cnt:
            kpi_parts.append(f"{manual_cnt} Cần kiểm tra thủ công")
        if resource_cnt:
            kpi_parts.append(f"{resource_cnt} Nguồn Web / Văn bản")
        if used_original_docx:
            kpi_parts.append(f"{in_place_healed_count} Mục đã cập nhật trực tiếp")
        kpi_prefix = "Tóm tắt: "
    else:
        kpi_parts = [
            f"{total_cnt} Total References",
            f"{verified_cnt} Verified",
            f"{repaired_cnt} Updated",
            f"{not_found_cnt} Source Not Found",
        ]
        if manual_cnt:
            kpi_parts.append(f"{manual_cnt} Manual Review Needed")
        if resource_cnt:
            kpi_parts.append(f"{resource_cnt} Web / Legal Sources")
        if used_original_docx:
            kpi_parts.append(f"{in_place_healed_count} Entries Updated In-Place")
        kpi_prefix = "Summary: "

    kpi_p = doc.add_paragraph()
    kpi_run = kpi_p.add_run(kpi_prefix + "  •  ".join(kpi_parts))
    kpi_run.bold = True

    # Section 1: Standardized Reference List (Ready to Paste)
    doc.add_heading(
        (
            f"1. Danh mục tài liệu chuẩn hóa ({norm_style.upper()})"
            if is_vi
            else f"1. Standardized Reference List ({norm_style.upper()})"
        ),
        level=1,
    )
    if entries:
        for e in entries:
            p_ref = doc.add_paragraph()
            formatted_ref = _select_style_text(e)
            comp_lbl = e.get("composite_label")
            if comp_lbl and norm_style != "ieee" and not formatted_ref.startswith(f"[{comp_lbl}]"):
                formatted_ref = f"[{comp_lbl}] {formatted_ref}"
            inline_badge, _ = _entry_status_badge_and_table_label(e, is_vi=is_vi)
            e_lbl = str(e.get("label") or "").lower()

            if e.get("is_hallucination") or e_lbl == "suspected_hallucination":
                r_bad = p_ref.add_run(
                    f"{not_found_stamp} {e.get('original_raw') or formatted_ref}"
                )
                r_bad.bold = True
                r_bad.font.color.rgb = RGBColor(220, 38, 38)
            elif e.get("was_modified"):
                r_good = p_ref.add_run(formatted_ref)
                r_good.bold = True
                r_good.font.color.rgb = RGBColor(21, 128, 61)
                diff_str = ", ".join(e.get("diff_fields") or ["details"])
                r_note = p_ref.add_run(
                    f"  [Đã cập nhật: {diff_str}]" if is_vi else f"  [Updated: {diff_str}]"
                )
                r_note.italic = True
                r_note.font.size = Pt(9)
                r_note.font.color.rgb = RGBColor(21, 128, 61)
            elif inline_badge == incomplete_stamp:
                r_inc = p_ref.add_run(f"{inline_badge} {e.get('original_raw') or formatted_ref}")
                r_inc.bold = True
                r_inc.font.color.rgb = RGBColor(180, 83, 9)
            elif inline_badge == manual_check_stamp:
                r_unres = p_ref.add_run(f"{inline_badge} {e.get('original_raw') or formatted_ref}")
                r_unres.bold = True
                r_unres.font.color.rgb = RGBColor(180, 83, 9)
            elif inline_badge == web_source_stamp:
                r_res = p_ref.add_run(f"{inline_badge} {formatted_ref}")
                r_res.font.color.rgb = RGBColor(3, 105, 161)
            else:
                p_ref.add_run(formatted_ref)
    else:
        doc.add_paragraph(
            "Không tìm thấy mục tài liệu tham khảo nào."
            if is_vi
            else "No bibliography entries found."
        )

    # Section 2: Before -> After Change Log Table
    doc.add_heading(
        "2. Nhật ký đối chiếu Trước → Sau" if is_vi else "2. Before → After Citation Change Log",
        level=1,
    )
    if entries:
        table = doc.add_table(rows=1, cols=5)
        table.style = "Table Grid"
        headers = (
            [
                "#",
                "Trạng thái",
                "Thông tin đã sửa",
                "Trước (Bản gốc trong tài liệu)",
                f"Sau (Chuẩn hóa {norm_style.upper()})",
            ]
            if is_vi
            else [
                "#",
                "Status",
                "Updated Fields",
                "Before (Original in Document)",
                f"After (Standardized {norm_style.upper()})",
            ]
        )
        for col_idx, h_text in enumerate(headers):
            cell = table.rows[0].cells[col_idx]
            cell.text = h_text
            if cell.paragraphs and cell.paragraphs[0].runs:
                cell.paragraphs[0].runs[0].bold = True

        for e in entries:
            row_cells = table.add_row().cells
            disp_idx = e.get("display_index") or e.get("composite_label") or e.get("index", "")
            row_cells[0].text = str(disp_idx)
            inline_badge, table_status = _entry_status_badge_and_table_label(e, is_vi=is_vi)
            row_cells[1].text = table_status
            diff_fields = e.get("diff_fields") or []
            row_cells[2].text = ", ".join(str(f) for f in diff_fields) if diff_fields else "—"
            row_cells[3].text = str(e.get("original_raw") or "")
            if e.get("is_hallucination"):
                after_text = not_found_stamp
            elif inline_badge in (incomplete_stamp, manual_check_stamp):
                after_text = f"{inline_badge} {e.get('original_raw') or ''}".strip()
            elif inline_badge == web_source_stamp:
                after_text = f"{inline_badge} {_select_style_text(e)}".strip()
            else:
                after_text = _select_style_text(e)
            row_cells[4].text = after_text
    else:
        doc.add_paragraph(
            "Không có thay đổi nào được ghi nhận."
            if is_vi
            else "No reference changes recorded."
        )

    # Section 3: BibTeX Export Block
    combined_bibtex = _sanitize_bibtex_comments(rem_data.get("combined_bibtex"), is_vi=is_vi)
    if combined_bibtex:
        doc.add_heading(
            "3. Danh mục BibTeX chuẩn hóa (.bib)"
            if is_vi
            else "3. Standardized BibTeX Entries (.bib)",
            level=1,
        )
        p_bib = doc.add_paragraph()
        r_bib = p_bib.add_run(combined_bibtex)
        r_bib.font.size = Pt(8.5)

    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()
