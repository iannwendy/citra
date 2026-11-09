"""ReferenceListParser — parse các entry ở cuối bài (References section).

Hỗ trợ (v1.2 §3.4):
    - APA-like: 'Smith, J. (2020). Title. Journal A, 10(2), 1-10. DOI: ...'
    - IEEE-like: '[1] Smith, J., "Title," Journal A, vol. 10, 2020.'
    - Vancouver: 'Smith J. Title. Journal A. 2020;10:1-10.'
    - Chicago author-date: tương tự APA

Sử dụng modular citation format system (patterns/):
    - Formats are loaded from registry at initialization
    - Format modules (APA, IEEE, Vancouver) are tried first
    - Legacy patterns kept as fallback for backward compatibility

Output:
    Citation với citation_type=REFERENCE_LIST và:
        - authors: list[str] (raw, dùng author_parser để canonicalize ở pipeline)
        - year + year_suffix
        - title (string)
        - title_normalized (cho duplicate detector)
        - venue
        - doi, url
        - numeric_index (cho IEEE-like)
        - order_index (vị trí trong bibliography)

References:
    v1.2 §3.4 (Reference list parsing)
    v1.2 §3.5 (bidirectional linking — cần title_normalized)
    v1.2 §4.3 (annotation guideline — reference variants)
    config.linking.duplicate_detection.title_year_author_similarity
"""

from __future__ import annotations

import logging
import re
from collections import Counter

from integrity_checker.extraction.base import Document
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.patterns import get_all_formats
from integrity_checker.extraction.patterns.apa import (
    is_vn_legal_reference,
    parse_vn_legal_reference,
)
from integrity_checker.extraction.patterns.base import CitationFormat
from integrity_checker.extraction.patterns.utils import extract_publication_year
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

logger = logging.getLogger(__name__)


# --- Regex patterns ---

# APA entry: authors block + (year) + . + title + . + venue + ... + DOI
_APA_ENTRY_RE = re.compile(
    r"""
    ^(?P<authors>.+?)                # authors block (lazy)
    \s*\(\s*(?:(?P<year>\d{4})(?P<suffix>[a-z])?(?:\s*,\s*[^)]*)?|(?P<nd>n\.?\s*d\.?))
    \s*\)
    \.?\s*
    (?P<title>[^\.]+?)               # title (up to first period — may include colons)
    \.\s*
    (?P<venue>.+?)                   # venue + volume + pages + DOI
    $
    """,
    re.VERBOSE | re.MULTILINE | re.IGNORECASE,
)

# IEEE entry: [N] authors, "title," venue, ...
# Tách theo dấu phẩy: phần trước quote-title là authors+initials, sau là venue.
# Support straight and curly double/single quotes emitted by PDF extractors.
_IEEE_ENTRY_RE = re.compile(
    r"""
    ^\[\s*(?P<index>\d+)\s*\]\s*      # [N]
    (?P<authors>[^"]+?),\s*           # authors (everything until quote)
    ["“‘](?P<title>[^"”’]+)["”’]\s*,\s*   # "title," / ''title,''
    (?P<venue>.+?)$                   # venue (rest of line)
    """,
    re.VERBOSE,
)

# Vancouver: "Smith J. Title. Journal. 2020;10:1-10."
_VANCOUVER_ENTRY_RE = re.compile(
    r"""
    ^(?P<authors>.+?)\.\s+              # authors (everything up to first period)
    (?P<title>.+?)\.\s+                 # title (up to next period)
    (?P<venue>.+?)\.\s+                 # venue (up to next period)
    (?P<year>\d{4})(?P<rest>.*)$         # year + rest
    """,
    re.VERBOSE,
)

# Vancouver variant: "Authors. Year. Title. Venue." (used by BERT paper)
# Example: "Samuel R. Bowman et al. 2015. A large annotated corpus..."
_VANCOUVER_YEAR_FIRST_RE = re.compile(
    r"""
    ^(?P<authors>.+?)\.\s*             # authors (ends with period)
    \(?(?P<year>(?:18|19|20)\d{2})\)?  # year (with optional parens)
    (?P<suffix>[a-z])?\.\s+            # period + space
    (?P<title>.+?)(?:[.?!]\s+          # title (ends with punctuation)
    (?P<venue>.+))?[.?!]?$             # optional venue
    """,
    re.VERBOSE,
)

# Unquoted book / chapter entry (APA-like, no quoted title):
#   "Settles, B, Active Learning (2012) Synthesis Lectures on ..."
# Parsed with plain string operations instead of one big regex: the author
# segment is the leading sequence of "Surname, Initials" pairs (ambiguous
# commas such as "Learning, Active" are resolved by trying every split, see
# ``_parse_unquoted_book_entry``). Avoids regex backtracking entirely.
_YEAR_PAREN_SEARCH = re.compile(r"\((?:19|20)\d{2}[a-z]?\)")
_INITIALS_FULLMATCH = re.compile(r"[A-ZÀ-Ý](?:\.?-?[A-ZÀ-Ý])*\.?")

# DOI regex (tách riêng vì có thể xuất hiện ở cuối nhiều style)
_DOI_RE = re.compile(r"10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+")
_URL_RE = re.compile(r"https?://(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+")
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})([a-z]?)\b")

# Essay title indicators — entries matching these should be filtered out
_ESSAY_TITLE_RE = re.compile(
    r"(?:this\s+essay|comprehensive\s+survey|comprehensive\s+review|"
    r"introduction\s+to\s+|abstract\s+|survey\s*$|:?\s*survey\s+of\s+|"
    r"a\s+(?:brief\s+)?(?:survey|review|introduction)|"
    r"^\s*(?:deep\s+learning|natural\s+language\s+processing))",
    re.IGNORECASE,
)

# Long text without year — likely not a citation entry
_LONG_TEXT_NO_YEAR_RE = re.compile(r"^[A-Za-z]{50,}")

# A line that is only a bibliography header or TDTU structural sub-header
# (used to drop it wherever it lands once running headers/page numbers have been stripped).
_BIB_HEADER_LINE_RE = re.compile(
    r"^\s*(?:[-*•●+\uf0a7\uf0b7\uf0d8\uf0fc\uf076]\s*)?(?:(?:(?:chương|phần|mục|chapter|section|part)\s+)?(?:\d+(?:\.\d+)*|[A-Z]|[IVXLC]+)\s*[\.\):\-–—]?\s*)?(?:"
    r"references?|reference\s+list|bibliography|works?\s+cited|literature(?:\s+cited)?|cited\s+literature|notes(?:\s+and\s+references)?|endnotes?"
    r"|sources|list\s+of\s+sources|reference\s+sources|sources\s+and\s+literature|literature\s+and\s+sources"
    r"|bibliografia(?:/bibliografía/bibliographie/works?\s+cited)?|bibliografía|bibliographie"
    r"|referências(?:\s+bibliográficas)?|referencias(?:\s+bibliográficas)?|daftar\s+pustaka"
    r"|(?:[^/\n]{2,50}/\s*)?list\s+of\s+references"
    r"|danh\s+mục\s+tài\s+liệu(?:\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?)?|(?:các\s+)?(?:tài\s+liệu|bài\s+viết|nguồn|link)\s+[tk]ham\s+khảo(?:\s+khác|\s*(?:,|và)\s*trích\s+dẫn)?|tham\s+khảo"
    r"|văn\s+bản\s+(?:quy\s+phạm\s+)?pháp\s+luật(?:\s+việt\s+nam|\s+nước\s+ngoài|\s+quốc\s+tế)?"
    r"|tài\s+liệu\s+trích\s+dẫn|nguồn\s+tài\s+liệu(?:\s+tham\s+khảo)?|tài\s+liệu"
    r"|(?:tài\s+liệu\s+(?:từ\s+)?|sách\s+)?(?:tiếng\s+vi[ệê]t|tiếng\s+anh|tiếng\s+pháp|tiếng\s+đức"
    r"|tiếng\s+nga|tiếng\s+trung|tiếng\s+nhật|nước\s+ngoài|internet|websites?|ebooks?|trang\s+web|trực\s+tuyến)"
    r"|(?:vietnamese|english|academic|non-academic)(?:\s+references?)?"
    r"|stt|link|liên\s+kết|theo\s+chuẩn\s+ieee"
    r")(?:\s*\([^)\n]{0,65}\))?\s*[:.]?\s*$",
    re.IGNORECASE,
)

_LEADING_SUBHEADER_RE = re.compile(
    r"^\s*(?:[-*•●+\uf0a7\uf0b7\uf0d8\uf0fc\uf076]\s*)?(?:(?:[A-Z]|[IVXLC]+|\d+(?:\.\d+)*)\s*[\.\)]\s*)?(?:"
    r"văn\s+bản\s+(?:quy\s+phạm\s+)?pháp\s+luật(?:\s+việt\s+nam|\s+nước\s+ngoài|\s+quốc\s+tế)?"
    r"|danh\s+mục\s+tài\s+liệu(?:\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?)?"
    r"|(?:các\s+)?(?:tài\s+liệu|bài\s+viết|nguồn|link)\s+[tk]ham\s+khảo(?:\s+khác|\s*(?:,|và)\s*trích\s+dẫn)?|tham\s+khảo"
    r"|(?:tài\s+liệu\s+(?:từ\s+)?|sách\s+)?(?:tiếng\s+vi[ệê]t|tiếng\s+anh|tiếng\s+pháp|tiếng\s+đức"
    r"|tiếng\s+nga|tiếng\s+trung|tiếng\s+nhật|nước\s+ngoài|internet|websites?|ebooks?|trang\s+web|trực\s+tuyến)"
    r"|(?:vietnamese|english|academic|non-academic)\s+references?"
    r")(?:\s*\([^)\n]{0,65}\))?\s*[:.]?\s+",
    re.IGNORECASE,
)

_UPPER_VN_R = r"[A-ZÀ-ÝĂÂĐÊÔƠƯĨŨẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]"
_PERSONAL_AUTHOR_HEAD_R = (
    rf"(?:\*\s*)?(?:(?:van|de|der|den|von|le|la|du|di|da|al|el)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+"
    rf"(?:,\s*(?:{_UPPER_VN_R}\.?\s*[-–]?\s*)+|[.,]\s*(?:[A-Za-zÀ-ỹ]\.\s*[-–]?\s*)+|\s+(?:{_UPPER_VN_R}\.\s*)+|\s+{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+(?=\s*,\s*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+,\s*{_UPPER_VN_R}\.)|,\s+{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+(?:\s+{_UPPER_VN_R}\.)?(?:,\s+(?:and\s+|&\s*)?{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+(?:\s+{_UPPER_VN_R}\.)?(?:\s+[a-zA-ZÀ-ỹ'\u2019\-]+)?)+)"
    rf"(?:[;,]\s*(?:(?:\.\s*\.\s*\.|…)\s*)?(?:&\s*|và\s*|and\s*)?(?:(?:van|de|der|den|von|le|la|du|di|da|al|el)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+(?:,\s*|\s+)(?:{_UPPER_VN_R}\.?\s*[-–]?\s*)+)*"
    rf"(?:\s*(?:(?:\.\s*\.\s*\.|…)\s*(?:&|và|and)?|&|(?<=\s)(?:và|and))\s*(?:(?:van|de|der|den|von|le|la|du|di|da|al|el)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+(?:,\s*|\s+)(?:{_UPPER_VN_R}\.?\s*[-–]?\s*)+)*"
    r"(?:\s*,?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?))?"
    r"(?:(?:,\s*|\s+)\((?:Eds?\.?|Ed\.?|eds?\.?|chủ\s+biên)\)\.?)?\s*[.,]*\s*\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+\.?(?:\s+\d{1,2})?)?|n\.?\s*d\.?)\s*\)"
)
_VN_FULLNAME_AUTHOR_HEAD_R = (
    rf"(?:(?<![\-–\d])\d{{1,3}}[^\S\n]*[\.\)][^\S\n]+)?{_UPPER_VN_R}[a-zà-ỹ]+(?:\s+{_UPPER_VN_R}[a-zà-ỹ]+){{1,4}}"
    rf"(?:(?:\s*,\s*|\s+(?:&|và|and)\s+){_UPPER_VN_R}[a-zà-ỹ]+(?:\s+{_UPPER_VN_R}[a-zà-ỹ]+){{1,4}})*"
    r"(?:\s*,?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?))?"
    r"(?:\s*\(chủ\s+biên\))?\s*,?\s*\(\s*(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?:18|19|20)\d{2}[a-z]?\s*\)[.,:]"
)
_DATED_WEB_AUTHOR_HEAD_R = (
    rf"{_UPPER_VN_R}[A-Za-zÀ-ỹ0-9.'\u2019\-]+(?:\s+{_UPPER_VN_R}?[A-Za-zÀ-ỹ0-9.'\u2019\-]+){{0,3}}\.?\s*"
    r"\(\s*(?:19|20)\d{2}[a-z]?,\s*[A-Za-z]+\.?(?:\s+\d{1,2})?\s*\)\."
)
_CORP_AUTHOR_HEAD_R = (
    r"(?:(?:(?<![\-–\d])\d{1,3}[^\S\n]*[\.\)][^\S\n]+)?(?:Bộ|Tổng\s+cục|Ủy\s+ban|Uỷ\s+ban|Chính\s+phủ|Quốc\s+hội|Thủ\s+tướng|Ban\s+Chấp\s+hành|Đảng\s+Cộng\s+sản|Tòa\s+án|Toà\s+án|Viện\s+kiểm\s+sát|Thanh\s+tra|Kiểm\s+toán|Văn\s+phòng\s+Quốc\s+hội|Ngân\s+hàng|Tổ\s+chức|Hiệp\s+hội|Trường\s+Đại\s+học|Công\s+ước|Công\s+ty"
    r"|Department|Ministry|Reserve\s+Bank|World\s+Health|United\s+Nations|World\s+Bank|International\s+Labour|National\s+Assembly|Object\s+Management\s+Group)"
    r"(?:[^().\n]|\b(?:TP|Tp)\.|\([A-Z0-9&/\-]{2,12}\)){0,85}?\.?\s*\(\s*(?:18|19|20)\d{2}(?:\s*[-–]\s*(?:18|19|20)\d{2})?[a-z]?\s*\)[.,:]"
    r"|(?!(?:Retrieved|Accessed|Available|Published|Reprinted|Adapted|Translated|In|Vol|No|Chapter|Section|Edition|Working|Technical|Master|Doctoral|PhD|See|Table|Figure)\b)(?:[A-Z]{2,12}|[A-ZÀ-Ý][a-zA-ZÀ-ỹ0-9'\u2019\-]+(?:\.[a-z]{2,6})?(?:\s+(?:[A-ZÀ-Ý][a-zA-ZÀ-ỹ0-9'\u2019\-]+|and|&|of|for|in|on|the|de|la)){0,4})\s*[.,]*\s*\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)\.\s*(?=[A-ZÀ-Ý\"\u201c\u2018']))"
)
_LEGAL_HEAD_R = (
    r"(?:(?<![\-–\d])\d+[^\S\n]*[\.\)][^\S\n]+)?(?:Hiến\s+pháp(?:\s+nước\s+Cộng\s+hòa\s+xã\s+hội\s+chủ\s+nghĩa\s+Việt\s+Nam)?(?:\s+các)?(?:\s+năm|\s+\d{4})"
    r"|(?:Bộ\s+luật|Luật|Pháp\s+lệnh|Sắc\s+lệnh)\s+[^().\n]{2,80}?(?:\((?:Bộ\s+luật|Luật|Pháp\s+lệnh)?\s*số|\bsố\s+\d|\bngày\s+\d|\bnăm\s+(?:19|20)\d{2}|\s+(?:19|20)\d{2}\b)"
    r"|(?:Nghị\s+định|Thông\s+tư(?:\s+liên\s+tịch)?|Quyết\s+định|Nghị\s+quyết(?:\s+liên\s+tịch)?|Chỉ\s+thị|Bản\s+án|Án\s+lệ|Công\s+văn|Kết\s+luận|Văn\s+bản\s+hợp\s+nhất)\s+(?:số\s*:?\s*)?\d+\s*[/\-–])"
)
_MLA_BOOK_AUTHOR_HEAD_R = (
    rf"(?:{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+,\s+{_UPPER_VN_R}[A-Za-zÀ-ỹ.\s'\u2019\-]{{1,35}}?(?:,\s*et\s+al\.|\.)"
    r"|(?:Homer|Aeschylus|Euripides|Herodotus|Sophocles|Plato|Aristotle|Virgil|Ovid|Seneca|Epictetus|Augustine|Aquinas|Cicero|Plutarch|Thucydides|Tacitus|Dante|Boethius)\."
    r"|(?:The\s+)?(?:English\s+Standard\s+Version|ESV(?:\s+Study)?|King\s+James|New\s+International\s+Version|NIV|NKJV|NASB|Holy)\s+Bible[.,]"
    r"|[\-\u2013\u2014_]{3,}\.)\s+(?=[A-Z0-9\"\u201c\u2018'])"
)
_CSE_AUTHOR_HEAD_R = (
    rf"(?:(?:van|de|der|den|von|le|la|du|di|da|el|al)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+\s+[A-Z]{{1,4}}\.?"
    rf"(?:(?:\s*,\s*|\s+(?:&|and|và)\s+)(?:(?:van|de|der|den|von|le|la|du|di|da|el|al)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+\s+[A-Z]{{1,4}}\.?(?:\s+Jr\.?)?)*"
    r"(?:\s*,?\s*(?:et\s+al\.?|and\s+(?:\d+\s+)?others?))?"
    r"\s*\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)"
)
_NAMEYEAR_DOT_AUTHOR_HEAD_R = (
    rf"(?:Anonymous\.|(?:(?:van|de|der|den|von|le|la|du|di|da|al|el)\s+)*{_UPPER_VN_R}[A-Za-zÀ-ỹ'\u2019\-]+,\s+"
    rf"(?:{_UPPER_VN_R}[A-Za-zÀ-ỹ.\s,&;\u00a0'\u2019\-]{{0,90}}?|\s*et\s+al\.)\.,?"
    r"|(?:Accenture|Commitment\s+2050|GSMA|OECD|UNESCO|UNICEF|UNCTAD|WTO|WHO|ILO|IMF|World\s+Bank|European\s+Commission),)"
    r"\s+(?:18|19|20)\d{2}[a-z]?(?:,\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?)?(?:\s*\[(?:18|19|20)\d{2}\])?\.\s+(?=[A-ZÀ-Ý\"\u201c\u2018'\d])"
)
_AU_HARVARD_AUTHOR_HEAD_R = (
    rf"(?:(?:van|de|der|den|von|le|la|du|di|da)\s+)*{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+,\s+"
    rf"(?:[A-Z]{{1,3}}(?:,\s+{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+,\s+[A-Z]{{1,3}})*(?:\s+(?:&|and)\s+{_UPPER_VN_R}[a-zA-ZÀ-ỹ'\u2019\-]+,\s+[A-Z]{{1,3}})?)"
    r"\s+(?:18|19|20)\d{2}[a-z]?[,:]?\s+(?=[\u2018'\u201c\"A-ZÀ-Ý])"
)
_INLINE_ENTRY_START_RE = re.compile(
    rf"(?:{_PERSONAL_AUTHOR_HEAD_R}|{_CSE_AUTHOR_HEAD_R}|{_NAMEYEAR_DOT_AUTHOR_HEAD_R}|{_AU_HARVARD_AUTHOR_HEAD_R}|{_VN_FULLNAME_AUTHOR_HEAD_R}|{_DATED_WEB_AUTHOR_HEAD_R}|{_CORP_AUTHOR_HEAD_R}|{_LEGAL_HEAD_R})"
)
_MLA_INLINE_SPLIT_RE = re.compile(
    rf"(?:(?<=\b(?:19|20)\d{{2}}\.)|(?<=ProQuest Ebook Central\.)|(?<=Google Scholar\.))\s+(?={_MLA_BOOK_AUTHOR_HEAD_R})"
)

# URL/DOI terminator — most web-style APA/MLA entries end with one of these
# (optionally followed by MLA "Accessed DD Mon. YYYY." or Vietnamese ", truy cập ngày DD/MM/YYYY."),
# which makes them a reliable boundary between consecutive reference entries.
_URL_BOUNDARY_RE = re.compile(
    r"(?:(?:https?://|www\.|doi\.org/)\S+|\bdoi\s*:\s*10\.\d{4,9}/\S+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|edu|gov|net)/\S+)"
    r"(?:"
    r"\s+Accessed\s+(?:\d{1,2}\s+)?[A-Za-z.]+\s+(?:19|20)\d{2}\.?"
    r"|\s*\(\s*accessed\s+(?:\d{1,2}\s+)?[A-Za-z.]+\s+(?:19|20)\d{2}\s*\)\.?"
    r"|\s*(?:[,;.]\s*)?(?:\[|\()?\s*(?:truy\s+cập\s+(?:lần\s+cuối\s+)?(?:ngày\s+)?|ngày\s+(?:truy\s+cập\s*:?\s*)?|accessed\s+(?:on\s+)?)?\d{1,2}\.?\s*[./-]\s*\d{1,2}\.?\s*[./-]\s*(?:19|20)\d{2}(?:\]|\))?\.?"
    r")?",
    re.IGNORECASE,
)


def _is_essay_title_entry(entry: str) -> bool:
    """Check if a reference entry is actually an essay title or header, not a citation.

    Returns True if the entry should be filtered out.
    """
    text_stripped = entry.strip()

    # Structured reference entries (Author (Year). / [N] / Vietnamese legal docs)
    # whose paper title contains "A survey of..." or "Introduction to..." are real citations.
    if (
        _INLINE_ENTRY_START_RE.match(text_stripped)
        or re.match(r"^\s*\[\d+\]", text_stripped)
        or re.search(r"\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.", text_stripped)
    ):
        return False

    # Very long text without year — likely a title or header
    if len(text_stripped) > 200 and _LONG_TEXT_NO_YEAR_RE.match(text_stripped):
        return True

    # Contains essay/survey/review indicators (without a citation year)
    if _ESSAY_TITLE_RE.search(text_stripped) and not re.search(r"\b(?:19|20)\d{2}\b", text_stripped):
        return True

    return False


# FIX v1.11: Fake/non-citation entry patterns - filter out method descriptions
_FAKE_ENTRY_PATTERNS = [
    # Pattern: Methodology-related headings that are not citations
    # Also matches when preceded by [N] (e.g., "[1] Context from...")
    re.compile(r'^\[\s*\d+\s*\]\s*(Context|Input\s*Processing|Classification|Loss|Computation|Optimization|'
              r'Model\s*\d*:|Embedding\s*Generation|Group\s*\d*:|'
              r'Robust\s*Vietnamese|Robustness|Fine-tuning|'
              r'Architecture|Training|Evaluation|Methodology)'
              r'[:\s]', re.IGNORECASE),
    # Pattern without [N] prefix
    re.compile(r'^(Context|Input\s*Processing|Classification|Loss|Computation|Optimization|'
              r'Model\s*\d*:|Embedding\s*Generation|Group\s*\d*:|'
              r'Robust\s*Vietnamese|Robustness|Fine-tuning|'
              r'Architecture|Training|Evaluation|Methodology)'
              r'[:\s]', re.IGNORECASE),
    # Pattern: Multi-word headings ending with colon
    re.compile(r'^\[\s*\d+\s*\]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}:'),
    re.compile(r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}:'),
    # Pattern: Entries starting with verbs (method descriptions)
    re.compile(r'^\[\s*\d+\s*\]\s*(Predicting|Training|Using|Applying|Extracting|Computing|'
              r'Encoding|Decoding|Processing|Analyzing|Evaluating)'
              r'\s+[a-z]', re.IGNORECASE),
    re.compile(r'^(Predicting|Training|Using|Applying|Extracting|Computing|'
              r'Encoding|Decoding|Processing|Analyzing|Evaluating)'
              r'\s+[a-z]', re.IGNORECASE),
    # Pattern: Table of Contents leader dots, leading colon, or structural headings
    re.compile(r'(?:\.\s*){5,}'),
    re.compile(r'^\s*:'),
    re.compile(
        r'^(?:CHAPTER\s+\d+\s*[.:]?\s*[A-ZÀ-Ý\s]{0,40}$|SECTION\b|TABLE\s+OF\s+CONTENTS|LIST\s+OF\s+(?:FIGURES|TABLES))\b',
        re.IGNORECASE,
    ),
]

_METHOD_INDICATORS = [
    'is first tokenized', 'is encoded using', 'is passed through',
    'is computed from', 'token embedding', 'classification head',
    'cross-entropy loss', 'learning rate', 'weight decay',
    'gradient clipping', 'linear warmup', 'class-based tf-idf',
    'sentence embeddings', 'topic modeling', 'pre-trained', 'fine-tune',
]


def _is_fake_entry(entry: str) -> bool:
    """Check if an entry looks like a method description, not a citation.

    FIX v1.11: Filter out entries that are methodology descriptions,
    not actual citations (e.g., "[1] Context from both left and right of each token...").

    Returns True if the entry should be filtered out as fake/non-citation.
    """
    text_stripped = entry.strip()

    # TDTU §2.6.1 Vietnamese legal documents (e.g. "1. Hiến pháp 2013.") are valid references
    if is_vn_legal_reference(text_stripped):
        return False

    # Skip very short entries unless they have explicit Author (Year) Title structure or numbered index
    if len(text_stripped) < 30:
        if len(text_stripped) >= 20 and re.search(
            r"^[A-ZÀ-Ý][A-Za-zÀ-ỹ'\u2019\-]+,\s+[A-Z].*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s+\S+",
            text_stripped,
        ):
            return False
        if len(text_stripped) >= 15 and re.match(
            r"^\s*(?:\[\s*\d{1,3}\s*\]\.?|\d{1,3}\s*[\.\)])\s*(?:https?://|www\.|[A-ZÀ-Ý]\S+)",
            text_stripped,
            re.IGNORECASE,
        ):
            return False
        return True

    # FIX v1.11: Remove [N] prefix for pattern matching
    text_without_index = re.sub(r'^\[\s*\d+\s*\]\s*[:.]?\s*', '', text_stripped)

    # Check for basic citation structure (author + year)
    has_year = bool(re.search(r'\b(19|20)\d{2}\b', text_stripped))
    has_author_pattern = bool(re.search(r'[A-Z][a-z]+,\s*[A-Z]', text_stripped))
    has_doi_or_url = bool(
        _DOI_RE.search(text_stripped)
        or _URL_RE.search(text_stripped)
        or re.search(r"\b(?:www\.|[a-z0-9\-]+\.(?:org|com|edu|net|gov|io|vn|asia))(?:/\S*|\b)", text_stripped, re.IGNORECASE)
    )

    # Check against fake entry patterns (both with and without [N] prefix)
    for pattern in _FAKE_ENTRY_PATTERNS:
        if pattern.search(text_stripped) or pattern.search(text_without_index):
            # A reference containing an explicit DOI or URL is not a methodology section heading
            if has_doi_or_url and pattern.pattern in (
                r'^\[\s*\d+\s*\]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}:',
                r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){2,}:',
            ):
                continue
            return True

    # Check for method description indicators
    lower_entry = text_without_index.lower()
    indicator_count = sum(1 for ind in _METHOD_INDICATORS if ind in lower_entry)

    # If many method indicators but no year or author pattern, it's fake
    if indicator_count >= 2 and not has_year and not has_author_pattern:
        return True

    # Filter out Appendix / codebase / annotation-guideline artifacts when no year/DOI/URL exists
    if not has_year and not has_doi_or_url:
        if re.match(r"^\s*\[\s*\d{1,3}\s*\]", text_stripped) and re.search(
            r"\b(?:documentation|scikit-learn|user\s+guide|manual|specification)\b",
            text_stripped,
            re.IGNORECASE,
        ):
            return False
        if (
            re.search(r"\b[a-z]+_[a-z]+\b", text_stripped)
            or re.search(r"\b[a-z_]{2,}/(?:[a-z0-9_.]*)", text_stripped, re.IGNORECASE)
            or "\u037e" in text_stripped
            or "↔" in text_stripped
            or re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", text_stripped, re.I)
            or re.search(
                r"(?:--partition=|getnodeset\(|add!\(|Dirichlet\(|@timeit\b|Listing\s+[A-Z]\.\d+:|::AbstractGrid|::Symbol|\breturn\s+_[a-z]|=\s*\"=[0-9.]+\"|DUMP_STRING|Set\s+electric\s+charge\s+and\s+mass|Conveniance\s+method\s+for\s+creating)",
                text_stripped,
                re.IGNORECASE,
            )
            or re.search(
                r"\b(?:Precision,\s*Recall,\s*F1|JSONL\s+loader|Pairwise\s+Cohen)",
                text_stripped,
                re.IGNORECASE,
            )
        ):
            return True

    return False


def _normalize_title(title: str) -> str:
    """Chuẩn hoá title: lowercase, bỏ punctuation, gộp spaces."""
    if not title:
        return ""
    t = title.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def _estimate_reference_confidence(citation: Citation) -> float:
    """Heuristic parse-confidence (0–1) for a reference-list entry.

    Reference-list parsers previously left ``confidence`` at the ``Citation``
    default of 0.0.  That made every structured reference look like the least
    trustworthy citation in the corpus (app DB average was 0.128).  Score the
    entry by how much structured metadata the pattern actually recovered:
    title, authors, year, then DOI/venue as smaller bonuses.
    """
    score = 0.0
    if citation.title:
        score += 0.4
    if citation.year:
        score += 0.3
    if citation.authors:
        score += 0.2
    if citation.doi:
        score += 0.1
    return min(round(score, 2), 1.0)


class ReferenceListParser:
    """Parse danh sách References ở cuối tiểu luận."""

    def __init__(self, extractor: CitationExtractor | None = None) -> None:
        self.extractor = extractor or CitationExtractor()
        # Initialize format parsers from registry (ordered by priority)
        # IEEE has [N] marker detection and should be tried first for numbered entries
        self.format_parsers: dict[str, CitationFormat] = {}
        for fmt in get_all_formats():
            self.format_parsers[fmt.name] = fmt

    def parse_reference_section(self, doc: Document) -> list[Citation]:
        """Trích và parse các entry ở reference section.

        Returns:
            List[Citation] với citation_type = REFERENCE_LIST.

        Note:
            Section text KHÔNG qua TextPreprocessor.normalize đầy đủ vì
            _fix_broken_lines có thể nối "References\nvan" → "References van"
            (false positive khi 's' cuối + '\n' + 'v' đầu). Thay vào đó chỉ
            áp dụng normalize nhẹ (Unicode NFC + ligature).
        """
        ref_range = self.extractor.find_reference_section(doc)
        if ref_range is None:
            return []
        start, end = ref_range
        raw_text = "\n".join(p.text for p in doc.pages if start <= p.page_num <= end)
        # Light normalize — KHÔNG qua _fix_broken_lines
        pp = self.extractor.preprocessor
        section_text = pp._normalize_unicode(pp._fix_ligatures(raw_text))

        entries = self._split_entries(section_text)
        citations: list[Citation] = []
        for idx, entry in enumerate(entries, start=1):
            # Bug fix: Filter out essay title/header entries (not actual citations)
            if _is_essay_title_entry(entry):
                logger.debug(f"Skipping essay title entry: {entry[:50]}...")
                continue
            # FIX v1.11: Filter out fake/non-citation entries (method descriptions)
            if _is_fake_entry(entry):
                logger.debug(f"Skipping fake entry: {entry[:50]}...")
                continue

            citation = self._parse_entry_with_dash_inheritance(
                entry, order_index=idx, page_num=start, prev_citations=citations
            )

            if citation:
                # FIX v1.11: Double-check parsed citation is not fake
                # Some entries pass _is_fake_entry but get parsed anyway
                if _is_fake_entry(citation.raw_text):
                    logger.debug(f"Skipping parsed fake entry: {citation.raw_text[:50]}...")
                    continue
                citations.append(citation)
        return citations

    def _parse_entry_with_dash_inheritance(
        self,
        entry: str,
        *,
        order_index: int,
        page_num: int,
        prev_citations: list[Citation],
    ) -> Citation | None:
        """Parse an entry while supporting Chicago/MLA 3-em dash or leading-period author inheritance."""
        dash_m = re.match(
            r"^\s*(?:[\u2014\u2013\u2012―—–_-]{2,}\.?|\.)\s+(?P<rest>[\"\u201c\u2018'A-ZÀ-Ý].+)$",
            entry,
            flags=re.DOTALL,
        )
        if dash_m and prev_citations and prev_citations[-1].authors:
            prev_authors = list(prev_citations[-1].authors)
            lead_author = str(prev_authors[0]).rstrip(".")
            synth_entry = f"{lead_author}. {dash_m.group('rest').strip()}"
            citation = self._parse_entry(synth_entry, order_index=order_index, page_num=page_num)
            if citation:
                citation.raw_text = entry.strip()
                citation.authors = prev_authors
            return citation

        single_hyphen_m = re.match(
            r"^\s*-\s*,\s*(?P<given>[A-ZÀ-Ý]\.(?:\s*[A-ZÀ-Ý]\.)?)\s*,?\s*(?P<rest>.+)$",
            entry,
            flags=re.DOTALL,
        )
        if single_hyphen_m and prev_citations and prev_citations[-1].authors:
            prev_first = str(prev_citations[-1].authors[0]).split(",", 1)[0].strip().rstrip(".")
            if prev_first:
                synth_entry = (
                    f"{prev_first}, {single_hyphen_m.group('given')}, "
                    f"{single_hyphen_m.group('rest').strip()}"
                )
                citation = self._parse_entry(synth_entry, order_index=order_index, page_num=page_num)
                if citation:
                    citation.raw_text = entry.strip()
                return citation

        return self._parse_entry(entry, order_index=order_index, page_num=page_num)

    def _split_entries(self, text: str) -> list[str]:
        """Tách các entry riêng.

        Strategy (fallback nhiều tầng):
            1. Bỏ prefix "References" / "Tài liệu tham khảo" / "Bibliography".
            2. Nếu có dòng bắt đầu bằng `[N]` → IEEE entries (từng dòng).
            3. Tách IEEE entries trên cùng dòng (do PDF wrapping): [N]...[M]...
            4. Merge wrapped lines, rồi tách bằng year-marker boundary.
            5. Fallback: tách bằng blank line.
            6. Nếu vẫn chỉ 1 entry → trả nguyên text.
        """
        # 0. Canonical NFC normalization so NFD decomposed Vietnamese headers/authors parse cleanly
        import unicodedata

        text = unicodedata.normalize("NFC", text)

        # 1. Strip header prefix
        header_strip_re = re.compile(
            r"^\s*(?:(?:(?:chương|phần|mục|chapter|section|part)\s+)?(?:\d+(?:\.\d+)*|[A-Z]|[IVXLC]+)(?:\s*[\.\):\-–—]+\s*|\s+))?(?:references?|reference\s+list|bibliography|literature(?:\s+cited)?|notes(?:\s+and\s+references)?|endnotes?"
            r"|bibliografia(?:/bibliografía/bibliographie/works?\s+cited)?|bibliografía|bibliographie"
            r"|referências(?:\s+bibliográficas)?|referencias(?:\s+bibliográficas)?|daftar\s+pustaka"
            r"|(?:[^/\n]{2,50}/\s*)?list\s+of\s+references"
            r"|danh\s+mục\s+tài\s+liệu(?:\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?)?|(?:các\s+)?(?:tài\s+liệu|bài\s+viết|nguồn|link)\s+[tk]ham\s+khảo(?:\s*(?:,|và)\s*trích\s+dẫn)?|tham\s+khảo|tài\s+liệu\s+trích\s+dẫn|tài\s+liệu"
            r"|works?\s+cited)(?:\s*\(\s*\))?\s*[:.]?\s*",
            flags=re.IGNORECASE,
        )
        text = header_strip_re.sub("", text, count=1).strip()

        if not text:
            return []

        # 1b. Drop page furniture (running headers + page numbers) so they do
        # not get glued to the front of an entry that starts after a page break.
        text = self._strip_running_headers(text)
        if not text:
            return []

        # 2. IEEE entries (each on separate line)
        ieee_line_nums = [int(n) for n in re.findall(r"^\s*\[(\d{1,3})\]", text, flags=re.MULTILINE)]
        if len(ieee_line_nums) >= 2 or (len(ieee_line_nums) == 1 and ieee_line_nums[0] == 1):
            entries: list[str] = []
            pre_ieee_lines: list[str] = []
            standalone_unnumbered_re = re.compile(
                r"^(?:[A-ZÀ-Ý][a-zA-ZÀ-ÿ'\-]+\s+[A-Z]{1,3}\.\s+[A-Z].*(?:\b(?:19|20)\d{2}\s*[;:(]|https?://|10\.\d{4,9}/)"
                r"|[A-ZÀ-Ý][a-zA-ZÀ-ÿ'\-]+,\s+[A-Z]\..*\(\s*(?:19|20)\d{2}[a-z]?\s*\))"
            )
            for line in text.splitlines():
                line = line.strip()
                if not line or _BIB_HEADER_LINE_RE.match(line):
                    continue
                if re.match(r"^\[\d{1,3}\]", line) or re.match(
                    r"^\d{1,3}\)\s*(?:https?://|www\.)\S+", line, re.IGNORECASE
                ):
                    if pre_ieee_lines and not entries:
                        pre_text = "\n".join(pre_ieee_lines)
                        pre_split = self._split_by_year_boundary(pre_text)
                        entries.extend(pre_split if pre_split else [pre_text])
                        pre_ieee_lines.clear()
                    entries.append(line)
                else:
                    if entries:
                        prev_complete = bool(
                            re.search(
                                r"(?:\b(?:19|20)\d{2}[a-z]?[.)]|https?://\S+|10\.\d{4,9}/\S+)\s*$",
                                entries[-1],
                            )
                        )
                        if prev_complete and standalone_unnumbered_re.match(line):
                            entries.append(line)
                        else:
                            entries[-1] = self._join_wrapped_line(entries[-1], line)
                    else:
                        pre_ieee_lines.append(line)
            result = [
                e
                for e in entries
                if len(e) > 20
                or re.match(r"^(?:\[\d{1,3}\]|\d{1,3}\))\s*(?:https?://|www\.)\S+", e, re.IGNORECASE)
            ]
            if len(result) >= 2:
                # FIX: Check if any entries contain multiple [N] references (inline merge)
                # Split them using _split_ieee_inline
                final_entries = []
                for entry in result:
                    sub_entries = self._split_ieee_inline(entry)
                    if len(sub_entries) >= 2:
                        final_entries.extend(sub_entries)
                    else:
                        final_entries.append(entry)
                return final_entries if len(final_entries) >= 2 else result
            return result

        # 3. FIX: Split IEEE entries that are on the same line (PDF wrapping issue)
        # Pattern: [N] ... [M] ... where each [N] starts a new entry
        # This handles cases like: [9] ... 2010. [10] ... 2020.
        ieee_inline_split = self._split_ieee_inline(text)
        if len(ieee_inline_split) >= 2:
            return ieee_inline_split

        # 3a. LaTeX alpha-style bracketed bibliography ('[ADG+16] ...', '[VSP+17] ...')
        alpha_key_re = re.compile(
            r"^\s*\[([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9+\-]{1,8}\d{2}[a-z]?)\]\s+\S"
        )
        alpha_matches = [ln for ln in text.splitlines() if alpha_key_re.match(ln)]
        if len(alpha_matches) >= 2:
            alpha_entries: list[str] = []
            for line in text.splitlines():
                sline = line.strip()
                if not sline:
                    continue
                if alpha_key_re.match(sline):
                    alpha_entries.append(sline)
                elif alpha_entries:
                    alpha_entries[-1] = self._join_wrapped_line(alpha_entries[-1], sline)
            alpha_result = [e for e in alpha_entries if len(e) > 20]
            if len(alpha_result) >= 2:
                return alpha_result

        # 3b. Sequentially dot/paren-numbered bibliography ('1. ...', '2. ...', '3. ...')
        dot_numbered_split = self._split_sequential_dot_numbered(text)
        if len(dot_numbered_split) >= 2:
            return dot_numbered_split

        # 4. Merge wrapped lines + year-marker boundary split
        entries = self._split_by_year_boundary(text)
        if len(entries) >= 2:
            return entries

        # 5. Fallback: blank-line split
        merged = text.replace("\r\n", "\n").replace("\r", "\n")
        parts = re.split(r"\n\s*\n", merged)
        result = [p.strip() for p in parts if len(p.strip()) > 20]
        if len(result) >= 2:
            return result

        # 6. Chỉ 1 entry
        return [text] if len(text) > 20 else []

    def _split_sequential_dot_numbered(self, text: str) -> list[str]:
        """Split a bibliography that uses sequential dot/paren numbering ('1. ...', '2. ...').

        Also handles multi-section numbered lists ('I. Văn bản... 1..M', 'II. Tài liệu... 1..N')
        and hybrid TDTU lists ('A. Văn bản... 1..3', 'B. Tài liệu... unnumbered APA').
        """
        lines = text.splitlines()
        num_line_re = re.compile(
            r"^\s*(?:(?:\((?P<pnum>\d{1,3})\)|(?P<num>\d{1,3})\s*[\.\)])(?:\s+(?P<rest>\S.*)|(?P<nospace_rest>(?:https?://|www\.)\S.*|[A-ZÀ-ÝĂÂĐÊÔƠƯ][A-Za-zÀ-ỹ'\u2019\-]+,\s*\S.*))?|(?P<tnum>\d{1,3})[\t\u2002\u2003]+\s*(?P<trest>[A-ZÀ-Ý]\S.*))$"
        )
        found_nums: list[int] = []
        expected = 1
        allow_reset_to_one = False
        unnumbered_prefix_lines = 0
        unnumbered_prefix_chars = 0
        for raw_ln in lines:
            ln = raw_ln.strip()
            if not ln:
                continue
            if _BIB_HEADER_LINE_RE.match(ln):
                if found_nums:
                    allow_reset_to_one = True
                continue
            m = num_line_re.match(raw_ln) or num_line_re.match(ln)
            if m:
                n = int(m.group("num") or m.group("pnum") or m.group("tnum"))
                if (
                    not found_nums
                    or n == expected
                    or (expected < n <= expected + 2)
                    or (n == 1 and (len(found_nums) >= 1 or allow_reset_to_one))
                ):
                    found_nums.append(n)
                    expected = n + 1
                    allow_reset_to_one = False
                    continue
            if not found_nums:
                unnumbered_prefix_lines += 1
                unnumbered_prefix_chars += len(ln)
        seq_steps = sum(1 for a, b in zip(found_nums, found_nums[1:], strict=False) if b == a + 1)
        valid_start = bool(
            found_nums
            and (
                found_nums[0] == 1
                or (len(found_nums) >= 3 and seq_steps >= 2)
            )
        )
        if (
            len(found_nums) < 2
            or not valid_start
            or unnumbered_prefix_lines >= 3
            or unnumbered_prefix_chars >= 200
        ):
            return []

        def _flush_numbered_chunk(chunk_text: str, start_num: int | None, out_list: list[str]) -> None:
            curr = chunk_text.strip()
            if not curr:
                return
            if start_num is not None:
                next_n = start_num + 1
                while True:
                    inline_m = re.search(
                        rf"(?:(?<=[.;])\s+|\s+)(?={next_n}\s*[\.\)](?:\s+[A-ZÀ-ÝĂÂĐÊÔƠƯ\"\u201c]|[A-ZÀ-ÝĂÂĐÊÔƠƯ][A-Za-zÀ-ỹ'\u2019\-]+,))",
                        curr,
                    )
                    if not inline_m:
                        break
                    first_part = curr[:inline_m.start()].strip()
                    curr = curr[inline_m.end():].strip()
                    curr = re.sub(r"^(\d{1,3})\.([A-ZÀ-ÝĂÂĐÊÔƠƯ])", r"\1. \2", curr)
                    if len(first_part) > 15 or is_vn_legal_reference(first_part):
                        out_list.append(first_part)
                    next_n += 1
            if len(curr) > 15 or is_vn_legal_reference(curr):
                vn_glued_m = re.search(
                    rf"(?<=\.)\s*(?={_VN_FULLNAME_AUTHOR_HEAD_R})",
                    curr,
                )
                if vn_glued_m and re.search(r"\(\s*(?:19|20)\d{2}\s*\)", curr[:vn_glued_m.start()]):
                    out_list.append(curr[:vn_glued_m.start()].strip())
                    out_list.append(curr[vn_glued_m.end():].strip())
                else:
                    out_list.append(curr)

        entries: list[str] = []
        unnumbered_tail_lines: list[str] = []
        in_unnumbered_section = False
        expected = found_nums[0]
        curr_entry = ""
        curr_num: int | None = None

        for raw_ln in lines:
            ln = raw_ln.strip()
            if not ln:
                continue
            if _BIB_HEADER_LINE_RE.match(ln):
                if curr_entry:
                    _flush_numbered_chunk(curr_entry, curr_num, entries)
                    curr_entry = ""
                    curr_num = None
                if entries:
                    in_unnumbered_section = True
                continue
            m = num_line_re.match(raw_ln) or num_line_re.match(ln)
            if m:
                n = int(m.group("num") or m.group("pnum") or m.group("tnum"))
                if n == expected or (expected < n <= expected + 2) or (n == 1 and entries):
                    if in_unnumbered_section and unnumbered_tail_lines:
                        tail_text = "\n".join(unnumbered_tail_lines)
                        entries.extend(self._split_by_year_boundary(tail_text))
                        unnumbered_tail_lines = []
                    in_unnumbered_section = False
                    if curr_entry:
                        _flush_numbered_chunk(curr_entry, curr_num, entries)
                    rest_part = (
                        m.group("rest")
                        or m.group("nospace_rest")
                        or m.group("trest")
                        or ""
                    ).strip()
                    curr_entry = f"{n}. {rest_part}".strip()
                    curr_num = n
                    expected = n + 1
                    continue
            if in_unnumbered_section:
                unnumbered_tail_lines.append(ln)
            elif curr_entry:
                # Detect transition from numbered section (1..N) to unnumbered APA section ("Author (Year). Title")
                if (
                    curr_num == found_nums[-1]
                    and re.search(r"[.;]\s*$", curr_entry)
                    and re.match(
                        r"^[A-ZÀ-ÝĂÂĐÊÔƠƯ][^\n()]{1,85}\(\s*(?:(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?)\s*\)[.,:]\s+\S",
                        ln,
                    )
                ):
                    _flush_numbered_chunk(curr_entry, curr_num, entries)
                    curr_entry = ""
                    curr_num = None
                    in_unnumbered_section = True
                    unnumbered_tail_lines.append(ln)
                else:
                    curr_entry = self._join_wrapped_line(curr_entry, ln)

        if curr_entry:
            _flush_numbered_chunk(curr_entry, curr_num, entries)
        if unnumbered_tail_lines:
            tail_text = "\n".join(unnumbered_tail_lines)
            entries.extend(self._split_by_year_boundary(tail_text))

        return entries if len(entries) >= 2 else []

    def _split_ieee_inline(self, text: str) -> list[str]:
        """Split IEEE entries that are on the same line due to PDF text wrapping.

        Pattern: [N] ... [M] ... where each [N] starts a new entry.
        This handles cases like:
            [9] S. J. Pan and Q. Yang. "A Survey..." IEEE Transactions, 2010. [10] F. Pan et al. "Transfer Learning..." 2020.

        Returns list of individual entries.
        """
        # Pattern: [N] followed by text, then [M] (a new entry)
        # Split at: ] followed by space and capital letter (start of next entry)
        # But be careful not to split inside quotes

        # Find all 1-3 digit [N] positions (excluding 4-digit calendar years like [2020] or [5706])
        bracket_pattern = re.compile(r'\[(\d{1,3})\]')
        matches = list(bracket_pattern.finditer(text))

        if len(matches) < 2:
            return []

        nums = [int(m.group(1)) for m in matches]
        if nums[0] != 1 and not any(nums[i + 1] == nums[i] + 1 for i in range(len(nums) - 1)):
            return []

        # Build entries by splitting at [N] positions
        entries = []
        for i, m in enumerate(matches):
            start = m.start()
            # Find the end of this entry (start of next [N] or end of text)
            if i + 1 < len(matches):
                end = matches[i + 1].start()
            else:
                end = len(text)

            entry = text[start:end].strip()
            # Clean up: remove leading whitespace and period before [
            entry = re.sub(r'^\s*\.\s*', '', entry)
            entry = re.sub(r'\s+', ' ', entry)

            if len(entry) > 20:
                entries.append(entry)

        return entries if len(entries) >= 2 else []

    @staticmethod
    def _join_wrapped_line(prev: str, nxt: str) -> str:
        """Join a wrapped bibliography line, repairing hyphenated word breaks and split URLs."""
        prev_s = prev.rstrip()
        nxt_s = nxt.lstrip()
        if not prev_s:
            return nxt_s
        if not nxt_s:
            return prev_s

        # 1. URL or DOI wrapped across lines (e.g. "https://github.com/kermitt2/\ngrobid",
        # "URL https://doi.or\ng/10.48550/...", "URL https://arxiv.\norg/abs/...", "https:\n//...")
        nxt_first = nxt_s.split()[0]
        if re.match(r"^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$", nxt_first):
            if re.search(r"(?:(?:https?://\S+|\b10\.\d{4,9}/\S+)[/\-_?&=:#~]|https?:)$", prev_s, re.IGNORECASE):
                return prev_s + nxt_s
            if re.search(r"https?://[^\s/]*$", prev_s, re.IGNORECASE) and re.match(
                r"^(?://|/|[a-z0-9_~%#-]+(?:/|\.[a-z]{2,4}\b))", nxt_first
            ):
                return prev_s + nxt_s
            if (
                re.search(r"(?:https?://|\b10\.\d{4,9}/)\S+$", prev_s, re.IGNORECASE)
                and not prev_s.endswith((".", ",", ";", ")"))
                and re.match(r"^[a-z0-9/_~%#?&=.-]", nxt_first)
            ):
                return prev_s + nxt_s
            if re.search(r"(?:https?://|\b10\.\d{4,9}/)\S+\.$", prev_s, re.IGNORECASE) and re.match(
                r"^(?:org|com|edu|net|gov|io|ai|uk|de|fr|jp|cn|html?|pdf|[a-z]{2,8}-\d+|\d{2,})(?:[/._-]|$)",
                nxt_first,
            ):
                return prev_s + nxt_s

        # 2. Word hyphenated at line end (e.g. "recog-\nnition", "Ide-\nSmith", "Pre-\ntraining")
        m_hyph = re.search(r"([A-Za-zÀ-ỹ]+)-$", prev_s)
        if m_hyph and re.match(r"^[A-Za-zÀ-ỹ]", nxt_s):
            prefix = m_hyph.group(1)
            nxt_word_m = re.match(r"^([A-Za-zÀ-ỹ]+)", nxt_s)
            nxt_word = nxt_word_m.group(1).lower() if nxt_word_m else ""
            # Keep hyphen for capitalized second part (compound surname like Ide-Smith)
            # or genuine compound prefixes (e.g. Pre-training, fine-tuning, neuro-symbolic)
            compound_prefixes = {
                "pre", "self", "multi", "cross", "neuro", "non", "semi",
                "fine", "zero", "few", "real", "open", "high", "low", "tf",
                "scikit", "class", "rule", "tree", "graph", "attention", "bert",
                "deep", "machine", "data", "text", "word", "sentence", "token",
                "aspect", "domain", "task", "user", "item", "time", "long", "short",
                "large", "small", "state", "end", "co", "sub", "inter", "intra",
                "meta", "post", "bi", "uni", "auto", "hyper", "over", "under",
            }
            compound_roots = {
                "training", "trained", "tuning", "tuned", "supervised", "symbolic",
                "lingual", "modal", "task", "attention", "shot", "time", "source",
                "level", "scale", "idf", "based", "centric", "driven", "learn",
                "learning", "aware", "free", "specific", "independent", "dependent",
                "oriented", "guided", "related", "labeled", "labelled", "term",
            }
            if nxt_s[0].isupper() or (
                prefix.lower() in compound_prefixes and nxt_word in compound_roots
            ):
                return prev_s + nxt_s
            return prev_s[:-1] + nxt_s

        return prev_s + " " + nxt_s

    @staticmethod
    def _clean_subheader_prefix(entry: str) -> str:
        """Strip leading TDTU structural sub-headers (e.g. 'A. Văn bản...', 'Tiếng Việt')."""
        cleaned = (entry or "").strip()
        while cleaned:
            m = _LEADING_SUBHEADER_RE.match(cleaned)
            if not m:
                break
            cleaned = cleaned[m.end():].strip()
        return cleaned

    def _split_inline_entries(self, chunk: str) -> list[str]:
        """Split a chunk that may contain multiple APA or Vietnamese legal entries."""
        cleaned_chunk = self._clean_subheader_prefix(chunk)
        if not cleaned_chunk:
            return []

        valid_starts: list[int] = []
        for m in _INLINE_ENTRY_START_RE.finditer(cleaned_chunk):
            pos = m.start()
            if pos == 0:
                valid_starts.append(pos)
                continue
            prefix = cleaned_chunk[:pos]
            # Never split right after an APA 6th/7th ellipsis (". . . " or "… ") in an 8+ author list
            if re.search(r"(?:\.\s*\.\s*\.|…)\s+$", prefix):
                continue
            # Never split a legal/statute title away from its own leading 'Author (Year).' header
            prev_seg = cleaned_chunk[valid_starts[-1]:pos].strip() if valid_starts else prefix.strip()
            if len(prev_seg) < 100 and re.search(
                r"\(\s*(?:18|19|20)\d{2}(?:\s*[-–]\s*(?:18|19|20)\d{2})?[a-z]?\s*\)\s*[.,:]?$",
                prev_seg,
            ):
                continue
            # Never split inside an author list when the preceding segment has no year, n.d., URL/DOI, or legal keyword
            if not re.search(
                r"\b(?:18|19|20)\d{2}\b|\bn\.?\s*d\.?\b|https?://|\bdoi\s*:|\b10\.\d{4,9}/|\bpp?\.\s*[\d\-–]+\.|(?:\bBộ\s+luật|\bLuật|\bNghị\s+định|\bThông\s+tư|\bQuyết\s+định|\bHiến\s+pháp|\bPháp\s+lệnh|\bNghị\s+quyết|\bChỉ\s+thị)\b",
                prev_seg,
                re.IGNORECASE,
            ):
                continue
            # Never split on a semicolon inside a semicolon-separated author list (before any year/URL appears)
            if re.search(r";\s+$", prefix) and not re.search(
                r"\b(?:18|19|20)\d{2}\b|https?://|\bdoi\s*:", prev_seg, re.IGNORECASE
            ):
                continue
            # Must follow a sentence-ending period/semicolon, a URL/DOI, a CSE vol:page range, an ISBN/ISSN, an access date, or a sub-header
            if re.search(
                r"(?:[\.;]|https?://\S+|\bdoi\s*:\s*10\.\d{4,9}/\S+|(?:[\),\s:]|\bpp?\.?\s*)\d+\s*[\-–]\s*\d+|\bIS[SB]N(?:-1[03])?\s*:?\s*[0-9Xx\-]{8,17}|\(\s*original\s+work\s+published\s+[^)]+\)|\b(?:Accessed|Retrieved|Truy\s+cập)[^()\n]{3,35}\d{2,4})\s+$"
                r"|(?:văn\s+bản\s+(?:quy\s+phạm\s+)?pháp\s+luật|tài\s+liệu\s+tham\s+khảo"
                r"|tiếng\s+việt|tiếng\s+anh|tiếng\s+pháp|(?:academic|non-academic)\s+references?)(?:\s*\([^)\n]{0,65}\))?\s*[:.]?\s+$",
                prefix,
                flags=re.IGNORECASE,
            ) or (
                re.search(r"[\.;]$", prefix)
                and re.search(r"\b(?:18|19|20)\d{2}\b", prev_seg)
            ):
                valid_starts.append(pos)

        if not valid_starts or (len(valid_starts) == 1 and valid_starts[0] == 0):
            mla_parts = [p.strip() for p in _MLA_INLINE_SPLIT_RE.split(cleaned_chunk) if len(p.strip()) > 20]
            if len(mla_parts) >= 2:
                return mla_parts
            return [cleaned_chunk] if (len(cleaned_chunk) > 20 or is_vn_legal_reference(cleaned_chunk)) else []

        sub_entries: list[str] = []
        if valid_starts[0] > 0:
            leading = self._clean_subheader_prefix(cleaned_chunk[:valid_starts[0]])
            if len(leading) > 20 or is_vn_legal_reference(leading):
                for mp in _MLA_INLINE_SPLIT_RE.split(leading):
                    if len(mp.strip()) > 20:
                        sub_entries.append(mp.strip())

        for idx, start_pos in enumerate(valid_starts):
            end_pos = valid_starts[idx + 1] if idx + 1 < len(valid_starts) else len(cleaned_chunk)
            piece = self._clean_subheader_prefix(cleaned_chunk[start_pos:end_pos])
            # Trim any trailing sub-header that belongs to the next section
            piece = re.sub(
                r"\s+(?:[A-Z]\.\s*)?(?:Văn\s+bản\s+(?:quy\s+phạm\s+)?pháp\s+luật"
                r"|B\.\s*Tài\s+liệu\s+tham\s+khảo|Tiếng\s+Việt|Tiếng\s+Anh|Tiếng\s+Pháp|(?:Academic|Non-academic)\s+references?)\s*[:.]?\s*$",
                "",
                piece,
                flags=re.IGNORECASE,
            ).strip()
            if len(piece) > 20 or is_vn_legal_reference(piece):
                for mp in _MLA_INLINE_SPLIT_RE.split(piece):
                    if len(mp.strip()) > 20 or is_vn_legal_reference(mp.strip()):
                        sub_entries.append(mp.strip())

        return sub_entries

    def _split_acl_year_first_lines(self, raw_lines: list[str]) -> list[str]:
        """Split unnumbered ACL / TACL / EMNLP / NAACL bibliographies ('Authors. YYYY[a-z]?. Title.')."""
        acl_yr_re = re.compile(
            r"(?:^|(?<!\bvol)(?<!\bno)(?<!\bpp)\.\s+)(?:18|19|20)\d{2}[a-z]?\.(?:\s|$)",
            re.IGNORECASE,
        )
        lines: list[str] = []
        for raw_ln in raw_lines:
            s = raw_ln.strip()
            if not s or _BIB_HEADER_LINE_RE.match(s):
                continue
            lines.append(s)
        if len(lines) < 2:
            return []

        year_line_idxs = [i for i, ln in enumerate(lines) if acl_yr_re.search(ln)]
        if len(year_line_idxs) < 2:
            return []

        start_idxs = [0]
        for k in range(1, len(year_line_idxs)):
            prev_y = year_line_idxs[k - 1]
            curr_y = year_line_idxs[k]
            m_yr = acl_yr_re.search(lines[curr_y])
            prefix_before_yr = lines[curr_y][: m_yr.start()].strip() if m_yr else ""
            has_author_end_prev_line = bool(
                not prefix_before_yr and curr_y > prev_y and lines[curr_y - 1].endswith(".")
            )
            best_start = curr_y if not has_author_end_prev_line else curr_y - 1
            scan_start = curr_y - 1 if not has_author_end_prev_line else curr_y - 2
            for j in range(scan_start, prev_y, -1):
                ln_j = lines[j]
                if (
                    (ln_j.endswith(".") and not re.search(r"\b[A-ZÀ-Ý]\.$", ln_j))
                    or re.search(r"https?://\S+$", ln_j)
                ):
                    best_start = j + 1
                    break
                if re.search(r"\b(?:In\s+Proceedings|Proceedings\s+of|arXiv|CoRR|journal|volume|pages|pp\.)\b", ln_j, re.I):
                    best_start = j + 1
                    break
                best_start = j
            if best_start <= start_idxs[-1]:
                best_start = max(start_idxs[-1] + 1, curr_y)
            start_idxs.append(best_start)

        entries: list[str] = []
        for idx_s, s_pos in enumerate(start_idxs):
            e_pos = start_idxs[idx_s + 1] if idx_s + 1 < len(start_idxs) else len(lines)
            chunk = ""
            for ln in lines[s_pos:e_pos]:
                chunk = self._join_wrapped_line(chunk, ln) if chunk else ln
            if len(chunk.strip()) > 20:
                entries.append(chunk.strip())
        return entries if len(entries) >= 2 else []

    def _split_plainnat_year_end_lines(self, raw_lines: list[str]) -> list[str]:
        """Split unnumbered plainnat / NeurIPS / ICLR / Chicago / MLA bibliographies."""
        end_re = re.compile(
            r"(?:"
            r"(?:,\s*|\.\s+|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Spring|Summer|Fall|Autumn|Winter)\.?\s+)(?:18|19|20)\d{2}[a-z]?\."
            r"|(?:,\s*|\(\s*)(?:18|19|20)\d{2}[a-z]?\)?(?:,\s*|\s*:\s*)(?:pp?\.\s*)?\d+(?:\s*[\-–]\s*\d+)?\."
            r"|\((?:[^()]+:\s+)?[^()]+,\s*(?:18|19|20)\d{2}[a-z]?\)\."
            r"|(?:URL\s+)?https?://\S+(?:\s+[a-z0-9]{1,8}){0,3}\.?"
            r"|\bdoi:\s*10\.\d{4,9}/\S+(?:\s+[a-z0-9]{1,8}){0,3}\.?"
            r"|\b10\.\d{4,9}/\S+(?:\s+[a-z0-9]{1,8}){0,3}\.?"
            r"|\bISBN\s+[0-9\-X]+\."
            r")\s*$",
            re.IGNORECASE,
        )
        cont_re = re.compile(
            r"^(?:URL\b|https?:|doi:|DOI:|ISBN\b|ISSN\b|arXiv:|abs/|volume\b|vol\.|pages\b|pp\.|note\b|Accessed\b|ProQuest\b|Google\s+Scholar\b|Association\s+for\s+Computational\s+Linguistics\.)",
            re.IGNORECASE,
        )

        lines: list[str] = []
        for raw_ln in raw_lines:
            s = raw_ln.strip()
            if not s or _BIB_HEADER_LINE_RE.match(s):
                continue
            lines.append(s)
        if len(lines) < 2:
            return []

        entries: list[str] = []
        curr = ""
        for idx_l, ln in enumerate(lines):
            curr = self._join_wrapped_line(curr, ln) if curr else ln
            nxt = lines[idx_l + 1] if idx_l + 1 < len(lines) else ""
            if not nxt:
                if len(curr.strip()) > 20:
                    entries.append(curr.strip())
                curr = ""
                continue
            if cont_re.match(nxt):
                continue
            # Do not split if curr ends with an incomplete URL/DOI that wraps onto nxt
            if re.search(r"https?://[^\s/]*$|https?:$", curr, re.I):
                continue
            nxt_first_tok = nxt.split()[0] if nxt.split() else ""
            if (
                re.search(r"(?:https?://\S+|https?:|\b10\.\d{4,9}/\S+)[/\-_?&=:#~]$", curr, re.I)
                and nxt_first_tok
                and re.match(r"^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$", nxt_first_tok)
            ):
                continue
            if (
                re.search(r"(?:https?://|\b10\.\d{4,9}/)\S+$", curr, re.I)
                and not curr.endswith((".", ",", ";", ")"))
                and re.match(r"^[a-z0-9/_~%#?&=.-]", nxt)
            ):
                continue
            if re.search(r"(?:https?://|\b10\.\d{4,9}/)\S+\.$", curr, re.I) and re.match(
                r"^(?:org|com|edu|net|gov|io|ai|uk|de|fr|jp|cn|html?|pdf|[a-z]{2,8}-\d+|\d{2,})(?:[/._-]|$)",
                nxt,
            ):
                continue

            has_year = bool(
                re.search(r"\b(?:18|19|20)\d{2}[a-z]?\b", curr)
                or re.search(r"\.\s+(?:URL\s+)?https?://\S+\.$", curr, re.I)
            )
            if has_year and end_re.search(curr) and re.match(
                r"^(?:[A-ZÀ-ÝĂÂĐÊÔƠƯ]|[\u2014\u2013\u2012―—–_-]{2,}\.?|-\s*,\s*[A-ZÀ-Ý]\.|\.\s+[\"\u201c\u2018'A-ZÀ-Ý])",
                nxt,
            ):
                if len(curr.strip()) > 20:
                    entries.append(curr.strip())
                curr = ""

        if len(curr.strip()) > 20:
            entries.append(curr.strip())
        return entries if len(entries) >= 2 else []

    def _split_by_year_boundary(self, text: str) -> list[str]:
        """Tach entries bang URL/DOI boundaries va inline APA/legal entry starts.

        Algorithm:
            1. Rejoin hyphen-broken line wraps (PDF splits long URLs as
               ".../how-to-develop-\\nhealthcare-...") WITHOUT inserting a
               space, so the URL stays a single token.
            2. Flatten remaining whitespace to single spaces and repair space-broken URLs.
            3. Tim URL/DOI boundaries (http/https/www/doi.org), split tai do.
            4. Split each chunk further on inline APA / Vietnamese legal entry boundaries.
            5. Neu 2+ entries -> tra ve. Fallback -> newline/year markers.
        """
        # Step 0: Detect unnumbered ACL ("Authors. YYYY. Title.") or plainnat ("Authors. Title. Venue, YYYY.")
        # line structures BEFORE flattening newlines so entries without URLs are never glued together.
        if "\n" in text and not _STRICT_VN_DIACRITIC_RE.search(text):
            raw_nonempty = [
                ln.strip()
                for ln in text.splitlines()
                if ln.strip() and not _BIB_HEADER_LINE_RE.match(ln.strip())
            ]
            if len(raw_nonempty) >= 4:
                apa_yr_count = sum(
                    1
                    for ln in raw_nonempty
                    if re.search(
                        r"\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+\.?(?:\s+\d{1,2})?)?|n\.?\s*d\.?)\s*\)[.,:]?"
                        r"|^[A-ZÀ-Ý][^\n]{1,120}?(?:\.,?|,)\s+(?:18|19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+)?\.\s+\S",
                        ln,
                    )
                )
                acl_yr_count = sum(
                    1
                    for ln in raw_nonempty
                    if re.search(
                        r"(?:^|(?<!\bvol)(?<!\bno)(?<!\bpp)\.\s+)(?:18|19|20)\d{2}[a-z]?\.(?:\s|$)",
                        ln,
                        re.IGNORECASE,
                    )
                )
                comma_end_yr_count = sum(
                    1
                    for ln in raw_nonempty
                    if re.search(
                        r"(?:(?:,\s*|\.\s+|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Spring|Summer|Fall|Autumn|Winter)\.?\s+)(?:18|19|20)\d{2}[a-z]?\."
                        r"|(?:,\s*|\(\s*)(?:18|19|20)\d{2}[a-z]?\)?(?:,\s*|\s*:\s*)(?:pp?\.\s*)?\d+(?:\s*[\-–]\s*\d+)?\."
                        r"|\((?:[^()]+:\s+)?[^()]+,\s*(?:18|19|20)\d{2}[a-z]?\)\.)(?:\s*(?:URL\s+\S+|https?://\S+|doi:\s*\S+))?\s*$",
                        ln,
                        re.IGNORECASE,
                    )
                    and not re.match(
                        r"^[A-ZÀ-Ý][a-zA-ZÀ-ÿ'\u2019\-]+,\s+(?:[A-Z]\.\s*)+.*,\s*(?:18|19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+)?\.\s*$",
                        ln,
                    )
                )
                if acl_yr_count >= 2 and acl_yr_count > comma_end_yr_count and acl_yr_count >= apa_yr_count:
                    acl_split = self._split_acl_year_first_lines(raw_nonempty)
                    if len(acl_split) >= 2:
                        return acl_split
                elif comma_end_yr_count >= 2 and comma_end_yr_count >= apa_yr_count:
                    plainnat_split = self._split_plainnat_year_end_lines(raw_nonempty)
                    if len(plainnat_split) >= 2:
                        return plainnat_split
        text = text.replace("\u200b", "")

        # Step 0a: Handle "Title" bởi Author ● Ngày xuất bản: YYYY (e.g. 082_tdtu)
        if re.search(r'["\u201c][^"\u201d]+["\u201d]\s+bởi\s+', text, re.IGNORECASE):
            boi_parts = [
                p.strip()
                for p in re.split(r'(?=["\u201c][^"\u201d]+["\u201d]\s+bởi\s+)', text)
                if len(self._clean_subheader_prefix(p).strip()) > 15
            ]
            if len(boi_parts) >= 2:
                return [self._clean_subheader_prefix(p).strip() for p in boi_parts]

        # Step 0b: Handle bulleted lists ('- https://...', '• ...', '● ...', Wingdings PUA '\uf0b7 ...')
        raw_lines_clean = [
            ln.strip()
            for ln in text.splitlines()
            if ln.strip() and not _BIB_HEADER_LINE_RE.match(ln.strip())
        ]
        bullet_line_re = re.compile(
            r"^(?:[-+](?![-+—–_])\s+|[•●▪▫\uf0a7\uf0b7\uf0d8\uf0fc\uf076]\s*)\S"
        )
        bullet_only_re = re.compile(r"^(?:[-+]|[•●▪▫\uf0a7\uf0b7\uf0d8\uf0fc\uf076])$")
        bullet_strip_re = re.compile(
            r"^(?:[-+](?![-+—–_])\s+|[•●▪▫\uf0a7\uf0b7\uf0d8\uf0fc\uf076]+\s*)"
        )
        bullet_count = sum(
            1
            for ln in raw_lines_clean
            if bullet_line_re.match(ln) or bullet_only_re.fullmatch(ln)
        )
        if bullet_count >= 2:
            bullet_entries: list[str] = []
            curr_b = ""
            pending_bullet = False
            for ln in raw_lines_clean:
                if bullet_only_re.fullmatch(ln):
                    if curr_b and len(curr_b) > 15:
                        bullet_entries.append(curr_b.strip())
                    curr_b = ""
                    pending_bullet = True
                    continue
                if bullet_line_re.match(ln):
                    if curr_b and len(curr_b) > 15:
                        bullet_entries.append(curr_b.strip())
                    curr_b = bullet_strip_re.sub("", ln).strip()
                    pending_bullet = False
                elif pending_bullet:
                    curr_b = ln
                    pending_bullet = False
                elif curr_b:
                    curr_b = self._join_wrapped_line(curr_b, ln)
                else:
                    curr_b = ln
            if curr_b and len(curr_b) > 15:
                bullet_entries.append(curr_b.strip())
            if len(bullet_entries) >= 2:
                return bullet_entries

        # Step 0c: Handle unnumbered line-per-item bibliographies where lines are "Title - Author/Site"
        # or "Slide: ..." / "Website: ..." / "Ebook ..." / "DocName, website: https://..."
        if len(raw_lines_clean) >= 2 and all(
            not re.search(r"\b(?:18|19|20)\d{2}[a-z]?\b", ln) for ln in raw_lines_clean
        ):
            dash_or_doc_count = sum(
                1
                for ln in raw_lines_clean
                if re.search(
                    r"(?:\s+[–—-]\s+\S|\bwebsite:\s*https?://|^(?:Slide|Website|Ebook|Chapter\s+\d+|A\s+Comprehensive\s+Guide|IPC-\d+)\b|^https?://\S+$)",
                    ln,
                    re.IGNORECASE,
                )
            )
            if dash_or_doc_count >= 2 and dash_or_doc_count >= len(raw_lines_clean) * 0.6:
                line_entries: list[str] = []
                for ln in raw_lines_clean:
                    if (
                        line_entries
                        and not re.match(
                            r"^(?:Slide|Website|Ebook|Chapter\s+\d+|A\s+Comprehensive\s+Guide|IPC-\d+|https?://|[A-ZÀ-Ý].*(?:\s+[–—-]\s+|\bwebsite:\s*https?://))",
                            ln,
                            re.IGNORECASE,
                        )
                    ):
                        line_entries[-1] = self._join_wrapped_line(line_entries[-1], ln)
                    else:
                        line_entries.append(ln)
                line_entries = [e.strip() for e in line_entries if len(e.strip()) > 15]
                if len(line_entries) >= 2:
                    return line_entries

        # Step 1+2: Rejoin hyphen-broken and line-wrapped URLs BEFORE flattening newlines to spaces.
        joined_lines: list[str] = []
        curr_entry_buf = ""
        for raw_ln in text.splitlines():
            s_ln = raw_ln.strip()
            if not s_ln or _BIB_HEADER_LINE_RE.match(s_ln):
                continue
            if joined_lines:
                prev_ln = joined_lines[-1]
                # If prev_ln ends inside a URL and s_ln is a single token URL continuation (e.g. ".asia/p/...", "hZJxl0orbEsd&index=3", "um%20loss%20value.")
                s_first = s_ln.split()[0]
                if (
                    re.search(r"https?://\S+$", prev_ln, re.IGNORECASE)
                    and not s_first.startswith(("---", "--", "—", "–"))
                    and not _INLINE_ENTRY_START_RE.match(s_ln)
                    and (
                        re.match(r"^(?:\.[a-z]{2,10}/|[a-zA-Z0-9_~%#+/-]*[=&%_+][a-zA-Z0-9_~%#=&.+/-]+)", s_first)
                        or (len(s_ln.split()) == 1 and re.match(r"^[a-zA-Z0-9_~%#/.&+=-]+\.?$", s_first))
                    )
                ):
                    joined_lines[-1] = prev_ln + s_ln
                    curr_entry_buf += s_ln
                    continue
                # If a new bibliography entry starts at column 0 of s_ln and the previous entry
                # already has a year/URL and >=40 chars, ensure prev_ln has a terminal period so
                # flattening newlines to spaces does not glue unpunctuated line endings (e.g. "New Jersey: Wiley\nAuthor (2016)").
                if (
                    _INLINE_ENTRY_START_RE.match(s_ln)
                    and len(curr_entry_buf) >= 40
                    and re.search(r"\b(?:18|19|20)\d{2}\b|\bn\.?\s*d\.?\b|https?://", curr_entry_buf, re.IGNORECASE)
                    and not re.search(r"(?:[.,;&\-–—]|\b(?:and|và|in|of|for|from|to|by|with))\s*$", prev_ln, re.IGNORECASE)
                    and not re.search(r"https?://\S+$", prev_ln, re.IGNORECASE)
                ):
                    joined_lines[-1] = prev_ln + "."
                    curr_entry_buf = ""
            joined_lines.append(s_ln)
            curr_entry_buf = f"{curr_entry_buf} {s_ln}".strip() if curr_entry_buf else s_ln
        text_rejoined = "\n".join(joined_lines)
        flat = re.sub(r"-\s*\n\s*", "-", text_rejoined)
        flat = re.sub(r"\s+", " ", flat).strip()
        flat = re.sub(r"%\s+([0-9A-Fa-f]{2})", r"%\1", flat)
        flat = re.sub(
            r"(%[0-9A-Fa-f]{2}[0-9A-Za-z_%~:-]*)\s+(%[0-9A-Fa-f]{2})",
            r"\1\2",
            flat,
        )
        flat = re.sub(r"\.(p)\s+(df)\b", r".\1\2", flat, flags=re.IGNORECASE)
        flat = re.sub(r"\.(ht)\s+(ml?)\b", r".\1\2", flat, flags=re.IGNORECASE)
        flat = re.sub(
            r"([a-z0-9_])_([a-z]{1,4})\s+([a-z0-9_]+\.html?)\b",
            r"\1_\2\3",
            flat,
            flags=re.IGNORECASE,
        )
        # Only join a broken URL after '/', '-', '.', '?', '&', '=' when the next token starts with lowercase/digit
        # and is NOT the start of a new bibliography entry (never glue capitalized author surnames!).
        for _ in range(2):
            flat = re.sub(
                r"(https?://[^\s]+?[/\-?&=])\s+((?:[a-z0-9_~%#][^\s]*|[A-Za-z0-9_~%#-]+/[^\s]*))",
                r"\1\2",
                flat,
            )
            flat = re.sub(
                r"(https?://[^\s]+?\.)\s+([a-z_~%#][^\s]*)",
                r"\1\2",
                flat,
            )
        flat = re.sub(
            r"\b(10\.\d{4,9}/[A-Za-z0-9._;()/-]+[-/])\s+(\d+[A-Za-z0-9._;()/-]*)",
            r"\1\2",
            flat,
        )
        flat = re.sub(
            r"\b(10\.\d{4,9}/[A-Za-z0-9._;()/-]+\.)\s+(\d+[A-Za-z0-9._;()/-]*)",
            r"\1\2",
            flat,
        )

        # Step 3: Split at every URL/DOI terminator.
        matches = list(_URL_BOUNDARY_RE.finditer(flat))
        url_chunks: list[str] = []
        if len(matches) >= 1:
            start = 0
            for m in matches:
                end = m.end()
                chunk = flat[start:end].strip()
                if (
                    url_chunks
                    and (
                        re.match(r"^(?:and|or|&|và|,)\s+(?:https?://|www\.)\S+\s*$", chunk, re.IGNORECASE)
                        or (
                            not re.search(r"\b(?:18|19|20)\d{2}\b", chunk)
                            and re.match(r"^[^.]{1,35}\.\s*url\s*:\s*(?:https?://|www\.)\S+", chunk, re.IGNORECASE)
                        )
                    )
                ):
                    url_chunks[-1] = f"{url_chunks[-1]} {chunk}"
                elif len(chunk) > 20 or is_vn_legal_reference(chunk):
                    url_chunks.append(chunk)
                start = end
            last_chunk = flat[start:].strip()
            if len(last_chunk) > 20 or is_vn_legal_reference(last_chunk):
                url_chunks.append(last_chunk)
        elif "\n" in text:
            # When there are no URLs/DOIs at all, preserve line-break boundaries first
            # before splitting any remaining multi-entry lines inline.
            fb_chunks = self._split_by_year_fallback(text)
            if len(fb_chunks) >= 2:
                expanded_fb: list[str] = []
                for fbc in fb_chunks:
                    sub_fb = self._split_inline_entries(fbc)
                    if sub_fb:
                        expanded_fb.extend(sub_fb)
                    elif len(fbc) > 20 or is_vn_legal_reference(fbc):
                        expanded_fb.append(fbc)
                if len(expanded_fb) >= 2:
                    return expanded_fb
            url_chunks = [flat]
        else:
            url_chunks = [flat]

        # Step 4: Split each URL-bounded chunk on inline APA / legal entry boundaries.
        entries: list[str] = []
        for chunk in url_chunks:
            sub = self._split_inline_entries(chunk)
            if sub:
                entries.extend(sub)
            elif len(chunk) > 20 or is_vn_legal_reference(chunk):
                entries.append(chunk)

        if len(entries) >= 2:
            return entries

        # Step 5: Fallback - split on newline / year markers
        return self._split_by_year_fallback(text)

    @staticmethod
    def _strip_running_headers(text: str) -> str:
        """Remove page furniture from a bibliography section.

        PDF page text repeats running headers (e.g. the essay title) and
        standalone page numbers on every page. When the bibliography spans
        several pages those lines end up glued to the front of the first entry
        on each page, corrupting its author/year metadata. Drop:
          - standalone page numbers ("43"),
          - standalone bibliography headers ("References"),
          - short lines that repeat at least twice (running headers),
          - running headers with page numbers (e.g. "TITLE...  28"),
          - Vietnamese journal running headers/footers and post-bibliography blocks.
        """
        lines = text.splitlines()
        counts = Counter(line.strip() for line in lines if line.strip())
        has_bracket_refs = any(re.match(r"^\s*\[\d+\]", ln) for ln in lines)

        # Pattern to match running headers with page numbers
        # e.g. "EMOTIONAL INTELLIGENCE AND HEART RATE VARIABILITY... 28"
        running_header_re = re.compile(r"^[\w\s]+?\s{3,}\d{1,3}\s*$")
        running_head_prefix_re = re.compile(r"^\s*Running\s+head\s*:.*$", re.IGNORECASE)
        allcaps_header_page_re = re.compile(r"^[A-Z0-9\s,'\-:]{4,70}\s+\d{1,3}\s*$")
        conf_running_header_re = re.compile(
            r"^\s*(?:(?:Published|Under\s+review)\s+as\s+a\s+(?:conference|workshop)\s+paper\s+at\s+.+|Preprint\.?(?:\s+Under\s+review\.?)?|(?:(?:Page\s+)?\d+\s+of\s+\d+|Page\s+\d+|of\s+\d{1,4})|(?:\d{1,3}\s+)?[A-Z][A-Za-zÀ-ÿ\-]+\s+et\s+al\.(?:\s+\d{1,3})?)\s*$",
            re.IGNORECASE,
        )
        vn_journal_furniture_re = re.compile(
            r"^(?:"
            r"Jos\.hueuni\.edu\.vn"
            r"|Tập\s+\d+\s*,\s*Số\s+[0-9A-Za-z]+\s*,\s*(?:19|20)\d{2}"
            r"|TRƯỜNG\s+ĐẠI\s+HỌC\s+LUẬT\s*,\s*ĐẠI\s+HỌC\s+HUẾ"
            r"|Khoa\s+học\s+Kiểm\s+sát"
            r"|Số\s+\d{1,3}\s*[-–]\s*(?:tháng\s+\d{1,2}\s*/\s*)?(?:19|20)\d{2}(?:\s+\d{1,3})?"
            r"|Tạp\s+chí\s+Quản\s+lý\s+nhà\s+nước\s*[-–]\s*Số\s+\d+.*"
            r"|Tạp\s+chí\s+Kinh\s+tế\s*[-–]\s*Luật\s*&\s*Ngân\s+hàng.*"
            r"|Năm\s+thứ\s+\d+.*Tạp\s+chí\s+Kinh\s+tế\s*[-–]\s*Luật\s*&\s*Ngân\s+hàng.*"
            r"|NHÀ\s+NƯỚC\s+VÀ\s+PHÁP\s+LUẬT"
            r"|Nghiên\s+cứu\s*[-–]\s*Trao\s+đổi"
            r"|vấn\s+đề\s+lý\s+luận\s+từ\s+thực\s+tiễn\s+phát\s+triển\s+và\s+hội\s+nhập"
            r"|TAÏP\s+CHÍ\s+COÂNG\s+THÖÔNG"
            r"|Soá\s+\d+\s*/\s*(?:19|20)\d{2}"
            r")\s*$",
            re.IGNORECASE,
        )
        post_bib_stop_re = re.compile(
            r"^\s*(?:[-•●▪▫\uf0a7\uf0b7\uf0d8\uf0fc\uf076]+\s*)?(?:(?:\d+(?:\.\d+)+)[\.\)]?\s*)?(?:Ngày\s+nhận\s+bài|ABSTRACT|SUMMARY|TÓM\s+TẮT|Thông\s+tin\s+tác\s+giả|Author\s+information"
            r"|(?:INDIVIDUAL\s+PROJECT\s+)?SELF[- ]?EVALUATION|BẢNG\s+TỰ\s+ĐÁNH\s+GIÁ|PHỤ\s*LỤC"
            r"|Chỉ\s+mục|Index|Khối\s+li[ệê]u\s+được\s+trích\s+dẫn"
            r"|Chi\s+tiết\s+phân\s+công(?:\s+công\s+việc)?|Bảng\s+phân\s+công\s+công\s+việc|Đánh\s+giá\s+mức\s+độ\s+hoàn\s+thành"
            r"|(?:Phần\s+mềm\s+và\s+thư\s+viện|Công\s+cụ\s+và\s+thư\s+viện)\s+(?:được\s+)?sử\s+dụng"
            r"|Литература|Список\s+литературы|Об\s+авторах)\s*(?::|$)",
            re.IGNORECASE,
        )

        cleaned: list[str] = []
        for idx_ln, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                cleaned.append("")
                continue
            # Stop if post-bibliography metadata / index / task-allocation / software list begins
            if post_bib_stop_re.match(stripped) and any(c.strip() for c in cleaned):
                break
            if (
                re.fullmatch(r"\d+(?:\.\d+)+[\.\)]?", stripped)
                and idx_ln + 1 < len(lines)
                and post_bib_stop_re.match(lines[idx_ln + 1].strip())
                and any(c.strip() for c in cleaned)
            ):
                break
            # Drop HTML hyperlink return anchors ("return to" / "text") and Australian TEXT journal footers
            if re.fullmatch(
                r"(?:return\s+to(?:\s+text)?|TEXT\s+Vol\s+\d+\s+No\s+\d+.*|.*Revista\s+de\s+Estudios\s+Norteamericanos.*ISSN\s+\d{4}-\d{3,4}.*)",
                stripped,
                re.IGNORECASE,
            ):
                continue
            if stripped.lower() == "text" and idx_ln > 0 and lines[idx_ln - 1].strip().lower() == "return to":
                continue
            # In a bracket-numbered bibliography ([1]..[N]), a bare 2-digit number line
            # near the bottom of the page (e.g. "31" followed by footnote text) marks bottom footnotes,
            # ONLY if no further [N] bibliography entries appear after it (otherwise it is a page number).
            if (
                has_bracket_refs
                and re.fullmatch(r"\d{2}", stripped)
                and int(stripped) >= 15
                and any(re.match(r"^\s*\[\d+\]", c_ln) for c_ln in cleaned)
                and not any(re.match(r"^\s*\[\d+\]", rem_ln) for rem_ln in lines[idx_ln + 1 :])
            ):
                break
            # Skip standalone page numbers or PDF font encoding bullet '®'
            # (unless the previous line ended mid-DOI/URL, e.g. "...2020.acl-main.\n740")
            if re.fullmatch(
                r"(?:\d{1,4}|\[\d{3,4}\]|®|Trang\s+\d{1,4}|\d{1,4}\s*\|\s*Page)",
                stripped,
                re.IGNORECASE,
            ):
                if stripped.isdigit() and cleaned:
                    prev_clean = cleaned[-1].strip()
                    next_nonempty_rem = next(
                        (rem.strip() for rem in lines[idx_ln + 1 :] if rem.strip()),
                        "",
                    )
                    is_root_domain_slash = bool(
                        re.search(r"https?://[^/\s]+/$", prev_clean, re.IGNORECASE)
                    )
                    followed_by_new_ref = bool(
                        prev_clean.endswith("/")
                        and re.match(
                            r"^(?:\[\s*\d{1,3}\s*\]|\d{1,3}[\.\)]\s+[A-ZÀ-Ý])",
                            next_nonempty_rem,
                        )
                    )
                    if (
                        not is_root_domain_slash
                        and not followed_by_new_ref
                        and re.search(
                            r"(?:https?://|\b10\.\d{4,9}/)\S*[./\-_]$",
                            prev_clean,
                            re.IGNORECASE,
                        )
                    ):
                        cleaned.append(stripped)
                continue
            # Skip bibliography header lines
            if _BIB_HEADER_LINE_RE.match(stripped):
                continue
            # Skip Vietnamese journal running headers/footers
            if vn_journal_furniture_re.match(stripped):
                continue
            # Skip running headers with page numbers (TITLE...  28 or Running head: ...)
            if (
                running_header_re.match(stripped)
                or running_head_prefix_re.match(stripped)
                or allcaps_header_page_re.match(stripped)
                or conf_running_header_re.match(stripped)
            ):
                continue
            # Skip short repeated lines without year/URL (typical running headers, never numbered ref starts or DOI/page lines)
            if (
                counts[stripped] >= 2
                and len(stripped) < 100  # Increased from 80 to catch more headers
                and (
                    len(stripped.split()) >= 2
                    or (stripped.isupper() and len(stripped) >= 4 and stripped.upper() != "URL")
                )
                and not re.fullmatch(r"(?:[A-ZÀ-Ý]\.\s*)+", stripped)
                and not re.search(r"(?:19|20)\d{2}|\bdoi\s*:|\b10\.\d{4,9}/|\bpp?\.\s*\d+|\bProceedings\s+of\b", stripped, re.IGNORECASE)
                and "http" not in stripped.lower()
                and not re.match(r"^\s*(?:\[\d{1,3}\]|\d{1,3}\s*[\.\)])\s+[A-ZÀ-Ý]", stripped)
            ):
                continue
            # Strip HTML-to-PDF hyperlink anchor artifact "return to text" and LaTeX pagebackref page numbers
            line = re.sub(r"\s+\breturn\s+to(?:\s+text)?\b\s*$", ".", line, flags=re.IGNORECASE)
            line = re.sub(
                r"((?:(?:18|19|20)\d{2}[a-z]?|https?://\S+|10\.\d{4,9}/\S+)\.)\s+\d{1,3}(?:,\s*\d{1,3})*\s*$",
                r"\1",
                line,
            )
            cleaned.append(line)
        return "\n".join(cleaned)

    def _split_by_year_fallback(self, text: str) -> list[str]:
        """Fallback: split reference list by newline boundaries.

        This method is called when DOI/URL-based splitting fails.
        Each reference entry is on its own line (or separated by blank lines).
        Returns list of entries.
        """
        # Split by blank lines first (paragraph-style)
        parts = re.split(r"\n\s*\n", text)
        if len(parts) >= 2:
            coalesced_parts: list[str] = []
            for p in parts:
                p_strip = p.strip()
                if not p_strip:
                    continue
                if (
                    coalesced_parts
                    and not re.search(
                        r'(?:[.)"\u201d]|https?://\S+|doi\.org/\S+)\s*$',
                        coalesced_parts[-1],
                        re.IGNORECASE,
                    )
                    and not _INLINE_ENTRY_START_RE.match(p_strip)
                    and not re.match(r"^(?:\[\d+\]|\d+\s*[\.\)])", p_strip)
                ):
                    coalesced_parts[-1] = f"{coalesced_parts[-1]}\n{p_strip}"
                else:
                    coalesced_parts.append(p_strip)
            expanded_parts: list[str] = []
            for p_strip in coalesced_parts:
                # If a paragraph chunk spans a page break and glues two complete entries
                # separated by a newline (where the first line ends with ", YYYY." or a URL),
                # split them cleanly.
                sub_lines = [ln.strip() for ln in p_strip.splitlines() if ln.strip()]
                if len(sub_lines) >= 2 and all(
                    re.search(r"(?:,\s*(?:19|20)\d{2}\.?|https?://\S+)\s*$", ln)
                    for ln in sub_lines
                ):
                    expanded_parts.extend(sub_lines)
                else:
                    expanded_parts.append(p_strip)
            result = [
                p
                for p in expanded_parts
                if len(p) > 20 or is_vn_legal_reference(p)
            ]
            if len(result) >= 2:
                return result

        # Split by newlines - each line is likely an entry
        lines = text.split("\n")
        entries: list[str] = []
        current = ""

        for line in lines:
            stripped = line.strip()
            if not stripped:
                # Blank line - end current entry if any
                if current:
                    entries.append(current.strip())
                    current = ""
            elif re.match(
                r"^(?:\d+\s*[\.\)]\s*)?(?:[A-ZÀ-ÝĂÂĐÊÔƠƯĨŨẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ][a-zA-ZÀ-ỹ]|[\u2014\u2013\u2012―—–_-]{2,}\.|\.\s+[\"\u201c\u2018A-ZÀ-Ý])",
                stripped,
            ) and (
                not current
                or bool(re.match(r"^(?:\d+\s*[\.\)]\s+|[\u2014\u2013\u2012―—–_-]{2,}\.)", stripped))
                or (
                    bool(re.search(r'(?:[.)"\u201d]|https?://\S+|doi\.org/\S+)\s*$', current, re.IGNORECASE))
                    and bool(re.search(r"(?:18|19|20)\d{2}|\bn\.?d\.?\b|https?://", current, re.IGNORECASE))
                )
            ):
                # Line starts with uppercase or numbered legal item - new entry
                if current:
                    entries.append(current.strip())
                current = stripped
            else:
                # Continuation line (wrapped text) - append to current
                current = (current + " " + stripped).strip()

        # Don't forget the last entry
        if current.strip():
            entries.append(current.strip())

        # Filter out very short entries (likely not citations), keeping valid legal documents
        result = [e for e in entries if len(e) > 20 or is_vn_legal_reference(e)]

        return result if len(result) >= 2 else []

    def _parse_entry(
        self, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        """Parse 1 entry. Try format modules first, then fallback to legacy patterns.

        Strategy:
            1. Normalize: replace newlines with spaces
            2. Extract numeric_index if entry starts with [N] prefix
            3. Try format modules from registry
            4. Fallback to legacy patterns (_parse_apa_entry, _parse_ieee_entry, etc.)
            5. Fallback to _parse_fallback_entry if numeric_index available
        """
        # Normalize: join wrapped lines (preserving compound hyphens and de-hyphenating line breaks)
        if "\n" in entry:
            joined = ""
            for ln in entry.splitlines():
                if ln.strip():
                    joined = self._join_wrapped_line(joined, ln.strip()) if joined else ln.strip()
            entry = joined
        entry = entry.replace("\n", " ").replace("\xad", "").replace("  ", " ")
        entry = entry.replace("\u2018\u2018", "\u201c").replace("\u2019\u2019", "\u201d")
        entry = re.sub(r"\s*\[trans\s*:[^\]]*\]?\s*$", "", entry, flags=re.IGNORECASE).strip()
        # Strip Wingdings / Private Use Area bullets, dangling access-time prefix ("10:15 Kruse..."), meta-analysis leading asterisk ("*Adil, A."), or template ellipsis ("… Vaswani, A.")
        entry = re.sub(r"^\s*[\uf0a7\uf0b7\uf0d8\uf0fc\uf076•●▪▫]+\s*", "", entry)
        entry = re.sub(r"^\s*\d{1,2}:\d{2}(?::\d{2})?\s+(?=[A-ZÀ-Ý])", "", entry)
        entry = re.sub(r"^\s*(?:page\s+)?(?:\d+\s+)?of\s+\d{1,4}\s+(?=[A-ZÀ-Ý])", "", entry, flags=re.IGNORECASE)
        entry = re.sub(r"^\s*(?:\*|\u2026|\.{2,})\s*(?=[A-ZÀ-Ý])", "", entry)
        # Strip Slavic/European Harvard key prefix (e.g. "Ewing 2002 – Ewing E.T. (2002) ...")
        entry = re.sub(
            r"^\s*[A-ZÀ-Ý][A-Za-zÀ-ỹ'\u2019\-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ỹ'\u2019\-]+)?\s+(?:18|19|20)\d{2}[a-z]?\s*[–—-]\s+(?=[A-ZÀ-Ý])",
            "",
            entry,
        )
        # Normalize "[1]. Author" or "[1]: Author" -> "[1] Author" so punctuation after bracket doesn't corrupt author parsing
        entry = re.sub(r"^\s*\[\s*(\d+)\s*\]\s*[.,:]\s*", r"[\1] ", entry)
        entry = re.sub(r"\b(https?)\s*:\s*//\s*", r"\1://", entry, flags=re.IGNORECASE)
        entry = re.sub(r"\.(p)\s+(df)\b", r".\1\2", entry, flags=re.IGNORECASE)
        for _ in range(3):
            entry = re.sub(r"(https?://\S*[/_\-~])\s+([a-z0-9_\-~])", r"\1\2", entry)
            entry = re.sub(r"(https?://\S*\.)\s+([a-z0-9_\-~])", r"\1\2", entry)

        original_entry_raw = entry.strip()
        alpha_key_m = re.match(
            r"^\s*\[(?P<akey>[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9+\-]{1,8}\d{2}[a-z]?)\]\s+",
            entry,
        )
        if alpha_key_m:
            entry = entry[alpha_key_m.end() :].strip()

        # FIX: Extract numeric_index first if entry starts with [N], (N), N., or "N Author (Year)" prefix
        numeric_index = None
        idx_match = re.match(
            r"^\s*(?:\[\s*(?P<b_idx>\d+)\s*\]|\(\s*(?P<p_idx>\d{1,3})\s*\)|(?P<d_idx>\d{1,3})\s*[\.\)]\s*|(?P<s_idx>\d{1,2})\s+(?=[A-ZÀ-Ý].*(?:\(\s*(?:19|20)\d{2}|\bn\.?\s*d\.?|https?://)))",
            entry,
        )
        if idx_match:
            idx_str = (
                idx_match.group("b_idx")
                or idx_match.group("p_idx")
                or idx_match.group("d_idx")
                or idx_match.group("s_idx")
            )
            if idx_str:
                numeric_index = int(idx_str)
            if idx_match.group("s_idx"):
                entry = entry[idx_match.end() :].strip()

        # TDTU §2.6.1 Vietnamese legal document entry
        legal_citation = parse_vn_legal_reference(entry)
        if legal_citation is not None:
            legal_citation.page_num = page_num
            legal_citation.order_index = order_index
            if numeric_index and legal_citation.numeric_index is None:
                legal_citation.numeric_index = numeric_index
            return legal_citation

        # Vietnamese traditional humanities/law entry (e.g. "[1] Đỗ Văn Đại, Title, Nxb. Hồng Đức, 2023"
        # or "8. Giáo dục liêm chính... https://..., ngày 30/8/2024.")
        vn_trad_citation = self._parse_vn_traditional_entry(
            entry, order_index, page_num, numeric_index, allow_fallback=False
        )
        if vn_trad_citation is not None:
            return vn_trad_citation

        # Scriptural / Bible edition entry (e.g. "The Bible. ESV ed., Crossway, 2022.",
        # "English Standard Version Bible. Crossway Bibles, 2016.",
        # "The ESV Study Bible, Wheaton, IL: Crossway, 2008.")
        bible_m = re.match(
            r"^The\s+Bible\.\s*(?:([A-Z]{2,6})\s+ed\.,\s*)?([^,]+),\s*((?:19|20)\d{2})\.?$",
            entry.strip(),
            re.IGNORECASE,
        )
        if bible_m:
            ed_code = (bible_m.group(1) or "Bible").upper()
            pub = bible_m.group(2).strip()
            yr = bible_m.group(3)
            return Citation(
                raw_text=entry.strip(),
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.MLA,
                page_num=page_num,
                order_index=order_index,
                matched_pattern="mla_bible_edition",
                authors=[ed_code],
                title=f"The Bible ({ed_code} ed.)" if bible_m.group(1) else "The Bible",
                year=yr,
                venue=pub,
                confidence=0.9,
            )

        bible_named_m = re.match(
            r"^(?P<btitle>(?:The\s+)?(?:English\s+Standard\s+Version|ESV(?:\s+Study)?|King\s+James|New\s+International\s+Version|NIV|NKJV|NASB|RSV|NRSV|Holy)\s+Bible)[.,]\s*(?:(?P<city>[A-Za-z.\s]+,\s*[A-Z]{2}):\s*)?(?P<pub>[^,]+),\s*(?P<yr>(?:19|20)\d{2})\.?$",
            entry.strip(),
            re.IGNORECASE,
        )
        if bible_named_m:
            btitle = bible_named_m.group("btitle").strip()
            pub = bible_named_m.group("pub").strip()
            yr = bible_named_m.group("yr")
            return Citation(
                raw_text=entry.strip(),
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.MLA,
                page_num=page_num,
                order_index=order_index,
                matched_pattern="mla_bible_edition",
                authors=[btitle],
                title=btitle,
                year=yr,
                venue=pub,
                confidence=0.9,
            )

        # Unquoted book/chapter entry: ``Surname, Initials, Title (Year) venue``.
        # Must run BEFORE the format registry — ``nature_book`` claims these
        # entries with a one-letter "title" and provably wrong authors.
        book_citation = self._parse_unquoted_book_entry(entry, order_index, page_num)
        if book_citation:
            if numeric_index and book_citation.numeric_index is None:
                book_citation.numeric_index = numeric_index
            return book_citation

        # Try format modules from registry first (Two-pass: strict patterns before fallbacks)
        # Require title for a meaningful match (year alone is not enough)
        # IEEE entries with [N] prefix are an exception - they should be accepted with just year
        all_formats = get_all_formats()
        is_ama_specific = bool(
            re.match(r"^\s*\d+\.\s+", entry)
            and (
                re.search(r"\bdoi:\s*10\.\d{4,9}/", entry, re.IGNORECASE)
                or re.search(r"[^.:]+:\s*[^;]+;\s*(?:19|20)\d{2}\b", entry)
            )
        )
        is_cse_nameyear_specific = bool(
            not re.match(r"^\s*(?:\[\s*\d+\s*\]|\d+\.)", entry)
            and re.match(
                r"^[A-ZÀ-Ý][a-zA-ZÀ-ÿ'-]+\s+(?!AI\b|II\b|III\b|IV\b|LLC\b|INC\b|LTD\b|PLC\b)[A-Z]{1,3}(?:,\s+[A-ZÀ-Ý][a-zA-ZÀ-ÿ'-]+\s+[A-Z]{1,3})*\.\s+(?:19|20)\d{2}\.\s+",
                entry,
            )
        )

        is_ieee_initial_bracket = bool(
            re.match(r"^\s*\[\s*\d+\s*\]\s*(?:[A-Z](?:-[A-Z])?\.\s*)+[A-Z][a-zA-Z'\-]+", entry)
        )

        for allow_fallback in (False, True):
            if allow_fallback:
                vn_trad_fallback = self._parse_vn_traditional_entry(
                    entry, order_index, page_num, numeric_index, allow_fallback=True
                )
                if vn_trad_fallback is not None:
                    return vn_trad_fallback
            for fmt in all_formats:
                if not allow_fallback:
                    if is_ama_specific and fmt.name in ("Vancouver", "CSE", "ACS"):
                        continue
                    if is_cse_nameyear_specific and fmt.name in ("Vancouver", "Chicago", "Harvard"):
                        continue
                    if is_ieee_initial_bracket and fmt.name in ("Chicago", "MLA"):
                        continue
                citation = fmt.parse_reference_entry(entry)
                if not citation:
                    continue
                is_fallback = "fallback" in (citation.matched_pattern or "")
                if is_fallback != allow_fallback:
                    continue
                has_title = bool(citation.title)
                has_year = bool(citation.year)
                has_numeric_index = citation.numeric_index is not None
                # Never let the short-title book pattern (``nature_book``)
                # claim an entry whose title is a stray token: it drops the
                # year and turns the title's words into fake authors.
                if (
                    citation.matched_pattern == "nature_book"
                    and (not has_year or len((citation.title or "").strip()) < 8)
                ):
                    continue
                # Accept if: (has title AND (has year OR doi OR url)), OR (has year AND has numeric_index)
                if (has_title and (has_year or citation.doi or citation.url)) or (
                    has_year and has_numeric_index
                ):
                    if citation.title and not re.match(r"^https?://\S+$", citation.title.strip(), re.IGNORECASE):
                        cleaned_t = re.sub(r"\s*https?://\S+\s*$", "", citation.title).strip().rstrip(".,;:")
                        if len(cleaned_t) >= 5:
                            citation.title = cleaned_t
                            citation.title_normalized = _normalize_title(cleaned_t)
                    if not citation.doi:
                        arxiv_m = re.search(
                            r"(?:arxiv[:\s]+|arxiv\.org/(?:abs|pdf)/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?",
                            entry,
                            re.IGNORECASE,
                        )
                        if arxiv_m:
                            aid = arxiv_m.group(1)
                            citation.doi = f"10.48550/arXiv.{aid}"
                            if not citation.year and len(aid) >= 4 and aid[:2].isdigit():
                                yy = int(aid[:2])
                                if 7 <= yy <= 30:
                                    citation.year = str(2000 + yy)
                    # Set common fields
                    if alpha_key_m:
                        citation.raw_text = original_entry_raw
                    citation.page_num = page_num
                    citation.order_index = order_index
                    citation.citation_type = CitationType.REFERENCE_LIST
                    # Set numeric_index if found and not already set
                    if numeric_index and citation.numeric_index is None:
                        citation.numeric_index = numeric_index
                    if not citation.url:
                        from integrity_checker.extraction.patterns.utils import extract_url

                        extracted_u = extract_url(entry)
                        if extracted_u and not re.search(
                            r"doi\.org/10\.\d{4,9}/", extracted_u, re.IGNORECASE
                        ):
                            citation.url = extracted_u
                    return citation

        # Fallback to legacy patterns if format modules didn't match
        # IEEE first (vì có marker [N] đặc trưng)
        if re.match(r"^\s*\[\d+\]", entry):
            citation = self._parse_ieee_entry(entry, order_index, page_num)
            if citation:
                if numeric_index and citation.numeric_index is None:
                    citation.numeric_index = numeric_index
                if not citation.url:
                    from integrity_checker.extraction.patterns.utils import extract_url

                    extracted_u = extract_url(entry)
                    if extracted_u and not re.search(
                        r"doi\.org/10\.\d{4,9}/", extracted_u, re.IGNORECASE
                    ):
                        citation.url = extracted_u
                return citation

        citation = self._parse_apa_entry(entry, order_index, page_num)
        if citation:
            if alpha_key_m:
                citation.raw_text = original_entry_raw
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Vancouver last — heuristic loose
        citation = self._parse_vancouver_entry(entry, order_index, page_num)
        if citation:
            if alpha_key_m:
                citation.raw_text = original_entry_raw
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Fallback to numbered Vietnamese traditional item if no structured format matched
        vn_trad_fallback = self._parse_vn_traditional_entry(
            entry, order_index, page_num, numeric_index, allow_fallback=True
        )
        if vn_trad_fallback is not None:
            return vn_trad_fallback

        # FIX: Fallback - create citation with numeric_index if available,
        # or for unnumbered bibliography items with URLs, quotes, or clear title-author structure.
        if numeric_index is not None or (
            len(entry) >= 18
            and (
                re.search(
                    r"https?://|\bwww\.|\([a-z0-9.-]+\.(?:com|org|io|vn|asia|net|edu)\)|[\"\u201c][^\"\u201d]+[\"\u201d]\s+bởi\s+|\b(?:Slide|Website|Ebook|Documentation|Chapter\s+\d+|A\s+Comprehensive\s+Guide|IPC-\d+)\b",
                    entry,
                    re.IGNORECASE,
                )
                or (
                    re.search(r"\s+[–—-]\s+[A-ZÀ-Ý]", entry)
                    and not re.search(r"\b(?:ISSN|vol\.|pp\.|(?:18|19|20)\d{2})\b", entry, re.IGNORECASE)
                )
            )
        ):
            citation = self._parse_fallback_entry(
                entry, numeric_index, order_index, page_num
            )
            if citation:
                return citation

        return None

    # -- per-style parsers --

    def _parse_vn_traditional_entry(
        self,
        entry: str,
        order_index: int,
        page_num: int,
        numeric_index: int | None = None,
        allow_fallback: bool = False,
    ) -> Citation | None:
        """Parse Vietnamese traditional humanities/law reference entries where Year is at the end
        or omitted (e.g., '[1] Đỗ Văn Đại, Title, Nxb. Hồng Đức, 2023', '8. Title. https://..., ngày 30/8/2024')."""
        if not _STRICT_VN_DIACRITIC_RE.search(entry):
            return None
        # 'đ' (Croatian/Serbian/Slovene/Sami) and 'ă' (Romanian) also exist in non-Vietnamese alphabets.
        # Require either a uniquely Vietnamese vowel/tone mark or a Vietnamese bibliographic keyword.
        if not re.search(
            r"[ằắẳẵặầấẩẫậềếểễệồốổỗộơờớởỡợưừứửữựảạẻẽẹỉĩịỏọủũụỳỷỹỵ]"
            r"|\b(?:Nxb|NXB|Nhà\s+xuất\s+bản|Tạp\s+chí|Luận\s+văn|Luận\s+án|Khóa\s+luận|chủ\s+biên|truy\s+cập|Việt\s+Nam|Hà\s+Nội)\b",
            entry,
            re.IGNORECASE,
        ):
            return None
        # Do not intercept APA entries that have (Year) or (n.d.) or Chicago Author-Date (. YYYY.) right after the author block
        if re.search(
            r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])?\s*[^()]{2,600}\(\s*(?:(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?:18|19|20)\d{2}[a-z]?(?:\s*[,–\-/]\s*[^)]*)?|n\.?\s*d\.?(?:-[a-z])?)\s*\)"
            r"|\(\s*(?:(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?:18|19|20)\d{2}[a-z]?(?:\s*[,–\-/]\s*[^)]*)?|n\.?\s*d\.?(?:-[a-z])?)\s*\)\s*[.,:]\s+\S"
            r"|^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])?\s*[^.]{2,200}\.\s+(?:18|19|20)\d{2}[a-z]?(?:/(?:18|19|20)\d{2})?\.\s+\S",
            entry,
            re.IGNORECASE,
        ):
            return None

        cleaned = re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])\s*", "", entry).strip()
        if not cleaned:
            return None

        style = CitationStyle.IEEE if re.match(r"^\s*\[\s*\d+\s*\]", entry) else CitationStyle.APA
        doi_m = _DOI_RE.search(cleaned)
        doi = doi_m.group(0).rstrip(".,;") if doi_m else None
        url_m = re.search(r"(https?://[^\s,;)\]]+)", cleaned, re.IGNORECASE)
        url = url_m.group(1).rstrip(".,;") if url_m else None
        year, _ = extract_publication_year(cleaned, prefer_last=True, allow_1800s=True)

        # Subcase A: Quoted title (e.g. '[3] Trương Đắc Linh và Nguyễn Mạnh Hùng, “Giới thiệu Hiến pháp mới”, Tạp chí...')
        q_m = re.match(
            r"^(?:(?P<authors>[^\"\u201c\u2018]{2,95}?)\s*[.,:-]\s*)?[\"\u201c\u2018](?P<title>[^\"\u201d\u2019]{5,})[\"\u201d\u2019]\s*[.,;-]?\s*(?P<venue>.*)$",
            cleaned,
        )
        if q_m:
            raw_auth = (q_m.group("authors") or "").strip()
            raw_auth = re.sub(r"^(?:Bài\s+viết|Bài)\s*$", "", raw_auth, flags=re.IGNORECASE).strip()
            raw_auth = re.sub(r"\s*\(chủ\s+biên\)", "", raw_auth, flags=re.IGNORECASE).strip()
            title = q_m.group("title").strip().rstrip(".,;")
            venue = (q_m.group("venue") or "").strip().rstrip(".,;")
            # Check if author is at the very end after ' - ' (e.g. 'Bài “Title” - Banking Magazine số 7, tháng 4/2025 - Lê Thị Giang')
            if not raw_auth and " - " in venue:
                v_parts = [vp.strip() for vp in venue.rsplit(" - ", 1)]
                if len(v_parts) == 2 and 2 <= len(v_parts[1].split()) <= 5:
                    venue, raw_auth = v_parts[0], v_parts[1]
            return Citation(
                raw_text=entry.strip(),
                citation_type=CitationType.REFERENCE_LIST,
                style=style,
                page_num=page_num,
                order_index=order_index,
                numeric_index=numeric_index,
                matched_pattern="vn_traditional_entry",
                authors=parse_authors(raw_auth) if raw_auth else [],
                title=title,
                title_normalized=_normalize_title(title),
                year=year,
                venue=venue or None,
                doi=doi,
                url=url,
                confidence=0.85,
            )

        # Subcase B: Unquoted title before Nxb / NXB / Tạp chí / Luận văn / Luận án / Trường Đại học
        v_m = re.search(
            r",\s*(?P<venue>(?:Nxb\.?|NXB|Nhà\s+xuất\s+bản|Tạp\s+chí|Luận\s+văn|Luận\s+án|Khóa\s+luận|Kỷ\s+yếu|Hội\s+thảo|Tài\s+liệu\s+hội\s+thảo)\b.+)$",
            cleaned,
            re.IGNORECASE,
        )
        if v_m:
            before_v = cleaned[: v_m.start()].strip()
            venue = v_m.group("venue").strip().rstrip(".,;")
            if "," in before_v:
                # Split author(s) from title: if '(chủ biên)' is present, split right after it;
                # otherwise split at the comma before 'Giáo trình'/'Những'/'Một số'/'Pháp luật'/'Bàn về'/'Bảo vệ'/'Vấn đề' or first comma.
                cb_m = re.search(r"\(chủ\s+biên\)\s*,\s*", before_v, re.IGNORECASE)
                if cb_m:
                    raw_auth = before_v[: cb_m.start()].strip()
                    title = before_v[cb_m.end() :].strip()
                else:
                    parts = [p.strip() for p in before_v.split(",") if p.strip()]
                    if len(parts) >= 3 and all(2 <= len(p.split()) <= 5 for p in parts[:-1]):
                        raw_auth = ", ".join(parts[:-1])
                        title = parts[-1]
                    else:
                        raw_auth, title = parts[0], ", ".join(parts[1:])
                return Citation(
                    raw_text=entry.strip(),
                    citation_type=CitationType.REFERENCE_LIST,
                    style=style,
                    page_num=page_num,
                    order_index=order_index,
                    numeric_index=numeric_index,
                    matched_pattern="vn_traditional_entry",
                    authors=parse_authors(raw_auth) if raw_auth else [],
                    title=title.rstrip(".,;"),
                    title_normalized=_normalize_title(title),
                    year=year,
                    venue=venue,
                    doi=doi,
                    url=url,
                    confidence=0.85,
                )

        # Subcase C: Vietnamese web/news reference with URL (e.g. '8. Giáo dục liêm chính... https://..., ngày 30/8/2024.')
        if url_m:
            before_url = cleaned[: url_m.start()].strip()
            before_url = re.sub(
                r"[,;.]?\s*(?:xem\s+tại|truy\s+cập\s+(?:tại|từ)|nguồn|available\s+at|retrieved\s+from)\s*:?\s*$",
                "",
                before_url,
                flags=re.IGNORECASE,
            ).strip().rstrip(".,;:")
            if len(before_url) >= 8:
                raw_auth = ""
                title = before_url
                if "," in before_url:
                    first_seg, rest_seg = before_url.split(",", 1)
                    if 2 <= len(first_seg.strip().split()) <= 4 and not re.search(r"\b(?:pháp\s+luật|giáo\s+dục|nghiên\s+cứu|thông\s+báo|báo\s+cáo|quy\s+định)\b", first_seg, re.I):
                        raw_auth = first_seg.strip()
                        title = rest_seg.strip()
                return Citation(
                    raw_text=entry.strip(),
                    citation_type=CitationType.REFERENCE_LIST,
                    style=style,
                    page_num=page_num,
                    order_index=order_index,
                    numeric_index=numeric_index,
                    matched_pattern="vn_traditional_entry",
                    authors=parse_authors(raw_auth) if raw_auth else [],
                    title=title,
                    title_normalized=_normalize_title(title),
                    year=year,
                    url=url,
                    confidence=0.80,
                )

        # Subcase D: Numbered Vietnamese report/document item without year or with year in title
        if allow_fallback and numeric_index is not None and len(cleaned) >= 20:
            raw_auth = ""
            title = cleaned.rstrip(".,;")
            authors_list: list[str] = []
            if "," in cleaned:
                first_seg, rest_seg = cleaned.split(",", 1)
                first_seg_s = first_seg.strip()
                if re.match(
                    r"^(?:Sở|Bộ|Ủy\s+ban|Uỷ\s+ban|Tòa\s+án|Toà\s+án|Viện|Tổng\s+cục|Cục|Ban|Hội|Trường|Ngân\s+hàng|Chính\s+phủ|Quốc\s+hội|Văn\s+phòng)\b",
                    first_seg_s,
                    re.IGNORECASE,
                ):
                    authors_list = [first_seg_s]
                    title = rest_seg.strip().rstrip(".,;")
                elif (
                    2 <= len(first_seg_s.split()) <= 6
                    and not re.search(
                        r"\b(?:pháp\s+luật|giáo\s+dục|nghiên\s+cứu|thông\s+báo|báo\s+cáo|quy\s+định|thực\s+trạng|vấn\s+đề|một\s+số|những|bàn\s+về)\b",
                        first_seg_s,
                        re.IGNORECASE,
                    )
                ):
                    authors_list = parse_authors(first_seg_s)
                    title = rest_seg.strip().rstrip(".,;")
            return Citation(
                raw_text=entry.strip(),
                citation_type=CitationType.REFERENCE_LIST,
                style=style,
                page_num=page_num,
                order_index=order_index,
                numeric_index=numeric_index,
                matched_pattern="vn_traditional_entry",
                authors=authors_list,
                title=title,
                title_normalized=_normalize_title(title),
                year=year,
                doi=doi,
                url=url,
                confidence=0.75,
            )

        return None

    def _parse_unquoted_book_entry(
        self, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        """Parse ``Surname, Initials, Title (Year) venue`` (no quoted title).

        Example: ``Settles, B, Active Learning (2012) Synthesis Lectures on …``.

        The comma that ends the author list is ambiguous when the title
        itself starts with ``Word, Word`` (``Settles, B, Learning, Active
        (2012)``): several split points are valid, so every split is tried and
        the longest author list whose pieces all look like ``Surname,
        Initials`` wins. A piece such as ``John`` (full first name) is never
        accepted as initials, so ``Smith, John, Title (2020)`` falls through.
        """
        year_m = _YEAR_PAREN_SEARCH.search(entry)
        if not year_m:
            return None
        head = entry[: year_m.start()].strip()
        rest = entry[year_m.end():]

        # Standard APA entries have a period right after (Year): "Authors (Year). Title."
        # Unquoted book entries here have the title BEFORE (Year) and venue after (Year)
        # without a leading period, and do not contain author conjunctions (& / and) in head.
        if rest.lstrip().startswith("."):
            return None
        if "&" in head or re.search(r"\band\b", head, re.IGNORECASE):
            return None

        pieces = [p.strip() for p in head.split(",")]

        raw_authors: str | None = None
        title = ""
        # pieces[0] is the surname; pairs are (surname, initials).
        for n_pairs in range(len(pieces) // 2, 0, -1):
            pair_pieces = pieces[: n_pairs * 2]
            surname = pair_pieces[0]
            if len(surname) < 2 or _INITIALS_FULLMATCH.fullmatch(surname):
                continue
            if any(
                not _INITIALS_FULLMATCH.fullmatch(pair_pieces[i])
                for i in range(1, len(pair_pieces), 2)
            ):
                continue
            rem_pieces = [p.strip() for p in pieces[n_pairs * 2:] if p.strip()]
            if not rem_pieces:
                continue
            # If any remaining piece looks like author initials (e.g. "R. L."),
            # then head is a multi-author APA list, not an unquoted book title.
            if any(
                _INITIALS_FULLMATCH.fullmatch(p) or re.search(r"\b[A-ZÀ-Ý]\.", p)
                for p in rem_pieces
            ):
                continue
            if len(rem_pieces) == 2 and all(
                re.fullmatch(r"[A-ZÀ-Ý][a-zà-ỹ]+", p) for p in rem_pieces
            ):
                # GROBID sometimes inverts a 2-word book title into "Surname, Forename"
                # (e.g. "Active Learning" -> "Learning, Active").
                candidate_title = f"{rem_pieces[1]} {rem_pieces[0]}"
            else:
                candidate_title = ", ".join(rem_pieces).strip()
            if len(candidate_title) < 5 or not candidate_title[0].isupper():
                continue
            raw_authors = ", ".join(pair_pieces)
            title = candidate_title
            break
        if raw_authors is None:
            return None

        title = title.rstrip(",;: ").strip()
        doi_m = _DOI_RE.search(entry)
        return Citation(
            raw_text=entry.strip(),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            page_num=page_num,
            matched_pattern="unquoted_book_entry",
            order_index=order_index,
            title=title,
            title_normalized=_normalize_title(title),
            year=year_m.group(0)[1:-1].rstrip("abcdefghijklmnopqrstuvwxyz"),
            year_suffix=(suffix if (suffix := year_m.group(0)[-2:-1]).isalpha() else None),
            authors=parse_authors(raw_authors),
            venue=(rest.strip(" .,") or None),
            doi=doi_m.group(0).rstrip(".,") if doi_m else None,
            confidence=0.75,
        )

    def _parse_apa_entry(
        self, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        """Legacy APA entry parser (fallback when format module doesn't match)."""
        m = _APA_ENTRY_RE.search(entry)
        if not m:
            return None

        # FIX: Extract numeric_index if entry starts with [N] prefix (APA with numbering)
        numeric_index = None
        idx_match = re.match(r"^\[\s*(\d+)\s*\]", entry)
        if idx_match:
            numeric_index = int(idx_match.group(1))

        citation = Citation(
            raw_text=entry.strip(),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            page_num=page_num,
            matched_pattern="apa_reference_entry",
            order_index=order_index,
            numeric_index=numeric_index,  # FIX: Set numeric_index for APA entries with [N]
        )
        citation.year = m.group("year")
        if not citation.year:
            ym = _YEAR_RE.search(m.group("venue") or "")
            if ym:
                citation.year = ym.group(1)
        suffix = m.group("suffix")
        citation.year_suffix = suffix if suffix else None
        title = m.group("title").strip().rstrip(".")
        citation.title = title
        citation.title_normalized = _normalize_title(title)
        citation.venue = m.group("venue").strip().rstrip(".")
        authors_raw = re.sub(r"^\[\s*\d+\s*\]\s*", "", m.group("authors")).strip()
        citation.authors = parse_authors(authors_raw)
        # DOI
        doi_m = _DOI_RE.search(entry)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip(".")
        citation.confidence = _estimate_reference_confidence(citation)
        return citation

    def _parse_ieee_entry(
        self, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        """Parse 1 IEEE entry: '[N] authors, "title," venue, year.'

        Strategy: split trên quote marks (regex title có thể fail vì
        dấu phẩy trong title). Dùng split-based heuristic.
        """
        # Match [N] đầu dòng
        idx_m = re.match(r"^\[\s*(\d+)\s*\]\s*", entry)
        if not idx_m:
            return None
        remainder = entry[idx_m.end():]

        # Support both straight and curly quotes from PDF extractors
        quote_chars_open = '"\u201c\u2018'
        quote_chars_close = '"\u201d\u2019'

        first_q: int | None = None
        for i, c in enumerate(remainder):
            if c in quote_chars_open:
                first_q = i
                break
        if first_q is None:
            return None

        close_q: int | None = None
        for j in range(first_q + 1, len(remainder)):
            if remainder[j] in quote_chars_close:
                close_q = j
                break
        if close_q is None:
            return None

        authors_part = remainder[:first_q].strip().rstrip(",").rstrip()
        title_raw = remainder[first_q + 1:close_q].strip().rstrip(",").rstrip().lstrip('\u2018\u2019"\'')
        venue_year = remainder[close_q + 1:].strip().lstrip(",").strip()

        # Extract year: ignore page numbers/ranges, volume/issue numbers, DOIs, URLs,
        # and arXiv IDs, while preferring publication year over access year.
        year, suffix = extract_publication_year(venue_year, prefer_last=True)

        citation = Citation(
            raw_text=entry.strip(),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            page_num=page_num,
            matched_pattern="ieee_reference_entry",
            order_index=order_index,
            numeric_index=int(idx_m.group(1)),
        )
        citation.year = year
        citation.year_suffix = suffix
        citation.title = title_raw
        citation.title_normalized = _normalize_title(title_raw)
        citation.venue = venue_year
        citation.authors = parse_authors(authors_part)

        doi_m = _DOI_RE.search(entry)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip(".")
        citation.confidence = _estimate_reference_confidence(citation)
        return citation

    def _parse_fallback_entry(
        self, entry: str, numeric_index: int | None, order_index: int, page_num: int
    ) -> Citation | None:
        """Fallback parser: extract whatever metadata possible from an unparseable entry.

        Handles IEEE-style entries that lack quoted titles, or have unusual formatting.
        Extracts: numeric_index, DOI/arXiv, URL, year, authors, venue, and a best-effort title.
        """
        text = re.sub(r"\s*(?:INDIVIDUAL\s+PROJECT\s+)?SELF[- ]?EVALUATION.*$", "", entry.strip(), flags=re.IGNORECASE).strip()
        text = self._clean_subheader_prefix(text)

        # Extract DOI if present
        doi_m = _DOI_RE.search(text)
        doi = doi_m.group(0).rstrip(".").rstrip(",") if doi_m else None

        # Extract URL if present
        url_m = re.search(
            r"https?://[^\s\]\)\,;]+|\bwww\.[a-zA-Z0-9.-]+\.[a-z]{2,}(?:/[^\s\]\)\,;]*)?|\(\s*(?P<paren_url>[a-zA-Z0-9.-]+\.(?:org|com|edu|net|gov|io|vn|asia)(?:/[^\s\]\)\,;]*)?)\s*\)",
            text,
            re.IGNORECASE,
        )
        url: str | None = None
        if url_m:
            url = (url_m.group("paren_url") or url_m.group(0)).rstrip(".,;)")

        # Extract arXiv ID if present (supports arXiv:YYMM.NNNNN, arxiv.org/abs/..., arxiv.org/pdf/...)
        arxiv_m = re.search(r"(?:arXiv:|arxiv\.org/(?:abs|pdf)/)(\d{4}\.\d{4,5})(?:v\d+)?", text, re.IGNORECASE)
        arxiv_id = arxiv_m.group(1) if arxiv_m else None
        if not doi and arxiv_id:
            doi = f"10.48550/arXiv.{arxiv_id}"

        # Extract authors: everything after [N] / (N) / N. up to first recognizable year/doi
        after_index = re.sub(r"^\s*(?:\[\s*\d+\s*\]\s*[:.]?|\(\s*\d{1,3}\s*\)|\d{1,3}\s*[\.\)]|[-•●+])\s*", "", text).strip()

        # Case 1: Bare URL entry (e.g. "[1] https://..." or "1. https://...")
        if re.fullmatch(r"(?:https?://|www\.)\S+", after_index, re.IGNORECASE):
            clean_u = after_index.rstrip(".,;)")
            return Citation(
                raw_text=text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                page_num=page_num,
                matched_pattern="fallback_ieee_entry",
                order_index=order_index,
                numeric_index=numeric_index,
                title=clean_u,
                title_normalized=_normalize_title(clean_u),
                url=clean_u,
                confidence=0.6,
            )

        # Case 2: '"Title" bởi Author ... Ngày xuất bản: YYYY' (e.g. 082_tdtu)
        boi_m = re.match(
            r'^["\u201c](?P<title>[^"\u201d]+)["\u201d]\s+bởi\s+(?P<author>[^●•\n]+?)(?:\s*[●•]?\s*Ngày\s+xuất\s+bản\s*:\s*(?P<year>(?:19|20)\d{2}))?',
            after_index,
            re.IGNORECASE,
        )
        if boi_m:
            b_title = boi_m.group("title").strip()
            b_auth = boi_m.group("author").strip()
            b_yr = boi_m.group("year")
            return Citation(
                raw_text=text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                page_num=page_num,
                matched_pattern="fallback_ieee_entry",
                order_index=order_index,
                numeric_index=numeric_index,
                title=b_title,
                title_normalized=_normalize_title(b_title),
                authors=parse_authors(b_auth) or [b_auth],
                year=b_yr,
                url=url,
                confidence=0.8,
            )

        # Strip URL before extracting year so numbers inside URL paths (e.g. /2017/01/12/) don't become fake years
        text_without_url = re.sub(r"https?://\S+|\bwww\.\S+", "", after_index).strip()
        year, year_suffix = extract_publication_year(text_without_url or text, prefer_last=True)
        year_m = (
            re.search(rf"\b{re.escape(year + (year_suffix or ''))}\b", text_without_url)
            if year
            else _YEAR_RE.search(text_without_url)
        )
        if not year and arxiv_id and len(arxiv_id) >= 4 and arxiv_id[:2].isdigit():
            yy = int(arxiv_id[:2])
            year = f"20{yy:02d}" if yy <= 35 else f"19{yy:02d}"

        # Remove common metadata patterns and trailing URLs that confuse title extraction
        clean_text = text_without_url or after_index
        for pattern in [
            r',?\s*vol\.\s*\d+[A-Z]?(?:-\d+)?',      # vol. 5 or vol. 5-7
            r',?\s*no\.\s*\d+',                       # no. 3
            r',?\s*pp\.\s*[\d\-–]+',                 # pp. 1-20 or pp. 123
            r',?\s*p\.\s*\d+',                        # p. 42
            r',?\s*chapters?\s+\d+',                   # chapter 3
            r',?\s*edition',                           # edition marker
            r',?\s*technical\s+report[^,]*',          # technical report
            r'\s+\d{4}[a-z]?\s*$',                    # trailing year at end
        ]:
            clean_text = re.sub(pattern, "", clean_text, flags=re.IGNORECASE).strip()

        # Try to find title: text between quotes, or text after authors
        title_raw = None
        authors_part = ""
        # Quoted title
        quote_m = re.search(r'["\u201c]([^"\u201d]+)["\u201d]', clean_text)
        if quote_m:
            title_raw = quote_m.group(1).strip().rstrip(",")
        else:
            # Fallback title: everything after authors, before year/DOI
            remaining = clean_text
            if doi_m:
                remaining = remaining[:doi_m.start()].strip()
            if year_m and year_m.start() < len(remaining):
                remaining = remaining[:year_m.start()].strip()

            # STRATEGY 1: For entries like "[N] Authors. Title." (title after period, not after 1-letter initial)
            if not title_raw:
                book_title_m = re.match(
                    r"^.+?,\s+(?P<title>(?!and\b|&\b)[A-ZÀ-Ý][^.]{5,})(?<!\b[A-Z])\.\s+",
                    remaining,
                )
                if book_title_m:
                    title_raw = book_title_m.group("title").strip()
                    authors_part = remaining[: book_title_m.start("title")].rstrip(", ")

            if not title_raw:
                period_title_m = re.search(r"(?<!\b[A-Z])\.\s+(?=[A-Z][a-z])", remaining)
                if period_title_m:
                    candidate = remaining[period_title_m.end():].strip()
                    if candidate and len(candidate) > 5:
                        title_raw = candidate.rstrip(".,").strip()
                        authors_candidate = remaining[:period_title_m.start()].strip().rstrip(".")
                        if authors_candidate and authors_candidate != remaining:
                            authors_part = authors_candidate

            # STRATEGY 2: Authors end with comma followed by capitalized word
            if not title_raw:
                author_end = re.search(
                    r",\s*(?=[A-Z][a-z])", remaining
                )
                if author_end:
                    prefix_cand = remaining[:author_end.start()].strip()
                    candidate = remaining[author_end.end():].strip()
                    # Guard against splitting a title with a colon or multi-word clause before comma
                    # (e.g. "Visual Question Answering: Datasets, Algorithms, and Future Challenges")
                    prefix_looks_like_title = (
                        ":" in prefix_cand
                        or (len(prefix_cand.split()) > 4 and not re.search(r"\b(?:and|et\s+al)\b|&|\b[A-Z]\.", prefix_cand))
                    )
                    if candidate and len(candidate) > 10 and not prefix_looks_like_title:
                        title_raw = candidate.rstrip(".,").strip()
                elif "," in remaining:
                    parts = remaining.rsplit(",", 1)
                    if len(parts) >= 2 and len(parts[1].strip()) > 10 and ":" not in parts[0]:
                        title_raw = parts[1].strip().rstrip(".,").strip()

            if remaining and len(remaining) >= 8 and not title_raw:
                title_raw = remaining.rstrip(".,").strip()

        # Extract authors: everything before the title or year
        if not authors_part:
            if title_raw:
                idx = after_index.find(title_raw)
                if idx > 0:
                    authors_part = after_index[:idx].strip().rstrip(",").rstrip()
            elif year_m:
                idx = after_index.find(year_m.group(0))
                if idx > 0:
                    authors_part = after_index[:idx].strip().rstrip(",").rstrip()

        # Parse authors
        authors = parse_authors(authors_part) if authors_part else []

        # Extract venue: text after year (before DOI)
        venue = None
        if year_m and doi_m:
            venue = text[year_m.end():doi_m.start()].strip().rstrip(".,")
        elif year_m:
            venue = text[year_m.end():].strip().rstrip(".,")
        elif doi_m:
            venue = text[:doi_m.start()].strip().rstrip(".,")
            if authors_part and venue.startswith(authors_part):
                venue = venue[len(authors_part):].strip().lstrip(",").rstrip(".,")

        # Build title if not found: use arXiv ID or first part
        if not title_raw:
            if arxiv_id:
                title_raw = f"arXiv:{arxiv_id}"
            elif len(after_index) >= 8:
                title_raw = after_index[:100].strip()

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            page_num=page_num,
            matched_pattern="fallback_ieee_entry",
            order_index=order_index,
            numeric_index=numeric_index,
            title=title_raw if title_raw else None,
            title_normalized=_normalize_title(title_raw) if title_raw else None,
            year=year,
            year_suffix=year_suffix,
            authors=authors if authors else [],
            venue=venue if venue and len(venue) > 2 else None,
            doi=doi,
            url=url,
            confidence=0.7,  # Lower confidence for fallback parsing
        )
        return citation

    def _parse_vancouver_entry(
        self, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        # Try Vancouver year-first variant first (BERT paper format: "Authors. Year. Title.")
        m_year_first = _VANCOUVER_YEAR_FIRST_RE.search(entry)
        if m_year_first:
            return self._parse_vancouver_year_first_match(m_year_first, entry, order_index, page_num)

        # Try standard Vancouver second
        m = _VANCOUVER_ENTRY_RE.search(entry)
        if m:
            return self._parse_vancouver_match(m, entry, order_index, page_num)

        return None

    def _parse_vancouver_match(
        self, m: re.Match, entry: str, order_index: int, page_num: int
    ) -> Citation:
        """Parse a standard Vancouver match."""
        # Extract numeric_index if entry starts with [N] prefix
        numeric_index = None
        idx_match = re.match(r"^\[\s*(\d+)\s*\]", entry)
        if idx_match:
            numeric_index = int(idx_match.group(1))

        citation = Citation(
            raw_text=entry.strip(),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            page_num=page_num,
            matched_pattern="vancouver_reference_entry",
            order_index=order_index,
            numeric_index=numeric_index,
        )
        citation.year = m.group("year")
        title = m.group("title").strip()
        citation.title = title
        citation.title_normalized = _normalize_title(title)
        citation.venue = m.group("venue").strip()
        citation.authors = parse_authors(m.group("authors"))
        doi_m = _DOI_RE.search(entry)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip(".")
        citation.confidence = _estimate_reference_confidence(citation)
        return citation

    def _parse_vancouver_year_first_match(
        self, m: re.Match, entry: str, order_index: int, page_num: int
    ) -> Citation | None:
        """Parse Vancouver format with year after authors: 'Authors. Year. Title. Venue.'"""
        try:
            citation = Citation(
                raw_text=entry.strip(),
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.VANCOUVER,
                page_num=page_num,
                matched_pattern="vancouver_year_first_entry",
                order_index=order_index,
            )
            citation.year = m.group("year")
            if m.groupdict().get("suffix"):
                citation.year_suffix = m.group("suffix")
            title = m.group("title").strip()
            citation.title = title
            citation.title_normalized = _normalize_title(title)
            venue = (m.group("venue") or "").strip()
            citation.venue = venue if venue else None
            citation.authors = parse_authors(m.group("authors"))
            doi_m = _DOI_RE.search(entry)
            if doi_m:
                citation.doi = doi_m.group(0).rstrip(".")
            from integrity_checker.extraction.patterns.utils import extract_url

            extracted_u = extract_url(entry)
            if extracted_u:
                citation.url = extracted_u
            citation.confidence = _estimate_reference_confidence(citation)
            return citation
        except Exception:
            return None


# =============================================================================
# TDTU Bibliography Ordering & Language Compliance Checker (§2.6.1 – §2.6.3)
# =============================================================================

_VN_ALPHABET_GROUPS: list[str] = [
    " ",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "aàảãáạ",
    "ăằẳẵắặ",
    "âầẩẫấậ",
    "b",
    "c",
    "d",
    "đ",
    "eèẻẽéẹ",
    "êềểễếệ",
    "f",
    "g",
    "h",
    "iìỉĩíị",
    "j",
    "k",
    "l",
    "m",
    "n",
    "oòỏõóọ",
    "ôồổỗốộ",
    "ơờởỡớợ",
    "p",
    "q",
    "r",
    "s",
    "t",
    "uùủũúụ",
    "ưừửữứự",
    "v",
    "w",
    "x",
    "yỳỷỹýỵ",
    "z",
]

_VN_CHAR_COLLATE_MAP: dict[str, tuple[int, int]] = {}
for _group_idx, _chars in enumerate(_VN_ALPHABET_GROUPS):
    for _tone_idx, _ch in enumerate(_chars):
        _VN_CHAR_COLLATE_MAP[_ch] = (_group_idx, _tone_idx)

_VN_DIACRITIC_RE = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

_STRICT_VN_DIACRITIC_RE = re.compile(
    r"[ăằắẳẵặấầẩẫậđềếểễệồốổỗộơờớởỡợưừứửữựảạẻẽẹỉĩịỏọủũụỳỷỹỵ]",
    re.IGNORECASE,
)


def vn_alphabetical_sort_key(text: str) -> tuple[list[int], list[int]]:
    """Return a Vietnamese ABC collation key (base letters first, tones second)."""
    import unicodedata

    s = unicodedata.normalize("NFC", (text or "").strip().lower())
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    base_ranks: list[int] = []
    tone_ranks: list[int] = []
    for ch in s:
        b_rank, t_rank = _VN_CHAR_COLLATE_MAP.get(ch, (len(_VN_ALPHABET_GROUPS) + ord(ch), 0))
        base_ranks.append(b_rank)
        tone_ranks.append(t_rank)
    return base_ranks, tone_ranks


def classify_tdtu_reference_group(citation: Citation) -> str:
    """Classify a reference into ``'legal'``, ``'vi'``, or ``'foreign'`` per TDTU §2.6."""
    raw = citation.raw_text or ""
    if citation.matched_pattern == "vn_legal_document" or is_vn_legal_reference(raw):
        return "legal"
    combined = f"{raw} {citation.title or ''} {citation.venue or ''}"
    if _VN_DIACRITIC_RE.search(combined):
        return "vi"
    return "foreign"


def _legal_hierarchy_rank(citation: Citation) -> int:
    """Return TDTU §2.6.1 legal hierarchy rank: 1=Hiến pháp, 2=Bộ luật/Luật, 3=Văn bản dưới luật."""
    title = (citation.title or citation.raw_text or "").strip()
    title_clean = re.sub(r"^\s*\d+\s*[\.\)]\s*", "", title)
    if re.match(r"^Hiến\s+pháp\b", title_clean, re.IGNORECASE):
        return 1
    if re.match(r"^(?:Bộ\s+luật|Luật|Pháp\s+lệnh)\b", title_clean, re.IGNORECASE):
        return 2
    return 3


def _reference_primary_sort_label(citation: Citation) -> str:
    """Return the author surname or corporate author name used for ABC sorting (§2.6.2b)."""
    if citation.authors:
        first = citation.authors[0]
        if hasattr(first, "last_name") and first.last_name:
            return first.last_name.strip()
        if isinstance(first, str) and first.strip():
            return first.strip()
    return (citation.title or citation.raw_text or "").strip()


class TDTUBibliographyComplianceResult:
    """Result of checking a reference list against TDTU §2.6 ordering and grouping rules."""

    def __init__(
        self,
        is_compliant: bool,
        groups: list[str],
        violations: list[str],
    ) -> None:
        self.is_compliant = is_compliant
        self.groups = groups
        self.violations = violations


def check_tdtu_bibliography_compliance(
    citations: list[Citation],
) -> TDTUBibliographyComplianceResult:
    """Check TDTU §2.6 reference list compliance (legal hierarchy, language grouping, ABC order)."""
    groups = [classify_tdtu_reference_group(c) for c in citations]
    violations: list[str] = []

    # 1. Check section ordering: legal -> vi -> foreign (no interleaving)
    group_order = {"legal": 0, "vi": 1, "foreign": 2}
    seen_groups: set[str] = set()
    prev_group: str | None = None
    for idx, grp in enumerate(groups):
        if prev_group is not None and grp != prev_group:
            if grp in seen_groups:
                violations.append(
                    f"Language/section groups are interleaved at entry #{idx + 1} ('{grp}' appears after '{prev_group}')."
                )
            elif group_order[grp] < group_order[prev_group]:
                violations.append(
                    f"Section '{grp}' at entry #{idx + 1} should appear before '{prev_group}'."
                )
        seen_groups.add(grp)
        prev_group = grp

    # 2. Check legal hierarchy within legal documents (Hiến pháp -> Luật/Bộ luật -> Văn bản dưới luật)
    legal_cits = [c for c, g in zip(citations, groups, strict=False) if g == "legal"]
    for i in range(len(legal_cits) - 1):
        r1 = _legal_hierarchy_rank(legal_cits[i])
        r2 = _legal_hierarchy_rank(legal_cits[i + 1])
        if r1 > r2:
            violations.append(
                f"Legal hierarchy violation: '{legal_cits[i].title}' appears before '{legal_cits[i + 1].title}'."
            )

    # 3. Check ABC alphabetical sorting within each academic language group ('vi' and 'foreign')
    for target_grp in ("vi", "foreign"):
        grp_cits = [c for c, g in zip(citations, groups, strict=False) if g == target_grp]
        for i in range(len(grp_cits) - 1):
            label_a = _reference_primary_sort_label(grp_cits[i])
            label_b = _reference_primary_sort_label(grp_cits[i + 1])
            if vn_alphabetical_sort_key(label_a) > vn_alphabetical_sort_key(label_b):
                violations.append(
                    f"Alphabetical order violation in '{target_grp}': '{label_a}' appears before '{label_b}'."
                )

    return TDTUBibliographyComplianceResult(
        is_compliant=len(violations) == 0,
        groups=groups,
        violations=violations,
    )


# =============================================================================
# Direct BibTeX (.bib) and RIS (.ris) Bibliography Parser (Task 6.3)
# =============================================================================

_LATEX_COMBINING_MARKS: dict[str, str] = {
    '"': "\u0308",  # diaeresis / umlaut
    "'": "\u0301",  # acute
    "`": "\u0300",  # grave
    "^": "\u0302",  # circumflex
    "~": "\u0303",  # tilde
    "=": "\u0304",  # macron
    ".": "\u0307",  # dot above
    "u": "\u0306",  # breve
    "v": "\u030c",  # caron / hacek
    "H": "\u030b",  # double acute
    "c": "\u0327",  # cedilla
    "k": "\u0328",  # ogonek
    "d": "\u0323",  # dot below
    "r": "\u030a",  # ring above
}

_LATEX_SPECIAL_MACROS: dict[str, str] = {
    r"\ss": "ß",
    r"\O": "Ø",
    r"\o": "ø",
    r"\L": "Ł",
    r"\l": "ł",
    r"\AA": "Å",
    r"\aa": "å",
    r"\AE": "Æ",
    r"\ae": "æ",
    r"\OE": "Œ",
    r"\oe": "œ",
    r"\DJ": "Đ",
    r"\dj": "đ",
    r"\&": "&",
    r"\%": "%",
    r"\_": "_",
    r"\#": "#",
    r"\$": "$",
}


def _clean_latex_text(raw: str) -> str:
    """Strip LaTeX braces, convert accent macros to Unicode NFC, and normalize whitespace."""
    import unicodedata

    if not raw:
        return ""
    text = raw.strip()

    # Replace special LaTeX character macros (e.g. {\ss}, \ss, \&, \o)
    for macro, repl in _LATEX_SPECIAL_MACROS.items():
        text = text.replace("{" + macro + "}", repl)
        if macro[-1].isalpha():
            text = re.sub(re.escape(macro) + r"(?![A-Za-z])", repl, text)
        else:
            text = text.replace(macro, repl)

    # Convert combining accents like {\"o}, \"o, \"{o}, {\'e}, \v{s}, \c{c}
    def _replace_accent(m: re.Match[str]) -> str:
        cmd = m.group("cmd")
        ch = m.group("ch")
        if ch in (r"\i", "i") and cmd in ('"', "'", "`", "^", "~"):
            ch = "i"
        mark = _LATEX_COMBINING_MARKS.get(cmd)
        if not mark or not ch:
            return ch or ""
        return unicodedata.normalize("NFC", ch[-1] + mark)

    accent_re = re.compile(
        r"\{?\s*\\(?P<cmd>[\"'`^~=.uvHckdr])(?:\s*\{(?P<ch1>\\?[A-Za-z])\}|\s+(?P<ch2>\\?[A-Za-z])|(?P<ch3>[A-Za-z]))\s*\}?"
    )
    for _ in range(2):
        text = accent_re.sub(
            lambda m: _replace_accent_groups(m),
            text,
        )

    text = text.replace("---", "—").replace("--", "–").replace("~", " ")
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _replace_accent_groups(m: re.Match[str]) -> str:
    """Helper to normalize a matched LaTeX accent group into NFC Unicode."""
    import unicodedata

    cmd = m.group("cmd")
    ch = m.group("ch1") or m.group("ch2") or m.group("ch3") or ""
    if ch.startswith("\\"):
        ch = ch[1:]
    mark = _LATEX_COMBINING_MARKS.get(cmd)
    if not mark or not ch:
        return ch
    return unicodedata.normalize("NFC", ch + mark)


def _clean_doi_value(raw_doi: str | None, fallback_url: str | None = None) -> str | None:
    """Normalize a DOI string from BibTeX/RIS fields or fallback URL."""
    candidates = [raw_doi or "", fallback_url or ""]
    for cand in candidates:
        cleaned = _clean_latex_text(cand).strip()
        if not cleaned:
            continue
        cleaned = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^doi\s*:\s*", "", cleaned, flags=re.IGNORECASE)
        m = _DOI_RE.search(cleaned)
        if m:
            return m.group(0).rstrip(".,;)}]")
    return None


def _extract_primary_surname(author_str: str) -> str:
    """Extract author surname from 'Last, First' or 'First Middle Last'."""
    cleaned = (author_str or "").strip()
    if not cleaned:
        return "Anonymous"
    if "," in cleaned:
        return cleaned.split(",", 1)[0].strip() or "Anonymous"
    parts = cleaned.split()
    return parts[-1].strip() if parts else "Anonymous"


def _build_bib_ris_citation_pair(
    *,
    idx: int,
    title: str | None,
    authors: list[str],
    year: str | None,
    venue: str | None,
    doi: str | None,
    url: str | None,
    volume: str | None,
    issue: str | None,
    pages: str | None,
    cite_key: str | None = None,
    source_tag: str = "bibtex",
) -> tuple[Citation, Citation]:
    """Construct a matched (REFERENCE_LIST, IN_TEXT) Citation pair for a BibTeX/RIS entry."""
    ref_id = f"ref-{idx:04d}"
    occ_id = f"occ-{idx:04d}"

    authors_display = ", ".join(authors) if authors else (cite_key or "Anonymous")
    year_display = year or "n.d."

    segments: list[str] = [f"{authors_display} ({year_display})."]
    if title:
        segments.append(f"{title.rstrip('.')}.")
    if venue:
        venue_str = venue.rstrip(".")
        if volume:
            venue_str += f", {volume}"
            if issue:
                venue_str += f"({issue})"
        elif issue:
            venue_str += f" ({issue})"
        if pages:
            venue_str += f", {pages}"
        segments.append(f"{venue_str}.")
    if doi:
        segments.append(f"https://doi.org/{doi}")
    elif url:
        segments.append(url)

    raw_ref_text = " ".join(segments).strip()
    primary_surname = _extract_primary_surname(authors[0]) if authors else (cite_key or "Anonymous")
    if len(authors) > 2:
        in_text_raw = f"({primary_surname} et al., {year_display})"
    elif len(authors) == 2:
        second_surname = _extract_primary_surname(authors[1])
        in_text_raw = f"({primary_surname} & {second_surname}, {year_display})"
    else:
        in_text_raw = f"({primary_surname}, {year_display})"

    ref_citation = Citation(
        raw_text=raw_ref_text,
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=list(authors),
        year=year,
        title=title,
        venue=venue,
        doi=doi,
        url=url,
        volume=volume,
        issue=issue,
        pages=pages,
        title_normalized=_normalize_title(title) if title else None,
        order_index=idx - 1,
        page_num=1,
        matched_pattern=f"{source_tag}_entry",
        raw_in_text_citation=in_text_raw,
        confidence=0.98,
        reference_id=ref_id,
        source=source_tag,
        grobid_ref_id=ref_id,
        is_grobid_linked=True,
    )

    in_text_citation = Citation(
        raw_text=in_text_raw,
        citation_type=CitationType.IN_TEXT,
        style=CitationStyle.APA,
        authors=list(authors[:2]) if authors else [],
        year=year,
        title=None,
        venue=None,
        doi=doi,
        url=None,
        order_index=idx - 1,
        page_num=1,
        matched_pattern=f"{source_tag}_in_text",
        confidence=0.98,
        reference_id=occ_id,
        source=source_tag,
        grobid_ref_id=ref_id,
        is_grobid_linked=True,
    )
    return ref_citation, in_text_citation


def _parse_bibtex_fields(body: str) -> dict[str, str]:
    """Parse key = value pairs from the interior of a BibTeX entry."""
    fields: dict[str, str] = {}
    n = len(body)
    i = 0

    while i < n:
        while i < n and body[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break

        key_start = i
        while i < n and (body[i].isalnum() or body[i] in "_:-."):
            i += 1
        key = body[key_start:i].strip().lower()
        if not key:
            i += 1
            continue

        while i < n and body[i] in " \t\r\n":
            i += 1
        if i >= n or body[i] != "=":
            while i < n and body[i] != ",":
                i += 1
            continue
        i += 1  # skip '='

        value_parts: list[str] = []
        while i < n:
            while i < n and body[i] in " \t\r\n":
                i += 1
            if i >= n:
                break

            if body[i] == "{":
                depth = 1
                i += 1
                val_start = i
                while i < n and depth > 0:
                    if body[i] == "{" and (i == 0 or body[i - 1] != "\\"):
                        depth += 1
                    elif body[i] == "}" and (i == 0 or body[i - 1] != "\\"):
                        depth -= 1
                    i += 1
                value_parts.append(body[val_start : max(val_start, i - 1)])
            elif body[i] == '"':
                i += 1
                val_start = i
                brace_depth = 0
                while i < n:
                    ch = body[i]
                    if ch == "{" and body[i - 1] != "\\":
                        brace_depth += 1
                    elif ch == "}" and body[i - 1] != "\\":
                        brace_depth = max(0, brace_depth - 1)
                    elif ch == '"' and brace_depth == 0 and body[i - 1] != "\\":
                        break
                    i += 1
                value_parts.append(body[val_start:i])
                if i < n and body[i] == '"':
                    i += 1
            else:
                val_start = i
                while i < n and body[i] not in ",#\r\n}":
                    i += 1
                value_parts.append(body[val_start:i].strip())

            while i < n and body[i] in " \t\r\n":
                i += 1
            if i < n and body[i] == "#":
                i += 1
                continue
            break

        while i < n and body[i] != ",":
            i += 1
        if i < n and body[i] == ",":
            i += 1

        fields[key] = "".join(value_parts).strip()

    return fields


def _parse_bibtex_content(text: str) -> list[Citation]:
    """Parse BibTeX (.bib) text into a list of REFERENCE_LIST and matched IN_TEXT Citations."""
    citations: list[Citation] = []
    entry_header_re = re.compile(r"@\s*([A-Za-z]+)\s*([{(])")
    pos = 0
    n = len(text)
    entry_idx = 0

    while pos < n:
        m = entry_header_re.search(text, pos)
        if not m:
            break
        entry_type = m.group(1).strip().lower()
        open_delim = m.group(2)
        close_delim = "}" if open_delim == "{" else ")"
        i = m.end()
        depth = 1
        while i < n and depth > 0:
            ch = text[i]
            if ch == open_delim and text[i - 1] != "\\":
                depth += 1
            elif ch == close_delim and text[i - 1] != "\\":
                depth -= 1
            i += 1

        block_inner = text[m.end() : max(m.end(), i - 1)].strip()
        pos = i

        if entry_type in {"comment", "preamble", "string"}:
            continue

        comma_idx = block_inner.find(",")
        if comma_idx == -1:
            continue
        cite_key = block_inner[:comma_idx].strip()
        fields_str = block_inner[comma_idx + 1 :]
        fields = _parse_bibtex_fields(fields_str)
        if not fields:
            continue

        raw_title = fields.get("title") or fields.get("booktitle") or ""
        title = _clean_latex_text(raw_title) or None

        raw_author = fields.get("author") or fields.get("editor") or ""
        authors: list[str] = []
        if raw_author:
            normalized_author_str = re.sub(r"\s+", " ", raw_author).strip()
            for part in re.split(r"\s+\band\b\s+", normalized_author_str, flags=re.IGNORECASE):
                cleaned_author = _clean_latex_text(part)
                if cleaned_author and cleaned_author.lower() != "others":
                    authors.append(cleaned_author)

        raw_year = fields.get("year") or fields.get("date") or ""
        yr_m = re.search(r"\b((?:18|19|20)\d{2})\b", _clean_latex_text(raw_year))
        year = yr_m.group(1) if yr_m else None

        raw_venue = (
            fields.get("journal")
            or fields.get("journaltitle")
            or fields.get("booktitle")
            or fields.get("series")
            or fields.get("publisher")
            or fields.get("school")
            or fields.get("institution")
            or fields.get("howpublished")
            or ""
        )
        venue = _clean_latex_text(raw_venue) or None
        if venue and title and venue == title and fields.get("publisher"):
            venue = _clean_latex_text(fields.get("publisher", "")) or venue

        raw_url = _clean_latex_text(fields.get("url") or fields.get("ee") or "") or None
        doi = _clean_doi_value(fields.get("doi"), raw_url)
        volume = _clean_latex_text(fields.get("volume", "")) or None
        issue = _clean_latex_text(fields.get("number") or fields.get("issue") or "") or None
        pages = _clean_latex_text(fields.get("pages", "")) or None

        if not title and not authors and not doi:
            continue

        entry_idx += 1
        ref_cit, occ_cit = _build_bib_ris_citation_pair(
            idx=entry_idx,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            doi=doi,
            url=raw_url,
            volume=volume,
            issue=issue,
            pages=pages,
            cite_key=cite_key,
            source_tag="bibtex",
        )
        citations.append(ref_cit)
        citations.append(occ_cit)

    return citations


def _parse_ris_content(text: str) -> list[Citation]:
    """Parse RIS (.ris) text into a list of REFERENCE_LIST and matched IN_TEXT Citations."""
    citations: list[Citation] = []
    tag_re = re.compile(r"^\s*([A-Z0-9]{2})\s+-\s?(.*)$")

    records: list[list[tuple[str, str]]] = []
    current_record: list[tuple[str, str]] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r\n")
        m = tag_re.match(line)
        if m:
            tag = m.group(1).upper()
            val = m.group(2).strip()
            if tag == "TY":
                if current_record:
                    records.append(current_record)
                current_record = [("TY", val)]
            elif tag == "ER":
                if current_record:
                    records.append(current_record)
                    current_record = None
            else:
                if current_record is None:
                    current_record = []
                current_record.append((tag, val))
        elif current_record and line.strip():
            last_tag, last_val = current_record[-1]
            current_record[-1] = (last_tag, f"{last_val} {line.strip()}".strip())

    if current_record:
        records.append(current_record)

    entry_idx = 0
    for rec in records:
        title: str | None = None
        authors: list[str] = []
        year: str | None = None
        venue: str | None = None
        raw_doi: str | None = None
        url: str | None = None
        volume: str | None = None
        issue: str | None = None
        sp: str | None = None
        ep: str | None = None
        cite_key: str | None = None

        for tag, val in rec:
            if not val:
                continue
            if tag in {"TI", "T1", "CT", "BT"} and not title:
                title = _clean_latex_text(val)
            elif tag in {"AU", "A1", "A2", "ED"}:
                cleaned_a = _clean_latex_text(val)
                if cleaned_a:
                    authors.append(cleaned_a)
            elif tag in {"PY", "Y1", "DA", "YR"} and not year:
                yr_m = re.search(r"\b((?:18|19|20)\d{2})\b", val)
                if yr_m:
                    year = yr_m.group(1)
            elif tag in {"JO", "JF", "T2", "JA", "J2", "PB"} and not venue:
                venue = _clean_latex_text(val)
            elif tag in {"DO", "DI"} and not raw_doi:
                raw_doi = val
            elif tag in {"UR", "L2", "LK"} and not url:
                url = val.strip()
            elif tag == "VL" and not volume:
                volume = val.strip()
            elif tag == "IS" and not issue:
                issue = val.strip()
            elif tag == "SP" and not sp:
                sp = val.strip()
            elif tag == "EP" and not ep:
                ep = val.strip()
            elif tag == "ID" and not cite_key:
                cite_key = val.strip()

        doi = _clean_doi_value(raw_doi, url)
        pages = f"{sp}–{ep}" if (sp and ep and sp != ep) else (sp or ep)

        if not title and not authors and not doi:
            continue

        entry_idx += 1
        ref_cit, occ_cit = _build_bib_ris_citation_pair(
            idx=entry_idx,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            doi=doi,
            url=url,
            volume=volume,
            issue=issue,
            pages=pages,
            cite_key=cite_key,
            source_tag="ris",
        )
        citations.append(ref_cit)
        citations.append(occ_cit)

    return citations


def parse_bib_or_ris_content(text: str, ext: str = ".bib") -> list[Citation]:
    """Parse raw BibTeX (.bib) or RIS (.ris) bibliography content into Citations.

    For each bibliography entry, emits both a ``CitationType.REFERENCE_LIST``
    citation (``reference_id="ref-XXXX"``) and a matched ``CitationType.IN_TEXT``
    citation (``reference_id="occ-XXXX"``, ``grobid_ref_id="ref-XXXX"``,
    ``is_grobid_linked=True``) so Layer 1 links 100% cleanly and Layer 2
    verifies every entry across the scholarly APIs.
    """
    if not text or not text.strip():
        return []
    norm_ext = (ext or "").strip().lower()
    if norm_ext.endswith("ris") or (
        not norm_ext.endswith("bib")
        and bool(re.search(r"(?:^|\n)\s*TY\s+-\s+", text))
    ):
        return _parse_ris_content(text)
    return _parse_bibtex_content(text)

