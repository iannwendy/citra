"""Author parser — chuẩn hoá author name cho so khớp (v1.2 §3.4, §3.7).

Bài toán:
    Trích xuất author name từ text có nhiều định dạng:
    - "Smith, J." (APA / Chicago / Harvard)
    - "Smith J. K." (không dấu phẩy)
    - "J. K. Smith" (last-name cuối, initials đầu)
    - "van der Berg, J." (multi-word last name — Dutch)
    - "O'Brien, M." (O'Apostrophe)
    - "Nguyễn Văn A" (Vietnamese — không dấu phẩy, family name đầu)
    - "Nguyễn, Văn A" (có dấu phẩy, ngược lại)
    - "Smith, John K." (full first name)
    - "Smith, J. K., & Doe, A. B." (multi-author)

Mục tiêu:
    Trả về Author record với:
        - last_name: họ (canonical form)
        - initials: list initials (e.g. ['J', 'K'])
        - full_first_name: optional
        - normalized: full canonical string để so khớp exact

Cảnh báo:
    KHÔNG dùng ML/NER nặng trong MVP — rule-based đủ cho v1.2.
    SpaCy en_core_web_sm sẽ được bật ở tuần 11 nếu coverage chưa đạt.

References:
    v1.2 §3.4 (TextPreprocessor + parsing đầy đủ)
    v1.2 §3.7 (author normalization)
    v1.2 §4.3 (annotation guideline author variant)
    config.matching.author_jaccard_verified (threshold so khớp)
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# --- Common Dutch multi-word last names (rule-based heuristic) ---
# Nếu first word là 1 trong các từ này → "X Y Z, F." → last_name = "X Y Z".
_DUTCH_MULTI_WORD_PREFIXES = frozenset([
    "van", "de", "den", "der", "ten", "ter",
    "von", "zu", "zur", "af",
    "le", "la", "du", "di", "da",
    "el", "al", "st", "st.",
])

# Particles trong nhiều ngôn ngữ — viết THƯỜNG trong họ
_PARTICLES = frozenset([
    "van", "de", "den", "der", "ten", "ter",
    "von", "zu", "zur", "af",
    "le", "la", "du", "di", "da",
    "el", "al", "st", "st.",
])


# --- Common Vietnamese family names (rule-based heuristic) ---
# Vietnamese: family name đầu; middle name giữa; first name cuối.
# Chỉ dùng khi KHÔNG có dấu phẩy (vì dấu phẩy → APA-style "Family, Given").
_VN_FAMILY_NAMES = frozenset([
    "nguyễn", "trần", "lê", "phạm", "hoàng", "huỳnh", "phan", "vũ", "võ",
    "đặng", "bùi", "đỗ", "hồ", "ngô", "dương", "lý", "đào", "đinh",
    "trịnh", "mai", "trương", "châu", "đoàn", "tô", "tăng",
])


@dataclass(frozen=True)
class Author:
    """Một author name đã parse.

    Attributes:
        last_name: họ (canonical form, lowercase, multi-word joined).
        initials: list initials ['J', 'K']. Empty list nếu không rõ.
        full_first_names: full first name nếu có (e.g. 'John'). Empty nếu
            chỉ thấy initials.
        normalized: canonical string dùng cho exact-match so khớp.
            Format: 'last_name|initials' (lowercase, no space).
        raw: original input (cho debug).
    """

    last_name: str
    initials: list[str] = field(default_factory=list)
    full_first_names: list[str] = field(default_factory=list)
    normalized: str = ""
    raw: str = ""

    @property
    def first_name(self) -> str:
        """Return full first names or formatted initials for serialization."""
        if self.full_first_names:
            return " ".join(self.full_first_names)
        if self.initials:
            return " ".join(
                f"{i.rstrip('.').upper()}."
                for i in self.initials
                if i and i.rstrip(".")
            )
        return ""


# --- Regex helpers ---

_UPPER_VN = r"[A-ZÀ-ÝĂÂĐÊÔƠƯĨŨẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]"
_INITIAL_RE = re.compile(rf"^{_UPPER_VN}\.?$")               # chỉ J. / J / Đ. (1 char + optional dot)
_PARTICLE_WORD_RE = re.compile(r"^[a-zà-ỹ]+$")              # một từ đơn lowercase
_INITIAL_TOKEN_RE = re.compile(rf"^{_UPPER_VN}\.?$")

# Corporate / Institutional author indicator (TDTU §2.6.2: hiệp hội, tổ chức, cơ quan ban hành)
_CORPORATE_AUTHOR_RE = re.compile(
    r"^(?:Bộ|Tổng\s+cục|Ủy\s+ban|Uỷ\s+ban|Chính\s+phủ|Ngân\s+hàng|Tổ\s+chức|Hiệp\s+hội"
    r"|Viện|Trường|Đại\s+học|Cục|Vụ|Sở|Ban|Tập\s+đoàn|Công\s+ty|Quốc\s+hội"
    r"|Department|Ministry|Association|Organization|Organisation|Institute|Institution"
    r"|Council|Committee|Commission|Agency|Bureau|Office|University|College"
    r"|World\s+Health|United\s+Nations|World\s+Bank|Reserve\s+Bank|General\s+Statistics"
    r"|International\s+Monetary|European\s+Union|National\s+Institute|Australian\s+Council"
    r"|Barnes\s*&\s*Noble|Bookish\s+Goblin|ReadDown|Goodreads|Calibraint|Fortinet|FireEye"
    r"|Radware|MITRE|IBM|OpenRocket|MathWorks|Statista|Liberty\s+Rocketry)\b"
    r"|\b(?:of|for)\s+(?:the\s+)?[A-ZÀ-Ý]"
    r"|\b(?:PTNT|GD&ĐT|KH&CN|GTVT|TN&MT|LĐTB&XH|Association|Organization|Organisation"
    r"|Ministry|Department|University|Institute|Institution|Council|Government|Corporation"
    r"|Administration|Center|Centre|Research|Advisors|Project|Team|Developers|Clinics"
    r"|Foundation|Society|Federation|Encyclopedia|Archive|Initiative|Network|Contributors"
    r"|Guard|Force|Command|Commission|Intelligence|Security|Deals|Drug"
    r"|LLC|Inc|Ltd|Corp|GmbH|PLC|OpenAI|Anthropic|DeepMind|DeepSeek|Meta\s+AI|Hugging\s*Face)\b",
    re.IGNORECASE,
)


_CREDENTIAL_NOISE_RE = re.compile(
    r"(?:\s*\[[^\]]+\]|,\s*(?:Ph\.?D\.?|M\.?D\.?|Esq\.?|ATC|PT|SCS|CSCS|FACSM|RN|MPH|Ed\.?D\.?|Psy\.?D\.?)\b)+",
    re.IGNORECASE,
)


def _strip_author_credentials(raw: str) -> str:
    """Remove bracketed aliases (e.g. '[Doctor Mike]') and academic credentials ('PhD, ATC')."""
    if not raw:
        return ""
    return _CREDENTIAL_NOISE_RE.sub("", raw).strip()


def _is_corporate_author(raw: str) -> bool:
    """True if ``raw`` represents an organization/institution rather than personal names."""
    cleaned = _strip_author_credentials((raw or "").strip()).rstrip(".,;").strip()
    if not cleaned:
        return False
    # If it contains "Surname, I." APA initial pattern, it's personal author(s)
    if re.search(rf"{_UPPER_VN}[a-zà-ỹ'\-]+,\s*{_UPPER_VN}\.", cleaned):
        return False
    return bool(_CORPORATE_AUTHOR_RE.search(cleaned))


def _strip_particles_from_first_name(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Tách last_name vs first_name parts dựa trên particle.

    Trả về (last_name_tokens, first_name_tokens).
    Cho APA-style "van der Berg, J.": tokens = ['van', 'der', 'Berg', ',', 'J.']
        → split tại dấu phẩy → last_words = ['van', 'der', 'Berg'], first = ['J.']
        → particle ở đầu last_words ('van') → KHÔNG strip
        → result: last = ['van', 'der', 'Berg'], first = ['J.']
    """
    return tokens  # placeholder


def _canonicalize_last_name(last_tokens: list[str]) -> str:
    """Chuẩn hoá last name: lowercase, join với space.

    'van der Berg' → 'van der berg' (giữ nguyên thứ tự particle).
    """
    return " ".join(t.lower() for t in last_tokens if t)


def _is_particle(token: str) -> bool:
    return token.lower() in _PARTICLES


def _split_on_comma(raw: str) -> tuple[list[str], list[str]] | None:
    """Tách theo dấu phẩy đầu tiên.

    "Smith, J. K." → (['Smith'], ['J.', 'K.'])
    "van der Berg, J." → (['van', 'der', 'Berg'], ['J.'])
    """
    if "," not in raw:
        return None
    last_str, first_str = raw.split(",", 1)
    # Preserve the order and case of tokens for last name
    last_tokens = last_str.split()
    first_tokens = first_str.split()
    return last_tokens, first_tokens


# --- Public API ---


def normalize_author(raw: str) -> Author:
    """Parse 1 author name thành Author.

    Args:
        raw: raw author string, có thể ở nhiều format.

    Returns:
        Author với last_name, initials, normalized.
    """
    raw = (raw or "").strip()
    if not raw:
        return Author(last_name="", raw="")

    # Chuẩn hoá Unicode (NFC) trước + strip credentials / bracketed handles
    raw = _strip_author_credentials(unicodedata.normalize("NFC", raw))
    if not raw:
        return Author(last_name="", raw="")

    # FIX: Handle "et al." / "và cộng sự" / "và cs." / "và ctv." pattern - NOT part of the author name
    et_al_match = re.search(
        r",?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên)\s*$",
        raw,
        re.IGNORECASE,
    )
    if et_al_match:
        raw = raw[:et_al_match.start()].strip().rstrip(",")
        if not raw:
            return Author(last_name="", raw=raw)

    # Strategy 0: Corporate / Institutional author (TDTU §2.6.2)
    if _is_corporate_author(raw):
        clean_corp = raw.strip().rstrip(".,;").strip()
        corp_norm = " ".join(clean_corp.lower().split())
        return Author(
            last_name=corp_norm,
            initials=[],
            normalized=corp_norm,
            raw=clean_corp,
        )

    # Strategy 1: comma-split (APA / Chicago)
    parts = _split_on_comma(raw)
    if parts:
        last_tokens, first_tokens = parts
        last_name = _canonicalize_last_name(last_tokens)
        initials = _extract_initials_from_first_tokens(first_tokens)
        normalized = f"{last_name}|{'.'.join(initials)}" if initials else last_name
        return Author(
            last_name=last_name,
            initials=initials,
            normalized=normalized,
            raw=raw,
        )

    # Strategy 2: không có dấu phẩy — 2 sub-cases:
    #   2a. Initial(s) trước, last name sau: "J. K. Smith" / "JK Smith"
    #   2b. Last name trước, initials sau: "Smith J." / "Smith J. K."
    #   2c. Vietnamese: "Nguyễn Văn A"

    tokens = raw.split()
    if not tokens:
        return Author(last_name="", raw=raw)

    # 2a: nếu token đầu là initial → last ở cuối
    if _INITIAL_RE.match(tokens[0]):
        last_tokens = [_INITIAL_RE.sub("", tokens[0])] if False else tokens[-1:]   # always last
        # Actually: heuristic — nếu token đầu là initial và token cuối không phải initial
        last_name_tokens = [tokens[-1]]
        initials = _extract_initials_from_tokens(tokens[:-1])
        last_name = _canonicalize_last_name(last_name_tokens)
        normalized = f"{last_name}|{'.'.join(initials)}" if initials else last_name
        return Author(
            last_name=last_name,
            initials=initials,
            normalized=normalized,
            raw=raw,
        )

    # 2c: Vietnamese family name đầu + multi-word given name
    if tokens[0].lower() in _VN_FAMILY_NAMES and len(tokens) >= 2:
        # Không chắc chắn 100% (có người Việt tên Âu), nhưng heuristic OK
        last_name = _canonicalize_last_name([tokens[0]])
        initials = _extract_initials_from_tokens(tokens[1:])
        normalized = f"{last_name}|{'.'.join(initials)}" if initials else last_name
        return Author(
            last_name=last_name,
            initials=initials,
            normalized=normalized,
            raw=raw,
        )

    # 2b: last name đầu + 1+ initials ở đuôi
    # Tìm boundary: từ cuối, các token ngược lên đều initial-like (1 char + dot
    # HOẶC 1 chữ cái đứng một mình — vd "Smith J." có thể có middle initial "K"
    # tách rời như "Smith J. K.").
    last_tokens, initials_after = _split_last_initials(tokens)
    if initials_after and len(last_tokens) >= 1:
        last_name = _canonicalize_last_name(last_tokens)
        normalized = f"{last_name}|{'.'.join(initials_after)}" if initials_after else last_name
        return Author(
            last_name=last_name,
            initials=initials_after,
            normalized=normalized,
            raw=raw,
        )

    # Fallback: toàn bộ là last name (không rõ initials)
    return Author(
        last_name=_canonicalize_last_name(tokens),
        initials=[],
        normalized=_canonicalize_last_name(tokens),
        raw=raw,
    )


def parse_authors(raw: str, format_name: str | None = None) -> list[Author]:
    """Parse 1 chuỗi nhiều authors thành list Author.

    Args:
        raw: Chuỗi author names cần parse.
        format_name: Định dạng citation (APA / IEEE / Vancouver / None).
            - Nếu None: dùng heuristic detection (mặc định).
            - Nếu có giá trị: dùng format-specific parsing.

    Xử lý separators (APA / Chicago / IEEE / Vancouver):
        - 'Smith, J., & Jones, A.'       (APA with &)
        - 'Smith, J. and Jones, A.'      (APA with "and")
        - 'Smith, J.; Jones, A.'         (semicolon)
        - 'Smith J., Jones A.'           (no comma)
        - 'Smith, J., Jones, A.'         (comma between authors, no &)
        - 'LeCun, Y., Bengio, Y., & Hinton, G.'  (3+ authors)
        - 'Bowman, Angeli, Potts, et al.' (Vancouver with et al.)

    Format-specific behavior:
        - **APA**: "LastName, I." format, "et al." support, "&" / "and" separators
        - **IEEE**: Initials first (e.g., "J. Smith"), comma-separated authors
        - **Vancouver**: Initials first, no punctuation between initials (e.g., "JABC")

    Strategy:
        1. Chuẩn hoá separator chính (& / "and" / "et al." / ;) → TOKEN_SEP.
        2. Với mỗi piece còn lại, nếu có nhiều dấu phẩy lẻ → có thể là
           multi-author với APA pattern "Last, I., Last, I." — cần cẩn trọng.
           Quy tắc: "Last, I." → author; nếu tiếp theo là "Last," (không có
           initial) → bắt đầu author mới.
    """
    if not raw:
        return []

    raw_nfc = _strip_author_credentials(unicodedata.normalize("NFC", raw.strip()))
    if not raw_nfc:
        return []
    if _is_corporate_author(raw_nfc):
        corp_author = normalize_author(raw_nfc)
        return [corp_author] if corp_author.last_name else []

    # Format-specific parsing when format_name is provided
    if format_name:
        format_upper = format_name.upper()
        if format_upper in ("APA", "HARVARD", "NATURE", "ACS", "CHICAGO", "MLA"):
            return _parse_apa_format(raw_nfc)
        elif format_upper in ("IEEE", "ACM"):
            if re.match(rf"^{_PARTICLES_GROUP}\s*{_UPPER_VN}[a-zà-ỹ'\-]+,", raw_nfc):
                return _parse_apa_format(raw_nfc)
            return _parse_ieee_format(raw_nfc)
        elif format_upper in ("VANCOUVER", "AMA", "CSE"):
            return _parse_vancouver_format(raw_nfc)
        # Unknown format, fall back to heuristic detection
        logger.debug(f"Unknown format_name: {format_name}, using heuristic detection")

    # Heuristic detection (default behavior when format_name is None)
    # Chuẩn hoá separator → split-friendly
    text = raw_nfc

    # Handle "et al." / "và cộng sự" / "và cs." / "và ctv." - replace with separator
    text = re.sub(
        r",?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên)\s*$",
        ";",
        text,
        flags=re.IGNORECASE,
    )

    # Normalize other separators (including Vietnamese "và")
    text = re.sub(r"\s+(?:and|và)\s+", " ; ", text, flags=re.IGNORECASE)
    text = text.replace("&", ";")

    # Bước 1: Nếu có separator chính (;), split piece-by-piece.
    # Mỗi piece vẫn có thể chứa nhiều author (vd "LeCun, Y., Bengio, Y.").
    if ";" in text:
        raw_pieces = [p.strip() for p in text.split(";") if p.strip()]
        authors: list[Author] = []
        for piece in raw_pieces:
            # Mỗi piece có thể là "Last, I., Last, I." → split_apa_authors
            authors.extend(_split_apa_authors(piece))
        return authors

    # Bước 2: Nếu không có separator chính, có thể là "Last, I., Last, I., & Last, I."
    return _split_apa_authors(text)


def _parse_apa_format(text: str) -> list[Author]:
    """Parse author string using APA format rules.

    APA format characteristics:
    - "LastName, Initials" pattern (e.g., "Smith, J.", "Vaswani, A.")
    - "et al." for 3+ authors (e.g., "Brown et al., 2020")
    - "&" or "and" as separator between authors
    - "and" before last author in list of 3+

    Examples:
    - "Smith, J." -> 1 author
    - "Smith, J., & Jones, A." -> 2 authors
    - "Vaswani, A., Shazeer, N., Parmar, N., et al." -> 3+ authors with et al.
    """
    text = text.strip()
    if not text:
        return []

    if _is_corporate_author(text):
        corp_author = normalize_author(text)
        return [corp_author] if corp_author.last_name else []

    # Handle "et al." / "và cộng sự" - replace with separator for individual parsing
    text = re.sub(
        r",?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên)\s*$",
        ";",
        text,
        flags=re.IGNORECASE,
    )

    # Normalize APA separators
    text = re.sub(r"\s+(?:and|và)\s+", " ; ", text, flags=re.IGNORECASE)
    text = text.replace("&", ";")

    authors: list[Author] = []
    if ";" in text:
        pieces = [p.strip() for p in text.split(";") if p.strip()]
        for piece in pieces:
            authors.extend(_split_apa_authors(piece))
    else:
        authors = _split_apa_authors(text)

    return authors


def _parse_ieee_format(text: str) -> list[Author]:
    """Parse author string using IEEE format rules.

    IEEE format characteristics:
    - Initials first, then last name (e.g., "J. Smith", "A. Vaswani")
    - Multiple initials before last name (e.g., "J. B. Smith")
    - Periods after each initial
    - Comma-separated authors

    Examples:
    - "J. Smith" -> last_name=Smith, initials=[J]
    - "A. Vaswani, N. Shazeer, et al." -> 2+ authors
    - "J. B. Smith, A. Jones" -> last_name=Smith, initials=[J, B]
    """
    text = text.strip()
    if not text:
        return []

    # Handle "et al." - replace with separator
    text = re.sub(r",?\s*et\s+al\.?\s*$", ";", text, flags=re.IGNORECASE)

    # Normalize IEEE separators: comma + space typically separates authors
    text = re.sub(r"\s+and\s+", " ; ", text, flags=re.IGNORECASE)
    text = text.replace("&", ";")

    authors: list[Author] = []

    # Split by semicolon (et al. replacement) or comma
    pieces = (
        [p.strip() for p in text.split(";") if p.strip()]
        if ";" in text
        else [p.strip() for p in text.split(",") if p.strip()]
    )
    for piece in pieces:
        tokens = piece.split()
        if (
            "," not in piece
            and len(tokens) >= 2
            and not _INITIAL_RE.match(tokens[0])
            and not _is_initial_token(tokens[-1])
            and tokens[0].lower() not in _VN_FAMILY_NAMES
            and tokens[0].lower() not in _PARTICLES
        ):
            fn_authors = _parse_firstname_lastname_no_et_al(piece)
            if fn_authors:
                authors.extend(fn_authors)
                continue
        a = normalize_author(piece)
        if a.last_name:
            authors.append(a)

    return authors


def _parse_vancouver_format(text: str) -> list[Author]:
    """Parse author string using Vancouver format rules.

    Vancouver format characteristics:
    - Initials first (no periods between initials, but can have periods)
    - No punctuation between initials
    - Surname last
    - Up to 6 authors, then "et al." or first 6 + "et al."

    Examples:
    - "Smith J" -> last_name=Smith, initials=[J]
    - "Smith JK" -> last_name=Smith, initials=[J, K]
    - "Bowman SR, Angeli L, Potts C" -> 3 authors
    - "Vaswani A, Shazeer N, Parmar N, et al." -> 3+ with et al.
    """
    text = text.strip()
    if not text:
        return []

    # Handle "et al." - replace with separator
    text = re.sub(r",?\s*et\s+al\.?\s*$", ";", text, flags=re.IGNORECASE)

    # Normalize Vancouver separators: comma typically separates authors
    text = re.sub(r"\s+and\s+", " ; ", text, flags=re.IGNORECASE)
    text = text.replace("&", ";")

    authors: list[Author] = []

    # Split by semicolon (et al. replacement) or comma
    if ";" in text:
        pieces = [p.strip() for p in text.split(";") if p.strip()]
    else:
        pieces = [p.strip() for p in text.split(",") if p.strip()]

    for piece in pieces:
        # Vancouver: "LastName Initials" - initials are at the end without period between
        # "Smith JK" -> tokens = ["Smith", "JK"] -> last_name=Smith, initials=[J, K]
        # "Smith J" -> tokens = ["Smith", "J"] -> last_name=Smith, initials=[J]
        tokens = piece.split()
        if not tokens:
            continue

        if len(tokens) >= 2:
            # Last token might be initials or last name continuation
            last_token = tokens[-1]
            rest = tokens[:-1]

            # Check if last token looks like initials (e.g., "JK", "J", "J.K.")
            # Initials can be: single letter, multiple letters, or with periods
            is_initials = len(last_token) <= 6 and (
                last_token.isupper() or
                all(c.isupper() or c == '.' for c in last_token)
            )

            if is_initials and len(rest) >= 1:
                last_name, initials = _handle_initials_pattern(rest, last_token)

                author = Author(
                    last_name=last_name.lower(),
                    initials=initials,
                    normalized=f"{last_name.lower()}|{''.join(initials).lower()}" if initials else last_name.lower(),
                    raw=piece,
                )
                authors.append(author)
            else:
                # Could be "FirstName LastName" format - take last token as last name
                last_name = last_token.rstrip(".,;|")
                first_part = " ".join(rest).rstrip(".,;|")

                if first_part:
                    # Extract initials from first part
                    initials = []
                    for word in first_part.split():
                        if word and word[0].isupper():
                            initials.append(word[0].upper())
                else:
                    initials = []

                if len(last_name) >= 1:
                    author = Author(
                        last_name=last_name.lower(),
                        initials=initials,
                        normalized=f"{last_name.lower()}|{''.join(initials).lower()}" if initials else last_name.lower(),
                        raw=piece,
                    )
                    authors.append(author)
        else:
            # Single token - could be just a last name
            last_name = tokens[0].rstrip(".,;|")
            if len(last_name) >= 2:
                author = Author(
                    last_name=last_name.lower(),
                    initials=[],
                    normalized=last_name.lower(),
                    raw=piece,
                )
                authors.append(author)

    return authors


def _handle_initials_pattern(rest: list[str], initials_token: str) -> tuple[str, list[str]]:
    """Xử lý pattern "LastName Initials" (Vancouver) cho phần tên đã tách.

    Args:
        rest: các token tên phía trước token initials (vd ["van", "der", "Berg"]).
        initials_token: token initials (vd "JK", "J", "J.K.").

    Returns:
        (last_name, initials) — last_name đã loại bỏ ký tự phân cách cuối,
        initials là danh sách chữ cái viết hoa.
    """
    initials = [c.upper() for c in initials_token if c.isalpha()]

    # Nếu tên có particle (van der Berg), last_name gồm particle + từ cuối
    last_name = " ".join(rest).rstrip(".,;|").strip()
    if not last_name:
        last_name = initials_token.rstrip(".,;|")

    return last_name, initials


def _safe_parse(piece: str) -> Author | None:
    a = normalize_author(piece)
    return a if a.last_name else None


# Pattern APA: "LastName, I." hoặc "LastName, I. K."
# Tên có thể có particle (van der Berg, de la Cruz) → group tên phức tạp.
# Cho phép leading particle(s) lowercase trước Capital last word.
#
# IMPORTANT: Restrict particles to KNOWN particles only to prevent "ohn" being
# matched as a particle before "Blitzer". Only particles like "van", "de", "von", etc.
#
# Compound particles (van der, de la) need to be matched together.
# Use ordered alternation: longest first ("van der", "de la", etc.) then individual.
_PARTICLES_GROUP = (
    r"(?:[Vv]an\s+der|[Tt]en\s+ter|[Dd]e\s+la|[Dd]er\s+den|[Zz]u\s+zur|[Ll]e\s+la|[Dd]os\s+[Rr]eis)?"  # compound particles first
    r"(?:[Vv]an|[Dd]e|[Dd]er|[Dd]en|[Vv]on|[Zz]u|[Zz]ur|[Aa]f|[Ll]e|[Ll]a|[Dd]u|[Dd]i|[Dd]a|[Dd]os|[Ee]l|[Aa]l|[Tt]en|[Tt]er|[Ss]t\.)?"  # then single particles
)

_APA_AUTHOR_RE = re.compile(
    rf"""
    (?P<author>
        { _PARTICLES_GROUP }\s*  # optional particles
        {_UPPER_VN}[a-zà-ỹ\-\'\u2019]+(?:[A-ZÀ-Ý][a-zà-ỹ\-\'\u2019]+)*(?:\s+{_UPPER_VN}[a-zà-ỹ\-\'\u2019]+){{0,2}}   # 1-3 word surname
        ,\s*
        (?:{_UPPER_VN}\.(?:\s*[-–]?\s*{_UPPER_VN}\.?)*|{_UPPER_VN}(?:\s*[-–]?\s*{_UPPER_VN})*)(?![A-Za-zÀ-ỹ])
    |
        {_UPPER_VN}[a-zà-ỹ\-\'\u2019]+(?:[A-ZÀ-Ý][a-zà-ỹ\-\'\u2019]+)*(?:\s+{_UPPER_VN}[a-zà-ỹ\-\'\u2019]+){{0,2}}   # 1-3 word surname
        ,\s*
        (?:{_UPPER_VN}\.(?:\s*[-–]?\s*{_UPPER_VN}\.?)*|{_UPPER_VN}(?:\s*[-–]?\s*{_UPPER_VN})*)(?![A-Za-zÀ-ỹ])
    )
    """,
    re.VERBOSE,
)


def _is_initial_token(tok: str) -> bool:
    """True nếu token là một initial: 'J', 'J.', 'Đ.', và cả cụm 'J.K.'."""
    tok = unicodedata.normalize("NFC", tok).strip(".,;")
    if not tok:
        return False
    stripped = tok.replace(".", "")
    if not stripped or len(stripped) > 3:
        return False
    return all(ch.isalpha() and ch.isupper() for ch in stripped)


def _count_separator_commas(text: str) -> int:
    """Đếm dấu phẩy đóng vai trò separator giữa các author.

    "LeCun, Y., Bengio, Y." → 2  (', Bengio', ', Yann' ở dạng full name)
    "LeCun, Y., Bengio, Y., Hinton, G." → 3
    "Y., Bengio" → dấu phẩy ngay sau initial KHÔNG tính.
    """
    count = 0
    for m in re.finditer(r",\s*([^\s,&.]+)", text):
        if not _is_initial_token(m.group(1)):
            count += 1
    return count


def _split_after_separator_commas(text: str) -> list[str]:
    """Tách author list tại các dấu phẩy là separator, GIỮ dấu phẩy sau initial.

    "LeCun, Y., Bengio, Y., & Hinton, G."
        → ["LeCun, Y.", "Bengio, Y.", "Hinton, G."]
    """
    parts: list[str] = []
    start = 0
    for m in re.finditer(r",", text):
        # A comma followed by a plain word ("LeCun, Yann", "Bowman, Angeli")
        # separates authors. A comma followed by initials ("LeCun, Y.") or by
        # nothing / a conjunction ("Y., Bengio") belongs to the previous name.
        if not re.match(r"\s*[^\s,&.]+", text[m.end():]):
            continue
        following = re.match(r"\s*([^\s,&.]+)", text[m.end():]).group(1)
        if _is_initial_token(following):
            continue
        parts.append(text[start : m.start()])
        start = m.end()
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def _is_surname_initial_piece(piece: str) -> bool:
    """True nếu piece là MỘT author APA đơn lẻ "Surname... , Initials".

    "LeCun, Y." / "van der Berg, J." → True
    "Yann" (full first name) / "Hinton, G. (2015). Deep learning." → False
    """
    return bool(_APA_AUTHOR_RE.fullmatch(piece.strip(" ,")))


def _is_vancouver_surname(piece: str) -> bool:
    """True nếu piece là surname Vancouver 1-2 từ, không có initials.

    "Bowman" / "Angeli" / "van der Berg" → True
    "Potts C" (Vancouver "Surname Initials") → False — để nhánh Vancouver cũ xử lý
    """
    words = piece.split()
    return 1 <= len(words) <= 2 and all(_PARTICLE_WORD_RE.match(w) for w in words)


def _split_apa_authors(text: str) -> list[Author]:
    """Tách multi-author APA không có separator rõ ràng.

    Strategy: tìm tất cả match của APA pattern liên tiếp trong text.
    Phần còn lại (nếu có) được ghép vào author cuối.

    Also detects Vancouver style (multiple commas without "and"/"&") and parses directly.
    """
    # Clean trailing punctuation
    text = text.strip().rstrip(".,")
    if not text:
        return []

    # Detect Vancouver style: multiple commas, no "and"/"&", likely separate names
    # "Bowman, Angeli, Potts" -> three separate single-word last names
    # A comma AFTER an initial ("Y., Bengio") is a punctuation mark belonging to
    # that initial, not an author-list separator. Only commas that precede a
    # plain word ("LeCun, Yann", "Bowman, Angeli") are candidate separators.
    separator_commas = _count_separator_commas(text)
    has_and_or_amp = bool(re.search(r"\s+and\s+|&", text, re.IGNORECASE))
    if separator_commas >= 2:
        # APA with a dangling "&" splits into one "Last, Initials" piece per
        # author: "LeCun, Y., Bengio, Y., & Hinton, G.". Parse each piece on its
        # own so no initials are dropped ("lecun|" for every author — the bug)
        # or glued onto the wrong author. Checked BEFORE the Vancouver branch
        # because "LeCun, Y." also looks like a two-word surname there.
        # Also works with "&" present — a letter-based comma split is what
        # keeps "LeCun, Y., & Bengio, Y." from becoming a single author.
        # A piece carrying a year is not an author piece — it is the trailing
        # title/venue of an entry-level string ("… Bengio, Y. (2015). Deep
        # learning. Nature, 521"); leave that to the heuristics below.
        pieces = _split_after_separator_commas(text)
        if (
            len(pieces) > 1
            and not any(re.search(r"\((?:19|20)\d{2}[a-z]?\)|\b(?:19|20)\d{2}\b", p) for p in pieces)
            and all(_is_surname_initial_piece(p) for p in pieces)
        ):
            return [normalize_author(p.strip(" ,")) for p in pieces]
        if not has_and_or_amp and pieces and all(_is_vancouver_surname(p) for p in pieces):
            # "Bowman, Angeli, Potts" — bare surnames, no initials.
            return _parse_firstname_lastname_no_et_al(text)
        # Anything else (a trailing title/venue after the author block, full
        # first names, mixed lists) keeps the match-based heuristics below.

    matches = list(_APA_AUTHOR_RE.finditer(text))
    if matches:
        authors = []
        # For each match, also process any text AFTER it that looks like "FirstName LastName"
        # e.g., "John Blitzer, Ryan McDonald, and Fernando Pereira"
        # Matches: "Blitzer, R.", but "Ryan McDonald" and "Fernando Pereira" need to be caught

        for i, m in enumerate(matches):
            # Process the APA match
            piece = m.group("author").strip()
            a = normalize_author(piece)
            if a.last_name:
                authors.append(a)

            # Extract text AFTER this match
            if i < len(matches) - 1:
                # Text between this match and next match
                after_text = text[m.end():matches[i+1].start()]
            else:
                # Text after last match (to end of string)
                after_text = text[m.end():]

            # Process after_text to find "FirstName LastName" pieces
            if after_text:
                # Replace "and" with semicolon and split
                after_text = re.sub(r'\s+and\s+', ' ; ', after_text, flags=re.IGNORECASE)
                after_text = after_text.replace("&", " ; ")
                for piece in after_text.split(";"):
                    piece = piece.strip().rstrip(",").strip()
                    if piece and len(piece) >= 2:
                        tokens = piece.split()
                        if len(tokens) >= 2:
                            # Take last token as last_name (FirstName LastName format)
                            last_name = tokens[-1].rstrip(".,;|")
                            if last_name and len(last_name) >= 2:
                                a = Author(
                                    last_name=last_name.lower(),
                                    initials=[],
                                    normalized=last_name.lower(),
                                    raw=piece,
                                )
                                authors.append(a)

        return authors

    # No APA matches - try FirstName LastName format
    return _parse_firstname_lastname_no_et_al(text)


def _parse_firstname_lastname_no_et_al(text: str) -> list[Author]:
    """Parse FirstName LastName without et al.

    Handles:
    - "FirstName LastName, FirstName LastName, and LastName" (multiple authors)
    - "LastName, LastName, LastName" (Vancouver style - single-word last names)
    - "Smith J" (Vancouver: LastName Initial)
    - "Bowman, Angeli, Potts, and Manning" (Vancouver with "and" before last author)

    IMPORTANT: Handle "and" BEFORE comma split for correct parsing of
    "John Blitzer, Ryan McDonald, and Fernando Pereira"
    """
    # Replace " and " / " và " with semicolon separator FIRST, before splitting by comma
    # This handles "John Blitzer, Ryan McDonald, and Fernando Pereira" correctly
    # where "and Fernando Pereira" needs to be separated from "Ryan McDonald,"
    normalized = re.sub(r"\s+(?:and|và)\s+", " ; ", text, flags=re.IGNORECASE).replace("&", " ; ")

    # Split by semicolon (our "and" replacement) and comma
    # Each semicolon-separated piece may contain comma-separated author groups
    semicolon_parts = [s.strip() for s in normalized.split(";") if s.strip()]

    authors = []
    for sem_part in semicolon_parts:
        # Split each semicolon part by comma
        comma_parts = [p.strip() for p in sem_part.split(",") if p.strip()]

        # Handle Chicago/MLA "Last, First [M.]" at the start of comma_parts:
        # e.g. "Smith, John A." or "Smith, John, Jane Doe"
        start_idx = 0
        if len(comma_parts) >= 2:
            first_toks = [t for t in comma_parts[0].split() if not _is_particle(t)]
            second_toks = comma_parts[1].split()
            is_single_surname = (
                len(first_toks) == 1
                and not _is_initial_token(first_toks[0])
                and len(first_toks[0].strip(".,;")) >= 2
            )
            second_looks_like_given = bool(second_toks) and (
                len(comma_parts) == 2
                or _is_initial_token(second_toks[-1])
            ) and not _is_initial_token(second_toks[0])
            # Do not merge if comma_parts[0] or comma_parts[1] is Vancouver "Surname Initials"
            if (
                is_single_surname
                and second_looks_like_given
                and not (len(second_toks) >= 2 and _is_initial_token(second_toks[-1]) and len(comma_parts) > 2 and all(len(cp.split()) >= 2 and _is_initial_token(cp.split()[-1]) for cp in comma_parts))
            ):
                paired = normalize_author(f"{comma_parts[0]}, {comma_parts[1]}")
                if paired.last_name:
                    authors.append(paired)
                start_idx = 2

        for part in comma_parts[start_idx:]:
            if not part or len(part) < 2:
                continue

            tokens = part.split()

            if len(tokens) >= 2:
                # Check if last token is initials (1-3 uppercase letters with/without dots)
                # "Smith J" or "Smith JA" -> last_name=Smith, initials=[J] or [J, A]
                if _is_initial_token(tokens[-1]):
                    # Format: "LastName Initials" (Vancouver / AMA / CSE)
                    last_name = " ".join(tokens[:-1]).rstrip(".,;|")
                    initials = [c.upper() for c in tokens[-1] if c.isalpha()]
                else:
                    # Format: "FirstName LastName" or "FirstName Middle LastName"
                    last_name = tokens[-1].rstrip(".,;|")
                    first_names = " ".join(tokens[:-1]).rstrip(".,;|")
                    initials = [t[0] + "." for t in first_names.split() if t and t[0].isupper()]

                if last_name and len(last_name) >= 2:
                    author = Author(
                        last_name=last_name.lower(),  # Consistent lowercase
                        initials=initials if initials else [],
                        normalized=f"{last_name.lower()}|{''.join(initials).lower()}" if initials else last_name.lower(),
                        raw=part,
                    )
                    authors.append(author)
            else:
                # Single word: just a last name (Vancouver style)
                last_name = part.rstrip(".,;|")
                if last_name and len(last_name) >= 2:
                    author = Author(
                        last_name=last_name.lower(),  # Lowercase for single-word names
                        initials=[],
                        normalized=last_name.lower(),
                        raw=last_name,
                    )
                    authors.append(author)

    return authors


# --- Internals ---


def _extract_initials_from_first_tokens(tokens: list[str]) -> list[str]:
    """Từ list tokens phía sau dấu phẩy APA → initials.

    ['J.'] → ['J']
    ['J.', 'K.'] → ['J', 'K']
    ['John', 'K.'] → ['J', 'K']   # full first name → lấy J từ John
    ['Laurens'] → ['l']           # full first name > 4 chars → lấy l từ Laurens
    ['John', 'K.', 'Smith'] → ['J', 'K']   # author bị trộn (edge case)
    """
    initials: list[str] = []
    seen_dotted_initial = False
    for tok in tokens:
        tok_clean = tok.strip(".,;")
        if not tok_clean:
            continue
        if _INITIAL_RE.match(tok_clean):
            initials.append(tok_clean[0].lower())
            seen_dotted_initial = True
        elif _is_initial_token(tok_clean):
            initials.extend(c.lower() for c in tok_clean if c.isalpha())
            if "." in tok:
                seen_dotted_initial = True
        elif _is_initial_like(tok_clean) or (
            not seen_dotted_initial
            and not initials
            and tok_clean[0].isupper()
            and tok_clean.lower() not in _PARTICLES
            and tok_clean.lower() not in {"jr", "sr", "ii", "iii", "iv"}
        ):
            initials.append(tok_clean[0].lower())
    return initials


def _is_initial_like(tok: str) -> bool:
    """True nếu token trông giống initial.

    'J.' → True
    'J' → True
    'John' → True (full first name, lấy chữ cái đầu)
    'Smith' → True (chữ cái đầu uppercase)
    'van' / 'der' / 'de' → False (particle — viết thường hết, không phải initial)
    'Jr.' → False (suffix)
    """
    tok = tok.strip(".,;")
    if not tok:
        return False
    # Particles viết thường (van / der / de / von...) KHÔNG phải initial
    if tok.lower() in _PARTICLES:
        return False
    if _INITIAL_RE.match(tok):
        return True
    if len(tok) <= 4 and tok[0].isupper() and tok[1:].islower():
        return True
    return False


def _extract_initials_from_tokens(tokens: list[str]) -> list[str]:
    """Từ list tokens → list initials (lowercase).

    'J.' → 'j'
    'J. K.' → 'j', 'k'
    'John' → 'j'  (full first name lấy chữ cái đầu)
    'Smith' → 's' (cũng lấy chữ cái đầu — không chắc chắn last vs first)
    'Jr.' → bỏ qua (suffix không phải initial)
    """
    initials: list[str] = []
    for tok in tokens:
        tok_clean = tok.strip(".,;")
        if not tok_clean:
            continue
        if _INITIAL_RE.match(tok_clean):
            initials.append(tok_clean[0].lower())
        elif _is_initial_token(tok_clean):
            initials.extend(c.lower() for c in tok_clean if c.isalpha())
        elif _is_initial_like(tok_clean):
            initials.append(tok_clean[0].lower())
    return initials


def _split_last_initials(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Tách boundary giữa last name và initials ở cuối.

    'Smith J.' → (['Smith'], ['J'])
    'Smith J. K.' → (['Smith'], ['J', 'K'])
    'van der Berg J.' → (['van', 'der', 'Berg'], ['J'])   # particles giữ nguyên
    'Smith John' → (['Smith'], ['John'])   # full first name treated as initial
    'J. K. Smith' → ([], [])  # không áp dụng (last ở cuối → sang 2a)

    Returns:
        (last_tokens, initials) — initials là list đã extract.
        Nếu không tìm được boundary hợp lệ → ([], []).
    """
    if len(tokens) < 2:
        return [], []

    # Từ cuối, đếm ngược các token initial-like
    i = len(tokens) - 1
    init_count = 0
    while i >= 0 and _is_initial_like(tokens[i]):
        i -= 1
        init_count += 1

    # Cần ít nhất 1 initial ở cuối, và last_tokens phải có ít nhất 1 token
    if init_count == 0:
        return [], []
    last_tokens = tokens[: len(tokens) - init_count]
    if not last_tokens:
        return [], []

    initial_tokens = tokens[len(tokens) - init_count:]
    return last_tokens, _extract_initials_from_tokens(initial_tokens)


def _split_initials_last(tokens: list[str]) -> tuple[list[str], list[str]]:
    """Tách initials đầu + last name cuối.

    'J. K. Smith' → (['J.', 'K.'], ['Smith'])
    'Smith' → ([], ['Smith'])   # không phân biệt được
    'Smith J.' → ([], ['Smith', 'J.'])   # last ở đầu, không áp dụng
    """
    if len(tokens) < 2:
        return [], tokens

    # Từ đầu, đếm xuôi các token initial-like
    i = 0
    init_count = 0
    while i < len(tokens) and _is_initial_like(tokens[i]):
        i += 1
        init_count += 1

    if init_count == 0:
        return [], tokens

    last_tokens = tokens[init_count:]
    if not last_tokens:
        return [], tokens

    initial_tokens = tokens[:init_count]
    return initial_tokens, last_tokens


# --- Helpers cho test + debug ---


def jaccard_similarity(a: list[str], b: list[str]) -> float:
    """Jaccard similarity trên 2 list last names.

    |A ∩ B| / |A ∪ B|.

    Dùng cho AuthorList matching: trích author list từ citation, trích
    author list từ candidate, đo Jaccard trên last names (lowercase).
    """
    if not a and not b:
        return 1.0
    set_a = {x.lower() for x in a if x}
    set_b = {x.lower() for x in b if x}
    if not set_a and not set_b:
        return 1.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0
