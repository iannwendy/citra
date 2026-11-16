# Citation Format Development Guide

This guide walks you through implementing a new citation format for the Essay Integrity Checker.

## Overview

The citation pattern system uses a modular architecture where each format:
- Implements the `CitationFormat` Protocol
- Auto-registers via `register_format()`
- Provides in-text and reference entry patterns
- Includes parsing and validation logic

## Quick Start

### 1. Create the Format Module

Create `src/integrity_checker/extraction/patterns/{format}.py`:

```python
"""FormatName citation format patterns and parser.

Format description and citation style examples.

Reference:
    https://official-style-guide.url/
"""

from __future__ import annotations

from typing import Optional

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


# =============================================================================
# Format Pattern Definitions
# =============================================================================

# --- In-text patterns ---

_FORMAT_INTEXT = CompiledPattern.create(
    name="format_intext",
    pattern=r"\(Author,\s*\d{4}\)",
    pattern_type=PatternType.IN_TEXT,
    description="Format in-text: (Author, Year)",
)

# --- Reference entry patterns ---

_FORMAT_REFERENCE = CompiledPattern.create(
    name="format_reference",
    pattern=r"^Author,\s*A\.\s*\((\d{4})\)\.\s*Title\.",
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Format reference entry: Author (Year). Title.",
)


# =============================================================================
# Format Implementation
# =============================================================================


class FormatNameFormat:
    """FormatName citation format implementation.

    Description of when to use this format and what it handles.
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "FormatName"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        See Priority Guidelines below.
        """
        return 80

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting FormatName in-text citations."""
        return [
            _FORMAT_INTEXT,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting FormatName reference list entries."""
        return [
            _FORMAT_REFERENCE,
        ]

    def parse_reference_entry(self, text: str) -> Optional[Citation]:
        """Parse FormatName reference entry into Citation object."""
        # Implementation here
        pass

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid FormatName citation."""
        # Implementation here
        pass


# =============================================================================
# Auto-registration
# =============================================================================

register_format(FormatNameFormat())
```

### 2. Update `__init__.py`

Add to the auto-import section in `src/integrity_checker/extraction/patterns/__init__.py`:

```python
try:
    from integrity_checker.extraction.patterns import chicago  # noqa: F401
    from integrity_checker.extraction.patterns.chicago import ChicagoFormat
except ImportError:
    pass

try:
    from integrity_checker.extraction.patterns import mla  # noqa: F401
    from integrity_checker.extraction.patterns.mla import MLAFormat
except ImportError:
    pass
```

Also add to `__all__`:

```python
__all__ = [
    # ... existing exports ...
    "ChicagoFormat",
    "MLAFormat",
]
```

## Priority Guidelines

Format priorities determine the order they're tried when parsing citations.

| Priority | Format | Notes |
|----------|--------|-------|
| 100 | APA | Most common, try first |
| 90 | IEEE | Common in CS/Engineering |
| 80 | Vancouver | Common in Medical/Science |
| 70 | Chicago, MLA | Humanities formats |
| 50 | Numeric | Fallback numeric style |

Lower priority formats should have simpler patterns to avoid false positives.

## Pattern Types

### In-Text Patterns

Match citations within running text:
- `(Author, Year)` - APA parenthetical
- `[1]` - IEEE numeric
- `(Author Page)` - MLA
- `1.` - Vancouver numbered

### Reference Entry Patterns

Match entries in the bibliography/reference list:
- `Author, A. (Year). Title. Journal.`
- `[1] A. Author, "Title," Journal, vol. X, pp. XX-YY.`
- `Author A. Title. Place: Publisher; Year.`

### Utility Patterns

Match metadata fragments:
- DOI patterns
- URL patterns
- Year patterns
- Volume/issue patterns

## Testing Requirements

### 1. Unit Tests

Create `tests/unit/test_patterns_{format}.py`:

```python
"""Tests for FormatName citation patterns."""

import pytest
from integrity_checker.extraction.patterns import get_all_formats


class TestFormatNameFormat:
    """Test FormatName format implementation."""

    def test_format_registered(self):
        """Format should be registered."""
        formats = get_all_formats()
        names = [f.name for f in formats]
        assert "FormatName" in names

    def test_intext_pattern_extraction(self):
        """Should extract in-text citations."""
        # Test implementation
        pass

    def test_reference_pattern_extraction(self):
        """Should extract reference entries."""
        # Test implementation
        pass

    def test_parse_reference_entry(self):
        """Should parse reference entries correctly."""
        # Test implementation
        pass

    def test_is_valid_citation(self):
        """Should validate citations correctly."""
        # Test implementation
        pass
```

### 2. Integration Tests

Test with real PDFs:
```bash
python -m pytest tests/ -v -k format_name
```

### 3. Verification Commands

```bash
# Check format is registered
python -c "from src.integrity_checker.extraction.patterns import get_all_formats; print([f.name for f in get_all_formats()])"

# Test pattern extraction
python -c "
from integrity_checker.extraction.patterns import get_in_text_patterns, get_reference_patterns
print(f'In-text patterns: {len(get_in_text_patterns())}')
print(f'Reference patterns: {len(get_reference_patterns())}')
"
```

## Common Patterns

### Author Name Patterns

```python
# Full name: Last, First M.
AUTHOR_LAST_FIRST = r"[A-Z][a-z]+,\s*[A-Z]\."

# Initials: A. A. Author
AUTHOR_INITIALS = r"[A-Z]\.\s*[A-Z]\.\s*[A-Z][a-z]+"

# Multiple authors: Author et al.
MULTI_AUTHOR = r"[A-Z][a-z]+(?:\s+et\s+al\.?)?"
```

### Year Patterns

```python
# Standard year: 2020
YEAR = r"\b(19|20)\d{2}\b"

# With suffix: 2020a
YEAR_SUFFIX = r"\b(19|20)\d{2}([a-z]?)\b"
```

### Title Patterns

```python
# Quoted title (IEEE)
TITLE_QUOTED = r'"([^"]+)"'

# Italic title (placeholder)
TITLE_ITALIC = r"<i>([^<]+)</i>"
```

## Implementation Checklist

- [ ] Create format module with docstring
- [ ] Define in-text patterns (at least 1)
- [ ] Define reference entry patterns (at least 1)
- [ ] Implement `FormatNameFormat` class
- [ ] Implement `parse_reference_entry()` method
- [ ] Implement `is_valid_citation()` method
- [ ] Auto-register with `register_format()`
- [ ] Update `__init__.py` exports
- [ ] Write unit tests
- [ ] Test with real PDFs
- [ ] Update this guide if needed

## Existing Formats

| Format | File | Status |
|--------|------|--------|
| APA | apa.py | Complete |
| IEEE | ieee.py | Complete |
| Vancouver | vancouver.py | Complete |
| Numeric | numeric.py | Complete |
| Chicago | chicago.py | Placeholder / chưa đăng ký mặc định |
| MLA | mla.py | Implemented, chưa đăng ký mặc định |
| Harvard | harvard.py | Implemented |
| ACM | acm.py | Implemented |
| Nature | nature.py | Implemented |
| CSE | cse.py | Implemented |
| ACS | acs.py | Implemented, chưa đăng ký mặc định |
| AMA | ama.py | Implemented, chưa đăng ký mặc định |

## References

- [Chicago Manual of Style](https://www.chicagomanualofstyle.org/)
- [MLA Handbook](https://style.mla.org/)
- [APA Style](https://apastyle.apa.org/)
- [IEEE Editorial Style Manual](https://ieee-dataport.org/sites/default/files/analysis/27/IEEE%20Reference%20Guide%20(updated)%20-%20Final.pdf)
- [Vancouver Style](https://www.nlm.nih.gov/bsd/uniform_requirements.html)
