"""Citation regex patterns — DEPRECATED.

.. deprecated::
    This module is deprecated. Use :mod:`integrity_checker.extraction.patterns` instead.

    Migration guide:
        - Replace ``from integrity_checker.extraction.regex_patterns import ...``
          with ``from integrity_checker.extraction.patterns import ...``
        - Use ``get_in_text_patterns()`` instead of ``CITATION_PATTERNS``
        - Use ``get_reference_patterns()`` for reference list patterns

This module is kept for backward compatibility with external consumers.
"""

from __future__ import annotations

import warnings

# Emit deprecation warning at module level
warnings.warn(
    "regex_patterns.py is deprecated. Use extraction.patterns instead.",
    DeprecationWarning,
    stacklevel=2,
)

# Re-export from patterns module for backward compatibility
from integrity_checker.extraction.patterns import (  # noqa: E402 - must follow the deprecation warning
    DOI_PATTERN,
    URL_PATTERN,
    YEAR_PATTERN,
    CitationFormat,
    CompiledPattern,
    PatternType,
    extract_doi,
    extract_url,
    extract_year,
    get_all_formats,
    get_format,
    get_in_text_patterns,
    get_reference_patterns,
    get_utility_patterns,
)

# Import CitationStyle and CitationType for backward compatibility
from integrity_checker.models.citation import CitationStyle, CitationType  # noqa: E402

# Backward compatibility alias - CitationPattern was the old name
CitationPattern = CompiledPattern

# Keep CITATION_PATTERNS for remaining consumers
# This maps to in-text patterns from the new patterns module
CITATION_PATTERNS = get_in_text_patterns()


def get_all_patterns():
    """Return all patterns (deprecated alias).

    .. deprecated::
        Use :func:`integrity_checker.extraction.patterns.get_in_text_patterns` and
        :func:`integrity_checker.extraction.patterns.get_utility_patterns` instead.
    """
    warnings.warn(
        "get_all_patterns() is deprecated. Use get_in_text_patterns() + get_utility_patterns() instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return list(get_in_text_patterns()) + list(get_utility_patterns())


# Public backward-compatible surface of this deprecated module.
__all__ = [
    "DOI_PATTERN",
    "URL_PATTERN",
    "YEAR_PATTERN",
    "CitationFormat",
    "CompiledPattern",
    "PatternType",
    "extract_doi",
    "extract_url",
    "extract_year",
    "get_all_formats",
    "get_format",
    "get_in_text_patterns",
    "get_reference_patterns",
    "get_utility_patterns",
    "CitationStyle",
    "CitationType",
    "CitationPattern",
    "CITATION_PATTERNS",
    "get_all_patterns",
]
