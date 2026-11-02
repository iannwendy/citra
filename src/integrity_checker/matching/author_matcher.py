"""Author matching layer — v1.2 §3.6 (task #29).

Mục đích: Match ``Citation.authors`` (parsed từ PDF) với
``SourceCandidate.authors`` (raw strings từ scholarly APIs).

Vấn đề:
    - Citation.authors là ``list[Author]`` (last_name, initials, full_names).
    - SourceCandidate.authors là ``list[str]`` raw: "John Smith" hoặc "Smith, J."
      hoặc "J. K. Smith" — mỗi source API trả format khác nhau.
    - Citation.authors có thể là ``list[str]`` legacy (nếu parse fail).

Edge cases (theo §1.1 KNOWN_ISSUES):
    - "van der Berg, J." → last_name = "van der berg" (lowercase, multi-token).
    - "Smith J. K." → last_name = "smith" (no comma).
    - "J. K. Smith" → last_name = "smith" (no comma).
    - Vietnamese: "Nguyễn Bảo Minh" → "minh" (last token).
    - Diacritics: "Nguyễn" vs "Nguyen" (fold).

Solution:
    1. Normalize cả 2 sides về canonical form (lowercase, fold diacritics,
       strip particles).
    2. Compare canonical last-name tokens.
    3. Tính Jaccard-like score = |intersect| / |union| trên token sets.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Union

from integrity_checker.matching.author_parser import Author

# Multi-token particles (compound last names) — theo §1.1
# Note: "le" and "la" are French particles ("Le Pen") but also common Vietnamese/Asian
# standalone surnames ("Lê", "La"), so they are only stripped when followed by another token.
_PURE_PARTICLES = {
    "van", "de", "der", "von", "den", "das", "ten",
    "du", "di", "el", "al", "st", "st.",
}
_AMBIGUOUS_PARTICLES = {"le", "la"}
_PARTICLES = _PURE_PARTICLES | _AMBIGUOUS_PARTICLES
_GENERATIONAL_SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}

# Strip punctuation EXCEPT apostrophe (which joins words like O'Brien, D'Angelo, L’Engle)
_PUNCT_RE = re.compile(r"[^\w\s']", re.UNICODE)
# Remove apostrophes only when surrounded by whitespace (lone apostrophes)
_LONE_APOSTROPHE_RE = re.compile(r"\s'|'s\s|'s$|^'|'$", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+", re.UNICODE)
# Initial pattern: "J", "J.", "J.K." (case-sensitive for 2-letter undotted "JK")
_INITIAL_RE = re.compile(r"^[A-Za-z]\.?$|^[A-Za-z](?:\.[A-Za-z])+\.?$|^[A-Z]{2}$")


def _is_initial_token(raw_tok: str, all_caps_name: bool = False) -> bool:
    """Return True if raw_tok is a given-name initial (e.g. 'J', 'J.', 'J.K.', 'JK').

    Distinguishes 2-letter TitleCase surnames ('Ji', 'Yu', 'Su', 'Xu', 'Lo',
    'Li', 'Wu', 'He', 'Le', 'Vo', 'Ho', 'Do') from true initials ('J.', 'J.K.',
    or Vancouver all-caps 'JK').
    """
    tok = raw_tok.strip().strip(",;:")
    if not tok:
        return False
    if re.match(r"^[A-Za-z]\.?$", tok):
        return True
    if re.match(r"^[A-Za-z](?:\.[A-Za-z])+\.?$", tok):
        return True
    if not all_caps_name and re.match(r"^[A-Z]{2}$", tok):
        return True
    return False
# Concatenated CamelCase author token from OpenAlex/Crossref (e.g. "PedregosaFabian")
_CAMEL_AUTHOR_RE = re.compile(r"^([A-ZÀ-ÖØ-Þ][a-zà-ÿ]{2,})([A-ZÀ-ÖØ-Þ][a-zà-ÿ]+)$")
_SURNAME_PREFIXES = {
    "mac", "van", "von", "fitz", "del", "dal", "das", "dos",
    "las", "los", "san", "bin", "abu", "ben",
}


def _split_camel_author(name: str) -> str:
    """Split concatenated CamelCase 'LastFirst' (e.g. 'PedregosaFabian' -> 'Pedregosa, Fabian')."""
    stripped = name.strip()
    if " " not in stripped and "," not in stripped:
        m = _CAMEL_AUTHOR_RE.match(stripped)
        if m and m.group(1).lower() not in _SURNAME_PREFIXES:
            return f"{m.group(1)}, {m.group(2)}"
    return name


def _fold_diacritics(text: str) -> str:
    """Fold diacritics: 'Nguyễn' → 'Nguyen', 'Đặng' → 'Dang'.

    Dùng NFD + filter combining marks + Vietnamese Đ/đ replacement.
    """
    nfd = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _strip_punctuation(text: str) -> str:
    """Remove punctuation, keep apostrophes within words.

    E.g. "O'Brien" → "O'Brien" (preserved), "Smith, J." → "Smith  J ".
    """
    return _PUNCT_RE.sub(" ", text)


def _strip_leading_particles(tokens: list[str]) -> list[str]:
    """Strip leading surname particles while preserving standalone 'Le'/'La' surnames."""
    res = list(tokens)
    while res:
        head = res[0]
        if head in _PURE_PARTICLES or head in _AMBIGUOUS_PARTICLES and len(res) > 1:
            res.pop(0)
        else:
            break
    return res


def _canonicalize_last_name(name: str, *, fold_diacritics: bool = True) -> str:
    """Canonicalize last_name cho matching.

    Handles:
        - Comma-split (APA / Chicago): "Smith, J." → last_name = "smith"
        - No-comma (IEEE): "J. K. Smith" → last_name = "smith"
        - Multi-word: "van der Berg" → "berg" (strip leading particles)
        - Vietnamese: "Nguyễn Bảo Minh" → "minh" (last token if no comma)
        - Diacritics: "Nguyễn" → "nguyen", "Đặng" → "dang", "Lê, L." → "le"

    Returns:
        Canonical last_name (lowercase, no diacritics, no particles).
    """
    if not name:
        return ""
    name = name.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'")
    name = _split_camel_author(name)
    has_comma = "," in name

    if has_comma:
        # APA-like: "Smith, J." or "van der Berg, J." or "Pouget-Abadie, J."
        surname_part = name.split(",", 1)[0]
        s = (_fold_diacritics(surname_part) if fold_diacritics else surname_part).lower()
        s = _strip_punctuation(s)
        s = _LONE_APOSTROPHE_RE.sub(" ", s)
        s = _WHITESPACE_RE.sub(" ", s).strip()
        if not s:
            return ""
        tokens = _strip_leading_particles(s.split())
        while len(tokens) > 1 and tokens[-1] in _GENERATIONAL_SUFFIXES:
            tokens.pop()
        if not tokens:
            return ""
        return tokens[-1]

    # No comma: take LAST non-initial token
    # E.g. "Smith J. K." → ["smith", "j", "k"] → "smith" (last non-initial)
    # E.g. "J. K. Smith" → ["j", "k", "smith"] → "smith" (also last)
    # E.g. "John Smith" → ["john", "smith"] → "smith"
    # E.g. "Ziwei Ji" → ["ziwei", "ji"] → "ji" (2-letter TitleCase surname preserved)
    raw_folded = _fold_diacritics(name) if fold_diacritics else name
    alpha_chars = [c for c in raw_folded if c.isalpha()]
    all_caps_name = bool(alpha_chars) and all(c.isupper() for c in alpha_chars)
    raw_tokens = raw_folded.split()
    while len(raw_tokens) > 1 and raw_tokens[-1].lower().strip(".,;:") in _GENERATIONAL_SUFFIXES:
        raw_tokens.pop()

    # Strip leading particles first
    while raw_tokens:
        first_clean = _WHITESPACE_RE.sub(
            " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(raw_tokens[0].lower()))
        ).strip()
        if first_clean in _PURE_PARTICLES:
            raw_tokens.pop(0)
        elif first_clean in _AMBIGUOUS_PARTICLES and len(raw_tokens) > 1:
            # Check if remaining tokens have at least one non-initial token
            has_other_surname = any(
                not _is_initial_token(rt, all_caps_name=all_caps_name)
                for rt in raw_tokens[1:]
            )
            if has_other_surname:
                raw_tokens.pop(0)
            else:
                break
        else:
            break
    if not raw_tokens:
        return ""

    # Find last token that's NOT an initial
    last_non_initial = ""
    fallback_tokens: list[str] = []
    for rt in raw_tokens:
        ct = _WHITESPACE_RE.sub(
            " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(rt.lower()))
        ).strip()
        if not ct:
            continue
        ct_parts = ct.split()
        fallback_tokens.extend(ct_parts)
        if not _is_initial_token(rt, all_caps_name=all_caps_name):
            last_non_initial = ct_parts[-1]
    # If all are initials, fallback to last token
    return last_non_initial if last_non_initial else (fallback_tokens[-1] if fallback_tokens else "")


def _author_to_last_name(author: Author | str, *, fold_diacritics: bool = True) -> str:
    """Extract last_name string từ Author or str.

    Args:
        author: Author object (with last_name) hoặc raw string "John Smith".

    Returns:
        Canonical last_name (lowercase, no diacritics, no particles).
        Empty string nếu không extract được.
    """
    if isinstance(author, Author):
        last_name = author.last_name or ""
    else:
        # String — use _canonicalize_last_name directly (more reliable than
        # normalize_author for ambiguous cases like "Alice Doe" where VN
        # heuristic incorrectly takes first token).
        last_name = str(author)
    return _canonicalize_last_name(last_name, fold_diacritics=fold_diacritics)


def _to_last_name_set(authors: list, *, fold_diacritics: bool = True) -> set[str]:
    """Convert list[Author|str] → set[canonical last_name]."""
    result: set[str] = set()
    for a in authors:
        ln = _author_to_last_name(a, fold_diacritics=fold_diacritics)
        if ln:
            result.add(ln)
    return result


def _extract_author_signature(
    author: Author | str, *, fold_diacritics: bool = True
) -> tuple[str, list[str], set[str]]:
    """Extract (primary_last_name, full_word_tokens, initial_letters) for East-Asian/swapped matching."""
    primary = _author_to_last_name(author, fold_diacritics=fold_diacritics)
    if isinstance(author, Author) or hasattr(author, "last_name"):
        raw_attr = getattr(author, "raw", "") or ""
        if isinstance(raw_attr, str) and raw_attr.strip():
            raw_str = raw_attr
        else:
            raw_parts: list[str] = []
            for attr_name in ("last_name", "first_name", "middle_name", "full_first_names", "initials"):
                val = getattr(author, attr_name, None)
                if not val:
                    continue
                if isinstance(val, (list, tuple, set)):
                    raw_parts.extend(str(item) for item in val if item)
                else:
                    raw_parts.append(str(val))
            raw_str = " ".join(raw_parts)
    else:
        raw_str = str(author or "")

    folded = _fold_diacritics(raw_str) if fold_diacritics else raw_str
    cleaned = _WHITESPACE_RE.sub(
        " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(folded.lower()))
    ).strip()
    tokens = [
        t for t in cleaned.split()
        if t not in _GENERATIONAL_SUFFIXES and t not in _PURE_PARTICLES
    ]
    full_tokens = [t for t in tokens if len(t) >= 2]
    initials = {t[0] for t in tokens if t}
    return primary, full_tokens, initials


def _is_swapped_author_match(
    sig_a: tuple[str, list[str], set[str]],
    sig_b: tuple[str, list[str], set[str]],
) -> bool:
    """Return True if two author signatures represent the same person with swapped Given/Family order.

    Examples:
        - "Wei, G." (primary='wei', full=['wei'], initials={'w','g'})
          vs "Wei Guodong" (primary='guodong', full=['wei','guodong'], initials={'w','g'})
        - "Guodong, W." (primary='guodong', full=['guodong'], initials={'g','w'})
          vs "Guodong Wei" (primary='wei', full=['guodong','wei'], initials={'g','w'})
        - "Wei, Guodong" vs "Guodong, Wei"
    """
    prim_a, full_a, init_a = sig_a
    prim_b, full_b, init_b = sig_b
    if not prim_a or not prim_b:
        return False
    if prim_a == prim_b:
        return True

    # Case 1: Both have >= 2 full tokens and share the exact same 2-token set (e.g. {"wei", "guodong"})
    if len(full_a) >= 2 and len(full_b) >= 2 and set(full_a) == set(full_b):
        return True

    # Case 2: One side has primary surname + initial(s), and the other side has 2+ full tokens
    # where one full token == primary surname and another full token starts with the given initial
    def _check_one_way(
        prim_1: str, full_1: list[str], init_1: set[str], full_2: list[str]
    ) -> bool:
        if len(full_2) < 2 or prim_1 not in full_2:
            return False
        other_tokens_2 = [t for t in full_2 if t != prim_1]
        if not other_tokens_2:
            return False
        given_inits_1 = init_1 - {prim_1[0]}
        if given_inits_1:
            return any(t[0] in given_inits_1 for t in other_tokens_2)
        # If the given name starts with the same letter as the surname (e.g. "Wang, W." vs "Wang Wei"),
        # accept when side 1 had a single full surname token and side 2 has another token with that same initial.
        if len(full_1) == 1 and any(t[0] == prim_1[0] for t in other_tokens_2):
            return True
        return False

    if _check_one_way(prim_a, full_a, init_a, full_b):
        return True
    if _check_one_way(prim_b, full_b, init_b, full_a):
        return True
    return False


_CORP_KEYWORDS = {
    "organization", "organisation", "association", "institute", "institution",
    "institutes", "institutions", "ministry", "ministries", "department", "departments",
    "commission", "committee", "council", "agency", "agencies", "foundation",
    "society", "federation", "university", "universities", "college", "academy",
    "academies", "center", "centers", "centre", "centres", "bureau", "bank",
    "nations", "group", "consortium", "collaboration", "union", "board", "office",
    "administration", "authority", "health", "control", "services",
    "bo", "so", "uy", "chinh", "quoc", "toa", "vien", "truong", "to", "hiep",
    "ngan", "tong", "cuc",
}
_CORP_STOPWORDS = {
    "the", "of", "for", "and", "in", "on", "to", "at", "by", "with", "from",
    "va", "cua", "ve", "cac", "tai", "trong",
}


def _extract_corporate_keys(author: Author | str, *, fold_diacritics: bool = True) -> set[str]:
    """Extract normalized corporate/institutional keys and initialisms (e.g. 'World Health Organization' <-> 'who')."""
    if isinstance(author, Author) or hasattr(author, "last_name"):
        raw_str = getattr(author, "raw", "") or getattr(author, "last_name", "") or ""
    else:
        raw_str = str(author or "")
    raw_str = raw_str.strip()
    if not raw_str:
        return set()

    keys: set[str] = set()
    # Explicit parenthesized or bracketed acronym: "World Health Organization (WHO)" -> "who"
    for acr in re.findall(r"[\(\[]([A-Za-zĐđ]{2,12})[\)\]]", raw_str):
        keys.add((_fold_diacritics(acr) if fold_diacritics else acr).lower())

    no_parens = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", raw_str).strip()
    folded = _fold_diacritics(no_parens) if fold_diacritics else no_parens
    alpha_only = re.sub(r"[^A-Za-z0-9\s]", " ", folded)
    words = [w for w in alpha_only.split() if w]
    if not words:
        return keys

    # Single all-caps acronym token (e.g. "WHO", "UNESCO", "UNICEF", "IEEE", "OECD", "NIMH")
    if len(words) == 1 and 2 <= len(words[0]) <= 10 and (words[0].isupper() or raw_str.isupper()):
        keys.add(words[0].lower())
        return keys

    lower_words = [w.lower() for w in words]
    if any(w in _CORP_KEYWORDS for w in lower_words):
        sig_words = [w for w in lower_words if w not in _CORP_STOPWORDS]
        if sig_words:
            keys.add(" ".join(sig_words))
            if len(sig_words) >= 2:
                keys.add("".join(w[0] for w in sig_words))
                # Also add initialism without trailing generic word if 4+ words (e.g. "Centers for Disease Control and Prevention" -> "cdc")
                if len(sig_words) >= 4:
                    keys.add("".join(w[0] for w in sig_words[:-1]))
    return keys


def author_match_score(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
) -> float:
    """Tính similarity score giữa 2 author lists.

    FIX v1.11: Improved handling for first-author-only citations.
    When citation has 1 author but candidate has many, we check if the
    first author matches any candidate author (common in short citations
    like "Settles, B (2012)").
    FIX Phase 3 (BUG-21): Handles East Asian swapped Given/Family name order
    (e.g. "Wei, G." vs "Wei Guodong" or "Guodong, W." vs "Guodong Wei").
    """
    cited_set = _to_last_name_set(cited, fold_diacritics=fold_diacritics)
    cand_set = _to_last_name_set(candidate, fold_diacritics=fold_diacritics)
    if not cited_set or not cand_set:
        return 0.0

    # Augment cand_set with any swapped East-Asian / 2-token matches
    if not (cited_set <= cand_set):
        cited_sigs = [_extract_author_signature(a, fold_diacritics=fold_diacritics) for a in cited]
        cand_sigs = [_extract_author_signature(b, fold_diacritics=fold_diacritics) for b in candidate]
        for sig_c in cited_sigs:
            prim_c = sig_c[0]
            if prim_c and prim_c not in cand_set:
                if any(_is_swapped_author_match(sig_c, sig_b) for sig_b in cand_sigs):
                    cand_set.add(prim_c)
        # Check corporate / institutional acronym & full-name equivalence (e.g. "WHO" <-> "World Health Organization")
        for a in cited:
            prim_c = _author_to_last_name(a, fold_diacritics=fold_diacritics)
            if not prim_c or prim_c in cand_set:
                continue
            c_corp = _extract_corporate_keys(a, fold_diacritics=fold_diacritics)
            if c_corp:
                for b in candidate:
                    b_corp = _extract_corporate_keys(b, fold_diacritics=fold_diacritics)
                    if c_corp & b_corp:
                        cand_set.add(prim_c)
                        break

    # FIX v1.11: If all cited authors are present in the candidate's author list
    # (e.g., "Settles, B" or "Pedregosa, Varoquaux, Gramfort, et al." on a 16-author paper),
    # treat as full author match.
    if cited_set <= cand_set:
        return 1.0  # Exact subset match (et al. truncation)
    if len(cand_set) == 1 and cand_set <= cited_set and cited:
        first_cited = _author_to_last_name(cited[0], fold_diacritics=fold_diacritics)
        if first_cited and first_cited in cand_set:
            return 1.0  # Cited entry also listed editors/introducers alongside primary author

    intersect = len(cited_set & cand_set)
    # Fallback: check prefix/suffix/apostrophe match for compound tokens (len >= 5)
    if intersect == 0:
        prefix_matches = sum(
            1
            for ca in cited_set
            if len(ca) >= 4
            and any(
                len(cb) >= 4
                and (
                    ca.replace("'", "") == cb.replace("'", "")
                    or (len(ca) >= 5 and len(cb) >= 5 and (ca.startswith(cb) or cb.startswith(ca) or ca.endswith(cb) or cb.endswith(ca)))
                )
                for cb in cand_set
            )
        )
        if prefix_matches > 0:
            return prefix_matches / len(cited_set)
        return 0.0
    union = len(cited_set | cand_set)
    return intersect / union if union else 0.0


def author_match_details(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
) -> AuthorMatchResult:
    """Trả về chi tiết match (để debug/log).

    Args:
        cited: Citation.authors.
        candidate: SourceCandidate.authors.

    Returns:
        AuthorMatchResult với:
            - score: 0.0–1.0
            - matched: list[last_name] chung
            - only_cited: list[last_name] chỉ có ở cited
            - only_candidate: list[last_name] chỉ có ở candidate
    """
    cited_set = _to_last_name_set(cited, fold_diacritics=fold_diacritics)
    cand_set = _to_last_name_set(candidate, fold_diacritics=fold_diacritics)
    matched = sorted(cited_set & cand_set)
    only_cited = sorted(cited_set - cand_set)
    only_cand = sorted(cand_set - cited_set)
    score = (
        author_match_score(cited, candidate, fold_diacritics=fold_diacritics)
        if (cited_set and cand_set)
        else 0.0
    )
    return AuthorMatchResult(
        score=score,
        matched=matched,
        only_cited=only_cited,
        only_candidate=only_cand,
    )


# --- Result dataclass ---

from dataclasses import dataclass, field  # noqa: E402


@dataclass
class AuthorMatchResult:
    """Output chi tiết của author_match_details() — cho debug/log."""

    score: float = 0.0
    matched: list[str] = field(default_factory=list)
    only_cited: list[str] = field(default_factory=list)
    only_candidate: list[str] = field(default_factory=list)

    def summary(self) -> str:
        """One-line summary cho log."""
        return (
            f"score={self.score:.2f} "
            f"matched={self.matched} "
            f"only_cited={self.only_cited} "
            f"only_candidate={self.only_candidate}"
        )
