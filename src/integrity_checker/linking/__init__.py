"""linking/ — Bidirectional citation linking (v1.2 §3.5).

Package này xây dựng citation graph — liên kết in-text occurrences
với reference entries trong bibliography.

Modules:
    statuses.py — CitationMappingStatus enum (8 values) + LinkingResult.
    citation_linker.py — CitationLinker (APA author-year + IEEE numeric + DOI + fuzzy).
    duplicate_detector.py — DuplicateDetector (exact DOI/arXiv + title-author-year similarity).

Public API:
    from integrity_checker.linking import (
        CitationMappingStatus,
        LinkingResult,
        CitationLinker,
        DuplicateDetector,
        DuplicateGroup,
    )

References:
    v1.2 §3.5 (bidirectional linking — citation graph)
    v1.2 §3.7 (linking styles — style consistency check)
    v1.2 §5.2 (tuần 8 — linking/ scaffold)
"""

from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.duplicate_detector import DuplicateDetector, DuplicateGroup
from integrity_checker.linking.statuses import (
    MAPPING_PENALTIES,
    MAPPING_SEVERITY,
    CitationMappingStatus,
    LinkingResult,
)

__all__ = [
    "CitationMappingStatus",
    "LinkingResult",
    "CitationLinker",
    "DuplicateDetector",
    "DuplicateGroup",
    "MAPPING_SEVERITY",
    "MAPPING_PENALTIES",  # deprecated alias of MAPPING_SEVERITY
]
