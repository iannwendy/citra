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

_ET_AL_MARKER_RE = re.compile(
    r"(?:\bet\s+al\.?(?:\b|$)|\bvà\s+cộng\s+sự\b|\bvà\s+cs\.?(?:\b|$)"
    r"|(?:^|[\s,;(\[])cs\.(?=\s|$|[),;\]])|\bvà\s+ctv\.?(?:\b|$)"
    r"|\band\s+others\b|\bothers\b"
    r"|(?:\.\s*\.\s*\.|…)\s*(?:&|\band\b|[A-ZÀ-ÖØ-ÞĐ])|^\s*(?:\.\s*\.\s*\.|…)\s*$)",
    re.IGNORECASE,
)
_ET_AL_STRIP_RE = re.compile(
    r",?\s*(?:\bet\s+al\.?(?:\b|$)|\bvà\s+cộng\s+sự\b|\bvà\s+cs\.?(?:\b|$)"
    r"|(?:^|[\s,;])cs\.(?=\s|$|[,;])|\bvà\s+ctv\.?(?:\b|$)"
    r"|\band\s+others\b|,\s*others\b|^\s*others\s*$).*$",
    re.IGNORECASE,
)
_LEADING_ELLIPSIS_RE = re.compile(r"^\s*(?:\.\s*\.\s*\.|…)\s*(?:&|\band\b)?\s*", re.IGNORECASE)

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
    cleaned = re.sub(r"[\u00b4\u00a8\u02c6\u02dc\u02c7\u02d8\u02d9\u02dd](?=[A-Za-z])", "", text)
    nfd = unicodedata.normalize("NFD", cleaned.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _strip_punctuation(text: str) -> str:
    """Remove punctuation, keep apostrophes within words.

    E.g. "O'Brien" → "O'Brien" (preserved), "Smith, J." → "Smith  J ".
    """
    return _PUNCT_RE.sub(" ", text)


def _strip_leading_particles(tokens: list[str]) -> list[str]:
    """Strip leading surname particles while preserving standalone surnames ('Du', 'Das', 'El', 'Le', 'La', 'Van', 'De', 'Di').

    Multi-token all-particle fragments (e.g. 'van der') still return [] so incomplete particle-only
    strings do not match real surnames.
    """
    if not tokens:
        return []
    if len(tokens) >= 2 and all(t in _PARTICLES for t in tokens):
        return []
    res = list(tokens)
    while len(res) > 1 and res[0] in _PARTICLES:
        res.pop(0)
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
    name = _LEADING_ELLIPSIS_RE.sub("", name)
    name = _ET_AL_STRIP_RE.sub("", name).strip().rstrip(",;:")
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

    # Multi-token all-particle fragments (e.g. "van der") have no real surname token
    cleaned_no_comma = [
        _WHITESPACE_RE.sub(
            " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(rt.lower()))
        ).strip()
        for rt in raw_tokens
    ]
    non_empty_cleaned = [c for c in cleaned_no_comma if c]
    if len(non_empty_cleaned) >= 2 and all(c in _PARTICLES for c in non_empty_cleaned):
        return ""

    # Strip leading particles ONLY when followed by a real non-initial, non-particle surname token
    # (preserves standalone Asian/European surnames like "Du Y.", "Das S.", "El B.", "Le L.").
    while len(raw_tokens) > 1:
        first_clean = _WHITESPACE_RE.sub(
            " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(raw_tokens[0].lower()))
        ).strip()
        if first_clean in _PARTICLES:
            has_other_surname = any(
                (
                    _WHITESPACE_RE.sub(
                        " ", _LONE_APOSTROPHE_RE.sub(" ", _strip_punctuation(rt.lower()))
                    ).strip()
                    not in _PARTICLES
                )
                and not _is_initial_token(rt, all_caps_name=all_caps_name)
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
    raw_toks_clean = [t for t in cleaned.split() if t and t not in _GENERATIONAL_SUFFIXES]
    # Preserve standalone/2-token surnames like "Du, Y.", "Du Yu", "Das Sayan", "Batu El"
    # while still dropping leading nobiliary particles in 3+-token compound names ("J. van der Berg").
    if len(raw_toks_clean) >= 3:
        tokens = [
            t
            for idx_t, t in enumerate(raw_toks_clean)
            if t not in _PURE_PARTICLES or idx_t == len(raw_toks_clean) - 1
        ] or raw_toks_clean
    else:
        tokens = raw_toks_clean
    full_tokens = [t for t in tokens if len(t) >= 2]
    initials = {t[0] for t in tokens if t}
    return primary, full_tokens, initials


def _extract_single_letter_patronymic_info(
    author: Author | str, *, fold_diacritics: bool = True
) -> tuple[str, str, str]:
    """Extract (mode, single_letter_surname, given_initial) for South Asian / Hungarian patronymics.

    Handles APA-inverted single-letter surnames vs. uninverted given-first names:
        - "B, P." / "V, V." / "T., I." -> ("comma_single", "b"/"v"/"t", "p"/"v"/"i")
        - "Premjith B" / "Venktesh V" / "Prasanth S N" / "István Nagy T."
          -> ("trailing_initial", "b"/"v"/"n"/"t", "p"/"v"/"p"/"i")

    Strictly returns ("", "", "") when:
        - comma-formatted surname has length != 1 (e.g. "Smith, J.") or lacks a given initial
        - no-comma form does not end with a standalone single-letter uppercase token (e.g. "John Smith").
    """
    raw_str = ""
    if isinstance(author, Author) or hasattr(author, "last_name"):
        raw_attr = getattr(author, "raw", "") or ""
        if isinstance(raw_attr, str) and raw_attr.strip():
            raw_str = raw_attr.strip()
        else:
            ln_raw = str(getattr(author, "last_name", "") or "").strip()
            inits_raw = getattr(author, "initials", None) or []
            fn_raw = str(getattr(author, "first_name", "") or "").strip()
            ln_clean = re.sub(r"[^A-Za-z]", "", _fold_diacritics(ln_raw) if fold_diacritics else ln_raw)
            if len(ln_clean) == 1:
                g_src = str(inits_raw[0]) if inits_raw else fn_raw
                g_letters = re.findall(r"[A-Za-z]", _fold_diacritics(g_src) if fold_diacritics else g_src)
                if g_letters:
                    return ("comma_single", ln_clean.lower(), g_letters[0].lower())
                return ("", "", "")
            if (
                len(ln_clean) >= 2
                and inits_raw
                and not getattr(author, "full_first_names", None)
            ):
                last_init = re.sub(r"[^A-Za-z]", "", str(inits_raw[-1]))
                if len(last_init) == 1:
                    return ("trailing_initial", last_init.lower(), ln_clean[0].lower())
            return ("", "", "")
    else:
        raw_str = str(author or "").strip()

    if not raw_str:
        return ("", "", "")
    cleaned_raw = _ET_AL_STRIP_RE.sub("", _LEADING_ELLIPSIS_RE.sub("", raw_str)).strip().rstrip(",;:")
    if not cleaned_raw:
        return ("", "", "")

    if "," in cleaned_raw:
        sur_part, rest_part = cleaned_raw.split(",", 1)
        sur_folded = _fold_diacritics(sur_part) if fold_diacritics else sur_part
        sur_alpha = re.sub(r"[^A-Za-z]", "", sur_folded)
        if len(sur_alpha) != 1:
            return ("", "", "")
        rest_folded = _fold_diacritics(rest_part) if fold_diacritics else rest_part
        rest_alpha = re.findall(r"[A-Za-z]", rest_folded)
        if not rest_alpha:
            return ("", "", "")
        return ("comma_single", sur_alpha.lower(), rest_alpha[0].lower())

    # No-comma form: inspect raw tokens BEFORE generational-suffix stripping so "Venktesh V" preserves "V"
    raw_toks = [t.strip(",;:") for t in cleaned_raw.split() if t.strip(",;:")]
    if len(raw_toks) < 2:
        return ("", "", "")
    last_tok = raw_toks[-1]
    if not re.fullmatch(r"[A-Z]\.?", last_tok):
        return ("", "", "")
    # Require at least one full word (>= 2 letters) before trailing initial(s)
    lead_tokens_folded = [
        re.sub(r"[^A-Za-z]", "", _fold_diacritics(t) if fold_diacritics else t)
        for t in raw_toks[:-1]
    ]
    full_lead = [t for t in lead_tokens_folded if len(t) >= 2]
    if not full_lead:
        return ("", "", "")
    first_alpha = lead_tokens_folded[0][0].lower() if lead_tokens_folded[0] else full_lead[0][0].lower()
    return ("trailing_initial", last_tok[0].lower(), first_alpha)


def _is_single_letter_patronymic_match(
    a: Author | str,
    b: Author | str,
    *,
    fold_diacritics: bool = True,
) -> bool:
    """Return True when one author is comma-formatted 'X, Y.' (1-letter surname) and the other is 'Y... X'."""
    if _has_vietnamese_conflict(a, b):
        return False
    mode_a, sur_a, init_a = _extract_single_letter_patronymic_info(a, fold_diacritics=fold_diacritics)
    if not mode_a:
        return False
    mode_b, sur_b, init_b = _extract_single_letter_patronymic_info(b, fold_diacritics=fold_diacritics)
    if not mode_b or mode_a == mode_b:
        return False
    return sur_a == sur_b and init_a == init_b


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
            other_inits_2 = {t[0] for t in other_tokens_2 if t}
            if len(given_inits_1) >= 2 and len(other_tokens_2) >= 2:
                return given_inits_1 <= other_inits_2
            return bool(given_inits_1 & other_inits_2)
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


_VN_FAMILY_NAMES_FOLDED = frozenset({
    "nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo",
    "dang", "bui", "do", "ho", "ngo", "duong", "ly", "dao", "dinh",
    "trinh", "mai", "truong", "chau", "doan", "to", "tang", "ha", "ta",
    "luong", "lam", "phung", "quach", "diep", "ton", "thach", "luu", "dam",
})


def _extract_raw_author_str(author: Author | str) -> str:
    if isinstance(author, Author) or hasattr(author, "last_name"):
        raw_attr = getattr(author, "raw", "") or ""
        if isinstance(raw_attr, str) and raw_attr.strip():
            return raw_attr.strip()
        return str(getattr(author, "last_name", "") or "").strip()
    return str(author or "").strip()


def _has_vietnamese_conflict(a: Author | str, b: Author | str) -> bool:
    """Detect false-positive matches between distinct Vietnamese names.

    Catches:
    1. Conflicting explicit Vietnamese diacritics on the same folded token
       (e.g. 'Nguyễn' vs 'Nguyên', 'Đỗ' vs 'Độ'), while still allowing
       diacritic vs ASCII OCR-stripped matches ('Nguyễn' vs 'Nguyen').
    2. Full Vietnamese names sharing the same given name (last token)
       but having different family names (first token), e.g.
       'Nguyễn Văn An' vs 'Trần Văn An' or 'Đỗ Văn An' vs 'Đào Văn An'.
    """
    raw_a = unicodedata.normalize("NFC", _extract_raw_author_str(a)).lower()
    raw_b = unicodedata.normalize("NFC", _extract_raw_author_str(b)).lower()
    if not raw_a or not raw_b:
        return False

    toks_a = [t for t in re.split(r"[^\w]+", raw_a) if len(t) >= 2]
    toks_b = [t for t in re.split(r"[^\w]+", raw_b) if len(t) >= 2]
    for ta in toks_a:
        fa = _fold_diacritics(ta)
        if ta == fa:
            continue
        for tb in toks_b:
            fb = _fold_diacritics(tb)
            if tb == fb:
                continue
            if fa == fb and ta != tb:
                return True

    sig_a = _extract_author_signature(a, fold_diacritics=True)
    sig_b = _extract_author_signature(b, fold_diacritics=True)
    prim_a, full_a, _ = sig_a
    prim_b, full_b, _ = sig_b
    if (
        prim_a
        and prim_a == prim_b
        and len(full_a) >= 2
        and len(full_b) >= 2
        and set(full_a) != set(full_b)
    ):
        if (
            (full_a[0] in _VN_FAMILY_NAMES_FOLDED or full_b[0] in _VN_FAMILY_NAMES_FOLDED)
            and full_a[0] != full_b[0]
            and prim_a not in {full_a[0], full_b[0]}
        ):
            return True

    return False


_CORP_KEYWORDS = {
    "organization", "organisation", "association", "institute", "institution",
    "institutes", "institutions", "ministry", "ministries", "department", "departments",
    "commission", "committee", "council", "agency", "agencies", "foundation",
    "society", "federation", "university", "universities", "college", "academy",
    "academies", "center", "centers", "centre", "centres", "bureau", "bank",
    "nations", "group", "consortium", "collaboration", "union", "board", "office",
    "administration", "authority", "health", "control", "services", "statistics",
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
    for acr in re.findall(r"[\(\[]([A-Za-zĐđ&]{2,12})[\)\]]", raw_str):
        clean_acr = re.sub(r"[^A-Za-zĐđ]", "", acr)
        if len(clean_acr) >= 2:
            keys.add((_fold_diacritics(clean_acr) if fold_diacritics else clean_acr).lower())

    no_parens = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", raw_str).strip()
    folded = _fold_diacritics(no_parens) if fold_diacritics else no_parens
    alpha_only = re.sub(r"[^A-Za-z0-9\s]", " ", folded)
    words = [w for w in alpha_only.split() if w]
    if not words:
        return keys

    # Single all-caps acronym token (e.g. "WHO", "UNESCO", "UNICEF", "IEEE", "OECD", "NIMH", "BGD&ĐT")
    if all(w.isupper() for w in words):
        joined_caps = "".join(w.lower() for w in words)
        if 2 <= len(joined_caps) <= 12:
            keys.add(joined_caps)
        if len(words) == 1:
            return keys

    lower_words = [w.lower() for w in words]
    if any(w in _CORP_KEYWORDS for w in lower_words):
        sig_pairs = [(w, w.lower()) for w in words if w.lower() not in _CORP_STOPWORDS]
        sig_words = [lw for _, lw in sig_pairs]
        if sig_words:
            keys.add(" ".join(sig_words))
            if len(sig_words) >= 2:
                keys.add("".join( lw if (len(orig) >= 2 and orig.isupper()) else lw[0] for orig, lw in sig_pairs ))
                keys.add("".join(w[0] for w in sig_words))
                # Also add initialism without trailing generic/country word if 4+ words (e.g. "Centers for Disease Control and Prevention" -> "cdc", "General Statistics Office of Vietnam" -> "gso")
                if len(sig_words) >= 4:
                    keys.add("".join(w[0] for w in sig_words[:-1]))
                if sig_words[0] in {"bo", "so", "uy", "tong"} and len(sig_pairs) >= 3:
                    keys.add("".join(lw if (len(orig) >= 2 and orig.isupper()) else lw[0] for orig, lw in sig_pairs[1:]))
    return keys


def _has_et_al_indicator(authors_or_text: list | str | None, *, has_et_al: bool = False) -> bool:
    """Return True if has_et_al is True or any author string/object contains an et al. marker."""
    if has_et_al:
        return True
    if not authors_or_text:
        return False
    items = [authors_or_text] if isinstance(authors_or_text, str) else list(authors_or_text)
    for item in items:
        if isinstance(item, Author) or hasattr(item, "last_name"):
            raw_val = f"{getattr(item, 'raw', '') or ''} {getattr(item, 'last_name', '') or ''}"
        else:
            raw_val = str(item or "")
        if raw_val and _ET_AL_MARKER_RE.search(raw_val):
            return True
    return False


def _first_author_matches(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
) -> bool:
    """Return True if the cited first author matches the candidate's first author."""
    first_c = None
    first_c_ln = ""
    for a in cited:
        ln = _author_to_last_name(a, fold_diacritics=fold_diacritics)
        if ln:
            first_c = a
            first_c_ln = ln
            break
    first_cand = None
    first_cand_ln = ""
    for b in candidate:
        ln = _author_to_last_name(b, fold_diacritics=fold_diacritics)
        if ln:
            first_cand = b
            first_cand_ln = ln
            break
    if not first_c_ln or not first_cand_ln or first_c is None or first_cand is None:
        return False
    if _has_vietnamese_conflict(first_c, first_cand):
        return False
    if first_c_ln == first_cand_ln:
        return True
    if _is_swapped_author_match(
        _extract_author_signature(first_c, fold_diacritics=fold_diacritics),
        _extract_author_signature(first_cand, fold_diacritics=fold_diacritics),
    ):
        return True
    if _is_single_letter_patronymic_match(first_c, first_cand, fold_diacritics=fold_diacritics):
        return True
    c_corp = _extract_corporate_keys(first_c, fold_diacritics=fold_diacritics)
    cand_corp = _extract_corporate_keys(first_cand, fold_diacritics=fold_diacritics)
    if c_corp and cand_corp and (c_corp & cand_corp):
        return True
    return False


def _resolve_author_alignment(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
    has_et_al: bool = False,
) -> tuple[float, set[str], set[str]]:
    """Shared reconciled alignment engine for both author_match_score() and author_match_details().

    Returns (score, cited_set, reconciled_cand_set) where swapped East-Asian, South-Asian
    single-letter patronymic, and corporate matches add the cited canonical key into
    reconciled_cand_set and replace the consumed candidate key when unique so
    author_match_details().only_cited / only_candidate stay 100% consistent with score.
    """
    cited_set = _to_last_name_set(cited, fold_diacritics=fold_diacritics)
    cand_set = _to_last_name_set(candidate, fold_diacritics=fold_diacritics)
    if not cited_set or not cand_set:
        return 0.0, cited_set, cand_set

    # Remove false-positive canonical last-name collisions caused by conflicting Vietnamese diacritics
    # (e.g. "Nguyễn" vs "Nguyên") or distinct Vietnamese family names sharing a given name
    # (e.g. "Nguyễn Văn An" vs "Trần Văn An", "Đỗ Văn An" vs "Đào Văn An").
    if fold_diacritics and (cited_set & cand_set):
        for idx_c, shared_ln in enumerate(list(cited_set & cand_set)):
            c_matching = [a for a in cited if _author_to_last_name(a, fold_diacritics=True) == shared_ln]
            b_matching = [b for b in candidate if _author_to_last_name(b, fold_diacritics=True) == shared_ln]
            if c_matching and b_matching and all(
                _has_vietnamese_conflict(ca, cb) for ca in c_matching for cb in b_matching
            ):
                cand_set.discard(shared_ln)
                cand_set.add(f"__vn_conflict_{idx_c}__")

    effective_has_et_al = _has_et_al_indicator(cited, has_et_al=has_et_al)
    consumed_cand_keys: set[str] = set()

    # 1-to-1 candidate claiming prevents 2-to-1 collapse (e.g. ["Du, Y.", "Yu, D."] vs ["Du Yu"])
    # and ensures shared-surname pairs (e.g. ["B, P.", "B, S."] vs ["Premjith B", "Suresh B"])
    # reconcile distinct candidate tokens cleanly without leaking into only_candidate.
    cited_sigs = [(a, _extract_author_signature(a, fold_diacritics=fold_diacritics)) for a in cited]
    cand_sigs = [(b, _extract_author_signature(b, fold_diacritics=fold_diacritics)) for b in candidate]
    used_cited_indices: set[int] = set()
    used_cand_indices: set[int] = set()
    direct_matched_keys: set[str] = set()

    for idx_a, (a_obj, sig_c) in enumerate(cited_sigs):
        prim_c = sig_c[0]
        if not prim_c or prim_c not in cand_set:
            continue
        for idx_b, (b_obj, sig_b) in enumerate(cand_sigs):
            if idx_b in used_cand_indices:
                continue
            if sig_b[0] == prim_c and not _has_vietnamese_conflict(a_obj, b_obj):
                used_cited_indices.add(idx_a)
                used_cand_indices.add(idx_b)
                direct_matched_keys.add(prim_c)
                break

    # Augment cand_set with 1-to-1 swapped East-Asian, single-letter patronymic, and corporate matches
    if len(used_cited_indices) < len(cited_sigs):
        for idx_a, (a_obj, sig_c) in enumerate(cited_sigs):
            if idx_a in used_cited_indices or not sig_c[0]:
                continue
            prim_c = sig_c[0]
            for idx_b, (b_obj, sig_b) in enumerate(cand_sigs):
                if idx_b in used_cand_indices:
                    continue
                if not _has_vietnamese_conflict(a_obj, b_obj) and (
                    _is_swapped_author_match(sig_c, sig_b)
                    or _is_single_letter_patronymic_match(
                        a_obj, b_obj, fold_diacritics=fold_diacritics
                    )
                ):
                    used_cited_indices.add(idx_a)
                    used_cand_indices.add(idx_b)
                    cand_set.add(prim_c)
                    if sig_b[0] and sig_b[0] not in direct_matched_keys:
                        still_unclaimed_same_key = any(
                            j not in used_cand_indices and cand_sigs[j][1][0] == sig_b[0]
                            for j in range(len(cand_sigs))
                        )
                        if not still_unclaimed_same_key:
                            consumed_cand_keys.add(sig_b[0])
                    break
        # Systematic East-Asian GivenName, SurnameInitial <-> Surname, GivenInitial across >=2 co-authors
        if len(cited_sigs) >= 2 and len(cand_sigs) >= 2:
            mutual_pairs: list[tuple[int, int, str, str]] = []
            tentative_b: set[int] = set(used_cand_indices)
            for idx_a, (a_obj, (prim_c, full_c, init_c)) in enumerate(cited_sigs):
                if idx_a in used_cited_indices or not prim_c or prim_c in cand_set or len(full_c) != 1:
                    continue
                given_c = init_c - {prim_c[0]}
                if len(given_c) != 1:
                    continue
                for idx_b, (b_obj, (prim_b, full_b, init_b)) in enumerate(cand_sigs):
                    if idx_b in tentative_b or not prim_b or len(full_b) != 1 or _has_vietnamese_conflict(a_obj, b_obj):
                        continue
                    given_b = init_b - {prim_b[0]}
                    if given_c == {prim_b[0]} and given_b == {prim_c[0]}:
                        mutual_pairs.append((idx_a, idx_b, prim_c, prim_b))
                        tentative_b.add(idx_b)
                        break
            if len({p[2] for p in mutual_pairs}) >= 2:
                for idx_a, idx_b, pc, pb in mutual_pairs:
                    used_cited_indices.add(idx_a)
                    used_cand_indices.add(idx_b)
                    cand_set.add(pc)
                    if pb and pb not in direct_matched_keys:
                        still_unclaimed_same_key = any(
                            j not in used_cand_indices and cand_sigs[j][1][0] == pb
                            for j in range(len(cand_sigs))
                        )
                        if not still_unclaimed_same_key:
                            consumed_cand_keys.add(pb)
        # Check corporate / institutional acronym & full-name equivalence (e.g. "WHO" <-> "World Health Organization")
        for idx_a, (a_obj, sig_c) in enumerate(cited_sigs):
            prim_c = sig_c[0]
            if idx_a in used_cited_indices or not prim_c or prim_c in cand_set:
                continue
            c_corp = _extract_corporate_keys(a_obj, fold_diacritics=fold_diacritics)
            if c_corp:
                for idx_b, (b_obj, sig_b) in enumerate(cand_sigs):
                    if idx_b in used_cand_indices:
                        continue
                    b_corp = _extract_corporate_keys(b_obj, fold_diacritics=fold_diacritics)
                    if c_corp & b_corp:
                        used_cited_indices.add(idx_a)
                        used_cand_indices.add(idx_b)
                        cand_set.add(prim_c)
                        prim_b = sig_b[0]
                        if prim_b and prim_b not in direct_matched_keys:
                            still_unclaimed_same_key = any(
                                j not in used_cand_indices and cand_sigs[j][1][0] == prim_b
                                for j in range(len(cand_sigs))
                            )
                            if not still_unclaimed_same_key:
                                consumed_cand_keys.add(prim_b)
                        break

    reconciled_cand_set = cand_set - consumed_cand_keys
    if not reconciled_cand_set:
        reconciled_cand_set = set(cand_set)

    # Restrict 1.0 subset shortcut to et al., multi-author subset (>=2),
    # single-author candidate, or first-author surname match.
    if cited_set <= reconciled_cand_set:
        if (
            effective_has_et_al
            or len(cited_set) >= 2
            or len(reconciled_cand_set) == 1
            or _first_author_matches(cited, candidate, fold_diacritics=fold_diacritics)
        ):
            return 1.0, cited_set, reconciled_cand_set
        return max(len(cited_set & reconciled_cand_set) / len(reconciled_cand_set), 0.55), cited_set, reconciled_cand_set
    if len(reconciled_cand_set) == 1 and reconciled_cand_set <= cited_set and cited:
        first_cited = _author_to_last_name(cited[0], fold_diacritics=fold_diacritics)
        if first_cited and first_cited in reconciled_cand_set:
            return 1.0, cited_set, reconciled_cand_set

    intersect = len(cited_set & reconciled_cand_set)
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
                for cb in reconciled_cand_set
            )
        )
        if prefix_matches > 0:
            return prefix_matches / len(cited_set), cited_set, reconciled_cand_set
        return 0.0, cited_set, reconciled_cand_set
    union = len(cited_set | reconciled_cand_set)
    return (intersect / union if union else 0.0), cited_set, reconciled_cand_set


def author_match_score(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
    has_et_al: bool = False,
) -> float:
    """Tính similarity score giữa 2 author lists.

    FIX v1.11: Improved handling for first-author-only citations.
    When citation has 1 author but candidate has many, we check if the
    first author matches any candidate author (common in short citations
    like "Settles, B (2012)").
    FIX Phase 3 (BUG-21): Handles East Asian swapped Given/Family name order
    (e.g. "Wei, G." vs "Wei Guodong" or "Guodong, W." vs "Guodong Wei"),
    standalone particle surnames ("Du, Y." vs "Yucheng Du"), and South Asian /
    Hungarian single-letter patronymic surnames ("B, P." vs "Premjith B").
    """
    score, _, _ = _resolve_author_alignment(
        cited,
        candidate,
        fold_diacritics=fold_diacritics,
        has_et_al=has_et_al,
    )
    return score


def author_match_details(
    cited: list,
    candidate: list,
    *,
    fold_diacritics: bool = True,
    has_et_al: bool = False,
) -> AuthorMatchResult:
    """Trả về chi tiết match (để debug/log), đồng bộ với author_match_score().

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
    score, cited_set, reconciled_cand_set = _resolve_author_alignment(
        cited,
        candidate,
        fold_diacritics=fold_diacritics,
        has_et_al=has_et_al,
    )
    visible_cand = {k for k in reconciled_cand_set if not k.startswith("__vn_conflict_")}
    matched = sorted(cited_set & visible_cand)
    only_cited = sorted(cited_set - visible_cand)
    only_cand = sorted(visible_cand - cited_set)
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
