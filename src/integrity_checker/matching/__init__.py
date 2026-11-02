"""Matching module — feature engineering cho so khớp citation vs candidate.

Bao gồm:
- Fuzzy (RapidFuzz)
- Semantic (sentence-transformers wrapper)
- Features (gộp thành MatchFeatures)
- Consensus (cross-source agreement)
- AuthorParser (chuẩn hoá author name) — MỚI v1.2
"""

from integrity_checker.matching.author_parser import (
    Author,
    jaccard_similarity,
    normalize_author,
    parse_authors,
)
from integrity_checker.matching.consensus import ConsensusCalculator
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.fuzzy import FuzzyMatcher
from integrity_checker.matching.semantic import SemanticMatcher

__all__ = [
    "FuzzyMatcher",
    "SemanticMatcher",
    "FeatureCalculator",
    "ConsensusCalculator",
    "Author",
    "normalize_author",
    "parse_authors",
    "jaccard_similarity",
]
