"""Citation data model — output của extraction module."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class CitationType(str, Enum):
    """Phân loại citation theo vị trí / format."""

    IN_TEXT = "in_text"               # (Smith, 2020), Smith et al. (2020)
    NUMERIC = "numeric"               # [1], [1,2], [1-5]
    REFERENCE_LIST = "reference_list"  # entry ở cuối bài
    DOI = "doi"                       # chỉ có DOI
    URL = "url"                       # chỉ có URL
    UNKNOWN = "unknown"


class CitationStyle(str, Enum):
    """Citation style — dùng cho format consistency check."""

    APA = "APA"
    MLA = "MLA"
    CHICAGO = "Chicago"
    IEEE = "IEEE"
    VANCOUVER = "Vancouver"
    HARVARD = "Harvard"
    AMA = "AMA"
    ACM = "ACM"
    NATURE = "Nature"
    ACS = "ACS"
    CSE = "CSE"
    UNKNOWN = "unknown"


_YEAR_RE = re.compile(r"\b(19|20)\d{2}[a-z]?\b")
_DOI_RE = re.compile(r"10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+")
_URL_RE = re.compile(r"https?://[^\s\]\)\,;]+")


def parse_year_safe(raw: str) -> str | None:
    """Trích xuất năm (4 chữ số, 19xx hoặc 20xx) từ chuỗi. Trả None nếu không có."""
    if not raw:
        return None
    m = _YEAR_RE.search(raw)
    return m.group(0) if m else None


@dataclass
class Citation:
    """Một citation được trích xuất từ PDF.

    Attributes:
        raw_text: chuỗi gốc lấy từ text (giữ nguyên để debug/audit).
        citation_type: loại citation.
        style: style (APA/MLA/...) nếu nhận diện được.
        authors: danh sách tác giả (best-effort từ NER / heuristics).
        year: năm xuất bản (nếu parse được).
        title: tiêu đề (chỉ có ở reference list, in-text thường không có).
        venue: tên tạp chí / hội nghị.
        doi, url, volume, issue, pages: metadata khác.
        page_num, paragraph_num: vị trí trong PDF (1-indexed).
        matched_pattern: tên regex pattern đã match (để debug).
        raw_in_text_citation: đối với reference-list entry, lưu cả citation
            in-text tương ứng nếu match được (dùng cho in-text ↔ bib consistency).
        confidence: 0.0–1.0, do extractor tự ước lượng (heuristic).
    """

    raw_text: str
    citation_type: CitationType = CitationType.UNKNOWN
    style: CitationStyle = CitationStyle.UNKNOWN

    authors: list[str] = field(default_factory=list)
    year: str | None = None
    title: str | None = None
    venue: str | None = None
    doi: str | None = None
    url: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None

    # NEW v1.2 — cho bidirectional linker + duplicate detector
    title_normalized: str | None = None
    year_suffix: str | None = None
    order_index: int = 0
    numeric_index: int | None = None

    page_num: int = 0
    paragraph_num: int = 0

    matched_pattern: str | None = None
    raw_in_text_citation: str | None = None
    confidence: float = 0.0

    # NEW v1.2 — optional reference_id cho bidirectional linker output.
    # None trước khi chạy CitationLinker; được set thành str ('ref-0007')
    # sau khi linker match occurrence ↔ reference entry.
    # Backward compatible: callers cũ không truyền field này vẫn chạy bình thường.
    reference_id: str | None = None

    # NEW v1.3 — citation context: đoạn văn xung quanh citation
    # Dùng cho Neural content alignment check
    context: str | None = None

    # NEW v1.7 — linking layer cho in-text citations (gắn sau CitationLinker chạy).
    # Cho phép UI Citations tab hiển thị mapping_status thật cho mỗi in-text.
    # None cho reference_list entries (chúng có mapping_status từ verdict).
    mapping_status: str | None = None        # CitationMappingStatus.value
    mapping_confidence: float = 0.0
    citation_link: object | None = None     # CitationLink

    # NEW v1.9 — MỌI link của occurrence này, không chỉ cái đầu.
    #
    # Một occurrence có thể cite nhiều reference cùng lúc ("[9, 10]" → ref-0009
    # + ref-0010). ``citation_link`` chỉ giữ được 1 slot nên ref thứ hai bị mất
    # khỏi report. Field này là nguồn sự thật; ``citation_link`` được giữ song
    # song (= ``citation_links[0]``) để không phá code/consumer cũ.
    citation_links: list = field(default_factory=list)   # list[CitationLink]

    # NEW v1.10 (GROBID adapter) — Provenance tracking cho extraction source
    # source: extraction source — 'grobid', 'regex', 'pymupdf', 'merged'
    # source_confidence: 0.0-1.0 confidence của nguồn này
    # grobid_ref_id: TEI xml:id nếu citation đến từ GROBID (vd 'b0', 'b1')
    # is_grobid_linked: True nếu citation có TEI link đến bibliography entry
    # conflict_fields: list các fields bị conflict khi merge GROBID + regex
    source: str = "regex"
    source_confidence: float | None = None
    grobid_ref_id: str | None = None
    is_grobid_linked: bool = False
    conflict_fields: list = field(default_factory=list)

    def to_search_query(self) -> str:
        """Ghép chuỗi truy vấn để gọi API theo title + author + year.

        Ưu tiên: title > author (last-name) > year > raw_text.

        Lưu ý: 'Vaswani, A.' → last name là 'Vaswani' (token đầu, vì APA format
        là "Họ, Tên viết tắt"). Hàm này cố gắng lấy last-name heuristic — cần
        được tinh chỉnh khi parse author chuẩn hơn.
        """
        parts: list[str] = []
        if self.title:
            parts.append(self.title)
        if self.authors:
            first_author = self.authors[0]
            if hasattr(first_author, "last_name") and getattr(first_author, "last_name", ""):
                parts.append(str(first_author.last_name).strip())
            else:
                first = str(first_author).strip()
                if first:
                    # APA: "Lastname, F." → token trước dấu phẩy là last-name
                    # MLA / raw: "First Last" → token cuối là last-name
                    if "," in first:
                        parts.append(first.split(",")[0].strip())
                    else:
                        parts.append(first.split()[-1])
        if self.year:
            parts.append(self.year)
        if not parts:
            parts.append(self.raw_text[:120])
        return " ".join(parts)

    @classmethod
    def from_raw(cls, raw: str, extract_title: bool = True) -> Citation:
        """Constructor tiện dụng — trích DOI/URL/year/title từ raw text.

        Args:
            raw: Raw citation text (có thể là short form như "Smith et al. (2020)"
                 hoặc formatted như "Smith et al. (2020). Paper Title. Journal.")
            extract_title: Nếu True, thử trích title từ formatted citation.
                          Title thường nằm sau year và trước venue (.,;:).
        """
        import re
        c = cls(raw_text=raw.strip())
        c.doi = _DOI_RE.search(raw).group(0) if _DOI_RE.search(raw) else None
        c.url = _URL_RE.search(raw).group(0) if _URL_RE.search(raw) else None
        c.year = parse_year_safe(raw)

        # NEW v1.5: Extract title from formatted citations
        # Pattern: "Author et al. (Year). Title. Venue" hoặc "Author (Year). Title"
        if extract_title:
            title = cls._extract_title_from_citation(raw)
            if title:
                c.title = title

        return c

    @staticmethod
    def _extract_title_from_citation(text: str) -> str | None:
        """Trích title từ formatted citation.

        Handles patterns:
        - "Smith et al. (2020). Title Here. Venue."
        - "Smith (2020). Title Here."
        - "Smith et al. (2020): Title Here. Venue"

        Returns None nếu không extract được.
        """
        import re

        # Pattern: year followed by title (between period/colon and next period or venue indicator)
        # Common patterns: "et al. (2020). Title." or "(2020). Title."
        year_pattern = r'\((\d{4})\)|(\d{4})'

        # Find position after year
        match = re.search(year_pattern, text)
        if not match:
            return None

        # Get position after year (after closing paren if exists)
        year_end = match.end()
        remaining = text[year_end:]

        # Skip common separators: ". ", ": ", " - "
        separator_match = re.match(r'[\.\:\-]+\s*', remaining)
        if separator_match:
            after_separator = remaining[separator_match.end():]
        else:
            after_separator = remaining.lstrip()

        if not after_separator:
            return None

        # Title ends at:
        # 1. Period followed by uppercase (venue) - "Title. Journal Name"
        # 2. Period followed by lowercase (continuation) - "Title. more text"
        # 3. End of string

        # Strategy: Find the title (usually 3-30 words, starts with uppercase)
        # Stop at venue indicators or long text

        # Common venue patterns
        venue_indicators = [
            r'\.\s+[A-Z][a-z]+\s+(and|&)',  # "Journal and Conference"
            r'\.\s+Proceedings',  # "Proceedings of..."
            r'\.\s+arXiv',  # "arXiv preprint"
            r'\.\s+https?://',  # URL follows
            r'\.\s+\d+\s*[-–]\s*\d+$',  # Page numbers at end
            r'\.\s*\(\d+\)$',  # Volume number
        ]

        # Try to find title end
        title_end = len(after_separator)

        # Common venue patterns (more comprehensive)
        for pattern in venue_indicators:
            m = re.search(pattern, after_separator, re.IGNORECASE)
            if m:
                # Title ends before this pattern
                potential_end = m.start()
                # Make sure we're not cutting too short (at least 3 words)
                potential_title = after_separator[:potential_end].strip()
                if len(potential_title.split()) >= 3:
                    title_end = min(title_end, potential_end)
                    break

        # Additional venue detection: common abbreviation patterns at end
        # e.g., "ICLR.", "NeurIPS.", "ACL.", "EMNLP.", "TACL."
        venue_abbrevs = r'\.(ICLR|NeurIPS|ACL|EMNLP|NAACL|COLING|AAAI|IJCAI|CVPR|ICCV|ECCV|NaACL|CoNLL|CoNLL|LREC|KDD|WWW|SIGIR|CIKM|EMNLP|ACL|AAAI)\s*$'
        m = re.search(venue_abbrevs, after_separator, re.IGNORECASE)
        if m:
            title_end = min(title_end, m.start() + 1)  # Keep period before venue

        # Also check for arXiv pattern
        arxiv_match = re.search(r'\. arXiv[:\.]', after_separator, re.IGNORECASE)
        if arxiv_match:
            title_end = min(title_end, arxiv_match.start())

        candidate_title = after_separator[:title_end].strip().rstrip('.')

        # Clean up: remove trailing punctuation and venue
        candidate_title = re.sub(r'[\.\:]+$', '', candidate_title).strip()

        # Remove venue at end if included
        # Pattern: title ends with "ICLR", "NeurIPS", "EMNLP", etc.
        candidate_title = re.sub(r'\s+(ICLR|NeurIPS|ACL|EMNLP|NAACL|AAAI|IJCAI|CVPR|ECCV|TACL|arxiv)\s*$', '', candidate_title, flags=re.IGNORECASE)
        candidate_title = re.sub(r'\s+arXiv preprint$', '', candidate_title, flags=re.IGNORECASE)
        candidate_title = candidate_title.rstrip('.,')

        # Validate: title should be reasonable length (10-200 chars) and start with uppercase
        if 10 <= len(candidate_title) <= 200 and candidate_title[0].isupper():
            # Additional check: title shouldn't contain common non-title patterns
            # like URLs, email addresses, or very long strings
            if not re.search(r'https?://|@\w+\.\w+', candidate_title):
                # Title should have at least 2 words
                words = candidate_title.split()
                if len(words) >= 2:
                    return candidate_title

        return None
