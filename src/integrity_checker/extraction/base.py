"""Abstract PDF parser — adapter pattern.

Cho phép gắn GROBID (mở rộng tương lai) mà không refactor pipeline.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Page:
    """Một trang PDF đã được parse."""

    page_num: int                # 1-indexed
    text: str
    has_text_layer: bool = True  # False nếu cần OCR


@dataclass
class Document:
    """Kết quả parse PDF — input cho các bước downstream."""

    file_path: str
    num_pages: int
    pages: list[Page] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    parser_used: str = ""         # "mupdf" | "pdfplumber" | "grobid"
    errors: list[str] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        """Ghép text toàn bộ trang, có dấu phân trang để debug."""
        parts = []
        for p in self.pages:
            if p.text:
                parts.append(f"\n--- Page {p.page_num} ---\n{p.text}")
        return "\n".join(parts)

    def has_any_text(self, min_chars: int = 50) -> bool:
        """Kiểm tra PDF có text layer (không phải scan)."""
        total = sum(len(p.text) for p in self.pages)
        return total >= min_chars


class BasePDFParser(ABC):
    """Interface cho mọi PDF parser.

    Implementations:
        - MuPdfParser (default, nhanh)
        - PdfPlumberParser (fallback)
        - GrobidParser (mở rộng tương lai — TODO)
    """

    name: str = "base"

    @abstractmethod
    def parse(self, file_path: str | Path) -> Document:
        """Parse PDF và trả Document. Raise exception nếu lỗi fatal."""
        raise NotImplementedError

    def is_supported(self, file_path: str | Path) -> bool:
        """Check file có phải PDF không. Default: extension check."""
        return str(file_path).lower().endswith(".pdf")


def chain_parsers(parsers: Iterable[BasePDFParser]) -> BasePDFParser:
    """Parser ghép — thử lần lượt cho đến khi parser nào trả Document có text.

    # TODO(user): implement thật trong tuần 3.
    """

    class _Chained(BasePDFParser):
        name = "chained"

        def parse(self, file_path: str | Path) -> Document:
            last_error: Exception | None = None
            for p in parsers:
                try:
                    doc = p.parse(file_path)
                    if doc.has_any_text():
                        return doc
                except Exception as e:  # noqa: BLE001
                    last_error = e
                    continue
            if last_error:
                raise last_error
            raise RuntimeError("All parsers failed")

    return _Chained()
