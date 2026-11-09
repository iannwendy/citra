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
        "Adv. Neural Inf. Process. Syst.",
    ],
    "International Conference on Machine Learning": ["ICML"],
    "International Conference on Learning Representations": ["ICLR"],
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
    # Common CS / AI / NLP conferences (proceedings titles)
    "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition": [
        "CVPR",
        "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
        "IEEE Conference on Computer Vision and Pattern Recognition",
    ],
    "Proceedings of the IEEE/CVF International Conference on Computer Vision": [
        "ICCV",
        "IEEE International Conference on Computer Vision",
    ],
    "European Conference on Computer Vision": ["ECCV"],
    "Annual Meeting of the Association for Computational Linguistics": [
        "ACL",
        "Association for Computational Linguistics",
        "Findings of the Association for Computational Linguistics: ACL",
    ],
    "Conference on Empirical Methods in Natural Language Processing": [
        "EMNLP",
        "Empirical Methods in Natural Language Processing",
        "Findings of the Association for Computational Linguistics: EMNLP",
    ],
    "Conference of the North American Chapter of the Association for Computational Linguistics": [
        "NAACL",
        "NAACL-HLT",
        "North American Chapter of the Association for Computational Linguistics",
        "North American Chapter of the Association for Computational Linguistics: Human Language Technologies",
    ],
    "Conference of the European Chapter of the Association for Computational Linguistics": [
        "EACL",
    ],
    "International Conference on Computational Linguistics": ["COLING"],
    "AAAI Conference on Artificial Intelligence": [
        "AAAI",
        "Proceedings of the AAAI Conference on Artificial Intelligence",
    ],
    "International Joint Conference on Artificial Intelligence": ["IJCAI"],
    "ACM SIGKDD Conference on Knowledge Discovery and Data Mining": ["KDD", "SIGKDD"],
    "International ACM SIGIR Conference on Research and Development in Information Retrieval": [
        "SIGIR",
    ],
    "The Web Conference": ["WWW", "International World Wide Web Conference"],
    "ACM International Conference on Web Search and Data Mining": ["WSDM"],
    "ACM International Conference on Information and Knowledge Management": ["CIKM"],
    "International AAAI Conference on Web and Social Media": [
        "ICWSM",
        "International AAAI Conference on Weblogs and Social Media",
    ],
}


# ----- Helpers (defined BEFORE reverse dict build) -----


def _fold_diacritics(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


_RUNNING_HEADER_SUFFIX_RE = re.compile(
    r"\s+(?:TRƯỜNG\s+ĐẠI\s+HỌC|ĐẠI\s+HỌC\s+QUỐC\s+GIA|KHOA\s+CÔNG\s+NGHỆ\s+THÔNG\s+TIN|BỘ\s+GIÁO\s+DỤC\s+VÀ\s+ĐÀO\s+TẠO)\b.*$"
)

_ISO4_WORD_MAP: dict[str, str] = {
    "adv": "advances",
    "proc": "proceedings",
    "inf": "information",
    "process": "processing",
    "syst": "systems",
    "trans": "transactions",
    "int": "international",
    "conf": "conference",
    "symp": "symposium",
    "mach": "machine",
    "learn": "learning",
    "res": "research",
    "comput": "computational",
    "linguist": "linguistics",
    "nat": "natural",
    "lang": "language",
    "artif": "artificial",
    "intell": "intelligence",
    "recognit": "recognition",
    "lett": "letters",
    "commun": "communications",
    "j": "journal",
}


def _strip_running_header(text: str) -> str:
    if not text:
        return ""
    return _RUNNING_HEADER_SUFFIX_RE.sub("", text).strip()


def _expand_iso4_key(norm_key: str) -> str:
    if not norm_key:
        return ""
    return " ".join(_ISO4_WORD_MAP.get(tok, tok) for tok in norm_key.split())


def _normalize_key(text: str) -> str:
    """Canonical key cho dictionary lookup.

    Steps:
        1. Strip leaked running headers + NFC + lowercase + fold diacritics.
        2. Strip "The " prefix.
        3. Remove punctuation, normalize whitespace.

    Returns:
        Canonical lowercase string.
    """
    if not text:
        return ""
    cleaned = _strip_running_header(text)
    s = _fold_diacritics(cleaned).lower().strip()
    if s.startswith("the "):
        s = s[4:]
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _has_issn(text: str) -> str | None:
    """Trả về ISSN nếu text chứa ISSN hợp lệ (XXXX-XXXX)."""
    m = re.search(r"\b\d{4}-\d{3}[\dXx]\b", text)
    return m.group(0).upper() if m else None


# Build reverse map: abbreviation → canonical full name (plus multi-map for shared acronyms like PRL).
_REVERSE_DICT: dict[str, str] = {}
_REVERSE_MULTI_DICT: dict[str, set[str]] = {}
for _full, _abbrevs in VENUE_DICT.items():
    _canonical = _normalize_key(_full)
    _REVERSE_DICT.setdefault(_canonical, _full)
    _REVERSE_MULTI_DICT.setdefault(_canonical, set()).add(_full)
    for _ab in _abbrevs:
        _ab_key = _normalize_key(_ab)
        _REVERSE_DICT.setdefault(_ab_key, _full)
        _REVERSE_MULTI_DICT.setdefault(_ab_key, set()).add(_full)


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
        self.reverse_multi_dict = _REVERSE_MULTI_DICT

    def _candidate_canonicals(self, venue: str | None) -> set[str]:
        """Return all canonical full names matching a venue string (resolving shared acronyms & proceedings wrappers)."""
        if not venue:
            return set()
        cleaned = _strip_running_header(venue)
        matches: set[str] = set()
        no_parens = re.sub(r"\s*[\(\[][^\)\]]+[\)\]]\s*", " ", cleaned).strip()
        for cand_str in (cleaned, no_parens):
            cand_key = _normalize_key(cand_str)
            cand_no_proc = re.sub(
                r"^(?:in\s+)?(?:proceedings\s+of\s+(?:the\s+)?|proc\s+(?:of\s+(?:the\s+)?)?)(?:\d{4}\s+|\d+(?:st|nd|rd|th)\s+)*(?:annual\s+)?",
                "",
                cand_key,
            ).strip()
            for k in (cand_key, cand_no_proc, _expand_iso4_key(cand_key), _expand_iso4_key(cand_no_proc)):
                if k in self.reverse_multi_dict:
                    matches.update(self.reverse_multi_dict[k])
        for paren_m in re.findall(r"[\(\[]([^)\]]{2,20})[\)\]]", cleaned):
            p_key = _normalize_key(paren_m)
            if p_key in self.reverse_multi_dict:
                matches.update(self.reverse_multi_dict[p_key])
        if not matches:
            # Substring match for long conference proceedings titles containing a canonical conference phrase (>= 4 words)
            full_key = _expand_iso4_key(_normalize_key(cleaned))
            if any(w in full_key.split() for w in ("proceedings", "conference", "meeting", "symposium", "workshop")):
                for dict_key, full_set in self.reverse_multi_dict.items():
                    if len(dict_key.split()) >= 4 and dict_key in full_key:
                        matches.update(full_set)
        return matches

    def normalize(self, venue: str | None) -> str:
        """Trả canonical full name nếu biết (trong dict), else normalized lowercase."""
        if not venue:
            return ""
        cleaned = _strip_running_header(venue)
        key = _normalize_key(cleaned)
        if key in self.reverse_dict:
            return self.reverse_dict[key]
        # Try stripping 'Proceedings of (the)' or trailing parenthetical abbreviation e.g. '(NeurIPS)'
        no_parens = re.sub(r"\s*[\(\[][^\)\]]+[\)\]]\s*", " ", cleaned).strip()
        for cand_str in (no_parens, cleaned):
            cand_key = _normalize_key(cand_str)
            cand_no_proc = re.sub(
                r"^(?:in\s+)?(?:proceedings\s+of\s+(?:the\s+)?|proc\s+(?:of\s+(?:the\s+)?)?)(?:\d{4}\s+|\d+(?:st|nd|rd|th)\s+)*(?:annual\s+)?",
                "",
                cand_key,
            ).strip()
            for k in (cand_key, cand_no_proc, _expand_iso4_key(cand_key), _expand_iso4_key(cand_no_proc)):
                if k in self.reverse_dict:
                    return self.reverse_dict[k]
        for paren_m in re.findall(r"[\(\[]([^)\]]{2,20})[\)\]]", cleaned):
            p_key = _normalize_key(paren_m)
            if p_key in self.reverse_dict:
                return self.reverse_dict[p_key]
        cands = self._candidate_canonicals(cleaned)
        if len(cands) == 1:
            return next(iter(cands))
        # Try ISSN
        issn = _has_issn(cleaned)
        if issn:
            return f"<ISSN:{issn}>"
        # Fallback: just normalized form
        return key

    def similarity(self, v1: str | None, v2: str | None) -> float:
        """Tính 0–1 giữa 2 venue strings.

        Order:
            1. ISSN exact → 1.0
            2. Dict / multi-dict lookup → 1.0
            3. Normalized exact → 1.0
            4. Fuzzy (token_set_ratio) → 0–1
        """
        if not v1 or not v2:
            return 0.0
        # ISSN
        issn1, issn2 = _has_issn(v1), _has_issn(v2)
        if issn1 and issn2:
            return 1.0 if issn1 == issn2 else 0.0
        cands1 = self._candidate_canonicals(v1)
        cands2 = self._candidate_canonicals(v2)
        if cands1 and cands2 and (cands1 & cands2):
            return 1.0
        # Dict lookup
        norm1 = self.normalize(v1)
        norm2 = self.normalize(v2)
        if norm1 and norm2 and norm1 == norm2:
            return 1.0
        # Fuzzy (with ISO-4 expansion if neither resolved to a distinct known journal)
        if not (cands1 and cands2):
            exp1 = _expand_iso4_key(_normalize_key(v1))
            exp2 = _expand_iso4_key(_normalize_key(v2))
            base_sim = max(_fuzzy_token_set_ratio(norm1, norm2), _fuzzy_token_set_ratio(exp1, exp2))
            if base_sim < 0.85:
                s1_clean = re.sub(r"\s+\d{2,4}$", "", norm1).strip()
                s2_clean = re.sub(r"\s+\d{2,4}$", "", norm2).strip()
                short_s, long_s = (
                    (s1_clean, exp2) if len(s1_clean) <= len(s2_clean) else (s2_clean, exp1)
                )
                if re.fullmatch(r"[a-z]{3,7}", short_s):
                    stop_words = {
                        "in", "of", "the", "on", "for", "and", "at", "to", "a", "an", "with", "by",
                    }
                    content_words = [
                        w
                        for w in long_s.split()
                        if w.isalpha() and w not in stop_words
                    ]
                    initials = "".join(w[0] for w in content_words)
                    if len(content_words) >= len(short_s) and (
                        initials == short_s or initials.endswith(short_s)
                    ):
                        return 0.90
            return base_sim
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
        cands1 = self._candidate_canonicals(v1)
        cands2 = self._candidate_canonicals(v2)
        if cands1 and cands2 and (cands1 & cands2):
            shared = sorted(cands1 & cands2)[0]
            return VenueMatchResult(
                matched=True,
                score=1.0,
                method="dict",
                canonical=shared,
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
        fuzzy = self.similarity(v1, v2)
        return VenueMatchResult(
            matched=fuzzy >= thr,
            score=fuzzy,
            method="fuzzy",
            canonical=norm1 if fuzzy >= thr else "",
            evidence={"v1_norm": norm1, "v2_norm": norm2, "fuzzy": fuzzy},
        )
