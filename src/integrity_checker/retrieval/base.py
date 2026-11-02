"""Abstract scholarly API client."""

from __future__ import annotations

from abc import ABC, abstractmethod

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate


class BaseScholarClient(ABC):
    """Interface chung cho mọi nguồn truy hồi.

    Implementations: Crossref / OpenAlex / Semantic Scholar / arXiv.

    # TODO(user): tuần 9–10 — thêm:
        - Polite pool headers (User-Agent có email)
        - Retry với exponential backoff (tenacity)
        - DOI exact lookup riêng (nếu có)
    """

    name: str = "base"

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    @abstractmethod
    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Tra cứu 1 citation. Trả SourceCandidate với found=True/False."""
        raise NotImplementedError

    async def lookup_many(self, citations: list[Citation]) -> list[SourceCandidate]:
        """Default sequential. Override nếu client hỗ trợ batch."""
        return [await self.lookup(c) for c in citations]
