"""DuplicateDetector — phát hiện duplicate reference entries (v1.2 §3.5).

Mục tiêu:
    Trong danh sách bibliography entries, phát hiện các cặp entries trỏ cùng 1
    source (DOI / arXiv ID / title+year+author similarity > threshold).

Priority:
    1. Exact DOI match → chắc chắn là duplicate.
    2. Exact arXiv ID match → chắc chắn là duplicate.
    3. Normalized title + year + first author similarity > threshold → potential duplicate.

Output:
    list[DuplicateGroup] — mỗi nhóm là ≥ 2 entries trùng lặp.

References:
    v1.2 §3.5 (bidirectional linking — duplicate detection)
    config.linking.duplicate_detection.{exact_identifier_match, title_year_author_similarity}
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from integrity_checker.models.citation import Citation

logger = logging.getLogger(__name__)

# arXiv ID pattern
_ARXIV_RE = re.compile(r"arXiv:?((\d{4}\.\d{4,5}|[a-z-]+/\d{7}))", re.IGNORECASE)


@dataclass
class DuplicateGroup:
    """Nhóm các entries là duplicate của nhau.

    Attributes:
        citations: list[Citation] trong nhóm (≥ 2).
        reason: str — giải thích tại sao chúng là duplicate.
        score: float — confidence score (0.0–1.0).
        representative: Citation — entry được chọn làm "canonical" (đầu tiên).
    """

    citations: list[Citation]
    reason: str
    score: float
    representative: Citation

    @property
    def duplicate_count(self) -> int:
        """Số lượng entries trùng lặp (tổng - 1)."""
        return max(0, len(self.citations) - 1)


class DuplicateDetector:
    """Phát hiện duplicate reference entries trong bibliography."""

    def __init__(
        self,
        exact_identifier_match: bool = True,
        title_year_author_similarity: float = 0.92,
    ) -> None:
        """
        Args:
            exact_identifier_match: nếu True, entries có cùng DOI/arXiv ID → duplicate.
            title_year_author_similarity: ngưỡng similarity cho title+year+author fallback.
        """
        self.exact_identifier_match = exact_identifier_match
        self.threshold = title_year_author_similarity

    def detect(
        self, bib_citations: list[Citation]
    ) -> list[DuplicateGroup]:
        """Phát hiện duplicate entries trong bib_citations.

        Args:
            bib_citations: Citation[] từ bibliography.

        Returns:
            list[DuplicateGroup] — mỗi nhóm là ≥ 2 entries trùng lặp.
        """
        if len(bib_citations) < 2:
            return []

        groups: list[DuplicateGroup] = []
        assigned: set[int] = set()  # indices đã được assign vào nhóm nào đó

        if self.exact_identifier_match:
            # 1. DOI exact groups
            doi_groups: dict[str, list[tuple[int, Citation]]] = {}
            for i, cit in enumerate(bib_citations):
                doi = (cit.doi or "").strip().lower()
                if doi:
                    doi_groups.setdefault(doi, []).append((i, cit))

            for doi, entries in doi_groups.items():
                if len(entries) < 2:
                    continue
                ids = [idx for idx, _ in entries]
                if any(idx in assigned for idx in ids):
                    continue
                for idx in ids:
                    assigned.add(idx)
                reason = f"Exact DOI match: {doi}"
                score = 1.0
                groups.append(
                    DuplicateGroup(
                        citations=[c for _, c in entries],
                        reason=reason,
                        score=score,
                        representative=entries[0][1],
                    )
                )

            # 2. arXiv exact groups
            arxiv_groups: dict[str, list[tuple[int, Citation]]] = {}
            for i, cit in enumerate(bib_citations):
                if i in assigned:
                    continue
                arxiv_id = self._extract_arxiv_id(cit.raw_text) or self._extract_arxiv_id(
                    cit.doi or ""
                )
                if arxiv_id:
                    arxiv_groups.setdefault(arxiv_id, []).append((i, cit))

            for arxiv_id, entries in arxiv_groups.items():
                if len(entries) < 2:
                    continue
                ids = [idx for idx, _ in entries]
                if any(idx in assigned for idx in ids):
                    continue
                for idx in ids:
                    assigned.add(idx)
                groups.append(
                    DuplicateGroup(
                        citations=[c for _, c in entries],
                        reason=f"Exact arXiv ID match: {arxiv_id}",
                        score=1.0,
                        representative=entries[0][1],
                    )
                )

        # 3. Title + year + author similarity fallback
        if self.threshold < 1.0:
            remaining = [
                (i, cit) for i, cit in enumerate(bib_citations) if i not in assigned
            ]
            for idx_a, cit_a in remaining:
                if idx_a in assigned:
                    continue
                group_members = [(idx_a, cit_a)]

                for idx_b, cit_b in remaining:
                    if idx_b <= idx_a or idx_b in assigned:
                        continue
                    sim = self._similarity(cit_a, cit_b)
                    if sim >= self.threshold:
                        group_members.append((idx_b, cit_b))

                if len(group_members) >= 2:
                    for idx, _ in group_members:
                        assigned.add(idx)
                    avg_score = sum(
                        self._similarity(
                            group_members[0][1], c
                        )
                        for _, c in group_members[1:]
                    ) / (len(group_members) - 1)
                    groups.append(
                        DuplicateGroup(
                            citations=[c for _, c in group_members],
                            reason=f"Title+year+author similarity ≥ {self.threshold:.0%}",
                            score=avg_score,
                            representative=group_members[0][1],
                        )
                    )

        return groups

    def _similarity(self, a: Citation, b: Citation) -> float:
        """Tính similarity giữa 2 citations (0.0–1.0)."""
        score = 0.0
        total = 0

        # Year match (weight: 0.2)
        if a.year and b.year and a.year == b.year:
            score += 0.2
        total += 0.2

        # First author match (weight: 0.4)
        author_a = self._first_author_last_name(a)
        author_b = self._first_author_last_name(b)
        if author_a and author_b:
            if author_a.lower() == author_b.lower():
                score += 0.4
            elif self._levenshtein_normalized(author_a, author_b) > 0.8:
                score += 0.3
        total += 0.4

        # Title similarity (weight: 0.4)
        title_a = a.title_normalized or ""
        title_b = b.title_normalized or ""
        if title_a and title_b:
            title_sim = self._jaccard_words(title_a, title_b)
            score += 0.4 * title_sim
        total += 0.4

        return score / total if total > 0 else 0.0

    def _first_author_last_name(self, cit: Citation) -> str | None:
        """Trả first author last name.

        Citation.authors là list[str] (raw strings như "Smith, J." hoặc "Smith J.").
        """
        if cit.authors and len(cit.authors) > 0:
            raw = cit.authors[0]
            if isinstance(raw, str):
                # "Smith, J." → "Smith"
                # "Smith J." → "Smith"
                # "J. Smith" → "Smith"
                if "," in raw:
                    return raw.split(",")[0].strip()
                tokens = [t.strip() for t in raw.split() if t.strip()]
                if not tokens:
                    return None
                if len(tokens) > 1 and len(tokens[0].rstrip(".")) == 1:
                    return tokens[-1]
                return tokens[0]
            # Fallback: object format (Author dataclass)
            return getattr(raw, "last_name", None) or ""
        # Fallback: extract from raw_text
        m = re.match(r"^([A-Z][a-zÀ-ÿ'-]+)", (cit.raw_text or "").split(",")[0])
        if m:
            return m.group(1).strip()
        return None

    def _jaccard_words(self, a: str, b: str) -> float:
        """Jaccard similarity trên word tokens."""
        words_a = set(a.split())
        words_b = set(b.split())
        if not words_a or not words_b:
            return 0.0
        return len(words_a & words_b) / len(words_a | words_b)

    def _levenshtein_normalized(self, a: str, b: str) -> float:
        """Normalized Levenshtein similarity (0.0–1.0)."""
        if not a or not b:
            return 0.0
        m, n = len(a), len(b)
        if m == 0 and n == 0:
            return 1.0
        if m == 0 or n == 0:
            return 0.0
        # Simple DP edit distance
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        for i in range(m + 1):
            dp[i][0] = i
        for j in range(n + 1):
            dp[0][j] = j
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                cost = 0 if a[i - 1] == b[j - 1] else 1
                dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
        edit_dist = dp[m][n]
        max_len = max(m, n)
        return 1.0 - (edit_dist / max_len)

    def _extract_arxiv_id(self, text: str) -> str | None:
        """Trích arXiv ID từ text."""
        m = _ARXIV_RE.search(text)
        if m:
            return m.group(1).strip().lower()
        return None
