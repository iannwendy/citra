"""StyleDetector — phân lớp document-level citation style (v1.2 §3.5).

Mục tiêu:
    Phân loại 1 document thuộc APA-like, IEEE-like, MIXED, hoặc UNKNOWN
    dựa trên tín hiệu kết hợp từ:
        - Body in-text citations (CitationType.IN_TEXT / NUMERIC)
        - Bibliography entries (CitationType.REFERENCE_LIST) + style của entry

Features:
    - Body APA ratio: tỉ lệ in-text "(Author, Year)" trên tổng.
    - Body IEEE ratio: tỉ lệ in-text "[N]" trên tổng.
    - Bib APA ratio: tỉ lệ ReferenceListParser detect APA entries.
    - Bib IEEE ratio: tương tự IEEE.
    - Bib Vancouver, Chicago, MLA ratios.

Decision:
    - Cần >= min_occurrences_to_classify citations để classify.
    - Nếu APA ratio > 0.5 và IEEE ratio < 0.2 → APA-like.
    - Nếu IEEE ratio > 0.5 và APA ratio < 0.2 → IEEE-like.
    - Nếu cả 2 ratio đều trong [0.2, 0.5] → MIXED.
    - Nếu max ratio < unknown_threshold → UNKNOWN.

References:
    v1.2 §3.5 (style signals — body vs bibliography split)
    v1.2 §3.7 (linking styles — cần style consistency check)
    config.style_detection.* (thresholds + features)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from integrity_checker.config import StyleDetectionConfig
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# Optional import for patterns registry
try:
    from .patterns import get_all_formats, get_format
    REGISTRY_AVAILABLE = True
except ImportError:
    REGISTRY_AVAILABLE = False
    get_all_formats = None
    get_format = None

logger = logging.getLogger(__name__)


@dataclass
class StyleFeatures:
    """Features trích từ body + bibliography."""

    body_total_citations: int = 0
    body_apa_like: int = 0     # count (Author, Year) hoặc Author (Year)
    body_ieee_like: int = 0    # count [N]
    body_vancouver_like: int = 0  # count (N. Author) — ít gặp
    body_other: int = 0

    bib_total_entries: int = 0
    bib_apa_style: int = 0
    bib_ieee_style: int = 0
    bib_vancouver_style: int = 0
    bib_chicago_style: int = 0
    bib_other_style: int = 0


@dataclass
class StyleProfile:
    """Output từ StyleDetector."""

    # New API
    label: str = ""               # 'APA-like' / 'IEEE-like' / 'MIXED' / 'UNKNOWN'
    confidence: float = 0.0        # 0–1
    features: StyleFeatures = field(default_factory=StyleFeatures)
    ratios: dict = field(default_factory=dict)
    explanation: str = ""

    # Old API backward compat (style= instead of label=)
    style: str = ""               # backward compat alias for label
    apa_count: int = 0
    numeric_count: int = 0
    evidence: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Backward compat: style= param maps to label=
        if self.style and not self.label:
            self.label = self.style


class StyleDetector:
    """Phân lớp document-level citation style."""

    def __init__(self, config: StyleDetectionConfig | None = None) -> None:
        self.config = config or StyleDetectionConfig()

    def detect(
        self,
        body_citations: list[Citation],
        bib_citations: list[Citation],
    ) -> StyleProfile:
        """Classify style dựa trên body citations + bibliography entries.

        Args:
            body_citations: Citation[] trích từ body (IN_TEXT / NUMERIC).
            bib_citations: Citation[] trích từ bibliography (REFERENCE_LIST).
        """
        features = self._extract_features(body_citations, bib_citations)
        ratios = self._compute_ratios(features)

        label, confidence, explanation = self._classify(ratios, features)

        return StyleProfile(
            label=label,
            confidence=confidence,
            features=features,
            ratios=ratios,
            explanation=explanation,
        )

    # -- internals --

    def _detect_style_from_registry(self, text: str) -> CitationStyle | None:
        """Detect citation style using patterns registry (if available)."""
        if not REGISTRY_AVAILABLE or get_all_formats is None:
            return None
        try:
            style_map = {
                "apa": CitationStyle.APA,
                "ieee": CitationStyle.IEEE,
                "vancouver": CitationStyle.VANCOUVER,
                "chicago": CitationStyle.CHICAGO,
                "mla": CitationStyle.MLA,
                "harvard": CitationStyle.HARVARD,
                "acm": CitationStyle.ACM,
                "nature": CitationStyle.NATURE,
                "acs": CitationStyle.ACS,
                "ama": CitationStyle.AMA,
                "cse": CitationStyle.CSE,
            }
            for fmt in get_all_formats():
                mapped = style_map.get(fmt.name.lower())
                if mapped is None:
                    continue
                for pat in fmt.reference_patterns:
                    if pat.search(text):
                        return mapped
        except Exception:
            pass
        return None

    def _extract_features(
        self,
        body_citations: list[Citation],
        bib_citations: list[Citation],
    ) -> StyleFeatures:
        f = StyleFeatures()

        apa_re = re.compile(self.config.features.apa_author_year_pattern)
        ieee_re = re.compile(self.config.features.ieee_numeric_pattern)

        # Body signals
        for c in body_citations:
            f.body_total_citations += 1

            # Try registry first (optional enhancement)
            detected_style = c.style if c.style and c.style != CitationStyle.UNKNOWN else self._detect_style_from_registry(c.raw_text)
            if (
                c.citation_type == CitationType.NUMERIC
                or ieee_re.search(c.raw_text)
                or detected_style in {
                    CitationStyle.IEEE,
                    CitationStyle.ACM,
                    CitationStyle.VANCOUVER,
                    CitationStyle.NATURE,
                    CitationStyle.ACS,
                    CitationStyle.AMA,
                }
            ):
                f.body_ieee_like += 1
            elif (
                apa_re.search(c.raw_text)
                or detected_style in {
                    CitationStyle.APA,
                    CitationStyle.HARVARD,
                    CitationStyle.MLA,
                    CitationStyle.CHICAGO,
                    CitationStyle.CSE,
                }
            ):
                f.body_apa_like += 1
            elif re.search(r"^\s*\d+\.\s+[A-Z]", c.raw_text):
                f.body_vancouver_like += 1
            else:
                f.body_other += 1

        # Bib signals (dùng Citation.style đã được ReferenceListParser set, hoặc registry nếu có)
        for c in bib_citations:
            # Skip synthetic GROBID bibliography entries that were not enriched by
            # regex reference patterns when body citations are present, because
            # GROBID hardcodes style=CitationStyle.APA on all TEI bib entries.
            if (
                body_citations
                and getattr(c, "source", None) == "grobid"
                and not c.matched_pattern
            ):
                continue

            f.bib_total_entries += 1

            # Use Citation.style if already set, otherwise try registry
            style = c.style
            if style == CitationStyle.UNKNOWN or style is None:
                detected_style = self._detect_style_from_registry(c.raw_text)
                if detected_style:
                    style = detected_style

            # If a bibliography entry is explicitly bracket-numbered "[1] ...",
            # it participates in numeric [N] linking (IEEE-like) even if its
            # internal fields put (Year) after the author.
            if re.match(r"^\s*\[\s*\d+\s*\]", c.raw_text or ""):
                f.bib_ieee_style += 1
            elif style in {CitationStyle.APA, CitationStyle.HARVARD, CitationStyle.MLA}:
                f.bib_apa_style += 1
            elif style in {
                CitationStyle.IEEE,
                CitationStyle.ACM,
                CitationStyle.NATURE,
                CitationStyle.ACS,
                CitationStyle.AMA,
            }:
                f.bib_ieee_style += 1
            elif style == CitationStyle.VANCOUVER:
                f.bib_vancouver_style += 1
            elif style == CitationStyle.CHICAGO:
                f.bib_chicago_style += 1
            elif style == CitationStyle.CSE:
                if c.numeric_index is not None or re.match(r"^\s*(?:\[\s*\d+\s*\]|\d+\.)", c.raw_text or ""):
                    f.bib_ieee_style += 1
                else:
                    f.bib_apa_style += 1
            else:
                f.bib_other_style += 1

        return f

    def _compute_ratios(self, f: StyleFeatures) -> dict[str, float]:
        """Tính tỉ lệ % APA-like / IEEE-like / khác từ body + bib.

        Nếu 1 trong 2 (body hoặc bib) rỗng → dùng cái còn lại thay vì chia cho 0.
        """
        ratios: dict[str, float] = {}

        # Body ratios
        body_total = f.body_total_citations
        if body_total > 0:
            ratios["body_apa"] = f.body_apa_like / body_total
            ratios["body_ieee"] = (f.body_ieee_like + f.body_vancouver_like) / body_total
            ratios["body_other"] = f.body_other / body_total
        else:
            ratios["body_apa"] = 0.0
            ratios["body_ieee"] = 0.0
            ratios["body_other"] = 0.0

        # Bib ratios
        bib_total = f.bib_total_entries
        if bib_total > 0:
            ratios["bib_apa"] = (f.bib_apa_style + f.bib_chicago_style) / bib_total
            ratios["bib_ieee"] = (f.bib_ieee_style + f.bib_vancouver_style) / bib_total
            ratios["bib_vancouver"] = f.bib_vancouver_style / bib_total
            ratios["bib_chicago"] = f.bib_chicago_style / bib_total
            ratios["bib_other"] = f.bib_other_style / bib_total
        else:
            ratios["bib_apa"] = 0.0
            ratios["bib_ieee"] = 0.0
            ratios["bib_vancouver"] = 0.0
            ratios["bib_chicago"] = 0.0
            ratios["bib_other"] = 0.0

        # Combined score (weight body + bib equally).
        # Nếu bib rỗng → dùng body only (không nhân 0.5).
        if bib_total == 0:
            ratios["apa_combined"] = ratios["body_apa"]
            ratios["ieee_combined"] = ratios["body_ieee"]
        elif body_total == 0:
            ratios["apa_combined"] = ratios["bib_apa"]
            ratios["ieee_combined"] = ratios["bib_ieee"]
        else:
            ratios["apa_combined"] = (ratios["body_apa"] + ratios["bib_apa"]) / 2
            ratios["ieee_combined"] = (ratios["body_ieee"] + ratios["bib_ieee"]) / 2
        return ratios

    def _classify(
        self, ratios: dict[str, float], f: StyleFeatures
    ) -> tuple[str, float, str]:
        apa = ratios.get("apa_combined", 0)
        ieee = ratios.get("ieee_combined", 0)
        max_score = max(apa, ieee)
        min_total = self.config.min_occurrences_to_classify

        # Quá ít tín hiệu → UNKNOWN
        total_signals = f.body_total_citations + f.bib_total_entries
        if total_signals < min_total or max_score < self.config.unknown_threshold:
            return (
                "UNKNOWN",
                float(max_score),
                f"Only {total_signals} signals (< {min_total}); "
                f"max score={max_score:.2f} < unknown threshold",
            )

        # MIXED: cả 2 đều đáng kể
        if (
            apa > self.config.mixed_threshold
            and ieee > self.config.mixed_threshold
        ):
            return (
                "MIXED",
                float(max_score),
                f"Both APA={apa:.2f} and IEEE={ieee:.2f} > "
                f"{self.config.mixed_threshold}",
            )

        # APA-like
        if apa > ieee and apa > 0.5:
            confidence = min(1.0, apa + 0.1 * f.bib_total_entries / max(f.bib_total_entries, 1))
            return (
                "APA-like",
                float(confidence),
                f"APA score={apa:.2f} dominates IEEE={ieee:.2f}",
            )

        # IEEE-like
        if ieee > apa and ieee > 0.5:
            confidence = min(1.0, ieee + 0.1 * f.bib_total_entries / max(f.bib_total_entries, 1))
            return (
                "IEEE-like",
                float(confidence),
                f"IEEE score={ieee:.2f} dominates APA={apa:.2f}",
            )

        return (
            "UNKNOWN",
            float(max_score),
            f"APA={apa:.2f}, IEEE={ieee:.2f}; no clear winner",
        )
