"""Consensus calculator — đo mức đồng thuận giữa các nguồn."""

from __future__ import annotations

from integrity_checker.models.source import SourceResult


class ConsensusCalculator:
    """Tính consensus score dựa trên số nguồn cùng trả về một scholarly record.

    # TODO(user): tuần 10 — bổ sung:
        - Weighted consensus (Crossref nặng hơn arXiv)
        - Field-level consensus (title đồng thuận nhưng year lệch)
    """

    @staticmethod
    def score(source: SourceResult) -> float:
        """Trả 0.0–1.0, dựa trên số nguồn found / tổng queried."""
        if not source.sources_queried:
            return 0.0
        return source.consensus_count() / len(source.sources_queried)

    @staticmethod
    def is_strong(source: SourceResult, threshold: int = 2) -> bool:
        """True nếu ≥ threshold nguồn cùng trả về 1 candidate."""
        return source.consensus_count() >= threshold
