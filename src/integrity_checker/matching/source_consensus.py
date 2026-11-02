"""Source consensus analysis — v1.2 §2.5 (task #31).

Mục đích: Đếm số nguồn độc lập trả về cùng DOI/title-author-year, để rule
`R-CONSENSUS-FULL` (v1.2 §2.6) có input đáng tin.

Hiện trạng (task #31 trước):
    - ``SourceResult.consensus_count()`` chỉ count unique fingerprints
      (group by DOI/title) — không tách riêng số nguồn độc lập.

Cải tiến:
    - Tính 3 metrics:
        - ``independent_source_count``: số nguồn distinct (crossref, openalex, s2, arxiv)
          trả về candidate cùng DOI/title.
        - ``fingerprint_groups``: dict[fingerprint → list[source_name]].
        - ``strongest_consensus``: (source_count, fingerprint) lớn nhất.
    - Dùng để rule: VERIFIED khi ≥2 nguồn distinct đồng thuận cùng DOI.

v1.2 §2.5 — Sprint 2.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from integrity_checker.models.source import SourceCandidate, SourceResult


@dataclass
class ConsensusBreakdown:
    """Output chi tiết của analyze_consensus()."""

    independent_source_count: int = 0
    unique_fingerprints: int = 0
    fingerprint_groups: dict[str, list[str]] = field(default_factory=dict)
    strongest_consensus: tuple[int, str] = (0, "")
    total_candidates: int = 0
    found_candidates: int = 0

    @property
    def has_strong_consensus(self) -> bool:
        """True nếu có ≥2 nguồn độc lập đồng thuận."""
        return self.independent_source_count >= 2


def analyze_consensus(source: SourceResult) -> ConsensusBreakdown:
    """Phân tích consensus từ SourceResult.

    Args:
        source: SourceResult từ RetrievalOrchestrator.

    Returns:
        ConsensusBreakdown với independent_source_count, fingerprint_groups,
        strongest_consensus.

    Example:
        >>> candidates = [
        ...     SourceCandidate(source_name='crossref', doi='10.x/abc', found=True),
        ...     SourceCandidate(source_name='openalex', doi='10.x/abc', found=True),
        ... ]
        >>> breakdown = analyze_consensus(SourceResult('raw', candidates=candidates))
        >>> breakdown.independent_source_count
        2
    """
    fingerprint_groups: dict[str, list[str]] = {}
    total = len(source.candidates)
    found = 0

    for c in source.candidates:
        if not c.found:
            continue
        if not (c.doi or c.title):
            continue  # nothing to fingerprint
        found += 1
        fp = c.fingerprint()
        if fp not in fingerprint_groups:
            fingerprint_groups[fp] = []
        if c.source_name not in fingerprint_groups[fp]:
            fingerprint_groups[fp].append(c.source_name)

    # When RetrievalOrchestrator deduplicated agreeing candidates into a single
    # fingerprint while recording multiple sources_succeeded, preserve those sources.
    if len(fingerprint_groups) == 1 and source.sources_succeeded:
        only_fp = next(iter(fingerprint_groups))
        for src_name in source.sources_succeeded:
            if src_name not in fingerprint_groups[only_fp]:
                fingerprint_groups[only_fp].append(src_name)

    # Strongest consensus: fingerprint with most distinct sources
    strongest: tuple[int, str] = (0, "")
    for fp, sources in fingerprint_groups.items():
        if len(sources) > strongest[0]:
            strongest = (len(sources), fp)

    # Independent source count: distinct sources in the strongest consensus group
    independent_count = strongest[0]

    return ConsensusBreakdown(
        independent_source_count=independent_count,
        unique_fingerprints=len(fingerprint_groups),
        fingerprint_groups=fingerprint_groups,
        strongest_consensus=strongest,
        total_candidates=total,
        found_candidates=found,
    )


def best_consensus_score(source: SourceResult) -> int:
    """Trả về ``independent_source_count`` cho fingerprint mạnh nhất.

    Shortcut để tích hợp vào rules không cần full breakdown.
    """
    return analyze_consensus(source).independent_source_count


def get_all_unique_sources(source: SourceResult) -> set[str]:
    """Trả về set tất cả source names có found candidate."""
    return {
        c.source_name
        for c in source.candidates
        if c.found and c.source_name
    }
