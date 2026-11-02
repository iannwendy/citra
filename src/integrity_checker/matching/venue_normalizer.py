"""Venue normalization — v1.2 §2.5 (task #30).

Mục đích: Map abbreviations ↔ full names ↔ ISSN để so sánh cited venue
(ví dụ "Journal of Machine Learning Research") với candidate venue
(ví dụ "JMLR" hoặc "J. Mach. Learn. Res.").

Strategy:
    1. **ISSN lookup** — nếu cả 2 có ISSN → exact match.
    2. **Static dictionary** — known abbreviations ↔ full names cho top venues.
    3. **Fuzzy matching** — fallback cho cases không có trong dict (token-set
       ratio pure Python, no external deps).
    4. **Heuristic** — bỏ punctuation, lowercase, strip "The " prefix.

API:
    - ``VenueNormalizer.normalize(venue: str) -> str`` — canonical key.
    - ``VenueNormalizer.similarity(v1: str, v2: str) -> float`` — 0–1.
    - ``VenueNormalizer.match(v1, v2, *, threshold=0.85) -> VenueMatchResult``.

v1.2 §2.5 — Sprint 2.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# ----- Static dictionary (top venues) -----
# Map: canonical_full_name → [abbreviations].
# Dữ liệu từ Wikipedia "List of academic journals by abbreviation" +
# ISO 4 (abbreviated title keys).

VENUE_DICT: dict[str, list[str]] = {
    # CS / ML
    "Journal of Machine Learning Research": ["JMLR", "J. Mach. Learn. Res."],
    "Machine Learning": ["ML", "Mach. Learn."],
    "Advances in Neural Information Processing Systems": [
        "NeurIPS",
        "NIPS",
        "Neural Information Processing Systems",
    ],
    "International Conference on Machine Learning": ["ICML"],
    "Proceedings of the IEEE": ["Proc. IEEE", "PIEEE"],
    "IEEE Transactions on Pattern Analysis and Machine Intelligence": [
        "TPAMI",
        "IEEE Trans. Pattern Anal. Mach. Intell.",
    ],
    "Pattern Recognition": ["PR", "Pattern Recognit."],
    "Pattern Recognition Letters": ["PRL", "Pattern Recognit. Lett."],
    "Communications of the ACM": ["CACM", "Commun. ACM"],
    "Journal of the ACM": ["JACM", "J. ACM"],
    "Artificial Intelligence": ["AI", "Artif. Intell."],
    "Journal of Artificial Intelligence Research": ["JAIR"],
    "Nature": ["Nature"],
    "Science": ["Science"],
    "Proceedings of the National Academy of Sciences": [
        "PNAS",
        "Proc. Natl. Acad. Sci.",
    ],
    "Physical Review Letters": ["PRL", "Phys. Rev. Lett."],
    "Physical Review D": ["PRD", "Phys. Rev. D"],
    "The Lancet": ["Lancet"],
    "New England Journal of Medicine": ["NEJM", "N. Engl. J. Med."],
    # Vietnamese journals
    "Tạp chí Khoa học và Công nghệ": ["TC KH&CN"],
    # Common CS conferences (proceedings titles)
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition": [
        "CVPR",
        "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
    ],
    "European Conference on Computer Vision": ["ECCV"],
}


# ----- Helpers (defined BEFORE reverse dict build) -----


def _fold_diacritics(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _normalize_key(text: str) -> str:
    """Canonical key cho dictionary lookup.

    Steps:
        1. NFC + lowercase + fold diacritics.
        2. Strip "The " prefix.
        3. Remove punctuation, normalize whitespace.

    Returns:
        Canonical lowercase string.
    """
    if not text:
        return ""
    s = _fold_diacritics(text).lower().strip()
    if s.startswith("the "):
        s = s[4:]
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _has_issn(text: str) -> str | None:
    """Trả về ISSN nếu text chứa ISSN hợp lệ (XXXX-XXXX)."""
    m = re.search(r"\b\d{4}-\d{3}[\dXx]\b", text)
    return m.group(0).upper() if m else None


# Build reverse map: abbreviation → canonical full name.
_REVERSE_DICT: dict[str, str] = {}
for _full, _abbrevs in VENUE_DICT.items():
    _canonical = _normalize_key(_full)
    _REVERSE_DICT[_canonical] = _full
    for _ab in _abbrevs:
        _REVERSE_DICT[_normalize_key(_ab)] = _full


# ----- Fuzzy helpers (pure Python, no external deps) -----


def _fuzzy_token_set_ratio(a: str, b: str) -> float:
    """Simple token-set ratio (RapidFuzz-style) — fallback.

    Returns:
        0–1. 1.0 = same token set (regardless of order).
    """
    if not a or not b:
        return 0.0
    set_a = set(a.lower().split())
    set_b = set(b.lower().split())
    if not set_a or not set_b:
        return 0.0
    inter = set_a & set_b
    if inter == set_a and inter == set_b:
        return 1.0
    # Jaccard-like: |inter| / |union|
    return len(inter) / len(set_a | set_b)


# ----- Public API -----


@dataclass
class VenueMatchResult:
    """Output của VenueNormalizer.match()."""

    matched: bool = False
    score: float = 0.0
    method: str = "none"           # 'issn' / 'dict' / 'fuzzy' / 'none'
    canonical: str = ""             # canonical full name nếu matched
    issn: str | None = None         # ISSN nếu có
    evidence: dict = field(default_factory=dict)


class VenueNormalizer:
    """Normalize + compare venue strings.

    Methods:
        normalize(venue: str) -> str: trả canonical full name (nếu biết) hoặc
            normalized lowercase string.
        similarity(v1: str, v2: str) -> float: 0–1.
        match(v1, v2, *, threshold=0.85) -> VenueMatchResult: chi tiết.
    """

    def __init__(self, threshold: float = 0.85) -> None:
        self.threshold = threshold
        self.reverse_dict = _REVERSE_DICT

    def normalize(self, venue: str | None) -> str:
        """Trả canonical full name nếu biết (trong dict), else normalized lowercase."""
        if not venue:
            return ""
        key = _normalize_key(venue)
        if key in self.reverse_dict:
            return self.reverse_dict[key]
        # Try stripping 'Proceedings of (the)' or trailing parenthetical abbreviation e.g. '(NeurIPS)'
        no_parens = re.sub(r"\s*[\(\[][^\)\]]+[\)\]]\s*", " ", venue).strip()
        for cand_str in (no_parens, venue):
            cand_key = _normalize_key(cand_str)
            cand_no_proc = re.sub(
                r"^(?:in\s+)?(?:proceedings\s+of\s+(?:the\s+)?|proc\s+(?:of\s+(?:the\s+)?)?)",
                "",
                cand_key,
            ).strip()
            if cand_key in self.reverse_dict:
                return self.reverse_dict[cand_key]
            if cand_no_proc in self.reverse_dict:
                return self.reverse_dict[cand_no_proc]
        for paren_m in re.findall(r"[\(\[]([^)\]]{2,15})[\)\]]", venue):
            p_key = _normalize_key(paren_m)
            if p_key in self.reverse_dict:
                return self.reverse_dict[p_key]
        # Try ISSN
        issn = _has_issn(venue)
        if issn:
            return f"<ISSN:{issn}>"
        # Fallback: just normalized form
        return key

    def similarity(self, v1: str | None, v2: str | None) -> float:
        """Tính 0–1 giữa 2 venue strings.

        Order:
            1. ISSN exact → 1.0
            2. Dict lookup → 1.0
            3. Normalized exact → 1.0
            4. Fuzzy (token_set_ratio) → 0–1
        """
        if not v1 or not v2:
            return 0.0
        # ISSN
        issn1, issn2 = _has_issn(v1), _has_issn(v2)
        if issn1 and issn2:
            return 1.0 if issn1 == issn2 else 0.0
        # Dict lookup
        norm1 = self.normalize(v1)
        norm2 = self.normalize(v2)
        if norm1 and norm2 and norm1 == norm2:
            return 1.0
        # Fuzzy
        return _fuzzy_token_set_ratio(norm1, norm2)

    def match(
        self,
        v1: str | None,
        v2: str | None,
        *,
        threshold: float | None = None,
    ) -> VenueMatchResult:
        """Match với threshold cho verdict + evidence."""
        thr = threshold if threshold is not None else self.threshold
        if not v1 or not v2:
            return VenueMatchResult(matched=False, score=0.0, method="none")
        issn1, issn2 = _has_issn(v1), _has_issn(v2)
        if issn1 and issn2:
            matched = issn1 == issn2
            return VenueMatchResult(
                matched=matched,
                score=1.0 if matched else 0.0,
                method="issn",
                issn=issn1 if matched else None,
            )
        norm1 = self.normalize(v1)
        norm2 = self.normalize(v2)
        if norm1 == norm2 and norm1:
            return VenueMatchResult(
                matched=True,
                score=1.0,
                method="dict",
                canonical=norm1,
            )
        fuzzy = _fuzzy_token_set_ratio(norm1, norm2)
        return VenueMatchResult(
            matched=fuzzy >= thr,
            score=fuzzy,
            method="fuzzy",
            canonical=norm1 if fuzzy >= thr else "",
            evidence={"v1_norm": norm1, "v2_norm": norm2, "fuzzy": fuzzy},
        )
