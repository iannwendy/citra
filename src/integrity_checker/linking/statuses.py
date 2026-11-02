"""CitationMappingStatus — enum 8 trạng thái mapping (v1.2 §3.5).

Trạng thái này mô tả **quan hệ giữa 1 in-text occurrence và 1 reference entry**
trong citation graph — gọi là "citation integrity layer".

Phân biệt với ``ValidationLabel`` (source verification layer):
    - MappingStatus: "in-text này có reference entry trong bibliography không?"
    - ValidationLabel: "reference entry này có nguồn thật không?"

8 trạng thái:

MATCHED (mapped, verified):
    In-text occurrence có reference entry tương ứng trong bibliography,
    author/year (APA) hoặc index (IEEE) khớp.

MISSING_REFERENCE (integrity issue):
    In-text occurrence không có reference entry nào khớp trong bibliography.
    → Có nguy cơ hallucination hoặc tác giả quên thêm entry.

UNCITED_REFERENCE (integrity issue):
    Reference entry tồn tại trong bibliography nhưng không được in-text nào
    refer. → Entry dư thừa (nguồn không được sử dụng).

IN_TEXT_MISMATCH (integrity issue):
    In-text occurrence có reference entry khớp author/year/index nhưng
    title trong entry không match → có thể refer nhầm source.

DUPLICATE_REFERENCE (integrity issue):
    ≥2 reference entries refer cùng 1 source (DOI / arXiv ID / title+year+author
    similarity > threshold). → Gộp thành 1 entry.

AMBIGUOUS_MAPPING (integrity issue):
    ≥2 in-text occurrences refer cùng 1 reference entry (1 entry được cite
    bởi nhiều in-text occurrence, nhưng không phải DOIs khác nhau).
    → Có thể hợp lệ (cùng nguồn, nhiều trang) hoặc duplicate.

STYLE_INCONSISTENT (integrity issue):
    In-text style (APA vs IEEE) không match reference list style trong cùng
    document. → Cảnh báo: có thể là copy từ nhiều nguồn.

UNRESOLVED (neutral):
    Chưa đủ thông tin để quyết định (extraction fail, API timeout, v.v.).
    → Neutral, không tính vào penalty.

References:
    v1.2 §3.5 (bidirectional linking — citation graph)
    v1.2 §3.7 (linking styles — style consistency)
    v1.2 §5.1 (SV1 — citation graph view trong web UI)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# Re-export StyleProfile từ extraction (old tests + pipeline)
from integrity_checker.extraction.style_detector import StyleProfile  # noqa: F401

# Re-export CitationLink + MappingMethod từ models/validation
# (backward compatibility — pipeline + old tests import từ đây)
from integrity_checker.models.validation import CitationLink, MappingMethod  # noqa: F401  re-export

# --- Stubs cho backward compatibility với old tests + pipeline ---
# Pipeline gốc dùng CitationOccurrence/ReferenceEntry wrappers.
# Chúng không được dùng trong implementation mới (CitationLinker dùng Citation[] trực tiếp).
# Giữ stub để pipeline import không bị break.


class CitationOccurrence:
    """Stub — không dùng trong implementation mới.

    Pipeline cũ dùng class này để wrap in-text citations trước khi link.
    Implementation mới dùng Citation[] trực tiếp.
    """

    __slots__ = ("occurrence_id", "raw_text", "page", "authors", "year",
                 "numeric_indices", "doi")

    def __init__(
        self,
        occurrence_id: str,
        raw_text: str = "",
        page: int = 0,
        authors: list | None = None,
        year: str | None = None,
        numeric_indices: list | None = None,
        doi: str | None = None,
    ) -> None:
        self.occurrence_id = occurrence_id
        self.raw_text = raw_text
        self.page = page
        self.authors = authors or []
        self.year = year
        self.numeric_indices = numeric_indices or []
        self.doi = doi


class ReferenceEntry:
    """Stub — không dùng trong implementation mới.

    Pipeline cũ dùng class này để wrap bibliography entries trước khi link.
    Implementation mới dùng Citation[] trực tiếp.
    """

    __slots__ = ("reference_id", "raw_text", "order_index", "page",
                 "authors", "year", "title", "title_normalized", "doi")

    def __init__(
        self,
        reference_id: str,
        raw_text: str = "",
        order_index: int = 0,
        page: int = 0,
        authors: list | None = None,
        year: str | None = None,
        title: str | None = None,
        title_normalized: str | None = None,
        doi: str | None = None,
    ) -> None:
        self.reference_id = reference_id
        self.raw_text = raw_text
        self.order_index = order_index
        self.page = page
        self.authors = authors or []
        self.year = year
        self.title = title
        self.title_normalized = title_normalized
        self.doi = doi


class CitationMappingStatus(str, Enum):
    """8 trạng thái citation graph integrity (v1.2 §3.5)."""

    # --- Mapped / verified ---
    MATCHED = "matched"
    """In-text ↔ reference entry khớp."""

    # --- Integrity issues ---
    MISSING_REFERENCE = "missing_reference"
    """In-text không có reference entry tương ứng."""

    UNCITED_REFERENCE = "uncited_reference"
    """Reference entry không được in-text nào refer."""

    IN_TEXT_MISMATCH = "in_text_mismatch"
    """In-text và reference entry không khớp (author/year/index đúng nhưng title khác)."""

    DUPLICATE_REFERENCE = "duplicate_reference"
    """≥2 reference entries trỏ cùng 1 source (DOI/arXiv/similarity)."""

    AMBIGUOUS_MAPPING = "ambiguous_mapping"
    """≥2 in-text occurrences refer cùng 1 reference entry."""

    STYLE_INCONSISTENT = "style_inconsistent"
    """In-text style không match bibliography style trong document."""

    # --- Neutral ---
    UNRESOLVED = "unresolved"
    """Chưa đủ thông tin để quyết định."""

    @property
    def is_integrity_issue(self) -> bool:
        """True nếu trạng thái này là integrity issue (cần kiểm tra)."""
        return self in {
            CitationMappingStatus.MISSING_REFERENCE,
            CitationMappingStatus.UNCITED_REFERENCE,
            CitationMappingStatus.IN_TEXT_MISMATCH,
            CitationMappingStatus.DUPLICATE_REFERENCE,
            CitationMappingStatus.AMBIGUOUS_MAPPING,
            CitationMappingStatus.STYLE_INCONSISTENT,
        }

    @property
    def is_verified(self) -> bool:
        """True nếu trạng thái này là verified (OK)."""
        return self == CitationMappingStatus.MATCHED

    @property
    def is_neutral(self) -> bool:
        """True nếu trạng thái này neutral (không đánh giá)."""
        return self == CitationMappingStatus.UNRESOLVED

    @property
    def penalty(self) -> float:
        """Penalty score cho CIS calculation (0.0 = OK, 1.0 = worst)."""
        return {
            CitationMappingStatus.MATCHED: 0.0,
            CitationMappingStatus.MISSING_REFERENCE: 1.0,
            CitationMappingStatus.UNCITED_REFERENCE: 0.5,
            CitationMappingStatus.IN_TEXT_MISMATCH: 0.8,
            CitationMappingStatus.DUPLICATE_REFERENCE: 0.6,
            CitationMappingStatus.AMBIGUOUS_MAPPING: 0.4,
            CitationMappingStatus.STYLE_INCONSISTENT: 0.2,
            CitationMappingStatus.UNRESOLVED: 0.0,
        }[self]

    @property
    def label(self) -> str:
        """Human-readable label cho UI."""
        return {
            CitationMappingStatus.MATCHED: "✓ Matched",
            CitationMappingStatus.MISSING_REFERENCE: "⚠ Missing reference",
            CitationMappingStatus.UNCITED_REFERENCE: "✗ Uncited",
            CitationMappingStatus.IN_TEXT_MISMATCH: "⚠ In-text mismatch",
            CitationMappingStatus.DUPLICATE_REFERENCE: "⚠ Duplicate",
            CitationMappingStatus.AMBIGUOUS_MAPPING: "⚠ Ambiguous mapping",
            CitationMappingStatus.STYLE_INCONSISTENT: "⚠ Style inconsistent",
            CitationMappingStatus.UNRESOLVED: "? Unresolved",
        }[self]


# --- Penalty table cho CIS (v1.2 §3.9) ---
# Dùng trong logic/cis.py để tính in_text_bib_consistency.

MAPPING_PENALTIES = {
    CitationMappingStatus.MATCHED: 0.0,
    CitationMappingStatus.MISSING_REFERENCE: 1.0,
    CitationMappingStatus.UNCITED_REFERENCE: 0.5,
    CitationMappingStatus.IN_TEXT_MISMATCH: 0.8,
    CitationMappingStatus.DUPLICATE_REFERENCE: 0.6,
    CitationMappingStatus.AMBIGUOUS_MAPPING: 0.4,
    CitationMappingStatus.STYLE_INCONSISTENT: 0.2,
    CitationMappingStatus.UNRESOLVED: 0.0,
}


@dataclass
class LinkingResult:
    """Kết quả từ CitationLinker.

    Attributes:
        links: list all CitationLink (1 per in-text occurrence).
        status_counts: dict[CitationMappingStatus, int] — summary counts.
        unmatched_in_text: list of citation IDs not matched to any reference.
        unmatched_reference_ids: list of reference IDs not matched to any in-text.
        total_citations: total in-text occurrences.
        total_references: total reference entries.
        matched_count: number of MATCHED links.
        duplicate_reference_ids: reference IDs flagged DUPLICATE_REFERENCE
            (every non-canonical member of a duplicate group).
        duplicate_groups: list of dicts describing each duplicate group
            (``reference_ids``, ``canonical_reference_id``, ``reason``, ``score``).
    """

    links: list = field(default_factory=list)
    status_counts: dict = field(default_factory=dict)
    unmatched_in_text: list = field(default_factory=list)
    unmatched_reference_ids: list = field(default_factory=list)
    total_citations: int = 0
    total_references: int = 0
    matched_count: int = 0
    duplicate_reference_ids: list = field(default_factory=list)
    duplicate_groups: list = field(default_factory=list)

    def add_link(self, link: CitationLink) -> None:
        """Thêm 1 link và update counters."""
        from integrity_checker.models.validation import CitationLink as _CitationLink
        if not isinstance(link, _CitationLink):
            return
        status = link.status
        if isinstance(status, str):
            # handle string status from serialization
            status = CitationMappingStatus(status)
        self.links.append(link)
        self.status_counts[status] = self.status_counts.get(status, 0) + 1
        if status == CitationMappingStatus.MATCHED:
            self.matched_count += 1

    @property
    def match_rate(self) -> float:
        """Tỉ lệ matched / total citations."""
        if self.total_citations == 0:
            return 0.0
        return self.matched_count / self.total_citations

    def to_dict(self) -> dict:
        """Serialize cho JSON response."""
        def _status_key(s: CitationMappingStatus) -> str:
            return s.value if isinstance(s, CitationMappingStatus) else str(s)

        return {
            "links": [
                {
                    "occurrence_id": lnk.occurrence_id,
                    "reference_id": lnk.reference_id,
                    "status": _status_key(lnk.status),
                    "confidence": lnk.confidence,
                    "method": lnk.method.value if hasattr(lnk.method, "value") else str(lnk.method),
                }
                for lnk in self.links
            ],
            "status_counts": {
                _status_key(k): v for k, v in self.status_counts.items()
            },
            "unmatched_in_text": self.unmatched_in_text,
            "unmatched_reference_ids": self.unmatched_reference_ids,
            "total_citations": self.total_citations,
            "total_references": self.total_references,
            "matched_count": self.matched_count,
            "match_rate": self.match_rate,
            "duplicate_reference_ids": list(self.duplicate_reference_ids),
            "duplicate_groups": list(self.duplicate_groups),
        }
