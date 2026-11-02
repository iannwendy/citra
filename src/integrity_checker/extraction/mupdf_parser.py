"""PyMuPDF (fitz) parser — default, nhanh, tốt cho text layer."""

from __future__ import annotations

import os
from pathlib import Path

from integrity_checker.extraction.base import BasePDFParser, Document, Page

MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "200"))


class MuPdfParser(BasePDFParser):
    """Parser dùng PyMuPDF (`pip install PyMuPDF`).

    # TODO(user): tuần 3 — thêm config dpi cho table extraction, image bbox.
    """

    name = "mupdf"

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

            scanned_pages_count = 0
            total_extractable_chars = 0

            for idx in range(page_limit):
                try:
                    page = doc[idx]
                    text = self._extract_page_text_reading_order(page)
                    stripped = text.strip()
                    char_len = len(stripped)
                    total_extractable_chars += char_len
                    has_text = char_len >= 40
                    if not has_text:
                        scanned_pages_count += 1
                    pages.append(
                        Page(page_num=idx + 1, text=text, has_text_layer=has_text)
                    )
                except Exception as e:  # noqa: BLE001
                    errors.append(f"Page {idx + 1}: {e!s}")

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

            metadata = dict(doc.metadata or {})
            metadata["is_scanned_pdf"] = is_scanned_pdf
            metadata["scanned_pages_count"] = scanned_pages_count
            metadata["total_extractable_chars"] = total_extractable_chars
            metadata["avg_chars_per_page"] = round(avg_chars_per_page, 1)
            metadata["scanned_ratio"] = round(scanned_ratio, 3)
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
