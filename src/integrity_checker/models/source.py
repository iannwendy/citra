"""Source data model — output của retrieval module."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from integrity_checker.retrieval.html_meta_verifier import HtmlPageMeta


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
    html_meta: HtmlPageMeta | None = None

    @staticmethod
    def _normalize_doi_key(doi: str | None) -> str:
        if not doi:
            return ""
        d = doi.strip().lower()
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
        return d.rstrip(".")

    @staticmethod
    def _normalize_title_key(title: str | None) -> str:
        if not title:
            return ""
        return "".join(c for c in title.lower() if c.isalnum())[:120]

    @staticmethod
    def _normalize_arxiv_key(cand: SourceCandidate) -> str:
        raw_ax = (cand.external_ids or {}).get("arxiv") or (cand.external_ids or {}).get("ArXiv") or ""
        ax = str(raw_ax).strip().lower()
        if ax.startswith("arxiv:"):
            ax = ax[6:].strip()
        if "v" in ax:
            head, _, tail = ax.rpartition("v")
            if head and tail.isdigit():
                ax = head
        return ax

    @classmethod
    def _candidates_match(cls, best: SourceCandidate, other: SourceCandidate) -> bool:
        """Return True iff ``other`` refers to the same scholarly work as ``best``."""
        if other is best:
            return True
        if not other.found:
            return False

        best_doi = cls._normalize_doi_key(best.doi)
        other_doi = cls._normalize_doi_key(other.doi)
        best_ax = cls._normalize_arxiv_key(best)
        other_ax = cls._normalize_arxiv_key(other)
        best_title = cls._normalize_title_key(best.title)
        other_title = cls._normalize_title_key(other.title)

        if best_doi and other_doi:
            if best_doi == other_doi:
                return True
            if best_ax and other_ax and best_ax == other_ax:
                return True
            # Published conference DOI <-> arXiv preprint DOI for the exact same paper title
            if (
                best_doi.startswith("10.48550/arxiv") != other_doi.startswith("10.48550/arxiv")
                and best_title
                and best_title == other_title
            ):
                return True
            return False

        if best_ax and other_ax and best_ax == other_ax:
            return True
        if best_title and other_title and best_title == other_title:
            return True
        return False

    def has_retracted_candidate(self) -> bool:
        """True if this result or a found candidate matching ``best_candidate()`` is retracted."""
        if self.is_retracted:
            return True
        best = self.best_candidate()
        if best is None:
            return False
        for c in self.candidates:
            if c.found and c.is_retracted and self._candidates_match(best, c):
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
        """Số nguồn đồng thuận trên cùng một paper với ``best_candidate()``.

        Chỉ cộng các nguồn khớp với ``best_candidate()`` (theo DOI, arXiv ID, hoặc normalized title)
        để tránh ứng viên nhiễu không liên quan làm phồng điểm đồng thuận.
        """
        best = self.best_candidate()
        if best is None or not (best.doi or best.title):
            return 0

        total = 0
        for c in self.candidates:
            if c.found and (c.doi or c.title) and self._candidates_match(best, c):
                merged_n = int(getattr(c, "_consensus_count", 1) or 1)
                total += merged_n
        return total
