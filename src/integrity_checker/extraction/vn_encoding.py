"""Legacy Vietnamese character encoding transcoder (TCVN3 / VNI-Windows -> Unicode NFC).

Subsystem A4:
- Complete, verified mapping tables for TCVN 5712:1993 (VN3 / TCVN3 / .VnTime)
  and VNI-Windows (VNI-Times / VNI-Helve).
- Line-scoped Vietnamese syllable phonotactics validator and safety gate to
  guarantee zero false positives on European names, French/German/Spanish/Nordic
  citations, LaTeX spacing accents, URLs/DOIs, and scientific SI units.
"""

from __future__ import annotations

import re
import unicodedata

# Unambiguous precomposed Vietnamese Unicode characters outside Latin-1 (U+0100+)
_EXISTING_VN_UNICODE_RE = re.compile(
    r"[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01a0\u01a1\u01af\u01b0\u1ea0-\u1ef9]"
)

# Protected spans that must never be mutated inside legacy lines
_PROTECTED_SPAN_RE = re.compile(
    r"(?:"
    r"https?://[^\s<>\"')]+|"
    r"www\.[^\s<>\"')]+|"
    r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+|"
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|"
    r"(?<=\d)\s*\u00b5(?:m|g|l|L|s|A|V|W|F|H|M|mol)\b|"
    r"\u00a7(?=\s*\d)"
    r")"
)
_TRAILING_SPAN_PUNCT = ".,;:"

# ============================================================================
# 1. Authoritative TCVN 5712:1993 (VN3 / TCVN3 / ABC / .VnTime) Mapping Table
# ============================================================================

# Uppercase non-toned special Vietnamese letters (0xA1..0xA7)
_TCVN3_UPPER_BASE: dict[str, str] = {
    "\u00a1": "Ă",  # 0xA1
    "\u00a2": "Â",  # 0xA2
    "\u00a3": "Ê",  # 0xA3
    "\u00a4": "Ô",  # 0xA4
    "\u00a5": "Ơ",  # 0xA5
    "\u00a6": "Ư",  # 0xA6
    "\u00a7": "Đ",  # 0xA7
}

# Lowercase non-toned special Vietnamese letters (0xA8..0xAE)
_TCVN3_LOWER_BASE: dict[str, str] = {
    "\u00a8": "ă",  # 0xA8
    "\u00a9": "â",  # 0xA9
    "\u00aa": "ê",  # 0xAA
    "\u00ab": "ô",  # 0xAB
    "\u00ac": "ơ",  # 0xAC
    "\u00ad": "ư",  # 0xAD (soft hyphen in Latin-1)
    "\u00ae": "đ",  # 0xAE
}

# 60 accented Vietnamese vowels (0xB5..0xFE); TCVN3 has no uppercase tone slots
_TCVN3_TONED_VOWELS: dict[str, str] = {
    # a: à, ả, ã, á, ạ
    "\u00b5": "à",  # 0xB5
    "\u00b6": "ả",  # 0xB6
    "\u00b7": "ã",  # 0xB7
    "\u00b8": "á",  # 0xB8
    "\u00b9": "ạ",  # 0xB9
    # ă: ằ, ẳ, ẵ, ắ, ặ (0xBA and 0xBF..0xC5 skipped in VN3)
    "\u00bb": "ằ",  # 0xBB
    "\u00bc": "ẳ",  # 0xBC
    "\u00bd": "ẵ",  # 0xBD
    "\u00be": "ắ",  # 0xBE
    "\u00c6": "ặ",  # 0xC6
    # â: ầ, ẩ, ẫ, ấ, ậ
    "\u00c7": "ầ",  # 0xC7
    "\u00c8": "ẩ",  # 0xC8
    "\u00c9": "ẫ",  # 0xC9
    "\u00ca": "ấ",  # 0xCA
    "\u00cb": "ậ",  # 0xCB
    # e: è, ẻ, ẽ, é, ẹ (0xCD skipped in VN3)
    "\u00cc": "è",  # 0xCC
    "\u00ce": "ẻ",  # 0xCE
    "\u00cf": "ẽ",  # 0xCF
    "\u00d0": "é",  # 0xD0
    "\u00d1": "ẹ",  # 0xD1
    # ê: ề, ể, ễ, ế, ệ
    "\u00d2": "ề",  # 0xD2
    "\u00d3": "ể",  # 0xD3
    "\u00d4": "ễ",  # 0xD4
    "\u00d5": "ế",  # 0xD5
    "\u00d6": "ệ",  # 0xD6
    # i: ì, ỉ, ĩ, í, ị (0xD9..0xDB skipped in VN3)
    "\u00d7": "ì",  # 0xD7
    "\u00d8": "ỉ",  # 0xD8
    "\u00dc": "ĩ",  # 0xDC
    "\u00dd": "í",  # 0xDD
    "\u00de": "ị",  # 0xDE
    # o: ò, ỏ, õ, ó, ọ (0xE0 skipped in VN3)
    "\u00df": "ò",  # 0xDF
    "\u00e1": "ỏ",  # 0xE1
    "\u00e2": "õ",  # 0xE2
    "\u00e3": "ó",  # 0xE3
    "\u00e4": "ọ",  # 0xE4
    # ô: ồ, ổ, ỗ, ố, ộ
    "\u00e5": "ồ",  # 0xE5
    "\u00e6": "ổ",  # 0xE6
    "\u00e7": "ỗ",  # 0xE7
    "\u00e8": "ố",  # 0xE8
    "\u00e9": "ộ",  # 0xE9
    # ơ: ờ, ở, ỡ, ớ, ợ
    "\u00ea": "ờ",  # 0xEA
    "\u00eb": "ở",  # 0xEB
    "\u00ec": "ỡ",  # 0xEC
    "\u00ed": "ớ",  # 0xED
    "\u00ee": "ợ",  # 0xEE
    # u: ù, ủ, ũ, ú, ụ (0xF0 skipped in VN3)
    "\u00ef": "ù",  # 0xEF
    "\u00f1": "ủ",  # 0xF1
    "\u00f2": "ũ",  # 0xF2
    "\u00f3": "ú",  # 0xF3
    "\u00f4": "ụ",  # 0xF4
    # ư: ừ, ử, ữ, ứ, ự
    "\u00f5": "ừ",  # 0xF5
    "\u00f6": "ử",  # 0xF6
    "\u00f7": "ữ",  # 0xF7
    "\u00f8": "ứ",  # 0xF8
    "\u00f9": "ự",  # 0xF9
    # y: ỳ, ỷ, ỹ, ý, ỵ
    "\u00fa": "ỳ",  # 0xFA
    "\u00fb": "ỷ",  # 0xFB
    "\u00fc": "ỹ",  # 0xFC
    "\u00fd": "ý",  # 0xFD
    "\u00fe": "ỵ",  # 0xFE
}

_TCVN3_FULL_MAP: dict[str, str] = {
    **_TCVN3_UPPER_BASE,
    **_TCVN3_LOWER_BASE,
    **_TCVN3_TONED_VOWELS,
}
_TCVN3_TONED_SET = frozenset(_TCVN3_TONED_VOWELS.keys())
_TCVN3_CASE_FLEX_MAP: dict[str, str] = {
    **_TCVN3_LOWER_BASE,
    **_TCVN3_TONED_VOWELS,
}
_TCVN3_CASE_FLEX_SET = frozenset(_TCVN3_CASE_FLEX_MAP.keys())

# ============================================================================
# 2. Authoritative VNI-Windows (VNI-Times / VNI-Helve) Mapping Table
# ============================================================================


def _build_vni_tables() -> tuple[dict[str, str], dict[str, str]]:
    pairs_2char: dict[str, str] = {}

    # Plain 5 tones: (sắc, huyền, hỏi, ngã, nặng)
    # Uppercase modifiers: Ù (0xD9), Ø (0xD8), Û (0xDB), Õ (0xD5), Ï (0xCF)
    # Lowercase modifiers: ù (0xF9), ø (0xF8), û (0xFB), õ (0xF5), ï (0xEF)
    plain_tones_lower = ("\u00f9", "\u00f8", "\u00fb", "\u00f5", "\u00ef")
    plain_tones_upper = ("\u00d9", "\u00d8", "\u00db", "\u00d5", "\u00cf")

    base_5tone_families = (
        ("a", "A", ("á", "à", "ả", "ã", "ạ"), ("Á", "À", "Ả", "Ã", "Ạ")),
        ("e", "E", ("é", "è", "ẻ", "ẽ", "ẹ"), ("É", "È", "Ẻ", "Ẽ", "Ẹ")),
        ("i", "I", ("í", "ì", "ỉ", "ĩ", "ị"), ("Í", "Ì", "Ỉ", "Ĩ", "Ị")),
        ("o", "O", ("ó", "ò", "ỏ", "õ", "ọ"), ("Ó", "Ò", "Ỏ", "Õ", "Ọ")),
        ("u", "U", ("ú", "ù", "ủ", "ũ", "ụ"), ("Ú", "Ù", "Ủ", "Ũ", "Ụ")),
        ("y", "Y", ("ý", "ỳ", "ỷ", "ỹ", "ỵ"), ("Ý", "Ỳ", "Ỷ", "Ỹ", "Ỵ")),
        # Horn vowels in VNI: ô/Ô = ơ/Ơ, ö/Ö = ư/Ư
        ("\u00f4", "\u00d4", ("ớ", "ờ", "ở", "ỡ", "ợ"), ("Ớ", "Ờ", "Ở", "Ỡ", "Ợ")),
        ("\u00f6", "\u00d6", ("ứ", "ừ", "ử", "ữ", "ự"), ("Ứ", "Ừ", "Ử", "Ữ", "Ự")),
    )
    for b_lo, b_hi, out_lo, out_hi in base_5tone_families:
        for mod_lo, mod_hi, ch_lo, ch_hi in zip(
            plain_tones_lower, plain_tones_upper, out_lo, out_hi, strict=True
        ):
            pairs_2char[b_lo + mod_lo] = ch_lo
            pairs_2char[b_hi + mod_hi] = ch_hi
            # Also tolerate uppercase base + lowercase modifier (e.g. Shift released early)
            pairs_2char[b_hi + mod_lo] = ch_hi

    # Circumflex + 6 tones: (ngang, sắc, huyền, hỏi, ngã, nặng)
    # Lowercase modifiers: â (0xE2), á (0xE1), à (0xE0), å (0xE5), ã (0xE3), ä (0xE4)
    # Uppercase modifiers: Â (0xC2), Á (0xC1), À (0xC0), Å (0xC5), Ã (0xC3), Ä (0xC4)
    circ_lower = ("\u00e2", "\u00e1", "\u00e0", "\u00e5", "\u00e3", "\u00e4")
    circ_upper = ("\u00c2", "\u00c1", "\u00c0", "\u00c5", "\u00c3", "\u00c4")
    circ_families = (
        ("a", "A", ("â", "ấ", "ầ", "ẩ", "ẫ", "ậ"), ("Â", "Ấ", "Ầ", "Ẩ", "Ẫ", "Ậ")),
        ("e", "E", ("ê", "ế", "ề", "ể", "ễ", "ệ"), ("Ê", "Ế", "Ề", "Ể", "Ễ", "Ệ")),
        ("o", "O", ("ô", "ố", "ồ", "ổ", "ỗ", "ộ"), ("Ô", "Ố", "Ồ", "Ổ", "Ỗ", "Ộ")),
    )
    for b_lo, b_hi, out_lo, out_hi in circ_families:
        for mod_lo, mod_hi, ch_lo, ch_hi in zip(
            circ_lower, circ_upper, out_lo, out_hi, strict=True
        ):
            pairs_2char[b_lo + mod_lo] = ch_lo
            pairs_2char[b_hi + mod_hi] = ch_hi
            pairs_2char[b_hi + mod_lo] = ch_hi

    # Breve (ă/Ă) + 6 tones: (ngang, sắc, huyền, hỏi, ngã, nặng)
    # Lowercase modifiers: ê (0xEA), é (0xE9), è (0xE8), ú (0xFA), ü (0xFC), ë (0xEB)
    # Uppercase modifiers: Ê (0xCA), É (0xC9), È (0xC8), Ú (0xDA), Ü (0xDC), Ë (0xCB)
    breve_lower = ("\u00ea", "\u00e9", "\u00e8", "\u00fa", "\u00fc", "\u00eb")
    breve_upper = ("\u00ca", "\u00c9", "\u00c8", "\u00da", "\u00dc", "\u00cb")
    breve_out_lo = ("ă", "ắ", "ằ", "ẳ", "ẵ", "ặ")
    breve_out_hi = ("Ă", "Ắ", "Ằ", "Ẳ", "Ẵ", "Ặ")
    for mod_lo, mod_hi, ch_lo, ch_hi in zip(
        breve_lower, breve_upper, breve_out_lo, breve_out_hi, strict=True
    ):
        pairs_2char["a" + mod_lo] = ch_lo
        pairs_2char["A" + mod_hi] = ch_hi
        pairs_2char["A" + mod_lo] = ch_hi

    # Single-byte VNI characters (evaluated ONLY if 2-char composite did not match at i)
    single_1char: dict[str, str] = {
        "\u00f1": "đ",  # 0xF1 ñ
        "\u00d1": "Đ",  # 0xD1 Ñ
        "\u00f4": "ơ",  # 0xF4 ô (standalone, when not preceded by o/O as oâ)
        "\u00d4": "Ơ",  # 0xD4 Ô
        "\u00f6": "ư",  # 0xF6 ö
        "\u00d6": "Ư",  # 0xD6 Ö
        # VNI 1-byte i tones: ì (0xEC), í (0xED), æ->ỉ (0xE6), ó->ĩ (0xF3), ò->ị (0xF2)
        "\u00ec": "ì",
        "\u00cc": "Ì",
        "\u00ed": "í",
        "\u00cd": "Í",
        "\u00e6": "ỉ",
        "\u00c6": "Ỉ",
        "\u00f3": "ĩ",
        "\u00d3": "Ĩ",
        "\u00f2": "ị",
        "\u00d2": "Ị",
        # VNI 1-byte y-nặng: î->ỵ (0xEE), Î->Ỵ (0xCE)
        "\u00ee": "ỵ",
        "\u00ce": "Ỵ",
    }
    return pairs_2char, single_1char


_VNI_2CHAR_MAP, _VNI_1CHAR_MAP = _build_vni_tables()

# ============================================================================
# 3. Vietnamese Syllable Phonotactics Validator
# ============================================================================

# Map every lowercase Vietnamese vowel to (base_vowel, tone_id)
# tone_id: 0=ngang, 1=sắc, 2=huyền, 3=hỏi, 4=ngã, 5=nặng
_VN_VOWEL_DECOMP: dict[str, tuple[str, int]] = {
    "a": ("a", 0), "á": ("a", 1), "à": ("a", 2), "ả": ("a", 3), "ã": ("a", 4), "ạ": ("a", 5),
    "ă": ("ă", 0), "ắ": ("ă", 1), "ằ": ("ă", 2), "ẳ": ("ă", 3), "ẵ": ("ă", 4), "ặ": ("ă", 5),
    "â": ("â", 0), "ấ": ("â", 1), "ầ": ("â", 2), "ẩ": ("â", 3), "ẫ": ("â", 4), "ậ": ("â", 5),
    "e": ("e", 0), "é": ("e", 1), "è": ("e", 2), "ẻ": ("e", 3), "ẽ": ("e", 4), "ẹ": ("e", 5),
    "ê": ("ê", 0), "ế": ("ê", 1), "ề": ("ê", 2), "ể": ("ê", 3), "ễ": ("ê", 4), "ệ": ("ê", 5),
    "i": ("i", 0), "í": ("i", 1), "ì": ("i", 2), "ỉ": ("i", 3), "ĩ": ("i", 4), "ị": ("i", 5),
    "o": ("o", 0), "ó": ("o", 1), "ò": ("o", 2), "ỏ": ("o", 3), "õ": ("o", 4), "ọ": ("o", 5),
    "ô": ("ô", 0), "ố": ("ô", 1), "ồ": ("ô", 2), "ổ": ("ô", 3), "ỗ": ("ô", 4), "ộ": ("ô", 5),
    "ơ": ("ơ", 0), "ớ": ("ơ", 1), "ờ": ("ơ", 2), "ở": ("ơ", 3), "ỡ": ("ơ", 4), "ợ": ("ơ", 5),
    "u": ("u", 0), "ú": ("u", 1), "ù": ("u", 2), "ủ": ("u", 3), "ũ": ("u", 4), "ụ": ("u", 5),
    "ư": ("ư", 0), "ứ": ("ư", 1), "ừ": ("ư", 2), "ử": ("ư", 3), "ữ": ("ư", 4), "ự": ("ư", 5),
    "y": ("y", 0), "ý": ("y", 1), "ỳ": ("y", 2), "ỷ": ("y", 3), "ỹ": ("y", 4), "ỵ": ("y", 5),
}

_VN_ACCENTED_CHARS = frozenset(
    ch for ch, (base, tone) in _VN_VOWEL_DECOMP.items() if tone != 0 or base in {"ă", "â", "ê", "ô", "ơ", "ư"}
) | {"đ"}

# Ordered longest-first so digraphs/trigraphs match greedily before single letters
_VN_ONSETS = (
    "ngh",
    "ch", "gh", "gi", "kh", "ng", "nh", "ph", "qu", "th", "tr",
    "b", "c", "d", "đ", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x",
)

_STOP_CODAS = frozenset({"c", "ch", "p", "t"})

_NUCLEUS_ALLOWED_CODAS: dict[str, frozenset[str]] = {
    "a": frozenset({"", "c", "ch", "m", "n", "ng", "nh", "p", "t"}),
    "ă": frozenset({"c", "m", "n", "ng", "p", "t"}),
    "â": frozenset({"c", "m", "n", "ng", "p", "t"}),
    "e": frozenset({"", "c", "m", "n", "ng", "p", "t"}),
    "ê": frozenset({"", "ch", "m", "n", "nh", "p", "t"}),
    "i": frozenset({"", "c", "ch", "m", "n", "nh", "p", "t"}),
    "o": frozenset({"", "c", "m", "n", "ng", "p", "t"}),
    "ô": frozenset({"", "c", "m", "n", "ng", "p", "t"}),
    "ơ": frozenset({"", "c", "m", "n", "p", "t"}),
    "u": frozenset({"", "c", "m", "n", "ng", "p", "t"}),
    "ư": frozenset({"", "c", "m", "n", "ng", "t"}),
    "y": frozenset({"", "ch", "m", "n", "nh", "p", "t"}),
    # Open-only diphthongs & triphthongs
    "ai": frozenset({""}),
    "ao": frozenset({""}),
    "au": frozenset({""}),
    "ay": frozenset({""}),
    "âu": frozenset({""}),
    "ây": frozenset({""}),
    "eo": frozenset({""}),
    "êu": frozenset({""}),
    "ia": frozenset({""}),
    "iu": frozenset({""}),
    "iêu": frozenset({""}),
    "yêu": frozenset({""}),
    "oai": frozenset({""}),
    "oao": frozenset({""}),
    "oay": frozenset({""}),
    "oeo": frozenset({""}),
    "oi": frozenset({""}),
    "ôi": frozenset({""}),
    "ơi": frozenset({""}),
    "ua": frozenset({""}),
    "uai": frozenset({""}),
    "uao": frozenset({""}),
    "uay": frozenset({""}),
    "uây": frozenset({""}),
    "ui": frozenset({""}),
    "uôi": frozenset({""}),
    "uya": frozenset({""}),
    "uyu": frozenset({""}),
    "ưa": frozenset({""}),
    "ưi": frozenset({""}),
    "ươi": frozenset({""}),
    "ươu": frozenset({""}),
    "ưu": frozenset({""}),
    # Closed-capable diphthongs & triphthongs
    "iê": frozenset({"c", "m", "n", "ng", "p", "t"}),
    "yê": frozenset({"c", "m", "n", "ng", "p", "t"}),
    "oa": frozenset({"", "c", "ch", "m", "n", "ng", "nh", "p", "t"}),
    "oă": frozenset({"c", "m", "n", "ng", "p", "t"}),
    "oe": frozenset({"", "n", "t"}),
    "oo": frozenset({"c", "ng"}),
    "uâ": frozenset({"n", "ng", "t"}),
    "uê": frozenset({"", "ch", "n", "nh", "t"}),
    "uô": frozenset({"c", "m", "n", "ng", "t"}),
    "uy": frozenset({"", "c", "ch", "m", "n", "nh", "p", "t"}),
    "uyê": frozenset({"n", "t"}),
    "ươ": frozenset({"c", "m", "n", "ng", "p", "t"}),
}

# Punctuation/digits to strip when extracting syllable tokens (preserves 0xA1..0xFE legacy bytes!)
_TOKEN_SPLIT_RE = re.compile(r"[\s,.;:!?()\[\]{}\"'`~@#$%^&*+=<>|\\/\u2000-\u206f\d\-]+")


def is_valid_vietnamese_syllable(word: str) -> tuple[bool, bool]:
    """Return `(is_valid_vn_syllable, has_vn_diacritic)` for a single word token."""
    if not word or len(word) > 9:
        return False, False
    norm_word = unicodedata.normalize("NFC", word)
    # Reject anomalous mid-word uppercase mixed with lowercase (e.g. TCVN3 mojibake "giÕng", "vÒ", "cÊp")
    if any(ch.isupper() for ch in norm_word[1:]) and any(ch.islower() for ch in norm_word):
        return False, False
    w = norm_word.lower()

    # Strip valid Vietnamese onset
    is_gi_onset = False
    rest = w
    if w.startswith("gi"):
        # Handle "gì", "gìn", "giữ", "giáo": if nothing or a consonant follows "gi",
        # "i" serves as the vowel nucleus of onset "g" (e.g. "gìn" -> onset "g", rest "ìn").
        after_gi = w[2:]
        if not after_gi or after_gi[0] not in _VN_VOWEL_DECOMP:
            rest = w[1:]
        else:
            is_gi_onset = True
            rest = after_gi
    elif w.startswith("qu"):
        after_qu = w[2:]
        if after_qu and after_qu[0] in _VN_VOWEL_DECOMP:
            rest = after_qu
        else:
            return False, False
    else:
        for cand in _VN_ONSETS:
            if w.startswith(cand):
                rest = w[len(cand) :]
                break

    if not rest:
        return False, False

    # Collect contiguous Vietnamese vowels as the nucleus
    vowels: list[str] = []
    idx = 0
    while idx < len(rest) and rest[idx] in _VN_VOWEL_DECOMP:
        vowels.append(rest[idx])
        idx += 1

    if not vowels or len(vowels) > 3:
        return False, False

    coda = rest[idx:]
    # Decompose vowels and enforce at most ONE tone mark across the nucleus
    base_chars: list[str] = []
    syllable_tone = 0
    for v in vowels:
        b_ch, t_id = _VN_VOWEL_DECOMP[v]
        base_chars.append(b_ch)
        if t_id != 0:
            if syllable_tone != 0:
                return False, False
            syllable_tone = t_id

    base_nucleus = "".join(base_chars)
    if is_gi_onset and base_nucleus == "ê":
        # Vietnamese orthography coalesces "gi" + "iê" + coda into "giê" + coda
        # (e.g. "giếng", "giềng", "giêng", "giếc")
        allowed_codas = _NUCLEUS_ALLOWED_CODAS["ê"] | _NUCLEUS_ALLOWED_CODAS["iê"]
    else:
        allowed_codas = _NUCLEUS_ALLOWED_CODAS.get(base_nucleus)
    if allowed_codas is None or coda not in allowed_codas:
        return False, False

    # Entering-tone phonotactic law: stop codas (-c, -ch, -p, -t) ONLY permit sắc (1) or nặng (5)
    if coda in _STOP_CODAS and syllable_tone not in (1, 5):
        return False, False

    has_accent = any(ch in _VN_ACCENTED_CHARS for ch in w)
    return True, has_accent


def _extract_eval_tokens(line: str) -> list[str]:
    """Split line into candidate word tokens, ignoring pure consonant acronyms (e.g. NXB, TP)."""
    raw_parts = [p for p in _TOKEN_SPLIT_RE.split(line) if p and "\x00" not in p]
    tokens: list[str] = []
    for p in raw_parts:
        # Skip 1-letter uppercase initials ("A", "B") and all-caps consonant acronyms ("NXB", "CNTT", "HCM")
        if p.isascii() and p.isupper() and (len(p) == 1 or not any(c in "AEIOUY" for c in p)):
            continue
        # Skip Roman numerals (I, II, III, IV, VI, VII, VIII, IX, XI, XII)
        if p in {"II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII"}:
            continue
        tokens.append(p)
    return tokens


def _score_tokens(tokens: list[str]) -> tuple[int, int, float]:
    """Return `(valid_count, accented_valid_count, valid_ratio)`."""
    if not tokens:
        return 0, 0, 0.0
    valid_cnt = 0
    accented_cnt = 0
    for tok in tokens:
        ok, accented = is_valid_vietnamese_syllable(tok)
        if ok:
            valid_cnt += 1
            if accented:
                accented_cnt += 1
    return valid_cnt, accented_cnt, valid_cnt / len(tokens)


_OUTER_WORD_PUNCT_LEAD_RE = re.compile(r"^[,.;:!?()\[\]{}\"'`~@#$%^&*+=<>|\\/\u2000-\u206f]+")
_OUTER_WORD_PUNCT_TRAIL_RE = re.compile(r"[,.;:!?()\[\]{}\"'`~@#$%^&*+=<>|\\/\u2000-\u206f]+$")
_NON_HYPHEN_DELIM_RE = re.compile(r"([\s,.;:!?()\[\]{}\"'`~@#$%^&*+=<>|\\/\u2000-\u206f]+)")
_TCVN3_ONSET_PAT = r"(?:(?i:ngh|ch|gh|gi|kh|ng|nh|ph|th|tr|[bcdghklmnrstvx])|\u00ae|\u00a7)"
_DEMOTED_UO_RE = re.compile(
    rf"^({_TCVN3_ONSET_PAT}?)-([\u00ac\u00ea-\u00ee\u00a5](?i:ng|i|u|c|m|n|p|t)?)$"
)
_DEMOTED_U_ONSET_RE = re.compile(rf"^({_TCVN3_ONSET_PAT})-((?i:ng|a|i|u|m|n)?)$")
_DEMOTED_U_INITIAL_RE = re.compile(r"^-((?i:ng|a|i|u|m|n))$")
_NEW_LIST_ENTRY_RE = re.compile(r"^\s*(?:\[\d+[a-zA-Z]?\]|\d+[.)](?:\s|$|\D)|[-•*–—+]\s)")
_VNI_SELF_MAPPED_LATIN1 = frozenset({"\u00ec", "\u00cc", "\u00ed", "\u00cd"})


def _strip_outer_non_hyphen_punct(chunk: str) -> tuple[str, str, str]:
    lead_m = _OUTER_WORD_PUNCT_LEAD_RE.match(chunk)
    lead = lead_m.group(0) if lead_m else ""
    rem = chunk[len(lead) :]
    trail_m = _OUTER_WORD_PUNCT_TRAIL_RE.search(rem)
    trail = trail_m.group(0) if trail_m else ""
    core = rem[: len(rem) - len(trail)] if trail else rem
    return lead, core, trail


def _restore_tcvn3_u_horn_hyphens(line: str) -> str:
    """Restore MuPDF-demoted '-' (0x2D from TCVN3 0xAD soft-hyphen) back to '\\u00ad' ('ư')."""
    if "-" not in line or not any(ch in _TCVN3_FULL_MAP for ch in line):
        return line

    parts = _NON_HYPHEN_DELIM_RE.split(line)
    for i in range(0, len(parts), 2):
        core = parts[i]
        if not core or "\x00" in core or "-" not in core or core == "-":
            continue
        new_core = _DEMOTED_UO_RE.sub(lambda m: f"{m.group(1)}\u00ad{m.group(2)}", core)
        if new_core == core:
            new_core = _DEMOTED_U_ONSET_RE.sub(
                lambda m: f"{m.group(1)}\u00ad{m.group(2)}", core
            )
        if new_core == core:
            new_core = _DEMOTED_U_INITIAL_RE.sub(lambda m: f"\u00ad{m.group(1)}", core)
        if new_core != core:
            parts[i] = new_core
    return "".join(parts)


def _decode_tcvn3_line(line: str, *, force_upper: bool = False) -> str:
    """Decode a single line from TCVN3, applying context-aware capitalization for all-caps words."""
    line = _restore_tcvn3_u_horn_hyphens(line)

    if force_upper:
        parts_force = re.split(r"(\s+)", line)
        for i, chunk in enumerate(parts_force):
            if not chunk or chunk.isspace() or "\x00" in chunk:
                continue
            parts_force[i] = "".join(_TCVN3_FULL_MAP.get(ch, ch) for ch in chunk).upper()
        return "".join(parts_force)

    # Check whether the entire line lacks any lowercase non-TCVN3-flex letters
    fixed_alpha = [
        ch
        for ch in line
        if ch not in _TCVN3_CASE_FLEX_SET and (ch.isalpha() or ch in _TCVN3_UPPER_BASE)
    ]
    upper_fixed = sum(1 for ch in fixed_alpha if ch.isupper() or ch in _TCVN3_UPPER_BASE)
    lower_fixed = sum(1 for ch in fixed_alpha if ch.islower())
    whole_line_all_caps = upper_fixed >= 2 and lower_fixed == 0

    # Split preserving delimiters so word-level and neighbor-level casing can be resolved cleanly
    parts = re.split(r"(\s+)", line)
    word_indices = [i for i, p in enumerate(parts) if p and not p.isspace()]

    # First pass: classify each non-space chunk's fixed-letter casing
    chunk_is_all_caps: dict[int, bool] = {}
    chunk_has_lower: dict[int, bool] = {}
    for wi in word_indices:
        raw_w = parts[wi]
        if "\x00" in raw_w:
            chunk_is_all_caps[wi] = False
            chunk_has_lower[wi] = False
            continue
        flex_pos = [k for k, ch in enumerate(raw_w) if ch in _TCVN3_CASE_FLEX_SET]
        up_pos = [
            k
            for k, ch in enumerate(raw_w)
            if ch not in _TCVN3_CASE_FLEX_SET and (ch.isupper() or ch in _TCVN3_UPPER_BASE)
        ]
        has_lo = any(ch not in _TCVN3_CASE_FLEX_SET and ch.islower() for ch in raw_w)
        chunk_has_lower[wi] = has_lo
        chunk_is_all_caps[wi] = (
            not has_lo
            and "." not in raw_w
            and (
                len(up_pos) >= 2
                or (len(up_pos) == 1 and bool(flex_pos) and up_pos[0] > flex_pos[0])
            )
        )

    out_parts = list(parts)
    for pos_idx, wi in enumerate(word_indices):
        raw_w = parts[wi]
        if "\x00" in raw_w:
            continue

        # Determine if TCVN3 case-flexible chars (0xA8..0xAE + 0xB5..0xFE) should be uppercased
        should_upper = False
        if whole_line_all_caps:
            should_upper = True
        elif not chunk_has_lower[wi]:
            flex_positions = [k for k, ch in enumerate(raw_w) if ch in _TCVN3_CASE_FLEX_SET]
            upper_positions = [
                k
                for k, ch in enumerate(raw_w)
                if ch not in _TCVN3_CASE_FLEX_SET and (ch.isupper() or ch in _TCVN3_UPPER_BASE)
            ]
            if flex_positions:
                first_flex = flex_positions[0]
                if len(upper_positions) >= 2 or any(k > first_flex for k in upper_positions):
                    should_upper = True
                elif len(upper_positions) in (0, 1):
                    # Short open-syllable CV or pure-vowel word (e.g. "Hµ", "T-", "ý" in "ý NGHÜA")
                    prev_wi = word_indices[pos_idx - 1] if pos_idx > 0 else None
                    next_wi = (
                        word_indices[pos_idx + 1] if pos_idx + 1 < len(word_indices) else None
                    )
                    adj_caps = (prev_wi is not None and chunk_is_all_caps[prev_wi]) or (
                        next_wi is not None and chunk_is_all_caps[next_wi]
                    )
                    adj_lower = (prev_wi is not None and chunk_has_lower[prev_wi]) or (
                        next_wi is not None and chunk_has_lower[next_wi]
                    )
                    if adj_caps and not adj_lower:
                        should_upper = True

        decoded_chars: list[str] = []
        for ch in raw_w:
            if ch in _TCVN3_CASE_FLEX_MAP:
                mapped = _TCVN3_CASE_FLEX_MAP[ch]
                decoded_chars.append(mapped.upper() if should_upper else mapped)
            elif ch in _TCVN3_FULL_MAP:
                decoded_chars.append(_TCVN3_FULL_MAP[ch])
            else:
                decoded_chars.append(ch)
        out_parts[wi] = "".join(decoded_chars)

    return "".join(out_parts)


def _decode_vni_line(line: str) -> str:
    """Decode a single line from VNI-Windows (greedy 2-char composite before 1-char)."""
    out: list[str] = []
    n = len(line)
    i = 0
    while i < n:
        if line[i] == "\x00":
            end_sentinel = line.find("\x00", i + 1)
            if end_sentinel != -1:
                out.append(line[i : end_sentinel + 1])
                i = end_sentinel + 1
                continue
        if i + 1 < n:
            pair = line[i : i + 2]
            mapped_pair = _VNI_2CHAR_MAP.get(pair)
            if mapped_pair is not None:
                out.append(mapped_pair)
                i += 2
                continue
        ch = line[i]
        out.append(_VNI_1CHAR_MAP.get(ch, ch))
        i += 1
    return "".join(out)


def _mask_protected_spans(line: str) -> tuple[str, list[str]]:
    spans: list[str] = []

    def _repl(match: re.Match[str]) -> str:
        full = match.group(0)
        stripped = full.rstrip(_TRAILING_SPAN_PUNCT)
        trailing = full[len(stripped) :]
        idx = len(spans)
        spans.append(stripped)
        return f"\x00{idx}\x00{trailing}"

    masked = _PROTECTED_SPAN_RE.sub(_repl, line)
    return masked, spans


def _unmask_protected_spans(line: str, spans: list[str]) -> str:
    if not spans:
        return line
    for idx, original in enumerate(spans):
        line = line.replace(f"\x00{idx}\x00", original)
    return line


_TCVN3_H_HINT_RE = re.compile(r"(?:^|[+\s,;])\.?vn[a-z0-9_]*h(?:$|[-_,\s;])", re.IGNORECASE)
_TCVN3_ANY_HINT_RE = re.compile(
    r"(?:^|[+\s,;])(?:\.vn[a-z]|vn[a-z0-9_]*h(?:$|[-_,\s;]))", re.IGNORECASE
)


def _parse_font_hint(font_hint: str | None) -> tuple[str | None, bool]:
    """Return `(encoding_hint, force_tcvn3_upper)`."""
    if not font_hint:
        return None, False
    low = font_hint.strip().lower()
    if low in {"tcvn3_upper", "tcvn3-upper"}:
        return "tcvn3", True
    if low in {"tcvn3", "abc", "vn3"}:
        return "tcvn3", False
    if low in {"vni_windows", "vni-windows", "vni"}:
        return "vni_windows", False
    if _TCVN3_H_HINT_RE.search(low):
        return "tcvn3", True
    if _TCVN3_ANY_HINT_RE.search(low):
        return "tcvn3", False
    if re.search(r"(?:^|[+\s,;])vni-[a-z]", low):
        return "vni_windows", False
    return None, False


def _validate_hinted_line_chunks(before_line: str, after_line: str, enc: str) -> bool:
    """Reject hinted/continuation decodes if untouched tokens retain raw Latin-1 accents
    or if any modified chunk failed to decode into valid Vietnamese syllable(s)."""
    b_chunks = [c for c in re.split(r"\s+", before_line.strip()) if c]
    a_chunks = [c for c in re.split(r"\s+", after_line.strip()) if c]
    if len(b_chunks) != len(a_chunks):
        return False

    for b_raw, a_raw in zip(b_chunks, a_chunks, strict=True):
        if "\x00" in b_raw or "\x00" in a_raw:
            continue
        _, b_core, _ = _strip_outer_non_hyphen_punct(b_raw)
        _, a_core, _ = _strip_outer_non_hyphen_punct(a_raw)
        if not b_core and not a_core:
            continue
        if b_core.lower() == a_core.lower() and b_core == a_core:
            # Untouched chunk: reject if raw non-Vietnamese Latin-1 accents survived!
            if enc == "tcvn3":
                if any(0xA1 <= ord(ch) <= 0xFF and ch != "\u00fd" for ch in b_core):
                    return False
            else:
                if any(
                    0xC0 <= ord(ch) <= 0xFF and ch not in _VNI_SELF_MAPPED_LATIN1
                    for ch in b_core
                ):
                    return False
        else:
            # Modified chunk (or case-shifted under .Vn*H): every eval token in `a_core`
            # must be a valid Vietnamese syllable!
            sub_tokens = _extract_eval_tokens(a_core)
            if not sub_tokens:
                continue
            if any(not is_valid_vietnamese_syllable(sub)[0] for sub in sub_tokens):
                return False
    return True


class VietnameseLegacyTranscoder:
    """Line-scoped TCVN3 & VNI-Windows -> Unicode NFC transcoder with phonotactic gating."""

    @classmethod
    def normalize_legacy_vietnamese(
        cls,
        text: str,
        font_hint: str | None = None,
        *,
        _allow_sentence_split: bool = True,
    ) -> tuple[str, str | None]:
        """Decode legacy TCVN3 or VNI-Windows lines to Unicode NFC if phonotactically proven.

        Returns:
            `(normalized_nfc_text, detected_encoding_or_none)` where `detected_encoding_or_none`
            is `"tcvn3"`, `"vni_windows"`, or `None` when no legacy encoding was applied.
        """
        if not text:
            return text, None

        # Fast-path: pure ASCII without soft-hyphen 0xAD cannot contain TCVN3 or VNI bytes
        if text.isascii():
            return text, None

        hinted_enc, force_tcvn3_upper = _parse_font_hint(font_hint)
        parts = text.splitlines(keepends=True)
        out_lines: list[str] = []
        detected_counts: dict[str, int] = {"tcvn3": 0, "vni_windows": 0}
        prev_line_enc: str | None = None

        candidate_order = (
            [hinted_enc, "vni_windows" if hinted_enc == "tcvn3" else "tcvn3"]
            if hinted_enc
            else ["vni_windows", "tcvn3"]
        )

        for raw_piece in parts:
            # Separate trailing line break (\r\n or \n or \r)
            line_ending = ""
            line = raw_piece
            if line.endswith("\r\n"):
                line, line_ending = line[:-2], "\r\n"
            elif line.endswith(("\n", "\r")):
                line, line_ending = line[:-1], line[-1]

            if not line.strip():
                prev_line_enc = None
                out_lines.append(raw_piece)
                continue

            # Reset paragraph-continuation encoding at numbered/bracketed/bulleted list entries
            if _NEW_LIST_ENTRY_RE.match(line):
                prev_line_enc = None

            if line.isascii():
                out_lines.append(raw_piece)
                continue

            nfc_line = unicodedata.normalize("NFC", line)
            # Never transcode any line that already contains genuine Unicode Vietnamese codepoints
            if _EXISTING_VN_UNICODE_RE.search(nfc_line):
                prev_line_enc = None
                out_lines.append(nfc_line + line_ending)
                continue

            masked_line, spans = _mask_protected_spans(line)
            before_tokens = _extract_eval_tokens(masked_line)
            if not before_tokens:
                out_lines.append(raw_piece)
                continue

            before_valid, before_accented, before_ratio = _score_tokens(before_tokens)

            best_enc: str | None = None
            best_decoded: str | None = None
            best_score: tuple[int, float] = (0, 0.0)

            for enc in candidate_order:
                decoded_masked = (
                    _decode_tcvn3_line(
                        masked_line,
                        force_upper=(force_tcvn3_upper and hinted_enc == "tcvn3"),
                    )
                    if enc == "tcvn3"
                    else _decode_vni_line(masked_line)
                )
                if decoded_masked == masked_line:
                    continue

                after_tokens = _extract_eval_tokens(decoded_masked)
                if not after_tokens:
                    continue

                after_valid, after_accented, after_ratio = _score_tokens(after_tokens)
                gained_accented = after_accented - before_accented
                ratio_delta = after_ratio - before_ratio

                # Primary strict phonotactic gate (no font hint needed)
                passes_strict = gained_accented >= 3 and ratio_delta >= 0.45

                # Bilingual paragraph gate (e.g., Vietnamese TCVN3/VNI sentence or authors + English title
                # inside a single DOCX paragraph): requires >= 4 gained accented syllables AND every
                # modified chunk must be valid Vietnamese with zero untouched raw Latin-1 accents.
                passes_bilingual = (
                    not passes_strict
                    and gained_accented >= 4
                    and (after_valid - before_valid) >= 4
                    and _validate_hinted_line_chunks(masked_line, decoded_masked, enc)
                )

                # Tightened hinted/widow gate when gained_accented is 1..2
                passes_hinted = False
                if not (passes_strict or passes_bilingual) and (
                    hinted_enc == enc or prev_line_enc == enc
                ):
                    min_after_ratio = 1.0 if len(after_tokens) <= 3 else 0.85
                    if (
                        gained_accented >= 1
                        and after_valid > before_valid
                        and after_ratio >= min_after_ratio
                        and _validate_hinted_line_chunks(masked_line, decoded_masked, enc)
                    ):
                        passes_hinted = True

                if passes_strict or passes_bilingual or passes_hinted:
                    cand_score = (gained_accented, ratio_delta)
                    if cand_score > best_score:
                        best_score = cand_score
                        best_enc = enc
                        best_decoded = decoded_masked

            has_multi_sentence = _allow_sentence_split and bool(
                re.search(r"[.!?;]\s+\S", line)
            )
            if (
                best_enc is not None
                and best_decoded is not None
                and (
                    not has_multi_sentence
                    or _validate_hinted_line_chunks(masked_line, best_decoded, best_enc)
                )
            ):
                restored = unicodedata.normalize(
                    "NFC", _unmask_protected_spans(best_decoded, spans)
                )
                out_lines.append(restored + line_ending)
                detected_counts[best_enc] += 1
                prev_line_enc = best_enc
            elif has_multi_sentence:
                # Multi-sentence paragraph (common in .docx <w:p> where a legacy Vietnamese
                # sentence is followed by English or European sentences): evaluate each sentence
                # independently so legacy Vietnamese sentences decode while foreign sentences stay untouched.
                sent_parts = re.split(r"((?<=[.!?;])\s+)", line)
                if len(sent_parts) > 1:
                    rebuilt_sents: list[str] = []
                    sent_encs: dict[str, int] = {"tcvn3": 0, "vni_windows": 0}
                    for sp in sent_parts:
                        if not sp or sp.isspace() or sp.isascii():
                            rebuilt_sents.append(sp)
                            continue
                        dec_sp, enc_sp = cls.normalize_legacy_vietnamese(
                            sp,
                            font_hint=font_hint,
                            _allow_sentence_split=False,
                        )
                        rebuilt_sents.append(dec_sp)
                        if enc_sp in sent_encs:
                            sent_encs[enc_sp] += 1
                    total_sent_enc = sent_encs["tcvn3"] + sent_encs["vni_windows"]
                    if total_sent_enc > 0:
                        dom_sent_enc = (
                            "tcvn3"
                            if sent_encs["tcvn3"] >= sent_encs["vni_windows"]
                            else "vni_windows"
                        )
                        out_lines.append(
                            unicodedata.normalize("NFC", "".join(rebuilt_sents)) + line_ending
                        )
                        detected_counts[dom_sent_enc] += 1
                        prev_line_enc = dom_sent_enc
                        continue
                prev_line_enc = None
                out_lines.append(raw_piece)
            else:
                prev_line_enc = None
                out_lines.append(raw_piece)

        total_applied = detected_counts["tcvn3"] + detected_counts["vni_windows"]
        if total_applied == 0:
            norm_out = (
                text if unicodedata.is_normalized("NFC", text) else unicodedata.normalize("NFC", text)
            )
            return norm_out, None

        dominant_enc = (
            "tcvn3"
            if detected_counts["tcvn3"] >= detected_counts["vni_windows"]
            else "vni_windows"
        )
        return unicodedata.normalize("NFC", "".join(out_lines)), dominant_enc
