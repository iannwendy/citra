"""pdfplumber parser — fallback, tốt cho table/structure."""

from __future__ import annotations

import os
from pathlib import Path

from integrity_checker.extraction.base import BasePDFParser, Document, Page

MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "200"))


class PdfPlumberParser(BasePDFParser):
    """Parser dùng pdfplumber (fallback khi PyMuPDF fail).

    # TODO(user): tuần 3 — bật table extraction, character-level metadata.
    """

    name = "pdfplumber"

    def parse(self, file_path: str | Path) -> Document:
        try:
            import pdfplumber  # type: ignore
        except ImportError as e:
            raise ImportError(
                "pdfplumber chưa cài. Chạy: pip install pdfplumber"
            ) from e

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        pages: list[Page] = []
        errors: list[str] = []
        metadata: dict = {}

        with pdfplumber.open(str(path)) as pdf:
            metadata = dict(pdf.metadata or {})
            total_doc_pages = len(pdf.pages)
            if total_doc_pages > MAX_PDF_PAGES:
                errors.append(
                    f"Document has {total_doc_pages} pages; truncated to first {MAX_PDF_PAGES} pages."
                )
            for idx, page in enumerate(pdf.pages[:MAX_PDF_PAGES]):
                try:
                    text = page.extract_text() or ""
                    has_text = len(text.strip()) > 0
                    pages.append(
                        Page(page_num=idx + 1, text=text, has_text_layer=has_text)
                    )
                except Exception as e:  # noqa: BLE001
                    errors.append(f"Page {idx + 1}: {e!s}")

        return Document(
            file_path=str(path),
            num_pages=len(pages),
            pages=pages,
            metadata=metadata,
            parser_used=self.name,
            errors=errors,
        )
