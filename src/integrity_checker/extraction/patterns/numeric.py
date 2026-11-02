"""Numeric citation format patterns - IEEE/Vancouver style.

This module provides numeric citation format implementation as a separate
module for the modular citation pattern system.

Numeric citations are commonly used in:
    - IEEE style: [1], [1,2], [1-5]
    - Vancouver style: (1), (1,2), (1-5)

Note:
    This is a separate module from ieee.py to allow for different
    numeric format variations (brackets vs parentheses).
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.models.citation import Citation

# =============================================================================
# Numeric Pattern Definitions
# =============================================================================

# --- In-text Numeric patterns ---

# Bracketed numbers: [1], [1,2], [1-5], [1, 2, 3]
# Used in IEEE and Vancouver styles
_NUMERIC_BRACKETED = CompiledPattern.create(
    name="numeric_bracketed",
    pattern=r"\[(\d+(?:[,\s\-]+\d+)*)\]",
    pattern_type=PatternType.IN_TEXT,
    description="Numeric bracketed: [1] | [1,2] | [1-5] | [1, 2, 3]",
)

# Parenthesized numbers: (1), (1,2), (1-5)
# Used in Vancouver style
_NUMERIC_PARENTHESIZED = CompiledPattern.create(
    name="numeric_parenthesized",
    pattern=r"\((\d+(?:[,\s\-]+\d+)*)\)",
    pattern_type=PatternType.IN_TEXT,
    description="Numeric parenthesized: (1) | (1,2) | (1-5) | (1, 2, 3)",
)


# =============================================================================
# Numeric Format Implementation
# =============================================================================


class NumericFormat:
    """Numeric citation format implementation.

    Numeric style is commonly used in:
        - IEEE
        - Vancouver (medical/scientific)
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "Numeric"

    @property
    def priority(self) -> int:
        """Priority for format resolution (lower = higher priority)."""
        return 20

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting numeric in-text citations."""
        return [
            _NUMERIC_BRACKETED,
            _NUMERIC_PARENTHESIZED,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Reference patterns (not typically used for numeric)."""
        return []

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse numeric reference entry (not applicable for numeric style).

        Numeric citations don't parse reference entries in the same way
        as author-year styles. Returns None.

        Args:
            text: Raw reference entry text

        Returns:
            None (numeric style uses index-based references)
        """
        return None

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid numeric citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches numeric citation pattern, False otherwise
        """

        # Check for bracketed number pattern
        bracket_pattern = r"\[\d+(?:[,\s\-]+\d+)*\]"
        if re.match(bracket_pattern, text.strip()):
            return True

        # Check for parenthesized number pattern
        paren_pattern = r"\(\d+(?:[,\s\-]+\d+)*\)"
        if re.match(paren_pattern, text.strip()):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register Numeric format when this module is imported
# Note: This will conflict with IEEE format which also registers _NUMERIC_BRACKETED
# The priority system handles this by using the first registered format
# If you want both, consider using only one of them
# For now, we don't auto-register to avoid conflicts
# register_format(NumericFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

NUMERIC_IN_TEXT_PATTERNS = [
    _NUMERIC_BRACKETED,
    _NUMERIC_PARENTHESIZED,
]

NUMERIC_REFERENCE_PATTERNS: list[CompiledPattern] = []
