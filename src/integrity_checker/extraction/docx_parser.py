"""DocxParser — Multi-modal Microsoft Word (.docx) structural extractor.

Extracts paragraphs, headings, tables (in true document order), and XML
footnotes/endnotes from .docx manuscripts into the unified ``Document``
and ``Page`` data structures used by ``DocumentParser``, ``SectionSegmenter``,
``CitationExtractor``, and ``ReferenceListParser``.
"""

from __future__ import annotations

import posixpath
import re
import unicodedata
import zipfile
from pathlib import Path

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as safe_fromstring

from integrity_checker.extraction.base import BasePDFParser, Document, Page
from integrity_checker.extraction.patterns.utils import (
    _ALPHA_LATIN_VN,
    _UPPER_LATIN_VN,
)
from integrity_checker.extraction.vn_encoding import VietnameseLegacyTranscoder
from integrity_checker.logging import get_logger

logger = get_logger(__name__)

_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Upper bounds against crafted DOCX ZIP bombs / oversized XML parts before python-docx loads XML
_MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
_MAX_DOCX_XML_MEMBER_BYTES = 50 * 1024 * 1024
_MAX_DOCX_ARCHIVE_ENTRIES = 5000
_NOTES_XML_MEMBERS = frozenset({"word/footnotes.xml", "word/endnotes.xml"})
_ALLOWED_NOTES_CONTENT_TYPES: dict[str, frozenset[str]] = {
    "word/footnotes.xml": frozenset(
        {
            "",
            "application/xml",
            "text/xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
        }
    ),
    "word/endnotes.xml": frozenset(
        {
            "",
            "application/xml",
            "text/xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
        }
    ),
}
_ALLOWED_NOTES_REL_SUFFIXES: dict[str, str] = {
    "word/footnotes.xml": "/relationships/footnotes",
    "word/endnotes.xml": "/relationships/endnotes",
}

# Upper bound for word/footnotes.xml / endnotes.xml (uncompressed) — real notes
# parts are a few hundred KB; anything bigger is treated as a zip bomb.
_MAX_NOTES_XML_BYTES = 20 * 1024 * 1024

_BIB_HEADING_RE = re.compile(
    r"^\s*(?:[IVXLCDM]+\.\s*|\d+(?:\.\d+)*\.?\s*)?"
    r"(?:references|bibliography|works\s+cited|literature\s+cited|"
    r"tài\s+liệu\s+tham\s+khảo|danh\s+mục\s+tài\s+liệu\s+tham\s+khảo)\s*$",
    re.IGNORECASE,
)

# IEEE / Journal trailing author biography detector after bibliography entries
_AUTHOR_BIO_RE = re.compile(
    rf"^{_UPPER_LATIN_VN}(?:{_ALPHA_LATIN_VN}|[\s.\-]){{2,45}}\s+"
    r"(?:is\s+currently\s+(?:an?\s+)?(?:undergraduate|graduate|phd|master|professor|lecturer|researcher|student)|"
    r"received\s+the\s+(?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?E\.?|B\.?Tech)|"
    r"was\s+born\s+in\s+)",
)


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


def _resolve_opc_rel_target(rels_member_norm: str, raw_target: str) -> str:
    """Resolve an internal OPC <Relationship Target=.../> path to normalized archive path."""
    clean_target = raw_target.replace("\\", "/").strip()
    if not clean_target:
        return ""
    if clean_target.startswith("/"):
        resolved = posixpath.normpath(clean_target.lstrip("/"))
    else:
        segs = [s for s in rels_member_norm.split("/") if s]
        if len(segs) >= 2 and segs[-2] == "_rels":
            base_dir = "/".join(segs[:-2])
        else:
            base_dir = "/".join(segs[:-1])
        joined = f"{base_dir}/{clean_target}" if base_dir else clean_target
        resolved = posixpath.normpath(joined)
    return resolved.lstrip("/").rstrip("/").lower()


class DocxParser(BasePDFParser):
    """Structural parser for Microsoft Word (.docx) manuscripts."""

    name = "docx"

    # Approximate characters per logical page when explicit page breaks are absent
    CHARS_PER_PAGE = 3200

    @staticmethod
    def _validate_docx_archive(path: Path) -> None:
        """Reject ZIP bombs (> 100 MB uncompressed), duplicate entries, and DTD/XXE payloads before python-docx opens the archive."""
        chunk_size = 65536
        try:
            with zipfile.ZipFile(path, "r") as zf:
                infos = zf.infolist()
                if len(infos) > _MAX_DOCX_ARCHIVE_ENTRIES:
                    raise ValueError(
                        f"DOCX archive has too many entries ({len(infos)} > {_MAX_DOCX_ARCHIVE_ENTRIES})"
                    )

                seen_names: set[str] = set()
                ct_info: zipfile.ZipInfo | None = None
                for info in infos:
                    if info.is_dir():
                        continue
                    norm = info.filename.replace("\\", "/").lstrip("/").rstrip("/").lower()
                    if not norm or norm in seen_names:
                        raise ValueError(
                            f"Invalid or duplicate DOCX archive entry '{info.filename}'"
                        )
                    seen_names.add(norm)
                    if norm == "[content_types].xml":
                        ct_info = info

                if (
                    ct_info is None
                    or "[content_types].xml" not in seen_names
                    or "word/document.xml" not in seen_names
                ):
                    raise ValueError(
                        "Invalid DOCX archive: missing required [Content_Types].xml or word/document.xml"
                    )

                declared_total = sum(
                    max(0, int(info.file_size or 0))
                    for info in infos
                    if not info.is_dir()
                )
                if declared_total > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES:
                    raise ValueError(
                        f"DOCX archive uncompressed size ({declared_total} bytes) exceeds 100 MB limit"
                    )

                ct_declared = max(0, int(ct_info.file_size or 0))
                if ct_declared > _MAX_DOCX_XML_MEMBER_BYTES:
                    raise ValueError(
                        f"DOCX XML member '{ct_info.filename}' ({ct_declared} bytes) exceeds {_MAX_DOCX_XML_MEMBER_BYTES // (1024 * 1024)} MB limit"
                    )

                total_uncompressed = 0
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
                            ct_bytes_len > _MAX_DOCX_XML_MEMBER_BYTES
                            or total_uncompressed > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES
                        ):
                            raise ValueError(
                                f"DOCX XML stream for '{ct_info.filename}' exceeds uncompressed size limit (possible ZIP bomb)"
                            )
                        if _window_has_dtd_or_entity(ct_tail + chunk, is_utf16=ct_is_utf16):
                            raise ValueError(
                                f"Unsafe XML entity/DTD in DOCX member '{ct_info.filename}'"
                            )
                        ct_tail = chunk[-64:]
                        ct_chunks.append(chunk)

                try:
                    ct_root = safe_fromstring(
                        b"".join(ct_chunks),
                        forbid_dtd=True,
                        forbid_entities=True,
                        forbid_external=True,
                    )
                except DefusedXmlException as exc:
                    raise ValueError(
                        f"Unsafe XML entity/DTD in DOCX member '{ct_info.filename}'"
                    ) from exc
                except Exception as exc:
                    raise ValueError(
                        f"Malformed XML in DOCX member '{ct_info.filename}'"
                    ) from exc

                def _is_ooxml_xml_ctype(ct: str) -> bool:
                    return (
                        ct in (
                            "application/xml",
                            "text/xml",
                            "application/vnd.openxmlformats-officedocument.vmldrawing",
                        )
                        or ct.endswith("+xml")
                    )

                xml_extensions: set[str] = {"xml", "rels"}
                xml_part_names: set[str] = set()
                default_ctypes: dict[str, str] = {}
                override_ctypes: dict[str, str] = {}
                for elem in ct_root.iter():
                    local_tag = (
                        elem.tag.rsplit("}", 1)[-1].lower()
                        if isinstance(elem.tag, str)
                        else ""
                    )
                    ctype = (elem.attrib.get("ContentType") or "").strip().lower()
                    ctype_base = ctype.split(";", 1)[0].strip()
                    if local_tag == "default":
                        ext = (elem.attrib.get("Extension") or "").strip().lstrip(".").lower()
                        if ext:
                            if ext in default_ctypes and default_ctypes[ext] != ctype_base:
                                default_ctypes[ext] = "__conflict__"
                            else:
                                default_ctypes[ext] = ctype_base
                            if _is_ooxml_xml_ctype(ctype_base):
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
                            if pname in override_ctypes and override_ctypes[pname] != ctype_base:
                                override_ctypes[pname] = "__conflict__"
                            else:
                                override_ctypes[pname] = ctype_base
                            if _is_ooxml_xml_ctype(ctype_base):
                                xml_part_names.add(pname)

                for info in infos:
                    if info is ct_info or info.is_dir():
                        continue
                    lower_name = info.filename.replace("\\", "/").lstrip("/").rstrip("/").lower()
                    ext = lower_name.rsplit(".", 1)[-1] if "." in lower_name else ""
                    effective_ctype = override_ctypes.get(lower_name, default_ctypes.get(ext, ""))
                    allowed_note_ctypes = _ALLOWED_NOTES_CONTENT_TYPES.get(info.filename)
                    is_notes_path = lower_name in _NOTES_XML_MEMBERS
                    is_notes_member = (
                        allowed_note_ctypes is not None
                        and effective_ctype in allowed_note_ctypes
                    )
                    is_declared_xml = (ext in xml_extensions) or (lower_name in xml_part_names)

                    declared_size = max(0, int(info.file_size or 0))
                    if is_notes_path and declared_size > _MAX_NOTES_XML_BYTES:
                        raise ValueError(
                            f"DOCX XML member '{info.filename}' ({declared_size} bytes) exceeds {_MAX_NOTES_XML_BYTES // (1024 * 1024)} MB limit"
                        )
                    if is_declared_xml and not is_notes_path and declared_size > _MAX_DOCX_XML_MEMBER_BYTES:
                        raise ValueError(
                            f"DOCX XML member '{info.filename}' ({declared_size} bytes) exceeds {_MAX_DOCX_XML_MEMBER_BYTES // (1024 * 1024)} MB limit"
                        )

                    xml_chunks: list[bytes] = []
                    head_buf = bytearray()
                    tail_buf = b""
                    entry_is_utf16 = False
                    should_parse_xml = is_declared_xml and not is_notes_member
                    part_bytes = 0
                    with zf.open(info, "r") as member_fp:
                        while True:
                            chunk = member_fp.read(chunk_size)
                            if not chunk:
                                break
                            if part_bytes == 0 and chunk.startswith((b"\xff\xfe", b"\xfe\xff")):
                                entry_is_utf16 = True
                            chunk_len = len(chunk)
                            part_bytes += chunk_len
                            total_uncompressed += chunk_len
                            if is_notes_path and part_bytes > _MAX_NOTES_XML_BYTES:
                                raise ValueError(
                                    f"DOCX XML stream for '{info.filename}' exceeds uncompressed size limit (possible ZIP bomb)"
                                )
                            if total_uncompressed > _MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES:
                                raise ValueError(
                                    f"DOCX stream for '{info.filename}' exceeds uncompressed size limit (possible ZIP bomb)"
                                )
                            if not is_notes_member:
                                if _window_has_dtd_or_entity(tail_buf + chunk, is_utf16=entry_is_utf16):
                                    raise ValueError(
                                        f"Unsafe XML entity/DTD in DOCX member '{info.filename}'"
                                    )
                                tail_buf = chunk[-64:]
                                if not should_parse_xml and len(head_buf) < 512:
                                    head_buf.extend(chunk[: 512 - len(head_buf)])
                                    if _has_xml_magic_prefix(bytes(head_buf)):
                                        should_parse_xml = True
                                if should_parse_xml:
                                    if part_bytes > _MAX_DOCX_XML_MEMBER_BYTES:
                                        raise ValueError(
                                            f"DOCX XML stream for '{info.filename}' exceeds uncompressed size limit (possible ZIP bomb)"
                                        )
                                    xml_chunks.append(chunk)

                    # Notes parts (footnotes/endnotes) are validated via safe_fromstring
                    # inside _extract_xml_notes so unsafe DTDs in notes degrade gracefully
                    # without aborting body/reference extraction, while oversized note
                    # ZIP-bomb streams and ContentType/relationship hijacks are rejected.
                    if should_parse_xml and xml_chunks and not is_notes_member:
                        try:
                            xml_root = safe_fromstring(
                                b"".join(xml_chunks),
                                forbid_dtd=True,
                                forbid_entities=True,
                                forbid_external=True,
                            )
                        except DefusedXmlException as exc:
                            raise ValueError(
                                f"Unsafe XML entity/DTD in DOCX member '{info.filename}'"
                            ) from exc
                        except Exception as exc:
                            raise ValueError(
                                f"Malformed XML in DOCX member '{info.filename}'"
                            ) from exc

                        root_local = (
                            xml_root.tag.rsplit("}", 1)[-1].lower()
                            if isinstance(xml_root.tag, str)
                            else ""
                        )
                        if (
                            ext == "rels"
                            or effective_ctype
                            == "application/vnd.openxmlformats-package.relationships+xml"
                            or root_local == "relationships"
                        ):
                            for rel_el in xml_root.iter():
                                rel_tag = (
                                    rel_el.tag.rsplit("}", 1)[-1].lower()
                                    if isinstance(rel_el.tag, str)
                                    else ""
                                )
                                if rel_tag != "relationship":
                                    continue
                                if (
                                    rel_el.attrib.get("TargetMode") or ""
                                ).strip().lower() == "external":
                                    continue
                                resolved_target = _resolve_opc_rel_target(
                                    lower_name, rel_el.attrib.get("Target") or ""
                                )
                                required_suffix = _ALLOWED_NOTES_REL_SUFFIXES.get(resolved_target)
                                if required_suffix is not None:
                                    rel_type = (rel_el.attrib.get("Type") or "").strip().lower()
                                    if not rel_type.endswith(required_suffix):
                                        raise ValueError(
                                            f"Invalid relationship type '{rel_type}' targeting '{resolved_target}' in '{info.filename}'"
                                        )
        except zipfile.BadZipFile as exc:
            raise ValueError(f"Invalid or corrupted DOCX ZIP archive: {path}") from exc

    def parse(self, file_path: str | Path) -> Document:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"DOCX file not found: {path}")

        self._validate_docx_archive(path)

        try:
            import docx  # type: ignore
        except ImportError as exc:
            raise RuntimeError("python-docx is required to parse .docx files") from exc

        doc = docx.Document(str(path))
        footnotes_map = self._extract_xml_notes(path, "word/footnotes.xml", "footnote")
        endnotes_map = self._extract_xml_notes(path, "word/endnotes.xml", "endnote")

        pages_lines: list[list[str]] = [[]]
        pages_legacy_encs: list[str | None] = [None]
        current_chars = 0
        current_page_notes: list[str] = []
        in_bibliography = False
        legacy_enc_counts: dict[str, int] = {}

        def _record_page_enc(enc: str | None) -> None:
            if enc and pages_legacy_encs[-1] is None:
                pages_legacy_encs[-1] = enc

        def _flush_page() -> None:
            nonlocal current_chars, current_page_notes
            if current_page_notes:
                pages_lines[-1].extend(current_page_notes)
                current_page_notes = []
            if pages_lines[-1]:
                pages_lines.append([])
                pages_legacy_encs.append(None)
                current_chars = 0

        body_elm = doc.element.body
        for child in body_elm.iterchildren():
            tag = child.tag
            if tag == f"{_WORD_NS}p":
                raw_text, note_refs, has_page_break, font_hint = self._extract_paragraph_xml(
                    child, footnotes_map, endnotes_map
                )
                if has_page_break and pages_lines[-1]:
                    _flush_page()

                decoded_text, detected_enc = (
                    VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                        raw_text, font_hint=font_hint
                    )
                )
                _record_page_enc(detected_enc)
                stripped = unicodedata.normalize("NFC", decoded_text).strip()
                if not stripped:
                    continue

                # Check if this paragraph is the Bibliography / References heading
                if _BIB_HEADING_RE.match(stripped):
                    if pages_lines[-1]:
                        _flush_page()
                        _record_page_enc(detected_enc)
                    in_bibliography = True
                    pages_lines[-1].append(stripped)
                    current_chars += len(stripped)
                    continue

                # Skip trailing IEEE author biography paragraphs at the end of REFERENCES
                if in_bibliography and _AUTHOR_BIO_RE.match(stripped):
                    logger.debug(
                        "Skipping trailing author biography paragraph in DOCX: {}",
                        stripped[:80],
                    )
                    continue

                pages_lines[-1].append(stripped)
                current_chars += len(stripped)

                for note_txt in note_refs:
                    norm_note, note_enc = (
                        VietnameseLegacyTranscoder.normalize_legacy_vietnamese(note_txt)
                    )
                    _record_page_enc(note_enc)
                    norm_note = unicodedata.normalize("NFC", norm_note)
                    if norm_note not in current_page_notes:
                        current_page_notes.append(norm_note)

                if not in_bibliography and current_chars >= self.CHARS_PER_PAGE:
                    _flush_page()

            elif tag == f"{_WORD_NS}tbl":
                table_lines, tbl_font_hint = self._extract_table_xml_with_fonts(child)
                for tline in table_lines:
                    norm_tline, tbl_enc = (
                        VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                            tline, font_hint=tbl_font_hint
                        )
                    )
                    _record_page_enc(tbl_enc)
                    norm_tline = unicodedata.normalize("NFC", norm_tline)
                    pages_lines[-1].append(norm_tline)
                    current_chars += len(norm_tline)
                if not in_bibliography and current_chars >= self.CHARS_PER_PAGE:
                    _flush_page()

        if current_page_notes:
            pages_lines[-1].extend(current_page_notes)

        # Append any unreferenced endnotes at the end of body if not already included
        all_joined = "\n".join("\n".join(lines) for lines in pages_lines)
        for eid, etext in sorted(endnotes_map.items()):
            norm_etext, end_enc = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(etext)
            _record_page_enc(end_enc)
            norm_etext = unicodedata.normalize("NFC", norm_etext)
            marker = f"[{eid}] {norm_etext}"
            if norm_etext and norm_etext not in all_joined:
                pages_lines[-1].append(marker)

        non_empty_pages: list[str] = []
        for idx_p, lines in enumerate(pages_lines):
            joined_p = "\n".join(lines).strip()
            if not joined_p:
                continue
            page_enc = pages_legacy_encs[idx_p] if idx_p < len(pages_legacy_encs) else None
            if page_enc is None:
                joined_p, page_enc = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                    joined_p
                )
                joined_p = unicodedata.normalize("NFC", joined_p)
            if page_enc:
                legacy_enc_counts[page_enc] = legacy_enc_counts.get(page_enc, 0) + 1
            non_empty_pages.append(joined_p)

        dominant_legacy_enc = (
            max(legacy_enc_counts.items(), key=lambda kv: kv[1])[0]
            if legacy_enc_counts
            else None
        )
        doc_metadata = {
            "is_scanned_pdf": False,
            "scanned_pages_count": 0,
            "ocr_pages_recovered": [],
            "legacy_encoding_detected": dominant_legacy_enc,
            "legacy_encoding_pages_count": sum(legacy_enc_counts.values()),
        }

        if not non_empty_pages:
            return Document(
                file_path=str(path),
                num_pages=1,
                pages=[Page(page_num=1, text="")],
                metadata=doc_metadata,
                parser_used=self.name,
            )

        pages = [
            Page(page_num=idx + 1, text=page_text)
            for idx, page_text in enumerate(non_empty_pages)
        ]
        return Document(
            file_path=str(path),
            num_pages=len(pages),
            pages=pages,
            metadata=doc_metadata,
            parser_used=self.name,
        )

    @staticmethod
    def _extract_paragraph_xml(
        p_elm,
        footnotes_map: dict[int, str],
        endnotes_map: dict[int, str],
    ) -> tuple[str, list[str], bool, str | None]:
        """Extract text, referenced footnotes/endnotes, page break flag, and font hint from <w:p>."""
        parts: list[str] = []
        note_texts: list[str] = []
        font_names: list[str] = []
        has_page_break = False

        for elem in p_elm.iter():
            etag = elem.tag
            if etag == f"{_WORD_NS}rFonts":
                for attr_name in (
                    f"{_WORD_NS}ascii",
                    f"{_WORD_NS}hAnsi",
                    f"{_WORD_NS}cs",
                ):
                    fval = elem.attrib.get(attr_name)
                    if fval and fval not in font_names:
                        font_names.append(fval)
            elif etag == f"{_WORD_NS}t" and elem.text:
                parts.append(elem.text)
            elif etag == f"{_WORD_NS}tab":
                parts.append(" ")
            elif etag in (f"{_WORD_NS}br", f"{_WORD_NS}cr"):
                br_type = elem.attrib.get(f"{_WORD_NS}type", "")
                if br_type == "page":
                    has_page_break = True
                else:
                    parts.append("\n")
            elif etag == f"{_WORD_NS}lastRenderedPageBreak":
                has_page_break = True
            elif etag == f"{_WORD_NS}footnoteReference":
                raw_id = elem.attrib.get(f"{_WORD_NS}id")
                if raw_id and raw_id.lstrip("-").isdigit():
                    fid = int(raw_id)
                    if fid > 0 and fid in footnotes_map:
                        note_texts.append(f"{fid}. {footnotes_map[fid]}")
            elif etag == f"{_WORD_NS}endnoteReference":
                raw_id = elem.attrib.get(f"{_WORD_NS}id")
                if raw_id and raw_id.lstrip("-").isdigit():
                    eid = int(raw_id)
                    if eid > 0 and eid in endnotes_map:
                        note_texts.append(f"{eid}. {endnotes_map[eid]}")

        text = "".join(parts)
        font_hint = " ".join(font_names) if font_names else None
        return text, note_texts, has_page_break, font_hint

    @staticmethod
    def _extract_table_xml_with_fonts(tbl_elm) -> tuple[list[str], str | None]:
        """Extract distinct row texts and run font hint from a <w:tbl> element."""
        lines: list[str] = []
        font_names: list[str] = []
        for rf in tbl_elm.findall(f".//{_WORD_NS}rFonts"):
            for attr_name in (f"{_WORD_NS}ascii", f"{_WORD_NS}hAnsi", f"{_WORD_NS}cs"):
                fval = rf.attrib.get(attr_name)
                if fval and fval not in font_names:
                    font_names.append(fval)
        for tr in tbl_elm.findall(f".//{_WORD_NS}tr"):
            row_cells: list[str] = []
            for tc in tr.findall(f"./{_WORD_NS}tc"):
                cell_texts = [
                    t.text for t in tc.findall(f".//{_WORD_NS}t") if t.text
                ]
                cell_str = " ".join("".join(cell_texts).split())
                if cell_str and (not row_cells or row_cells[-1] != cell_str):
                    row_cells.append(cell_str)
            if row_cells:
                lines.append(" | ".join(row_cells))
        font_hint = " ".join(font_names) if font_names else None
        return lines, font_hint

    @classmethod
    def _extract_table_xml(cls, tbl_elm) -> list[str]:
        """Backward-compatible table row text extractor."""
        lines, _ = cls._extract_table_xml_with_fonts(tbl_elm)
        return lines

    @staticmethod
    def _extract_xml_notes(
        docx_path: Path, member_name: str, note_tag: str
    ) -> dict[int, str]:
        """Extract footnotes or endnotes from word/footnotes.xml or word/endnotes.xml."""
        notes: dict[int, str] = {}
        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                if member_name not in zf.namelist():
                    return notes
                info = zf.getinfo(member_name)
                if info.file_size > _MAX_NOTES_XML_BYTES:
                    logger.warning(
                        "Skipping oversized {} in {} (possible zip bomb)", member_name, docx_path
                    )
                    return notes
                xml_buf = bytearray()
                with zf.open(info, "r") as member_fp:
                    while True:
                        chunk = member_fp.read(65536)
                        if not chunk:
                            break
                        xml_buf.extend(chunk)
                        if len(xml_buf) > _MAX_NOTES_XML_BYTES:
                            logger.warning(
                                "Skipping oversized streamed {} in {} (possible zip bomb)",
                                member_name,
                                docx_path,
                            )
                            return notes
                xml_bytes = bytes(xml_buf)
            # Untrusted user upload: defusedxml forbids DTD entities / external
            # references (billion-laughs, XXE) and raises instead of expanding.
            root = safe_fromstring(
                xml_bytes,
                forbid_dtd=True,
                forbid_entities=True,
                forbid_external=True,
            )
            for note_el in root.findall(f".//{_WORD_NS}{note_tag}"):
                raw_id = note_el.attrib.get(f"{_WORD_NS}id")
                note_type = note_el.attrib.get(f"{_WORD_NS}type", "")
                if note_type in ("separator", "continuationSeparator"):
                    continue
                if not raw_id or not raw_id.lstrip("-").isdigit():
                    continue
                nid = int(raw_id)
                if nid <= 0:
                    continue
                texts = [
                    t.text for t in note_el.findall(f".//{_WORD_NS}t") if t.text
                ]
                cleaned = " ".join("".join(texts).split())
                if cleaned:
                    notes[nid] = cleaned
        except Exception as exc:
            logger.debug("Could not parse {} from {}: {}", member_name, docx_path, exc)
        return notes
