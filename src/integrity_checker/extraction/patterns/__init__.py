"""Modular citation patterns system — PUBLIC API.

This package provides a modular, extensible citation pattern system for
extracting citations from academic papers.

Structure:
    patterns/
        __init__.py      # This file - public API exports
        base.py          # Core dataclasses and Protocol definitions
        utils.py         # Utility patterns (DOI, URL, Year) - SINGLE SOURCE OF TRUTH
        registry.py      # Format registry for managing citation formats
        apa.py           # APA format patterns
        ieee.py          # IEEE format patterns
        numeric.py       # Numeric citation patterns

Auto-registration:
    Format modules (apa.py, ieee.py, etc.) should register themselves
    by calling `from integrity_checker.extraction.patterns.registry import register_format`
    at import time.

Usage:
    from integrity_checker.extraction.patterns import (
        # Core types
        PatternType,
        CompiledPattern,
        CitationFormat,

        # Utility functions
        extract_doi,
        extract_url,
        extract_year,

        # Registry functions
        get_in_text_patterns,
        get_reference_patterns,
        get_all_formats,
    )

    # Get all patterns for extraction
    in_text_patterns = get_in_text_patterns()

    # Use utility functions
    doi = extract_doi("DOI: 10.1000/xyz123")
"""

from __future__ import annotations

# Import base types
from integrity_checker.extraction.patterns.base import (
    CitationFormat,
    CompiledPattern,
    PatternType,
)

# Import registry functions
from integrity_checker.extraction.patterns.registry import (
    clear_registry,
    get_all_formats,
    get_format,
    get_in_text_patterns,
    get_reference_patterns,
    get_registry_info,
    get_utility_patterns,
    register_format,
)

# Import utility functions and patterns
from integrity_checker.extraction.patterns.utils import (
    DOI_PATTERN,
    URL_PATTERN,
    UTILITY_PATTERNS,
    YEAR_PATTERN,
    extract_doi,
    extract_publication_year,
    extract_url,
    extract_year,
)

# Auto-register built-in formats
# Import these at the end to avoid circular imports
try:
    from integrity_checker.extraction.patterns import apa  # noqa: F401
    from integrity_checker.extraction.patterns.apa import APAFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import ieee  # noqa: F401
    from integrity_checker.extraction.patterns.ieee import IEEEFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import numeric  # noqa: F401
    from integrity_checker.extraction.patterns.numeric import NumericFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import vancouver  # noqa: F401
    from integrity_checker.extraction.patterns.vancouver import VancouverFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import chicago  # noqa: F401
    from integrity_checker.extraction.patterns.chicago import ChicagoFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import harvard  # noqa: F401
    from integrity_checker.extraction.patterns.harvard import HarvardFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import acm  # noqa: F401
    from integrity_checker.extraction.patterns.acm import ACMFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import nature  # noqa: F401
    from integrity_checker.extraction.patterns.nature import NatureFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import cse  # noqa: F401
    from integrity_checker.extraction.patterns.cse import CSEFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import mla  # noqa: F401
    from integrity_checker.extraction.patterns.mla import MLAFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import acs  # noqa: F401
    from integrity_checker.extraction.patterns.acs import ACSFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import ama  # noqa: F401
    from integrity_checker.extraction.patterns.ama import AMAFormat
except ImportError:
    pass


# =============================================================================
# Public API
# =============================================================================

__all__ = [
    # Base types
    "PatternType",
    "CompiledPattern",
    "CitationFormat",
    # Utility patterns
    "DOI_PATTERN",
    "URL_PATTERN",
    "YEAR_PATTERN",
    "UTILITY_PATTERNS",
    # Utility functions
    "extract_doi",
    "extract_url",
    "extract_year",
    "extract_publication_year",
    # Registry functions
    "get_format",
    "get_all_formats",
    "get_in_text_patterns",
    "get_reference_patterns",
    "get_utility_patterns",
    "get_registry_info",
    "register_format",
    "clear_registry",
    # Citation format classes
    "APAFormat",
    "IEEEFormat",
    "NumericFormat",
    "VancouverFormat",
    "ChicagoFormat",
    "HarvardFormat",
    "ACMFormat",
    "NatureFormat",
    "CSEFormat",
    "MLAFormat",
    "ACSFormat",
    "AMAFormat",
]
