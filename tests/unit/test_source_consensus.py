"""Tests cho source_consensus (task #31 — Sprint 2)."""

from __future__ import annotations

from integrity_checker.matching.source_consensus import (
    ConsensusBreakdown,
    analyze_consensus,
    best_consensus_score,
    get_all_unique_sources,
)
from integrity_checker.models.source import SourceCandidate, SourceResult


def _cand(source_name: str, doi: str | None = None, title: str | None = None,
          found: bool = True) -> SourceCandidate:
    return SourceCandidate(
        source_name=source_name,
        found=found,
        doi=doi,
        title=title,
    )


def _result(*candidates: SourceCandidate) -> SourceResult:
    return SourceResult(citation_raw="test", candidates=list(candidates))


class TestAnalyzeConsensus:
    """Main consensus analysis."""

    def test_two_sources_same_doi(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("openalex", doi="10.1234/abc"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 2
        assert breakdown.has_strong_consensus is True
        assert breakdown.unique_fingerprints == 1

    def test_three_sources_same_doi(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("openalex", doi="10.1234/abc"),
            _cand("semantic_scholar", doi="10.1234/abc"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 3
        assert breakdown.has_strong_consensus is True

    def test_one_source_only(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 1
        assert breakdown.has_strong_consensus is False

    def test_no_match_different_dois(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("openalex", doi="10.5678/def"),
        )
        breakdown = analyze_consensus(r)
        # Each source has its own fingerprint → independent_count = max(1, 1) = 1
        assert breakdown.independent_source_count == 1
        assert breakdown.has_strong_consensus is False
        assert breakdown.unique_fingerprints == 2

    def test_same_source_two_candidates(self) -> None:
        # 2 candidates from crossref with same DOI → counts as 1 source
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("crossref", doi="10.1234/abc"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 1
        # 'crossref' listed once in fingerprint_groups
        assert breakdown.fingerprint_groups["doi:10.1234/abc"] == ["crossref"]

    def test_failed_candidates_ignored(self) -> None:
        r = _result(
            _cand("crossref", found=False, doi=None),
            _cand("openalex", doi="10.1234/abc"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 1
        assert breakdown.found_candidates == 1

    def test_title_fallback(self) -> None:
        # No DOI but same title
        r = _result(
            _cand("crossref", title="Deep Learning"),
            _cand("openalex", title="Deep Learning"),
        )
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 2
        # Both normalize to same fingerprint
        assert breakdown.unique_fingerprints == 1

    def test_empty(self) -> None:
        r = _result()
        breakdown = analyze_consensus(r)
        assert breakdown.independent_source_count == 0
        assert breakdown.has_strong_consensus is False
        assert breakdown.unique_fingerprints == 0
        assert breakdown.total_candidates == 0
        assert breakdown.found_candidates == 0


class TestStrongestConsensus:
    """strongest_consensus tracking."""

    def test_picks_largest_group(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("openalex", doi="10.1234/abc"),
            _cand("semantic_scholar", doi="10.5678/xyz"),
        )
        breakdown = analyze_consensus(r)
        # 2 sources agree on 'abc', 1 on 'xyz' → strongest = (2, doi:10.1234/abc)
        assert breakdown.strongest_consensus[0] == 2
        assert breakdown.strongest_consensus[1] == "doi:10.1234/abc"


class TestShortcuts:
    """best_consensus_score + get_all_unique_sources."""

    def test_best_score(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("openalex", doi="10.1234/abc"),
            _cand("semantic_scholar", doi="10.1234/abc"),
        )
        assert best_consensus_score(r) == 3

    def test_unique_sources(self) -> None:
        r = _result(
            _cand("crossref", doi="10.1234/abc"),
            _cand("crossref", doi="10.5678/xyz"),  # same source, different doi
            _cand("openalex", doi="10.1234/abc"),
            _cand("semantic_scholar", found=False),
        )
        sources = get_all_unique_sources(r)
        assert sources == {"crossref", "openalex"}

    def test_dataclass_init(self) -> None:
        b = ConsensusBreakdown()
        assert b.has_strong_consensus is False
        b.independent_source_count = 2
        assert b.has_strong_consensus is True
