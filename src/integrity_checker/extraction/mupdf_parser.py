"""PyMuPDF (fitz) parser — default, nhanh, tốt cho text layer."""

from __future__ import annotations

import logging
import os
import re
import time
import unicodedata
from pathlib import Path

from integrity_checker.extraction.base import BasePDFParser, Document, Page
from integrity_checker.extraction.vn_encoding import VietnameseLegacyTranscoder

logger = logging.getLogger(__name__)

MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "500"))
MAX_OCR_PAGES = 15
OCR_TIMEOUT_SEC = 12.0


class MuPdfParser(BasePDFParser):
    """Parser dùng PyMuPDF (`pip install PyMuPDF`).

    # TODO(user): tuần 3 — thêm config dpi cho table extraction, image bbox.
    """

    name = "mupdf"

    _STANDARD_TESSDATA_DIRS: tuple[str, ...] = (
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tesseract-ocr/tessdata",
        "/opt/homebrew/share/tessdata",
        "/usr/local/share/tessdata",
    )
    _TCVN3_FONT_RE = re.compile(r"(?:^|[+\s,;])\.vn[a-z]", re.IGNORECASE)
    _VNI_FONT_RE = re.compile(r"(?:^|[+\s,;])vni-[a-z]", re.IGNORECASE)

    @classmethod
    def _discover_tessdata(cls) -> tuple[str, str] | None:
        """Discover Tesseract language folder and choose `'vie+eng'` or `'eng'`."""
        candidates: list[Path] = []
        env_prefix = os.getenv("TESSDATA_PREFIX", "").strip()
        if env_prefix:
            p_env = Path(env_prefix)
            candidates.append(p_env)
            candidates.append(p_env / "tessdata")
        for std_dir in cls._STANDARD_TESSDATA_DIRS:
            candidates.append(Path(std_dir))

        seen: set[str] = set()
        for cand in candidates:
            key = str(cand)
            if key in seen:
                continue
            seen.add(key)
            if not cand.is_dir():
                continue
            has_vie = (cand / "vie.traineddata").is_file()
            has_eng = (cand / "eng.traineddata").is_file()
            if has_vie and has_eng:
                return str(cand), "vie+eng"
            if has_eng:
                return str(cand), "eng"
            if has_vie:
                return str(cand), "vie"
        return None

    @classmethod
    def _extract_page_font_hint(cls, page) -> str | None:
        """Inspect PDF font names on `page` for `.Vn*` (TCVN3) or `VNI-*` hints."""
        try:
            fonts = page.get_fonts() or []
        except Exception:  # noqa: BLE001
            return None
        saw_tcvn3 = False
        saw_vni = False
        first_tcvn3: str | None = None
        first_vni: str | None = None
        for entry in fonts:
            for idx in (3, 4):
                if len(entry) > idx and isinstance(entry[idx], str) and entry[idx]:
                    fname = entry[idx]
                    if cls._TCVN3_FONT_RE.search(fname):
                        saw_tcvn3 = True
                        first_tcvn3 = first_tcvn3 or fname
                    elif cls._VNI_FONT_RE.search(fname):
                        saw_vni = True
                        first_vni = first_vni or fname
        if saw_tcvn3 and not saw_vni:
            return first_tcvn3
        if saw_vni and not saw_tcvn3:
            return first_vni
        return None

    @staticmethod
    def _page_raster_coverage(page) -> float:
        """Compute exact clamped 2D union area ratio of raster images on `page`."""
        try:
            p_rect = page.rect
            page_area = float(p_rect.width * p_rect.height)
            if page_area <= 0.0:
                return 0.0

            rects: list[tuple[float, float, float, float]] = []
            try:
                for info in page.get_image_info() or []:
                    bbox = info.get("bbox")
                    if bbox and len(bbox) >= 4:
                        x0 = max(float(p_rect.x0), float(bbox[0]))
                        y0 = max(float(p_rect.y0), float(bbox[1]))
                        x1 = min(float(p_rect.x1), float(bbox[2]))
                        y1 = min(float(p_rect.y1), float(bbox[3]))
                        if x1 > x0 and y1 > y0:
                            rects.append((x0, y0, x1, y1))
            except Exception:  # noqa: BLE001
                rects = []

            if not rects:
                for img in page.get_images(full=True) or []:
                    xref = img[0]
                    for r in page.get_image_rects(xref) or []:
                        x0 = max(float(p_rect.x0), float(r.x0))
                        y0 = max(float(p_rect.y0), float(r.y0))
                        x1 = min(float(p_rect.x1), float(r.x1))
                        y1 = min(float(p_rect.y1), float(r.y1))
                        if x1 > x0 and y1 > y0:
                            rects.append((x0, y0, x1, y1))

            if not rects:
                return 0.0

            xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
            union_area = 0.0
            for i in range(len(xs) - 1):
                sx0, sx1 = xs[i], xs[i + 1]
                if sx1 <= sx0:
                    continue
                y_intervals = sorted(
                    (r[1], r[3]) for r in rects if r[0] <= sx0 and r[2] >= sx1
                )
                if not y_intervals:
                    continue
                cur_y0, cur_y1 = y_intervals[0]
                merged_y = 0.0
                for ny0, ny1 in y_intervals[1:]:
                    if ny0 <= cur_y1:
                        if ny1 > cur_y1:
                            cur_y1 = ny1
                    else:
                        merged_y += cur_y1 - cur_y0
                        cur_y0, cur_y1 = ny0, ny1
                merged_y += cur_y1 - cur_y0
                union_area += (sx1 - sx0) * merged_y
            return min(1.0, union_area / page_area)
        except Exception:  # noqa: BLE001
            return 0.0

    def _maybe_ocr_sparse_pages(
        self,
        doc,
        pages,
        page_indices: list[int] | None = None,
        max_pages: int = MAX_OCR_PAGES,
        timeout_sec: float = OCR_TIMEOUT_SEC,
    ) -> list[int]:
        """Run native PyMuPDF Tesseract OCR selectively on sparse raster pages.

        Priority when candidate pages exceed `max_pages` (default 15):
        1. Up to the last 10 candidate pages (References / Tài liệu tham khảo).
        2. Up to the first 5 candidate pages (title, abstract, introduction).
        """
        if max_pages <= 0 or timeout_sec <= 0.0 or len(doc) == 0 or not pages:
            return []

        def _get_text(idx: int) -> str:
            item = pages[idx]
            if isinstance(item, Page):
                return item.text or ""
            if isinstance(item, dict):
                return str(item.get("text") or "")
            return str(item or "")

        def _set_text(idx: int, new_text: str) -> None:
            item = pages[idx]
            if isinstance(item, Page):
                item.text = new_text
                item.has_text_layer = len(new_text.strip()) >= 40
            elif isinstance(item, dict):
                item["text"] = new_text
                item["has_text_layer"] = len(new_text.strip()) >= 40
            else:
                pages[idx] = new_text

        upper_bound = min(len(doc), len(pages))
        raw_indices = (
            list(range(upper_bound)) if page_indices is None else list(page_indices)
        )
        seen_idx: set[int] = set()
        candidates: list[int] = []
        for idx in sorted(raw_indices):
            if not (0 <= idx < upper_bound) or idx in seen_idx:
                continue
            seen_idx.add(idx)
            if len(_get_text(idx).strip()) >= 45:
                continue
            if self._page_raster_coverage(doc[idx]) >= 0.25:
                candidates.append(idx)

        if not candidates:
            return []

        tess_info = self._discover_tessdata()
        if tess_info is None:
            logger.debug("Skipping selective PyMuPDF OCR: tessdata directory not available.")
            return []
        tessdata_dir, ocr_lang = tess_info

        # Priority selection: last 10 back-matter candidates first, then first 5 front-matter
        back_cap = min(10, max_pages)
        back_pages = candidates[-back_cap:] if back_cap > 0 else []
        back_set = set(back_pages)
        rem_cap = max(0, max_pages - len(back_pages))
        front_pages = [idx for idx in candidates if idx not in back_set][:rem_cap]
        prioritized = back_pages + front_pages

        try:
            import fitz  # type: ignore

            ocr_flags = int(
                getattr(fitz, "TEXTFLAGS_OCR", 0)
                or getattr(fitz, "TEXT_PRESERVE_WHITESPACE", 0)
            )
        except Exception:  # noqa: BLE001
            ocr_flags = 0

        recovered: list[int] = []
        deadline = time.monotonic() + timeout_sec

        for idx in prioritized:
            if time.monotonic() >= deadline:
                logger.debug(
                    "Selective PyMuPDF OCR timeout (%.1fs) reached after %d pages.",
                    timeout_sec,
                    len(recovered),
                )
                break
            try:
                page = doc[idx]
                tp = page.get_textpage_ocr(
                    flags=ocr_flags,
                    language=ocr_lang,
                    dpi=200,
                    full=True,
                    tessdata=tessdata_dir,
                )
                ocr_raw = page.get_text("text", textpage=tp) or ""
                ocr_norm = unicodedata.normalize("NFC", ocr_raw)
                if len(ocr_norm.strip()) > len(_get_text(idx).strip()):
                    _set_text(idx, ocr_norm)
                    recovered.append(idx)
            except Exception as exc:  # noqa: BLE001
                logger.debug("Selective PyMuPDF OCR failed on page %d: %s", idx + 1, exc)
                msg = str(exc).lower()
                if "tessdata" in msg or "tesseract" in msg or "init" in msg:
                    break

        return recovered

    @staticmethod
    def _extract_page_text_reading_order(page) -> str:
        """Extract page text, restoring Left-Column -> Right-Column reading order
        when a 2-column PDF stores right-column text blocks before left-column blocks."""
        raw_text = page.get_text("text") or ""
        try:
            if getattr(page, "rotation", 0) in (90, 270):
                return raw_text
            all_blocks = [
                b for b in page.get_text("blocks")
                if len(b) >= 7 and b[6] == 0 and (b[4] or "").strip()
            ]
            # Exclude narrow vertical margin banners (e.g. rotated journal section strip on outer margin)
            blocks = [
                b for b in all_blocks
                if not ((b[2] - b[0]) < 35 and (b[3] - b[1]) > (b[2] - b[0]) * 2)
            ]
            if len(blocks) < 2:
                return raw_text
            min_x = min(b[0] for b in blocks)
            max_x = max(b[2] for b in blocks)
            span_x = max_x - min_x
            if span_x < 250:
                return raw_text
            mid_x = (min_x + max_x) / 2.0
            page_h = float(getattr(getattr(page, "rect", None), "height", 800.0) or 800.0)
            body_blocks = [
                b for b in blocks
                if b[3] >= page_h * 0.11 and b[1] <= page_h * 0.89
            ]
            left_body = [
                b for b in body_blocks
                if b[2] <= mid_x + 18 and (b[2] - b[0]) < span_x * 0.60
            ]
            right_body = [
                b for b in body_blocks
                if b[0] >= mid_x - 18 and (b[2] - b[0]) < span_x * 0.60
            ]
            if not (left_body and right_body):
                return raw_text
            left_chars = sum(len(b[4].strip()) for b in left_body)
            right_chars = sum(len(b[4].strip()) for b in right_body)
            if left_chars < 150 or right_chars < 150:
                return raw_text
            # Only reorder if at least one right-column body block appears before a
            # left-column body block that is vertically above or overlapping it
            needs_reorder = False
            for i, b_i in enumerate(body_blocks):
                if b_i in right_body:
                    for b_j in body_blocks[i + 1 :]:
                        if b_j in left_body and b_j[1] < b_i[3] - 5:
                            needs_reorder = True
                            break
                if needs_reorder:
                    break
            if not needs_reorder:
                return raw_text

            left_blocks = [
                b for b in blocks
                if b[2] <= mid_x + 18 and (b[2] - b[0]) < span_x * 0.60
            ]
            right_blocks = [
                b for b in blocks
                if b[0] >= mid_x - 18 and (b[2] - b[0]) < span_x * 0.60
            ]
            spanning = [b for b in blocks if b not in left_blocks and b not in right_blocks]
            col_min_y = min(b[1] for b in left_blocks + right_blocks)
            top_span = sorted(
                [b for b in spanning if b[1] <= col_min_y + 10],
                key=lambda b: (b[1], b[0]),
            )
            bot_span = sorted(
                [b for b in spanning if b not in top_span],
                key=lambda b: (b[1], b[0]),
            )
            ordered = (
                top_span
                + sorted(left_blocks, key=lambda b: b[1])
                + sorted(right_blocks, key=lambda b: b[1])
                + bot_span
            )
            return "\n".join(b[4].rstrip("\n") for b in ordered) + "\n"
        except Exception:
            return raw_text

    def parse(self, file_path: str | Path) -> Document:
        try:
            import fitz  # type: ignore
        except ImportError as e:
            raise ImportError(
                "PyMuPDF chưa cài. Chạy: pip install PyMuPDF"
            ) from e

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        doc = fitz.open(str(path))
        try:
            pages: list[Page] = []
            errors: list[str] = []
            total_doc_pages = len(doc)
            page_limit = min(total_doc_pages, MAX_PDF_PAGES)
            if total_doc_pages > MAX_PDF_PAGES:
                errors.append(
                    f"Document has {total_doc_pages} pages; truncated to first {MAX_PDF_PAGES} pages."
                )

            sparse_page_indices: list[int] = []
            legacy_enc_counts: dict[str, int] = {}

            for idx in range(page_limit):
                try:
                    page = doc[idx]
                    raw_page_text = self._extract_page_text_reading_order(page)
                    font_hint = self._extract_page_font_hint(page)
                    decoded_text, detected_enc = (
                        VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                            raw_page_text, font_hint=font_hint
                        )
                    )
                    if detected_enc:
                        legacy_enc_counts[detected_enc] = (
                            legacy_enc_counts.get(detected_enc, 0) + 1
                        )
                    text = unicodedata.normalize("NFC", decoded_text)
                    stripped = text.strip()
                    char_len = len(stripped)
                    has_text = char_len >= 40
                    if char_len < 45:
                        sparse_page_indices.append(len(pages))
                    pages.append(
                        Page(page_num=idx + 1, text=text, has_text_layer=has_text)
                    )
                except Exception as e:  # noqa: BLE001
                    errors.append(f"Page {idx + 1}: {e!s}")

            ocr_pages_recovered = self._maybe_ocr_sparse_pages(
                doc,
                pages,
                sparse_page_indices,
                max_pages=MAX_OCR_PAGES,
                timeout_sec=OCR_TIMEOUT_SEC,
            )

            scanned_pages_count = 0
            total_extractable_chars = 0
            for p_obj in pages:
                c_len = len((p_obj.text or "").strip())
                total_extractable_chars += c_len
                p_obj.has_text_layer = c_len >= 40
                if not p_obj.has_text_layer:
                    scanned_pages_count += 1

            avg_chars_per_page = (
                total_extractable_chars / page_limit if page_limit > 0 else 0.0
            )
            scanned_ratio = (
                scanned_pages_count / page_limit if page_limit > 0 else 0.0
            )
            is_scanned_pdf = bool(
                page_limit > 0
                and (
                    avg_chars_per_page < 55.0
                    or (scanned_ratio >= 0.70 and avg_chars_per_page < 120.0)
                )
            )

            dominant_legacy_enc = (
                max(legacy_enc_counts.items(), key=lambda kv: kv[1])[0]
                if legacy_enc_counts
                else None
            )

            metadata = dict(doc.metadata or {})
            metadata["is_scanned_pdf"] = is_scanned_pdf
            metadata["scanned_pages_count"] = scanned_pages_count
            metadata["total_extractable_chars"] = total_extractable_chars
            metadata["avg_chars_per_page"] = round(avg_chars_per_page, 1)
            metadata["scanned_ratio"] = round(scanned_ratio, 3)
            metadata["ocr_pages_recovered"] = ocr_pages_recovered
            metadata["legacy_encoding_detected"] = dominant_legacy_enc
            metadata["warning_code"] = (
                "SCANNED_PDF_DETECTED" if is_scanned_pdf else None
            )
            metadata["warning_message"] = (
                "Phát hiện tài liệu PDF dạng ảnh quét (Scanned/Image-only PDF) thiếu lớp văn bản số hóa (Text Layer). "
                "Vui lòng chuyển đổi qua OCR hoặc tải lên bản gốc .docx / PDF xuất trực tiếp từ Word/LaTeX để đạt độ chính xác kiểm chứng trích dẫn tối đa."
                if is_scanned_pdf
                else None
            )
            if is_scanned_pdf:
                errors.append(
                    f"SCANNED_PDF_DETECTED: {scanned_pages_count}/{page_limit} pages lack an extractable text layer "
                    f"(avg {avg_chars_per_page:.1f} chars/page)."
                )
            return Document(
                file_path=str(path),
                num_pages=len(doc),
                pages=pages,
                metadata=metadata,
                parser_used=self.name,
                errors=errors,
            )
        finally:
            doc.close()
