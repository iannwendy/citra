"""APA citation format patterns and parser.

This module provides APA (American Psychological Association) citation format
implementation for the modular citation pattern system.

APA Style Citations:
    In-text:
        - Parenthetical: (Author, 2020), (Author et al., 2020)
        - Narrative: Author (2020), Author et al. (2020)

    Reference list:
        - Author, A. A., & Author, B. B. (Year). Title of article. Journal, Vol(Issue), pages.
        - Author, A. A. (Year). Title of book. Publisher.
        - Author, A. A. (Year). Chapter title. In A. Editor (Ed.), Book title (pp. xx-xx). Publisher.

Reference:
    https://apastyle.apa.org/
"""

from __future__ import annotations

import re
from typing import Optional

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import Author, parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


# =============================================================================
# APA Pattern Definitions
# =============================================================================

# --- In-text APA patterns ---

_UPPER_VN = r"[A-ZÀ-ÝĂÂĐÊÔƠƯĨŨẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]"
_STOPWORDS_AHEAD = (
    r"(?!(?:Theo|Trong|Tại|Với|Như|Của|Bởi|Qua|Từ|Khi|Nếu|Vì|Do|Ở|Hoặc|Và"
    r"|Cụ\s*thể|Ví\s*dụ|Chẳng\s*hạn|Theo\s*đó|Ngoài\s*ra|Tuy\s*nhiên|Do\s*đó|Như\s*vậy|Mặt\s*khác|Đặc\s*biệt|Tương\s*tự|Ngược\s*lại|Hơn\s*nữa"
    r"|In|For|By|From|See|As|With|According|However|Although|Similarly|Conversely"
    r"|Specifically|Furthermore|Moreover|Notably|Importantly|Additionally|Meanwhile"
    r"|Consequently|Nevertheless|Nonetheless|Therefore|Thus|Hence|Indeed|Instead"
    r"|Likewise|Otherwise|Subsequently|Accordingly|Alternatively|Finally|Overall"
    r"|Recently|Traditionally|Historically|Yet|Still|Even|While|Whereas|Because"
    r"|Since|When|Where|If|Unless|Until|After|Before|Once|Despite|Unlike|Like"
    r"|Table|Figure|Chapter|Section|Appendix|Part|Page|Papers|Networks"
    r"|Only|Both|Either|Neither|All|Most|Many|Some|Several|Few|Other|Such|These|Those|Each|Every|No|Nor|Not"
    r"|Binary|Logistic|Probit|Heckman|Tobit|Regression|Random|Forest|Gradient|Boosting)(?:,|\s+))"
)
_AUTHOR_TOKEN = rf"(?:(?:van|de|der|von)\s+)*{_UPPER_VN}[a-zA-ZÀ-ỹ'\u2019\-]+"
_AUTHOR_PHRASE = rf"{_STOPWORDS_AHEAD}{_AUTHOR_TOKEN}(?:[^\S\n]+{_STOPWORDS_AHEAD}{_AUTHOR_TOKEN}){{0,3}}"
_COAUTHOR_PHRASE = rf"{_STOPWORDS_AHEAD}{_AUTHOR_TOKEN}(?:\s+{_STOPWORDS_AHEAD}{_AUTHOR_TOKEN}){{0,3}}"
_CORP_AUTHOR_NARRATIVE = (
    r"(?:Bộ|Tổng\s+cục|Ủy\s+ban|Uỷ\s+ban|Ngân\s+hàng\s+Nhà\s+nước|Tổ\s+chức|Hiệp\s+hội)(?:\s+[A-Za-zÀ-ỹ&]+){1,8}"
    r"|(?:Chính\s+phủ|Quốc\s+hội|Hiến\s+pháp)(?:\s+[A-Za-zÀ-ỹ&]+){0,9}"
    r"|(?:Bộ\s+luật|Luật|Pháp\s+lệnh)(?:\s+[A-Za-zÀ-ỹ]+){1,6}"
    r"|(?:Nghị\s+định|Thông\s+tư(?:\s+liên\s+tịch)?|Quyết\s+định|Nghị\s+quyết|Chỉ\s+thị)(?:\s+số)?\s+\d+[A-Za-zĐđ0-9/\-]+"
    r"|(?:Department|Ministry|World\s+Health\s+Organization|United\s+Nations|Reserve\s+Bank)"
    rf"(?:\s+(?:of|for|and|the|&|{_UPPER_VN}[a-zA-ZÀ-ỹ\-]*)){{1,8}}"
    r"|(?:Media\s+Helping\s+Media|Amen\s+Clinics|OpenRocket\s+Project|RocketPy\s+Team|RocketSerializer\s+Developers|Pew\s+Research\s+Center|Security\s+Risk\s+Advisors|Microsoft\s+Security|American\s+Library\s+Association|National\s+News\s+Literacy\s+Project|Local\s+News\s+Initiative|IBM|MITRE|Fortinet)"
)
_PAGE_OR_SECONDARY_SUFFIX = (
    r"(?:\s*,\s*(?:"
    r"(?:dẫn\s+theo|trích\s+dẫn\s+(?:trong|từ)|as\s+cited\s+in|cited\s+in)\s+[^)\]]+"
    r"|(?:pp?\.?|tr\.?|trang)\s*\d+(?:\s*[-–]\s*\d+)?"
    r"))?"
)

# Parenthetical: (Author, 2020), [Author, 2020], (Author et al., 2020), ("Title," 2024), (Author, n.d.)
_APA_INTEXT_PARENTHETICAL = CompiledPattern.create(
    name="apa_intext_parenthetical",
    pattern=rf"[\(\[]([^()\]\[]+),[\"\u201d\u2019']?\s*((?:18|19|20)\d{{2}}[a-z]?|n\.?\s*d\.?(?:-[a-z])?){_PAGE_OR_SECONDARY_SUFFIX}[\)\]]",
    pattern_type=PatternType.IN_TEXT,
    description="APA in-text parenthetical: (Author, 2020) | (Author et al., 2020) | (Author, n.d.)",
)

# Narrative: Author (2020), Author [2020], Author et al. (2020), Author et al. 2020, Corporate Author (2020)
_APA_INTEXT_NARRATIVE = CompiledPattern.create(
    name="apa_intext_narrative",
    pattern=(
        rf"({_CORP_AUTHOR_NARRATIVE}|{_AUTHOR_PHRASE}"
        rf"(?:(?:\s*,\s*(?:và|and|&)\s+|\s+(?:và|and|&)\s+|\s*,\s*){_COAUTHOR_PHRASE})*"
        rf"(?:\s*,?\s*(?:et\s+a?l\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên))?"
        rf"(?:[\s,]{_UPPER_VN}[a-zA-ZÀ-ỹ'\u2019\-]*)*)"
        rf"\s+[\(\[]((?:18|19|20)\d{{2}}[a-z]?|n\.?\s*d\.?(?:-[a-z])?){_PAGE_OR_SECONDARY_SUFFIX}[\)\]]"
        rf"|({_AUTHOR_PHRASE}\s+et\s+al\.)\s+((?:18|19|20)\d{{2}}[a-z]?)\b"
    ),
    pattern_type=PatternType.IN_TEXT,
    description="APA narrative: Author (2020) | Author et al. (2020) | Author (n.d.)",
)

# --- Reference list APA patterns ---

# Standard APA reference entry:
# Author, A. A., & Author, B. B. (Year). Title of work. Publisher/DOI.
_APA_REFERENCE_ENTRY = CompiledPattern.create(
    name="apa_reference_entry",
    pattern=(
        r"^"
        r"(?P<authors>.+?)"
        r"\s*,?\s*\(\s*(?:(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?P<year>(?:18|19|20)\d{2})(?P<suffix>[a-z])?(?:\s*[,–\-/]\s*[^)]+)?|(?P<nd>n\.?\s*d\.?)(?:-(?P<nd_suffix>[a-z]))?)\s*\)"
        r"[.,:]?\s*"
        r"(?P<title>[^\.]+?)"
        r"\.(?:\s*)"
        r"(?P<venue>.+)"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="APA reference entry with full author block and venue",
)

# Vietnamese APA entry where title and venue are separated by quotes or comma (e.g. Author (2020), “Title”, Tạp chí... or Author (2020), Title, Nxb...)
_APA_VN_COMMA_ENTRY = CompiledPattern.create(
    name="apa_reference_entry",
    pattern=(
        r"^"
        r"(?P<authors>.+?)"
        r"\s*,?\s*\(\s*(?:(?:\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)?(?P<year>(?:18|19|20)\d{2})(?P<suffix>[a-z])?(?:\s*[,–\-/]\s*[^)]+)?|(?P<nd>n\.?\s*d\.?)(?:-(?P<nd_suffix>[a-z]))?)\s*\)"
        r"[.,:]?\s*"
        r"(?:"
        r"[\"\u201c\u2018](?P<q_title>[^\"\u201d\u2019]+)[\"\u201d\u2019]\s*[.,;]?\s*(?P<q_venue>.+?)"
        r"|(?P<c_title>.+?)\s*,\s*(?P<c_venue>(?:Nxb|NXB|Nhà\s+xuất\s+bản|Tạp\s+chí|Báo\s+|Trường\s+|Học\s+viện|Viện\s+|Khoa\s+|Luận\s+văn|Luận\s+án|Khóa\s+luận|Đồ\s+án|Tiểu\s+luận|Kỷ\s+yếu|Hội\s+thảo|Đặc\s+san|Số\s+chuyên\s+đề|Tài\s+liệu|Hà\s+Nội|TP\.?\s*Hồ\s+Chí\s+Minh|TP\.?\s*HCM|H\.?\s*[,:]?\s*NXB|https?://|truy\s+cập).+?)"
        r"|(?P<s_title>[^\.]{10,})"
        r")\.?$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Vietnamese APA reference entry with quoted or comma-delimited title and venue",
)

# APA reference entry with numbered prefix: [1] Author (Year). Title. Venue.
_APA_NUMBERED_REFERENCE = CompiledPattern.create(
    name="apa_numbered_reference",
    pattern=(
        r"^\[\s*\d+\s*\]\s*"
        r"(?P<authors>[A-Z][a-zÀ-ž]+(?:,\s*[A-Z]\.?\s*[A-Z]?[a-zÀ-ž]*)*)"
        r"\s+\(\s*(?P<year>\d{4})(?P<suffix>[a-z])?(?:\s*,\s*[^)]+)?\s*\)"
        r"\.?\s*"
        r"(?P<title>[^\.]+?)"
        r"\.(?:\s*)"
        r"(?P<venue>.+)"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Numbered APA reference: [1] Author (Year). Title. Venue.",
)

# Book chapter: Author (Year). Chapter title. In A. Editor (Ed.), Book title (pp. xx-xx). Publisher.
_APA_BOOK_CHAPTER = CompiledPattern.create(
    name="apa_book_chapter",
    pattern=(
        r"^"
        r"(?P<authors>.+?)"
        r"\s+\(\s*(?P<year>\d{4})(?P<suffix>[a-z])?(?:\s*,\s*[^)]+)?\s*\)"
        r"\.?\s*"
        r"(?P<title>[^\.]+?)"
        r"\.\s*"
        r"In\s+"
        r"(?P<editor>.+?)"
        r"(?:\s*\(Eds?\.?\)|\(Ed\.?\))?,?"
        r"\s*"
        r"(?P<book_title>.+?)(?:\s*\(pp\.\s*[\d\-–]+\))?"
        r"(?:\.\s*(?P<publisher>.+))?"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="APA book chapter: Author (Year). Chapter. In Editor (Ed.), Book (pp. xx).",
)

# Simple APA entry (minimal): Author (Year). Title. Venue/DOI.
_APA_SIMPLE_ENTRY = CompiledPattern.create(
    name="apa_simple_entry",
    pattern=(
        r"^"
        r"(?P<authors>[A-Z][a-zÀ-ž]+(?:,\s*[A-Z]\.?\s*[A-Z]?[a-zÀ-ž]*)*)"
        r"\s+\(\s*(?P<year>\d{4})(?P<suffix>[a-z])?\)"
        r"\.?\s*"
        r"(?P<title>[^\.]+?)"
        r"\.\s*"
        r"(?P<venue>.+)"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Simple APA entry: Author (Year). Title. Venue.",
)


# =============================================================================
# Vietnamese Legal Document Helpers (TDTU §2.6.1)
# =============================================================================

_VN_LEGAL_LIST_PREFIX_RE = re.compile(
    r"^\s*(?:\[\s*(?P<b_idx>\d+)\s*\]|(?P<d_idx>\d{1,3})\s*[\.\)]|[a-z]\s*\)|[-•–])\s*"
)

_VN_LEGAL_ACADEMIC_EXCLUSION_RE = re.compile(
    r"\b(?:Nxb\.?|NXB|Nhà\s+xuất\s+bản|Tạp\s+chí|chủ\s+biên|Luận\s+văn|Luận\s+án|Khóa\s+luận|Giáo\s+trình)\b",
    re.IGNORECASE,
)

_VN_AGENCY_FIRST_LEGAL_RE = re.compile(
    r"^(?P<agency>(?:Quốc\s+hội|Ủy\s+ban\s+Thường\s+vụ\s+Quốc\s+hội|Uỷ\s+ban\s+Thường\s+vụ\s+Quốc\s+hội"
    r"|Văn\s+phòng\s+Quốc\s+hội|Chính\s+phủ|Thủ\s+tướng\s+Chính\s+phủ|Bộ\s+Chính\s+trị|Ban\s+Bí\s+thư"
    r"|Ban\s+Chấp\s+hành\s+Trung\s+ương(?:\s+Đảng)?|Tòa\s+án\s+nhân\s+dân[^,(\n]{0,55}"
    r"|Toà\s+án\s+nhân\s+dân[^,(\n]{0,55}|Hội\s+đồng\s+Thẩm\s+phán[^,(\n]{0,55}"
    r"|Viện\s+kiểm\s+sát\s+nhân\s+dân[^,(\n]{0,55}|Thanh\s+tra\s+Chính\s+phủ|Kiểm\s+toán\s+Nhà\s+nước"
    r"|Ngân\s+hàng\s+Nhà\s+nước(?:\s+Việt\s+Nam)?|Bộ\s+[A-ZÀ-ÝĐ][^,().\n]{2,60}"
    r"|Ủy\s+ban\s+nhân\s+dân[^,(\n]{0,50}|Uỷ\s+ban\s+nhân\s+dân[^,(\n]{0,50}"
    r"|Chủ\s+tịch\s+nước|Chủ\s+tịch\s+Chính\s+phủ[^,(\n]{0,30}))[.,]*\s*"
    r"(?:\(\s*(?P<agency_year>(?:19|20)\d{2}[a-z]?(?:\s*[,–\-/]\s*(?:19|20)\d{2}[a-z]?)*)\s*\))?\s*[.,:]+\s*"
    r"(?P<doc_rest>.+)$",
    re.IGNORECASE,
)

_VN_CONSTITUTION_RE = re.compile(
    r"^Hiến\s+pháp(?:\s+nước\s+Cộng\s+hòa\s+xã\s+hội\s+chủ\s+nghĩa\s+Việt\s+Nam|\s+Việt\s+Nam)?"
    r"(?:\s+các)?(?:\s+năm)?\s*\(?(?P<years>(?:19|20)\d{2}(?:\s*(?:,|và|-|–)\s*(?:19|20)\d{2})*)\)?(?:\b.*)?$",
    re.IGNORECASE,
)

_VN_LAW_RE = re.compile(
    r"^(?P<law_prefix>Bộ\s+luật|Luật|Pháp\s+lệnh|Sắc\s+lệnh|LDN|BLDS|BLHS|BLLĐ|BLTTDS|BLTTHS|LTM|LSHTT)\s+(?P<rest>.+)$",
    re.IGNORECASE,
)

_VN_SUBLAW_RE = re.compile(
    r"^(?P<doc_type>Nghị\s+định|Thông\s+tư(?:\s+liên\s+tịch)?|Quyết\s+định"
    r"|Nghị\s+quyết(?:\s+liên\s+tịch)?|Chỉ\s+thị|Sắc\s+lệnh|Bản\s+án|Án\s+lệ"
    r"|Công\s+văn|Kết\s+luận|Văn\s+bản\s+hợp\s+nhất|Thông\s+báo)\s+"
    r"(?:số\s*:?\s*)?(?P<doc_code>\d+\s*(?:[/\-–]\s*[0-9A-ZĐƯa-zđư\-–/]+)+)",
    re.IGNORECASE,
)

_VN_TREATY_OR_DRAFT_RE = re.compile(
    r"^(?P<doc_type>Công\s+ước|Hiệp\s+ước|Hiệp\s+định|Dự\s+thảo\s+(?:Bộ\s+luật|Luật|Nghị\s+định|Thông\s+tư)|Tờ\s+trình)\s+(?P<rest>.+)$",
    re.IGNORECASE,
)

_SUBLAW_AGENCY_SUFFIX_MAP = {
    "NĐ-CP": "Chính phủ",
    "NQ-CP": "Chính phủ",
    "QĐ-TTG": "Thủ tướng Chính phủ",
    "QĐTTG": "Thủ tướng Chính phủ",
    "CT-TTG": "Thủ tướng Chính phủ",
    "NQ-QH": "Quốc hội",
    "NQ/TW": "Bộ Chính trị",
    "NQ/TƯ": "Ban Chấp hành Trung ương",
    "UBTVQH": "Ủy ban Thường vụ Quốc hội",
    "VBHN-VPQH": "Văn phòng Quốc hội",
    "TANDTC": "Tòa án nhân dân tối cao",
    "KL-TTCP": "Thanh tra Chính phủ",
    "TT-BTC": "Bộ Tài chính",
    "TT-NHNN": "Ngân hàng Nhà nước",
    "TT-BGDĐT": "Bộ Giáo dục và Đào tạo",
    "TT-BCT": "Bộ Công Thương",
    "TT-BKHĐT": "Bộ Kế hoạch và Đầu tư",
    "TT-BKHCN": "Bộ Khoa học và Công nghệ",
    "TT-BTTTT": "Bộ Thông tin và Truyền thông",
    "TT-BCA": "Bộ Công an",
    "TT-BTNMT": "Bộ Tài nguyên và Môi trường",
    "TT-BLĐTBXH": "Bộ Lao động - Thương binh và Xã hội",
    "TT-BTP": "Bộ Tư pháp",
    "TT-BYT": "Bộ Y tế",
    "TT-BXD": "Bộ Xây dựng",
    "TT-BGTVT": "Bộ Giao thông vận tải",
    "TT-BNNPTNT": "Bộ Nông nghiệp và Phát triển nông thôn",
}


def _make_corp_author(name: str) -> Author:
    clean = re.sub(r"\s+", " ", (name or "").strip().rstrip(".,;")).strip()
    low = clean.lower()
    return Author(last_name=low, initials=[], full_first_names=[], normalized=low, raw=clean)


def parse_vn_legal_reference(text: str) -> Optional[Citation]:
    """Parse a Vietnamese legal document reference entry per TDTU §2.6.1.

    Supports:
        1. Hiến pháp: ``Hiến pháp 2013.``
        2. Đạo luật / Bộ luật: ``Luật Doanh nghiệp (Luật số 68/2014/QH13) ngày 26/12/2014.``
        3. Văn bản dưới luật: ``Nghị định số 23/2015/NĐ-CP của Chính phủ ngày 16/02/2015 về ...``
        4. Agency-first legal citations: ``Quốc hội (2020), Luật Doanh nghiệp...``, ``Chính phủ (2024). Nghị định số...``
    """
    if not text:
        return None
    normalized_text = re.sub(r"\s+", " ", text.strip())
    lead_m = _VN_LEGAL_LIST_PREFIX_RE.match(normalized_text)
    idx_str = (lead_m.group("b_idx") or lead_m.group("d_idx")) if lead_m else None
    numeric_index = int(idx_str) if idx_str else None
    cleaned = normalized_text[lead_m.end():].strip() if lead_m else normalized_text
    cleaned = re.sub(r"\s*\[trans\s*:[^\]]*\]?\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"([a-zà-ỹ])(năm\s+(?:19|20)\d{2})\b", r"\1 \2", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(\b\d+)\s*/\s*(\d{4})\s*/\s*([A-ZĐ0-9\-]+)", r"\1/\2/\3", cleaned)
    if not cleaned:
        return None
    if _VN_LEGAL_ACADEMIC_EXCLUSION_RE.search(cleaned):
        return None
    clean_title = cleaned.rstrip(".,; ").strip()
    title_norm = re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", clean_title.lower())).strip()

    # 0. Agency-first legal reference: "Quốc hội (2020), Luật Doanh nghiệp...", "Chính phủ (2024). Nghị định số..."
    agency_m = _VN_AGENCY_FIRST_LEGAL_RE.match(cleaned)
    if agency_m:
        agency_name = re.sub(r"\s+", " ", agency_m.group("agency")).strip().rstrip(".,:")
        agency_yr_raw = agency_m.group("agency_year") or ""
        agency_yr_m = re.search(r"((?:19|20)\d{2})", agency_yr_raw)
        doc_rest = agency_m.group("doc_rest").strip()
        # Normalize "Số: 12/VBHN-VPQH ... Luật Thương mại" into "Văn bản hợp nhất số 12/VBHN-VPQH ..."
        if re.match(r"^Số\s*:\s*\d+/", doc_rest, re.IGNORECASE):
            doc_rest = "Văn bản hợp nhất " + re.sub(r"^Số\s*:\s*", "số ", doc_rest, flags=re.IGNORECASE)
        inner_cit = parse_vn_legal_reference(doc_rest)
        if inner_cit is not None:
            year = agency_yr_m.group(1) if agency_yr_m else inner_cit.year
            authors: list[Author] = [_make_corp_author(agency_name)]
            for a in inner_cit.authors or []:
                if a.last_name != agency_name.lower():
                    authors.append(a)
            url_m = re.search(r"(https?://[^\s,;)\]]+)", cleaned, re.IGNORECASE)
            return Citation(
                raw_text=normalized_text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                matched_pattern="vn_legal_document",
                numeric_index=numeric_index,
                title=inner_cit.title or clean_title,
                title_normalized=inner_cit.title_normalized or title_norm,
                year=year,
                venue=agency_name,
                authors=authors,
                url=url_m.group(1).rstrip(".,;") if url_m else inner_cit.url,
                confidence=0.95,
            )

    # 1. Hiến pháp
    const_m = _VN_CONSTITUTION_RE.match(cleaned)
    if const_m:
        all_years = re.findall(r"(?:19|20)\d{2}", const_m.group("years"))
        year = all_years[-1] if all_years else None
        return Citation(
            raw_text=normalized_text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="vn_legal_document",
            numeric_index=numeric_index,
            title=clean_title,
            title_normalized=title_norm,
            year=year,
            venue="Quốc hội",
            authors=[
                _make_corp_author("Hiến pháp"),
                _make_corp_author("Quốc hội"),
            ],
            confidence=0.95,
        )

    # 2. Đạo luật / Bộ luật / Pháp lệnh / Sắc lệnh
    law_m = _VN_LAW_RE.match(cleaned)
    if law_m and not re.match(r"^(?:Bộ\s+luật|Luật|Pháp\s+lệnh)\s*\(\s*\d{4}\s*\)\.", cleaned, re.IGNORECASE):
        has_legal_marker = bool(
            re.search(
                r"\((?:Bộ\s+luật|Luật|Pháp\s+lệnh)?\s*(?:số\s*)?\d+[\d/A-ZĐa-z\-–]+\)"
                r"|\bsố\s*:?\s*\d+[\d/A-ZĐa-z\-–]+"
                r"|\bngày\s+\d{1,2}\s*(?:[/-]|tháng)\s*\d{1,2}\s*(?:[/-]|năm)\s*(?:19|20)\d{2}"
                r"|\b(?:các\s+)?năm\s+(?:19|20)\d{2}\b"
                r"|\b(?:19|20)\d{2}(?:\s*\([^)]*\))?[.,;\s]*$",
                cleaned,
                re.IGNORECASE,
            )
        )
        if has_legal_marker:
            # Extract short law name before (Luật số ...), số ..., ngày ..., or năm YYYY
            name_m = re.match(
                r"^(?P<name>(?:Bộ\s+luật|Luật|Pháp\s+lệnh|Sắc\s+lệnh|LDN|BLDS|BLHS|BLLĐ|BLTTDS|BLTTHS|LTM|LSHTT)\s+[^(),.\n]+?)"
                r"(?=\s*\(|\s*,\s*số\s+\d|\s+số\s+\d|\s+ngày\s+\d|\s+(?:các\s+)?năm\s+(?:19|20)\d{2}|\s+(?:19|20)\d{2}\b|[.,;]|$)",
                cleaned,
                re.IGNORECASE,
            )
            law_name = name_m.group("name").strip().rstrip(",") if name_m else clean_title

            # Extract year: prefer enactment date, then code /YYYY/, then any 4-digit year
            date_y = re.search(
                r"\bngày\s+\d{1,2}\s*(?:[/-]|tháng)\s*\d{1,2}\s*(?:[/-]|năm)\s*((?:19|20)\d{2})\b",
                cleaned,
                re.IGNORECASE,
            )
            code_y = re.search(r"/((?:19|20)\d{2})/", cleaned)
            any_years = re.findall(r"\b((?:19|20)\d{2})\b", cleaned)
            year = (
                date_y.group(1)
                if date_y
                else (code_y.group(1) if code_y else (any_years[0] if any_years else None))
            )

            authors = [_make_corp_author(law_name), _make_corp_author("Quốc hội")]
            code_full_m = re.search(
                r"((?:Bộ\s+luật|Luật|Pháp\s+lệnh|Sắc\s+lệnh)\s+số\s+[\d/A-ZĐa-z\-–]+)",
                cleaned,
                re.IGNORECASE,
            )
            if code_full_m:
                authors.append(_make_corp_author(code_full_m.group(1)))
            colon_law_m = re.search(
                r":\s*((?:Bộ\s+luật|Luật|Pháp\s+lệnh)\s+[^().\n]+?)(?=\s*,\s*ban\s+hành|\s+ban\s+hành|\s*,\s*ngày\s+\d|\s+ngày\s+\d|\s+năm\s+(?:19|20)\d{2}|[.\n]|$)",
                cleaned,
                re.IGNORECASE,
            )
            if colon_law_m:
                authors.append(_make_corp_author(colon_law_m.group(1).strip()))

            url_m = re.search(r"(https?://[^\s,;)\]]+)", cleaned, re.IGNORECASE)
            return Citation(
                raw_text=normalized_text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.APA,
                matched_pattern="vn_legal_document",
                numeric_index=numeric_index,
                title=clean_title,
                title_normalized=title_norm,
                year=year,
                venue="Quốc hội",
                authors=authors,
                url=url_m.group(1).rstrip(".,;") if url_m else None,
                confidence=0.95,
            )

    # 3. Văn bản dưới luật (Nghị định, Thông tư, Quyết định, Nghị quyết, Chỉ thị, Bản án, Án lệ, Công văn, Kết luận)
    sublaw_m = _VN_SUBLAW_RE.match(cleaned)
    if sublaw_m:
        doc_type = re.sub(r"\s+", " ", sublaw_m.group("doc_type")).strip()
        doc_code = re.sub(r"\s+", "", sublaw_m.group("doc_code").strip().rstrip(".,;"))

        # Extract issuing agency after "của ..." and from official code suffix
        agency: Optional[str] = None
        mapped_suffix_agency: Optional[str] = None
        code_upper = doc_code.upper()
        for suffix_key, mapped_agency in _SUBLAW_AGENCY_SUFFIX_MAP.items():
            if suffix_key in code_upper:
                mapped_suffix_agency = mapped_agency
                break

        agency_m = re.search(
            r"\bcủa\s+(?P<agency>(?:Chính\s+phủ|Thủ\s+tướng(?:\s+Chính\s+phủ)?|Quốc\s+hội"
            r"|Ủy\s+ban\s+Thường\s+vụ\s+Quốc\s+hội|Uỷ\s+ban\s+Thường\s+vụ\s+Quốc\s+hội"
            r"|Bộ\s+Chính\s+trị|Ban\s+Bí\s+thư|Ban\s+Chấp\s+hành\s+Trung\s+ương(?:\s+Đảng)?"
            r"|Bộ\s+(?:trưởng\s+Bộ\s+)?[A-ZÀ-ÝĐ][^,.\n“\"']{2,55}?"
            r"|Ngân\s+hàng\s+Nhà\s+nước(?:\s+Việt\s+Nam)?|Tòa\s+án\s+nhân\s+dân[^,.\n“\"']{0,75}?"
            r"|Toà\s+án\s+nhân\s+dân[^,.\n“\"']{0,75}?|Hội\s+đồng\s+Thẩm\s+phán[^,.\n“\"']{0,75}?"
            r"|Viện\s+kiểm\s+sát\s+nhân\s+dân[^,.\n“\"']{0,75}?|Thanh\s+tra\s+Chính\s+phủ"
            r"|Ủy\s+ban\s+nhân\s+dân[^,.\n“\"']{0,75}?|Uỷ\s+ban\s+nhân\s+dân[^,.\n“\"']{0,75}?|Chủ\s+tịch\s+nước))"
            r"(?=\s+ngày\s+\d|\s+về\s+|\s+ban\s+hành|\s+quy\s+định|\s+hướng\s+dẫn|\s+sửa\s+đổi|\s+phê\s+duyệt|[,.\"“]|$)",
            cleaned,
            re.IGNORECASE,
        )
        if agency_m:
            agency = agency_m.group("agency").strip()
        else:
            agency = mapped_suffix_agency

        date_y = re.search(
            r"\bngày\s+\d{1,2}\s*(?:[/-]|tháng)\s*\d{1,2}\s*(?:[/-]|năm)\s*((?:19|20)\d{2})\b",
            cleaned,
            re.IGNORECASE,
        )
        code_y = re.search(r"/((?:19|20)\d{2})/", doc_code)
        any_y = re.search(r"\b((?:19|20)\d{2})\b", cleaned)
        year = (
            date_y.group(1)
            if date_y
            else (code_y.group(1) if code_y else (any_y.group(1) if any_y else None))
        )

        authors = []
        if mapped_suffix_agency:
            authors.append(_make_corp_author(mapped_suffix_agency))
        if agency and agency.lower() != (mapped_suffix_agency or "").lower():
            authors.append(_make_corp_author(agency))
            if "thành phố hồ chí minh" in agency.lower():
                tp_alias = re.sub(r"Thành\s+phố\s+Hồ\s+Chí\s+Minh", "TP. Hồ Chí Minh", agency, flags=re.IGNORECASE)
                authors.append(_make_corp_author(tp_alias))
            elif "tp. hồ chí minh" in agency.lower() or "tp hồ chí minh" in agency.lower():
                tp_alias = re.sub(r"TP\.?\s*Hồ\s+Chí\s+Minh", "Thành phố Hồ Chí Minh", agency, flags=re.IGNORECASE)
                authors.append(_make_corp_author(tp_alias))
        authors.append(_make_corp_author(f"{doc_type} số {doc_code}"))
        authors.append(_make_corp_author(f"{doc_type} {doc_code}"))

        url_m = re.search(r"(https?://[^\s,;)\]]+)", cleaned, re.IGNORECASE)
        return Citation(
            raw_text=normalized_text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="vn_legal_document",
            numeric_index=numeric_index,
            title=clean_title,
            title_normalized=title_norm,
            year=year,
            venue=agency or doc_type,
            authors=authors,
            url=url_m.group(1).rstrip(".,;") if url_m else None,
            confidence=0.95,
        )

    # 4. International treaties / Draft laws (Công ước, Hiệp định, Dự thảo Luật)
    treaty_m = _VN_TREATY_OR_DRAFT_RE.match(cleaned)
    if treaty_m:
        doc_type = re.sub(r"\s+", " ", treaty_m.group("doc_type")).strip()
        any_y = re.search(r"\b((?:18|19|20)\d{2})\b", cleaned)
        year = any_y.group(1) if any_y else None
        short_name_m = re.match(r"^([^(),.\n]{4,70})", cleaned)
        short_name = short_name_m.group(1).strip() if short_name_m else doc_type
        return Citation(
            raw_text=normalized_text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="vn_legal_document",
            numeric_index=numeric_index,
            title=clean_title,
            title_normalized=title_norm,
            year=year,
            venue=doc_type,
            authors=[_make_corp_author(short_name)],
            confidence=0.90,
        )

    return None


def is_vn_legal_reference(text: str) -> bool:
    """Return True if ``text`` is a Vietnamese legal document reference entry."""
    return parse_vn_legal_reference(text) is not None


# =============================================================================
# APA Format Implementation
# =============================================================================


class APAFormat:
    """APA citation format implementation.

    APA (American Psychological Association) style is commonly used in:
        - Social sciences
        - Psychology
        - Education
        - Most common citation style in academic papers

    This implementation handles:
        - In-text parenthetical citations: (Smith, 2020), (Smith et al., 2020)
        - In-text narrative citations: Smith (2020), Smith et al. (2020)
        - Reference list entries with full metadata extraction
        - Book chapters with editor information
        - Numbered reference list entries
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "APA"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        APA is the most common citation style, so it gets highest priority.
        """
        return 100

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting APA in-text citations."""
        return [
            _APA_INTEXT_PARENTHETICAL,
            _APA_INTEXT_NARRATIVE,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting APA reference list entries."""
        return [
            _APA_REFERENCE_ENTRY,
            _APA_NUMBERED_REFERENCE,
            _APA_BOOK_CHAPTER,
            _APA_SIMPLE_ENTRY,
        ]

    def parse_reference_entry(self, text: str) -> Optional[Citation]:
        """Parse APA reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "Smith, J., & Jones, A. (2020). Paper Title. Journal, 10(2), 1-15."
            >>> citation = APAFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith, J.', 'Jones, A.']
            >>> citation.year
            '2020'
        """
        import re

        # Normalize whitespace and repair broken URLs with space after slash
        text = re.sub(r'\s+', ' ', text.strip())
        text = re.sub(r"\s*\[trans\s*:[^\]]*\]?\s*$", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"(https?://[^\s/]+(?:/[^\s/]+)*/)\s+([A-Za-z0-9_\-]+)", r"\1\2", text)

        # Check for TDTU Vietnamese legal document entry (§2.6.1)
        legal_cit = parse_vn_legal_reference(text)
        if legal_cit is not None:
            return legal_cit

        # Check for numbered reference first (has [N] or N. prefix)
        idx_match = re.match(r"^\s*(?:\[\s*(?P<b_idx>\d+)\s*\]|(?P<d_idx>\d{1,3})\s*[\.\)]\s+)", text)
        idx_str = (idx_match.group("b_idx") or idx_match.group("d_idx")) if idx_match else None
        numeric_index = int(idx_str) if idx_str else None

        # Try each reference pattern in order
        patterns_to_try = [
            (_APA_REFERENCE_ENTRY, self._parse_apa_entry),
            (_APA_VN_COMMA_ENTRY, self._parse_apa_vn_comma_entry),
            (_APA_NUMBERED_REFERENCE, self._parse_apa_numbered_entry),
            (_APA_BOOK_CHAPTER, self._parse_apa_book_chapter_entry),
            (_APA_SIMPLE_ENTRY, self._parse_apa_simple_entry),
        ]

        for pattern, parser_func in patterns_to_try:
            match = pattern.search(text)
            if match:
                citation = parser_func(match, text)
                if citation:
                    # Set numeric_index if found and not already set
                    if numeric_index and citation.numeric_index is None:
                        citation.numeric_index = numeric_index
                    return citation

        # Fallback: try to extract whatever we can from unstructured text
        fallback_cit = self._parse_apa_fallback(text)
        if fallback_cit and numeric_index and fallback_cit.numeric_index is None:
            fallback_cit.numeric_index = numeric_index
        return fallback_cit

    def _is_non_apa_structure(self, authors_str: str, title: str, text: str) -> bool:
        """Return True if matched groups actually belong to Harvard/ACM/Nature/Chicago."""
        clean_auth = re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])\s*", "", (authors_str or "")).strip()
        # Authors block in APA cannot contain quoted titles, volume/issue markers, or trailing numbers
        if re.search(r'["\u201c\u201d]|\b(?:vol|no|pp)\.\s*\d|\d+\s*,\s*\d+\s*$|:\s*\d+\s*$', clean_auth, re.IGNORECASE):
            return True
        if re.search(r"\d\s*$", clean_auth) and not re.search(r"\b(?:19|20)\d{2}\b", clean_auth):
            return True
        # Title in APA cannot start with punctuation like ',' or ':' or be a bare URL/DOI after (Year).
        if not title or title[0] in ",:;" or re.match(r"^(?:https?://|www\.|doi\s*:)", title.strip(), re.IGNORECASE):
            return True
        # Harvard check: no period/comma after (Year) AND (quoted title or Harvard edition/pp./Place:Publisher)
        has_vn_diacritics = bool(
            re.search(r"[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]", text, re.IGNORECASE)
        )
        no_dot_after_year = bool(
            re.search(r"\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s+(?![.,])", text)
        )
        if no_dot_after_year and not has_vn_diacritics:
            if title[0] in "'\"‘“" or re.search(
                r"\b\d+(?:st|nd|rd|th)\s+edn?\.?\b|,\s*pp?\.\s*\d", text, re.IGNORECASE
            ):
                return True
        return False

    def _parse_apa_vn_comma_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Vietnamese APA entry where title and venue are separated by quotes or commas."""
        authors_raw = match.group("authors") or ""
        title_raw = (
            match.group("q_title")
            or match.group("c_title")
            or match.group("s_title")
            or ""
        ).strip()
        venue_raw = (match.group("q_venue") or match.group("c_venue") or "").strip()
        if self._is_non_apa_structure(authors_raw, title_raw, text):
            return None
        # For single-sentence unquoted s_title without venue, require either a period/comma after (Year)
        # or Vietnamese diacritics so we do not steal Harvard/ACM entries.
        if match.group("s_title") and not venue_raw:
            has_vn = bool(
                re.search(r"[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]", text, re.IGNORECASE)
            )
            has_punct_after_yr = bool(re.search(r"\(\s*(?:18|19|20)\d{2}[^)]*\)\s*[.,:]", text))
            if not (has_vn or has_punct_after_yr):
                return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="apa_reference_entry",
        )
        clean_auth = re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])\s*", "", authors_raw).strip().rstrip(",")
        if clean_auth:
            citation.authors = self._parse_authors(clean_auth)
        citation.year = match.group("year")
        suffix = match.group("suffix") or match.groupdict().get("nd_suffix")
        citation.year_suffix = suffix if suffix else None
        citation.title = title_raw.rstrip(".,;").strip()
        citation.title_normalized = self._normalize_title(citation.title)
        if venue_raw:
            self._parse_venue(citation, venue_raw)
        doi_match = re.search(r"(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text)
        if doi_match:
            citation.doi = doi_match.group(1).rstrip(".,;")
        self._extract_url_into(citation, text)
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_apa_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse standard APA reference entry."""
        authors_raw = match.group("authors") or ""
        title_raw = (match.group("title") or "").strip()
        if self._is_non_apa_structure(authors_raw, title_raw, text):
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="apa_reference_entry",
        )

        # Extract authors (strip any leading [N] or N. marker before parsing)
        authors_str = match.group("authors")
        if authors_str:
            authors_str = re.sub(r"^\s*(?:\[\s*\d+\s*\]|\d{1,3}\s*[\.\)])\s*", "", authors_str).strip().rstrip(",")
            citation.authors = self._parse_authors(authors_str)

        # Extract year (for "(n.d.)" entries, only fallback to explicit Retrieved/Accessed year, not URL path years)
        citation.year = match.group("year")
        if not citation.year and not match.group("nd"):
            venue_no_url = re.sub(r"https?://\S+", "", match.group("venue") or "")
            venue_year_m = re.search(r"\b((?:19|20)\d{2})\b", venue_no_url)
            if venue_year_m:
                citation.year = venue_year_m.group(1)
        suffix = match.group("suffix") or match.groupdict().get("nd_suffix")
        citation.year_suffix = suffix if suffix else None

        # Extract title and venue (rest of the text after title)
        title = match.group("title").strip()
        venue = match.group("venue").strip()

        # Rejoin title if it was split at an abbreviation, middle initial, decimal, or inside parentheses (e.g. "Tp. HCM.", "fMRI vs. SPECT", "Dr. Amen", "Daniel G. Amen", "Version 24.12", "(5th ed., text rev.)")
        while (
            (
                re.search(
                    r"\b(?:Tp|TP|ThS|TS|PGS|GS|vs|Dr|Mr|Mrs|Ms|St|Jr|Sr|U\.S|U\.K|No|Vol|Ed|ed|Fig|al|Inc|Ltd|Co|Corp|[A-Z][a-z]{2,}\s+[A-Z])$",
                    title,
                )
                or (re.search(r"\d$", title) and re.match(r"^\d", venue))
                or title.count("(") > title.count(")")
            )
            and ". " in venue
        ):
            next_part, rest_venue = venue.split(". ", 1)
            if next_part.strip().lower().startswith(("http://", "https://")):
                break
            sep = (
                "."
                if next_part.startswith((",", ")", ";", ":"))
                or (re.search(r"\d$", title) and re.match(r"^\d", next_part))
                else ". "
            )
            title = f"{title}{sep}{next_part.strip()}"
            venue = rest_venue.strip()

        # Detect Title-first anonymous APA entry where the article title precedes (Year)/(n.d.)
        # and only the site/publisher name + URL follow (Year):
        # e.g. "CAC payback period vs LTV: CAC ratio. (2022). MetricHQ. https://..."
        venue_without_url = re.sub(r"\s*(?:https?://|www\.)\S+\s*", "", venue).strip().rstrip(".")
        if (
            not venue_without_url
            and authors_str
            and not re.search(r"[A-Z][a-z]+,\s*[A-Z]\.", authors_str)
            and (
                any(ch in authors_str for ch in (":", "?", "|"))
                or authors_str[0].islower()
                or re.search(
                    r"\b(?:what\s+is|how\s+to|metrics\s+for|state\s+of|top\s+\d+|top\s+fitness|growth|statistics|payback\s+period)\b",
                    authors_str,
                    re.I,
                )
            )
        ):
            real_title = authors_str.strip().rstrip(".")
            real_site = title.strip().rstrip(".")
            title = real_title
            venue = real_site
            citation.authors = [_make_corp_author(real_site)]

        # TDTU Vietnamese thesis format uses a comma after (Luận án ...), e.g.:
        # "Title (Luận án Tiến sĩ kinh tế), Trường Đại học Kinh tế Tp. HCM, Việt Nam."
        combined_tv = f"{title}. {venue}"
        thesis_comma_m = re.match(
            r"^(?P<t>.+?\((?:(?:Luận\s+án|Luận\s+văn|Khóa\s+luận|Đồ\s+án|Tiểu\s+luận)[^)]*"
            r"|[^)]*(?:thesis|dissertation)[^)]*)\))\s*,\s*(?P<v>.+)$",
            combined_tv,
            flags=re.IGNORECASE,
        )
        if thesis_comma_m:
            title = thesis_comma_m.group("t").strip()
            venue = thesis_comma_m.group("v").strip()

        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r"https?://(?:dx\.)?doi\.org/(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text, re.IGNORECASE)
        if doi_match:
            citation.doi = doi_match.group(1).rstrip(".,;")
        else:
            doi_match = re.search(r"(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text)
            if doi_match:
                citation.doi = doi_match.group(1).rstrip(".,;")

        # Extract URL if present (non-DOI internet reference, including line-wrapped URLs)
        self._extract_url_into(citation, text)

        citation.confidence = self._estimate_confidence(citation)
        return citation

    @staticmethod
    def _extract_url_into(citation: Citation, text: str) -> None:
        """Extract non-DOI URL into citation.url, handling line-break spaces after https://."""
        if citation.url:
            return
        url_match = re.search(r"(https?://\s*[^\s\]\)\,;]+)", text, re.IGNORECASE)
        if url_match:
            raw_url = re.sub(r"\s+", "", url_match.group(1)).rstrip(".,;")
            if not re.search(r"doi\.org/10\.\d{4,9}/", raw_url, re.IGNORECASE):
                citation.url = raw_url

    def _parse_apa_numbered_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse numbered APA reference entry like [1] Author (Year). Title."""
        # Extract numeric index
        idx_match = re.search(r"\[\s*(\d+)\s*\]", text)
        numeric_index = int(idx_match.group(1)) if idx_match else None

        citation = self._parse_apa_entry(match, text)
        if citation and numeric_index:
            citation.numeric_index = numeric_index
        return citation

    def _parse_apa_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse APA book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="apa_book_chapter",
        )

        # Extract authors (strip any leading [N] marker before parsing)
        authors_str = match.group("authors")
        if authors_str:
            authors_str = re.sub(r"^\[\s*\d+\s*\]\s*", "", authors_str).strip()
            citation.authors = self._parse_authors(authors_str)

        # Extract year (for "(n.d.)" entries, fallback to retrieval/access year in venue)
        citation.year = match.group("year")
        if not citation.year:
            venue_year_m = re.search(r"\b((?:19|20)\d{2})\b", match.group("venue") or "")
            if venue_year_m:
                citation.year = venue_year_m.group(1)
        suffix = match.group("suffix")
        citation.year_suffix = suffix if suffix else None

        # Extract chapter title
        chapter_title = match.group("title").strip()
        citation.title = chapter_title
        citation.title_normalized = self._normalize_title(chapter_title)

        # Extract book title (stored in venue as "In Book Title")
        book_title = match.group("book_title").strip()
        publisher = match.group("publisher")
        citation.venue = f"In {book_title}" + (f". {publisher.strip()}" if publisher else "")

        # Extract DOI if present
        doi_match = re.search(r"(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text)
        if doi_match:
            citation.doi = doi_match.group(1).rstrip(".,;")

        self._extract_url_into(citation, text)
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_apa_simple_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse simple APA reference entry."""
        authors_raw = match.group("authors") or ""
        title_raw = (match.group("title") or "").strip()
        if self._is_non_apa_structure(authors_raw, title_raw, text):
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="apa_simple_entry",
        )

        # Extract authors (strip any leading [N] marker before parsing)
        authors_str = match.group("authors")
        if authors_str:
            authors_str = re.sub(r"^\[\s*\d+\s*\]\s*", "", authors_str).strip()
            citation.authors = self._parse_authors(authors_str)

        # Extract year (for "(n.d.)" entries, fallback to retrieval/access year in venue)
        citation.year = match.group("year")
        if not citation.year:
            venue_year_m = re.search(r"\b((?:19|20)\d{2})\b", match.group("venue") or "")
            if venue_year_m:
                citation.year = venue_year_m.group(1)
        suffix = match.group("suffix")
        citation.year_suffix = suffix if suffix else None

        # Extract title
        title = match.group("title").strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = match.group("venue").strip()
        self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r"(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text)
        if doi_match:
            citation.doi = doi_match.group(1).rstrip(".,;")

        self._extract_url_into(citation, text)
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_apa_fallback(self, text: str) -> Optional[Citation]:
        """Fallback parser: extract whatever metadata possible from unstructured text."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            matched_pattern="apa_fallback",
        )

        # Try to extract year
        year_match = re.search(r"\((\d{4})([a-z])?\)", text)
        if year_match:
            before_year = text[:year_match.start()].strip()
            after_year = text[year_match.end():].strip()
            # Reject if (Year) is at the end of a Nature/ACM/Chicago entry or preceded by quotes/numbers
            if re.search(r'["\u201c\u201d]|\d\s*$', before_year):
                return None
            if after_year.startswith((":", ",")) or after_year in ("", "."):
                return None
            citation.year = year_match.group(1)
            if year_match.group(2):
                citation.year_suffix = year_match.group(2)
            clean_auth = re.sub(r"^\[\s*\d+\s*\]\s*", "", before_year).strip()
            if clean_auth:
                citation.authors = self._parse_authors(clean_auth)

        # Try to extract title (text between year and period after it)
        if year_match:
            after_year = text[year_match.end():]
            title_match = re.search(r"\.?\s*(.+?)(?:\.|$)", after_year)
            if title_match:
                title = title_match.group(1).strip()
                if title and len(title) > 5:
                    citation.title = title
                    citation.title_normalized = self._normalize_title(title)

        # Try to extract DOI
        doi_match = re.search(r"(10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+)", text)
        if doi_match:
            citation.doi = doi_match.group(1).rstrip(".,;")

        self._extract_url_into(citation, text)
        citation.confidence = self._estimate_confidence(citation)
        # Only return if we have meaningful data (title OR year with some other field)
        return citation if citation.title or citation.year else None

    def _parse_authors(self, authors_str: str) -> list[str]:
        """Parse author string into list of authors.

        Args:
            authors_str: Author string like "Smith, J., & Jones, A."

        Returns:
            List of author strings (via parse_authors)
        """
        return parse_authors(authors_str)

    def _parse_venue(self, citation: Citation, venue_text: str) -> None:
        """Parse venue information from remaining text.

        Handles:
        - Journal with volume and issue: "Journal Name, 10(2), 1-15"
        - Journal with DOI only: "Journal Name. https://doi.org/..."
        - Publisher: "Publisher Name"
        """
        if not venue_text:
            return

        venue_text = venue_text.strip()

        # Web retrieval clause (TDTU §2.6.2: "Retrieved March 21, 2011, from ..." / "Truy cập 21/7/2016, từ ...")
        # Do not mistake the retrieval date's year for a journal volume number.
        if re.match(r"^(?:Retrieved|Truy\s+cập|Accessed)\b", venue_text, flags=re.IGNORECASE):
            citation.venue = venue_text.rstrip(".,")
            return

        # Book chapter / conference proceedings page range: "(pp. 29-43)" or "(tr. 29-43)"
        chapter_pages_m = re.search(
            r"\((?:pp?\.?|tr\.?|trang)\s*(?P<pages>\d+\s*[-–]\s*\d+|\d+)\)",
            venue_text,
            flags=re.IGNORECASE,
        )
        if chapter_pages_m and not citation.pages:
            citation.pages = re.sub(r"\s+", "", chapter_pages_m.group("pages"))

        # Extract volume and issue: "Journal, 10(2)" or "Journal, 126(5D)"
        vol_issue_match = re.search(
            r"(?P<journal>.+?),\s*(?P<vol>\d+[A-Za-z0-9\-]*)\((?P<issue>[A-Za-z0-9\-]+)\)",
            venue_text
        )
        if vol_issue_match:
            citation.venue = vol_issue_match.group("journal").strip()
            citation.volume = vol_issue_match.group("vol")
            citation.issue = vol_issue_match.group("issue")

            # Extract pages after volume(issue)
            remaining = venue_text[vol_issue_match.end():]
            pages_match = re.search(r",\s*(?P<pages>[\d–-]+)", remaining)
            if pages_match:
                citation.pages = pages_match.group("pages")
        else:
            # Try just volume: "Journal, 10"
            vol_match = re.search(
                r"(?P<journal>.+?),\s*(?P<vol>\d+)(?P<pages>(?:\s*,\s*pp?\.\s*[\d–-]+)?)",
                venue_text
            )
            if vol_match:
                citation.venue = vol_match.group("journal").strip()
                citation.volume = vol_match.group("vol")
                pages = vol_match.group("pages")
                if pages:
                    # Extract page numbers from "pp. 1-15" or just "1-15"
                    pages_clean = re.sub(r"^,?\s*(?:pp?\.\s*)?", "", pages)
                    if pages_clean:
                        citation.pages = pages_clean.strip()
            else:
                # No volume - just journal name or publisher
                citation.venue = venue_text

        # Clean up venue
        if citation.venue:
            # Remove DOI from venue
            citation.venue = re.sub(
                r"\s*https?://(?:dx\.)?doi\.org/\S+",
                "",
                citation.venue
            ).strip()
            citation.venue = re.sub(
                r"\s*10\.\d{4,9}/\S+",
                "",
                citation.venue
            ).strip()
            citation.venue = citation.venue.rstrip(".,")

    def _normalize_title(self, title: str) -> str:
        """Normalize title for comparison: lowercase, remove punctuation."""
        if not title:
            return ""
        t = title.lower()
        t = re.sub(r"[^\w\s]", " ", t)
        t = re.sub(r"\s+", " ", t)
        return t.strip()

    def _estimate_confidence(self, citation: Citation) -> float:
        """Estimate parse confidence based on extracted fields."""
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

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid APA citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches APA citation pattern, False otherwise
        """
        import re

        # Check for year pattern: any 4-digit year in reasonable range
        if not re.search(r"\b(19|20)\d{2}\b", text):
            return False

        # Check for author name pattern (capitalized word, including Vietnamese uppercase)
        author_pattern = rf"{_UPPER_VN}[a-zA-ZÀ-ỹ]"
        if not re.search(author_pattern, text):
            return False

        # Check if it's a parenthetical citation (starts with opening paren)
        stripped = text.strip()
        if stripped.startswith("("):
            # For parenthetical: author should be inside parentheses before year
            # Pattern: (Author, Year) or (Author et al., Year)
            paren_match = re.search(r"\(([^)]+)\)", text)
            if paren_match:
                paren_content = paren_match.group(1)
                # Check for year in parentheses
                if not re.search(r"\d{4}", paren_content):
                    return False
                # Check for author in parentheses (capitalized word)
                if not re.search(author_pattern, paren_content):
                    return False
                return True

        # For narrative citations: Author (Year) - author outside parens
        # Check if there's a capitalized word followed by (Year)
        narrative_pattern = rf"{_UPPER_VN}[a-zA-ZÀ-ỹ]*(?:[\s,&]+(?:và|and|et\s+al\.?|cộng\s+sự|cs\.?|{_UPPER_VN}[a-zA-ZÀ-ỹ]*))*\s+\(\d{{4}}"
        if re.search(narrative_pattern, text):
            return True

        # Fallback: just check if it has both author and year
        return True


# =============================================================================
# Auto-registration
# =============================================================================

# Register APA format when this module is imported
register_format(APAFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

APA_IN_TEXT_PATTERNS = [
    _APA_INTEXT_PARENTHETICAL,
    _APA_INTEXT_NARRATIVE,
]

APA_REFERENCE_PATTERNS = [
    _APA_REFERENCE_ENTRY,
    _APA_NUMBERED_REFERENCE,
    _APA_BOOK_CHAPTER,
    _APA_SIMPLE_ENTRY,
]
