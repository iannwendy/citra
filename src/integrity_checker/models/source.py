"""Source data model — output của retrieval module."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SourceCandidate:
    """Một ứng viên được một nguồn trả về.

    Attributes:
        source_name: tên nguồn (Crossref / OpenAlex / Semantic Scholar / arXiv).
        found: True nếu source trả về bản ghi, False nếu lookup thất bại.
        doi, title, authors, year, venue, url: metadata từ source.
        external_ids: dict các định danh ngoài (DOI, arXiv ID, MAG ID, ...).
        score: score do source trả về (relevance), không dùng làm ground truth.
        confidence: 0.0–1.0, do source tự gán (thường heuristic của source).
        error: thông báo lỗi nếu API call thất bại.
        cached: True nếu lấy từ local database (DB hoặc known papers).
    """

    source_name: str
    found: bool = False

    doi: str | None = None
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    year: str | None = None
    venue: str | None = None
    url: str | None = None
    abstract: str | None = None
    external_ids: dict[str, str] = field(default_factory=dict)

    score: float = 0.0
    confidence: float = 0.0

    error: str | None = None
    cached: bool = False
    paper_id: int | None = None  # local_papers.db row id, when available

    @property
    def is_retracted(self) -> bool:
        """True if external_ids indicates this publication has been retracted."""
        return bool(
            self.external_ids
            and str(self.external_ids.get("is_retracted", "")).lower() == "true"
        )

    def fingerprint(self) -> str:
        """Hash key để dedupe giữa các nguồn.

        Ưu tiên DOI; fallback normalized title.
        """
        if self.doi:
            d = self.doi.strip().lower()
            for prefix in (
                "https://doi.org/",
                "http://doi.org/",
                "https://dx.doi.org/",
                "http://dx.doi.org/",
                "doi:",
            ):
                if d.startswith(prefix):
                    d = d[len(prefix) :].strip()
                    break
            d = d.rstrip(".")
            if d:
                return f"doi:{d}"
        if self.title:
            # lowercase, bỏ punctuation + spaces
            norm = "".join(c for c in self.title.lower() if c.isalnum())
            return f"title:{norm[:120]}"
        return f"raw:{self.source_name}:{id(self)}"


@dataclass
class SourceResult:
    """Kết quả gộp cho 1 citation sau khi truy hồi đa nguồn."""

    citation_raw: str
    candidates: list[SourceCandidate] = field(default_factory=list)
    sources_queried: list[str] = field(default_factory=list)
    sources_succeeded: list[str] = field(default_factory=list)
    sources_failed: dict[str, str] = field(default_factory=dict)  # source → error
    api_exhausted: bool = False
    url_status: str | None = None
    url_status_code: int | None = None
    archive_url: str | None = None
    is_retracted: bool = False

    def has_retracted_candidate(self) -> bool:
        """True if this result or any found candidate is marked as retracted."""
        if self.is_retracted:
            return True
        for c in self.candidates:
            if c.found and c.external_ids and str(c.external_ids.get("is_retracted", "")).lower() == "true":
                return True
        return False

    def best_candidate(self) -> SourceCandidate | None:
        """Trả về candidate tốt nhất (highest confidence hoặc được chọn bởi FeatureCalculator) trong số found=True."""
        selected = getattr(self, "_selected_best", None)
        if selected is not None and selected in self.candidates and selected.found:
            return selected
        found = [c for c in self.candidates if c.found]
        if not found:
            return None
        return max(found, key=lambda c: c.confidence)

    def consensus_count(self) -> int:
        """Số nguồn đồng thuận trên cùng một paper.

        Đếm số nguồn TRÙNG NHAU trên cùng fingerprint (DOI hoặc title).
        - 3 nguồn cùng trả về DOI giống nhau → consensus = 3
        - 3 nguồn trả về 3 papers khác nhau → consensus = 1
        - Không có nguồn nào → consensus = 0
        """
        from collections import Counter

        fingerprints: list[str] = []
        for c in self.candidates:
            if c.found and (c.doi or c.title):
                fingerprints.append(c.fingerprint())

        if not fingerprints:
            return 0

        # Đếm số nguồn trùng nhau trên mỗi fingerprint (cộng thêm các nguồn đã được merge qua _dedupe_candidates)
        count_by_fp: Counter[str] = Counter()
        for c in self.candidates:
            if c.found and (c.doi or c.title):
                merged_n = int(getattr(c, "_consensus_count", 1) or 1)
                count_by_fp[c.fingerprint()] += merged_n

        # Consensus = số nguồn đồng thuận trên paper được nhiều nguồn nhất
        # Nếu tất cả đều khác nhau → max count = 1
        return max(count_by_fp.values())
