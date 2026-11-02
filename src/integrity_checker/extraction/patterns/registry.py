"""Citation format registry — manages all registered citation formats.

This module provides a centralized registry for citation formats:
- Formats register themselves via register_format()
- Other modules query the registry for patterns
- Priority ordering ensures deterministic resolution

The registry auto-imports from format modules via __init__.py.

Usage:
    from integrity_checker.extraction.patterns.registry import (
        register_format,
        get_format,
        get_all_formats,
        get_in_text_patterns,
        get_reference_patterns,
    )

    # Register a new format
    register_format(MyCustomFormat())

    # Query patterns
    patterns = get_in_text_patterns()
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from integrity_checker.extraction.patterns.base import CitationFormat, CompiledPattern

if TYPE_CHECKING:
    pass


# =============================================================================
# Internal Registry State
# =============================================================================

# Registry of all registered formats (name -> CitationFormat)
_FORMAT_REGISTRY: dict[str, CitationFormat] = {}

# Priority-ordered list of format names (lower index = higher priority)
_PRIORITY_ORDER: list[str] = []


# =============================================================================
# Registry Functions
# =============================================================================


def register_format(format: CitationFormat) -> None:
    """Register a citation format.

    Args:
        format: CitationFormat implementation to register

    Raises:
        TypeError: If format doesn't implement CitationFormat Protocol
        ValueError: If format with same name already registered
    """
    if not isinstance(format, CitationFormat):
        raise TypeError(
            f"{type(format).__name__} must implement CitationFormat Protocol"
        )

    name = format.name

    if name in _FORMAT_REGISTRY:
        raise ValueError(f"Citation format '{name}' already registered")

    _FORMAT_REGISTRY[name] = format

    # Insert into priority order (higher priority = earlier in list = tried first)
    insert_position = len(_PRIORITY_ORDER)
    for i, existing_name in enumerate(_PRIORITY_ORDER):
        existing_format = _FORMAT_REGISTRY[existing_name]
        if format.priority > existing_format.priority:
            insert_position = i
            break

    _PRIORITY_ORDER.insert(insert_position, name)


def get_format(name: str) -> CitationFormat | None:
    """Get a registered format by name.

    Args:
        name: Format name (e.g., 'APA', 'IEEE')

    Returns:
        CitationFormat if found, None otherwise
    """
    return _FORMAT_REGISTRY.get(name)


def get_all_formats() -> list[CitationFormat]:
    """Get all registered formats in priority order.

    Returns:
        List of CitationFormat objects sorted by priority (highest first)
    """
    return [_FORMAT_REGISTRY[name] for name in _PRIORITY_ORDER]


def get_in_text_patterns() -> list[CompiledPattern]:
    """Get all in-text patterns from all registered formats.

    Returns:
        List of CompiledPattern objects from all formats in priority order
    """
    patterns: list[CompiledPattern] = []
    for fmt in get_all_formats():
        patterns.extend(fmt.in_text_patterns)
    return patterns


def get_reference_patterns() -> list[CompiledPattern]:
    """Get all reference entry patterns from all registered formats.

    Returns:
        List of CompiledPattern objects from all formats in priority order
    """
    patterns: list[CompiledPattern] = []
    for fmt in get_all_formats():
        patterns.extend(fmt.reference_patterns)
    return patterns


def get_utility_patterns() -> list[CompiledPattern]:
    """Get all utility patterns (DOI, URL, Year).

    Returns:
        List of CompiledPattern utility patterns
    """
    from integrity_checker.extraction.patterns.utils import UTILITY_PATTERNS

    return list(UTILITY_PATTERNS)


def clear_registry() -> None:
    """Clear all registered formats. Useful for testing."""
    global _FORMAT_REGISTRY, _PRIORITY_ORDER
    _FORMAT_REGISTRY = {}
    _PRIORITY_ORDER = []


def get_registry_info() -> dict[str, dict]:
    """Get information about registered formats for debugging.

    Returns:
        Dict mapping format names to their info
    """
    info: dict[str, dict] = {}
    for fmt in get_all_formats():
        info[fmt.name] = {
            "priority": fmt.priority,
            "in_text_patterns": len(fmt.in_text_patterns),
            "reference_patterns": len(fmt.reference_patterns),
        }
    return info


# =============================================================================
# Re-export
# =============================================================================
__all__ = [
    "CitationFormat",
    "CompiledPattern",
    "register_format",
    "get_format",
    "get_all_formats",
    "get_in_text_patterns",
    "get_reference_patterns",
    "get_utility_patterns",
    "clear_registry",
    "get_registry_info",
]
