"""Domain models — dataclass + enum + Pydantic schemas.

Re-export từ đây để tránh import sâu: `from integrity_checker.models import Citation`.
"""

from integrity_checker.models.api_schemas import (
    AnalysisReportSchema,
    CISSchema,
    CitationSchema,
    EssayUploadResponse,
    HealthResponse,
    VerdictSchema,
)
from integrity_checker.models.citation import (
    Citation,
    CitationStyle,
    CitationType,
    parse_year_safe,
)
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)

__all__ = [
    # citation
    "Citation",
    "CitationType",
    "CitationStyle",
    "parse_year_safe",
    # source
    "SourceCandidate",
    "SourceResult",
    # validation
    "ValidationLabel",
    "CitationVerdict",
    "MatchFeatures",
    # api
    "CitationSchema",
    "VerdictSchema",
    "CISSchema",
    "AnalysisReportSchema",
    "EssayUploadResponse",
    "HealthResponse",
]
