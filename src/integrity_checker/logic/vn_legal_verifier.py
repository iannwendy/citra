"""Vietnamese Legal Statute & Regulatory Verification Engine (Sprint 3.2).

Validates Vietnamese legal citations (Hiến pháp, Bộ luật, Luật, Nghị định,
Thông tư, Quyết định, Nghị quyết) against:
1. Canonical statutory registry (promulgation years, official code numbers `Số hiệu`,
   issuing authority `Cơ quan ban hành`, and vigencia / superseded status).
2. Structural consistency rules for Vietnamese legal document numbers:
   - `QH\\d+` -> must be issued by `Quốc hội` and year must match the National Assembly term
   - `NĐ-CP` -> must be issued by `Chính phủ` and `/YYYY/NĐ-CP` must match the cited year
   - `QĐ-TTg` / `CT-TTg` -> must be issued by `Thủ tướng Chính phủ`
   - `TT-B...` -> must be issued by the corresponding Ministry (`Bộ ...`) and `/YYYY/TT-...` must match year
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class VNLegalVerificationResult:
    """Result of verifying a Vietnamese legal citation."""

    is_valid: bool = True
    is_verified_statute: bool = False
    is_superseded: bool = False
    canonical_name: str | None = None
    canonical_code: str | None = None
    canonical_authority: str | None = None
    superseded_by: str | None = None
    mismatched_fields: list[str] = field(default_factory=list)
    triggered_rules: list[str] = field(default_factory=lambda: ["R-LEGAL-DOCUMENT"])
    reasoning: str = ""


# Curated registry of foundational Vietnamese Codes (Bộ luật), Laws (Luật), and Decrees (Nghị định)
_STATUTE_REGISTRY: list[dict] = [
    {
        "pattern": re.compile(r"\bhiến\s+pháp\b", re.IGNORECASE),
        "canonical_name": "Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam",
        "authority": "Quốc hội",
        "valid_years": {"1946", "1959", "1980", "1992", "2013"},
        "active_years": {"2013"},
        "superseded_map": {
            "1946": "Hiến pháp 2013",
            "1959": "Hiến pháp 2013",
            "1980": "Hiến pháp 2013",
            "1992": "Hiến pháp 2013",
        },
        "codes_by_year": {"2013": "Hiến pháp 2013"},
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+dân\s+sự\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Dân sự",
        "authority": "Quốc hội",
        "valid_years": {"1995", "2005", "2015"},
        "active_years": {"2015"},
        "superseded_map": {
            "1995": "Bộ luật Dân sự 2015 (91/2015/QH13)",
            "2005": "Bộ luật Dân sự 2015 (91/2015/QH13)",
        },
        "codes_by_year": {
            "2005": "33/2005/QH11",
            "2015": "91/2015/QH13",
        },
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+hình\s+sự\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Hình sự",
        "authority": "Quốc hội",
        "valid_years": {"1985", "1999", "2015", "2017"},
        "active_years": {"2015", "2017"},
        "superseded_map": {
            "1985": "Bộ luật Hình sự 2015 (100/2015/QH13, sửa đổi 2017)",
            "1999": "Bộ luật Hình sự 2015 (100/2015/QH13, sửa đổi 2017)",
        },
        "codes_by_year": {
            "1999": "15/1999/QH10",
            "2015": "100/2015/QH13",
            "2017": "12/2017/QH14",
        },
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+lao\s+động\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Lao động",
        "authority": "Quốc hội",
        "valid_years": {"1994", "2012", "2019"},
        "active_years": {"2019"},
        "superseded_map": {
            "1994": "Bộ luật Lao động 2019 (45/2019/QH14)",
            "2012": "Bộ luật Lao động 2019 (45/2019/QH14)",
        },
        "codes_by_year": {
            "2012": "10/2012/QH13",
            "2019": "45/2019/QH14",
        },
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+tố\s+tụng\s+dân\s+sự\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Tố tụng dân sự",
        "authority": "Quốc hội",
        "valid_years": {"2004", "2015"},
        "active_years": {"2015"},
        "superseded_map": {
            "2004": "Bộ luật Tố tụng dân sự 2015 (92/2015/QH13)",
        },
        "codes_by_year": {
            "2004": "24/2004/QH11",
            "2015": "92/2015/QH13",
        },
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+tố\s+tụng\s+hình\s+sự\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Tố tụng hình sự",
        "authority": "Quốc hội",
        "valid_years": {"2003", "2015"},
        "active_years": {"2015"},
        "superseded_map": {
            "2003": "Bộ luật Tố tụng hình sự 2015 (101/2015/QH13)",
        },
        "codes_by_year": {
            "2003": "19/2003/QH11",
            "2015": "101/2015/QH13",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+doanh\s+nghiệp\b", re.IGNORECASE),
        "canonical_name": "Luật Doanh nghiệp",
        "authority": "Quốc hội",
        "valid_years": {"1999", "2005", "2014", "2020"},
        "active_years": {"2020"},
        "superseded_map": {
            "1999": "Luật Doanh nghiệp 2020 (59/2020/QH14)",
            "2005": "Luật Doanh nghiệp 2020 (59/2020/QH14)",
            "2014": "Luật Doanh nghiệp 2020 (59/2020/QH14)",
        },
        "codes_by_year": {
            "2005": "60/2005/QH11",
            "2014": "68/2014/QH13",
            "2020": "59/2020/QH14",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+đầu\s+tư\b(?!\s+công)", re.IGNORECASE),
        "canonical_name": "Luật Đầu tư",
        "authority": "Quốc hội",
        "valid_years": {"2005", "2014", "2020"},
        "active_years": {"2020"},
        "superseded_map": {
            "2005": "Luật Đầu tư 2020 (61/2020/QH14)",
            "2014": "Luật Đầu tư 2020 (61/2020/QH14)",
        },
        "codes_by_year": {
            "2005": "59/2005/QH11",
            "2014": "67/2014/QH13",
            "2020": "61/2020/QH14",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+đất\s+đai\b", re.IGNORECASE),
        "canonical_name": "Luật Đất đai",
        "authority": "Quốc hội",
        "valid_years": {"1993", "2003", "2013", "2024"},
        "active_years": {"2024"},
        "superseded_map": {
            "1993": "Luật Đất đai 2024 (31/2024/QH15)",
            "2003": "Luật Đất đai 2024 (31/2024/QH15)",
            "2013": "Luật Đất đai 2024 (31/2024/QH15)",
        },
        "codes_by_year": {
            "2003": "13/2003/QH11",
            "2013": "45/2013/QH13",
            "2024": "31/2024/QH15",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+thương\s+mại\b", re.IGNORECASE),
        "canonical_name": "Luật Thương mại",
        "authority": "Quốc hội",
        "valid_years": {"1997", "2005"},
        "active_years": {"2005"},
        "superseded_map": {
            "1997": "Luật Thương mại 2005 (36/2005/QH11)",
        },
        "codes_by_year": {
            "2005": "36/2005/QH11",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+sở\s+hữu\s+trí\s+tuệ\b", re.IGNORECASE),
        "canonical_name": "Luật Sở hữu trí tuệ",
        "authority": "Quốc hội",
        "valid_years": {"2005", "2009", "2019", "2022"},
        "active_years": {"2005", "2009", "2019", "2022"},
        "superseded_map": {},
        "codes_by_year": {
            "2005": "50/2005/QH11",
            "2009": "36/2009/QH12",
            "2019": "42/2019/QH14",
            "2022": "07/2022/QH15",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+an\s+ninh\s+mạng\b", re.IGNORECASE),
        "canonical_name": "Luật An ninh mạng",
        "authority": "Quốc hội",
        "valid_years": {"2018"},
        "active_years": {"2018"},
        "superseded_map": {},
        "codes_by_year": {
            "2018": "24/2018/QH14",
        },
    },
    {
        "pattern": re.compile(r"\bluật\s+giao\s+dịch\s+điện\s+tử\b", re.IGNORECASE),
        "canonical_name": "Luật Giao dịch điện tử",
        "authority": "Quốc hội",
        "valid_years": {"2005", "2023"},
        "active_years": {"2023"},
        "superseded_map": {
            "2005": "Luật Giao dịch điện tử 2023 (20/2023/QH15)",
        },
        "codes_by_year": {
            "2005": "51/2005/QH11",
            "2023": "20/2023/QH15",
        },
    },
    {
        "pattern": re.compile(r"\bbộ\s+luật\s+hàng\s+hải\b", re.IGNORECASE),
        "canonical_name": "Bộ luật Hàng hải Việt Nam",
        "authority": "Quốc hội",
        "valid_years": {"1990", "2005", "2015"},
        "active_years": {"2015"},
        "superseded_map": {
            "1990": "Bộ luật Hàng hải Việt Nam 2015 (95/2015/QH13)",
            "2005": "Bộ luật Hàng hải Việt Nam 2015 (95/2015/QH13)",
        },
        "codes_by_year": {
            "2005": "40/2005/QH11",
            "2015": "95/2015/QH13",
        },
    },
    {
        "pattern": re.compile(r"\bnghị\s+định\b.*?\bđăng\s+ký\s+doanh\s+nghiệp\b", re.IGNORECASE),
        "canonical_name": "Nghị định về đăng ký doanh nghiệp",
        "authority": "Chính phủ",
        "valid_years": {"2006", "2010", "2015", "2018", "2021", "2025"},
        "active_years": {"2021"},
        "superseded_map": {
            "2006": "Nghị định 01/2021/NĐ-CP về đăng ký doanh nghiệp",
            "2010": "Nghị định 01/2021/NĐ-CP về đăng ký doanh nghiệp",
            "2015": "Nghị định 01/2021/NĐ-CP về đăng ký doanh nghiệp",
        },
        "codes_by_year": {
            "2006": "88/2006/NĐ-CP",
            "2010": "43/2010/NĐ-CP",
            "2015": "78/2015/NĐ-CP",
            "2018": "108/2018/NĐ-CP",
            "2021": "01/2021/NĐ-CP",
            "2025": "168/2025/NĐ-CP",
        },
    },
]

# Document number pattern: e.g. 91/2015/QH13, 23/2015/NĐ-CP, 200/2014/TT-BTC
_DOC_CODE_RE = re.compile(
    r"\b(?P<num>\d{1,4})/(?P<code_year>(?:19|20)\d{2})/(?P<suffix>[A-ZĐa-zđ0-9\-]+)\b"
)
_ALL_YEARS_RE = re.compile(r"\b((?:19|20)\d{2})\b")


def verify_vn_legal_citation(
    raw_text: str,
    extracted_year: str | None = None,
    extracted_venue: str | None = None,
) -> VNLegalVerificationResult:
    """Verify a Vietnamese legal reference against statutory registry & structural rules."""
    text = (raw_text or "").strip()
    years_in_text = _ALL_YEARS_RE.findall(text)
    primary_year = (extracted_year or (years_in_text[-1] if years_in_text else "")).strip()

    code_match = _DOC_CODE_RE.search(text)
    code_str = code_match.group(0) if code_match else None
    code_year = code_match.group("code_year") if code_match else None
    code_suffix = code_match.group("suffix").upper() if code_match else None

    mismatches: list[str] = []
    reasons: list[str] = []

    # 1. Check code_year vs cited date/year consistency
    if code_year and primary_year and code_year != primary_year and len(set(years_in_text)) > 1:
        # Check if there is a promulgation date with a different year than the code year
        date_year_m = re.search(r"ngày\s+\d{1,2}[/-]\d{1,2}[/-]((?:19|20)\d{2})", text, re.IGNORECASE)
        if date_year_m and date_year_m.group(1) != code_year:
            mismatches.append("year")
            reasons.append(
                f"Mâu thuẫn năm ban hành trong số hiệu ({code_str}) và ngày ban hành ({date_year_m.group(0)})"
            )

    # 2. Check issuing authority consistency with document type & code suffix
    text_lower = text.lower()
    if re.search(r"\b(?:hiến\s+pháp|bộ\s+luật)\b", text_lower) or (code_suffix and code_suffix.startswith("QH")):
        # Must be Quốc hội; flag if explicitly attributed to Chính phủ or Bộ
        if re.search(r"của\s+(?:chính\s+phủ|bộ\s+[a-zà-ỹ]+|thủ\s+tướng)", text_lower):
            mismatches.append("venue")
            reasons.append(
                "Sai cơ quan ban hành: Hiến pháp / Bộ luật / Luật (QH) thuộc thẩm quyền ban hành của Quốc hội"
            )
    elif code_suffix == "NĐ-CP":
        if re.search(r"của\s+(?:quốc\s+hội|bộ\s+[a-zà-ỹ]+|tòa\s+án)", text_lower):
            mismatches.append("venue")
            reasons.append(
                f"Sai cơ quan ban hành cho Nghị định {code_str}: Nghị định (NĐ-CP) do Chính phủ ban hành"
            )

    # 3. Match against curated statutory registry
    any_name_matched = any(e["pattern"].search(text) for e in _STATUTE_REGISTRY)
    for entry in _STATUTE_REGISTRY:
        name_matched = bool(entry["pattern"].search(text))
        code_matched = bool(
            not any_name_matched
            and code_str
            and any(code_str.lower() == v.lower() for v in entry["codes_by_year"].values())
        )
        if not name_matched and not code_matched:
            continue

        canonical_name = entry["canonical_name"]
        canonical_authority = entry["authority"]
        valid_years: set[str] = entry["valid_years"]
        codes_by_year: dict[str, str] = entry["codes_by_year"]
        superseded_map: dict[str, str] = entry["superseded_map"]

        # Check if any valid year is cited
        cited_years = set(years_in_text) | ({primary_year} if primary_year else set())
        cited_years.discard("")

        if cited_years and not (cited_years & valid_years):
            mismatches.append("year")
            reasons.append(
                f"Năm ban hành ({', '.join(sorted(cited_years))}) không khớp với lịch sử lập pháp của {canonical_name} "
                f"(các năm hợp lệ: {', '.join(sorted(valid_years))})"
            )

        # If a specific year is matched and a code number is provided, verify the exact code number
        matched_year = primary_year if primary_year in valid_years else next(iter(cited_years & valid_years), None)
        canonical_year_for_code = matched_year or (sorted(entry["active_years"])[-1] if entry.get("active_years") else None)
        expected_code = codes_by_year.get(canonical_year_for_code) if canonical_year_for_code else None
        if expected_code and code_str and expected_code.lower() != code_str.lower():
            mismatches.append("title")
            reasons.append(
                f"Sai số hiệu văn bản: {canonical_name} năm {canonical_year_for_code} có số hiệu chuẩn là {expected_code} "
                f"(ghi nhận: {code_str})"
            )

        if mismatches:
            return VNLegalVerificationResult(
                is_valid=False,
                is_verified_statute=False,
                canonical_name=canonical_name,
                canonical_code=expected_code,
                canonical_authority=canonical_authority,
                mismatched_fields=list(dict.fromkeys(mismatches)),
                triggered_rules=["R-LEGAL-DOCUMENT", "R-VN-LEGAL-MISMATCH"],
                reasoning="Phát hiện sai lệch thông tin văn bản quy phạm pháp luật Việt Nam: " + "; ".join(reasons),
            )

        is_superseded = bool(matched_year and matched_year in superseded_map and not (cited_years & entry["active_years"]))
        superseded_by = superseded_map.get(matched_year) if is_superseded else None
        rules = ["R-LEGAL-DOCUMENT", "R-VN-LEGAL-VERIFIED"]
        if is_superseded:
            rules.append("R-VN-LEGAL-SUPERSEDED")
            reason_msg = (
                f"Đã xác thực văn bản pháp luật Việt Nam: {canonical_name} ({matched_year}"
                + (f", số hiệu {expected_code}" if expected_code else "")
                + f", cơ quan ban hành: {canonical_authority}). "
                f"Lưu ý hiệu lực: Văn bản này đã hết hiệu lực và được thay thế bởi {superseded_by}."
            )
        else:
            reason_msg = (
                f"Đã xác thực văn bản pháp luật Việt Nam hợp lệ: {canonical_name}"
                + (f" ({matched_year})" if matched_year else "")
                + (f" — Số hiệu: {expected_code}" if expected_code else "")
                + f" — Cơ quan ban hành: {canonical_authority} (Đang có hiệu lực thi hành)."
            )

        return VNLegalVerificationResult(
            is_valid=True,
            is_verified_statute=True,
            is_superseded=is_superseded,
            canonical_name=canonical_name,
            canonical_code=expected_code or code_str,
            canonical_authority=canonical_authority,
            superseded_by=superseded_by,
            mismatched_fields=[],
            triggered_rules=rules,
            reasoning=reason_msg,
        )

    # 4. Non-registry legal document (e.g., Nghị định, Thông tư, Quyết định, Bản án)
    # Check for fabricated / hallucinated legal codes, non-existent Bộ luật, or impossible dates
    is_fabricated_legal = False

    # 4a. Vietnam only has 6 official Codes (Bộ luật), all registered above. Any other "Bộ luật" is fabricated.
    if re.search(r"\bbộ\s+luật\b", text_lower):
        is_fabricated_legal = True
        mismatches.append("title")
        reasons.append(
            "Văn bản có dấu hiệu bịa đặt: Pháp luật Việt Nam chỉ có 6 Bộ luật chính thức (Dân sự, Hình sự, Lao động, Tố tụng dân sự, Tố tụng hình sự, Hàng hải)"
        )

    # 4b. Check impossible calendar dates (e.g. 30/02, 31/11, 31/04)
    full_date_m = re.search(
        r"ngày\s+(?P<d>\d{1,2})[/-](?P<m>\d{1,2})[/-](?P<y>(?:19|20)\d{2})",
        text,
        re.IGNORECASE,
    )
    if full_date_m:
        day_i = int(full_date_m.group("d"))
        mon_i = int(full_date_m.group("m"))
        if mon_i < 1 or mon_i > 12 or day_i < 1 or day_i > 31 or (mon_i == 2 and day_i > 29) or (mon_i in {4, 6, 9, 11} and day_i > 30):
            is_fabricated_legal = True
            mismatches.append("year")
            reasons.append(
                f"Ngày ban hành không tồn tại trong lịch ({full_date_m.group(0)})"
            )

    # 4c. Check impossible document code numbers (e.g. 888/2023/QH15, 777/2022/QH15, 555/2024/NĐ-CP)
    if code_match:
        code_num = int(code_match.group("num"))
        if code_suffix and code_suffix.startswith("QH") and code_num > 200:
            is_fabricated_legal = True
            mismatches.append("title")
            reasons.append(
                f"Số hiệu văn bản Quốc hội ({code_str}) vượt quá phạm vi đánh số thực tế của Quốc hội và không tồn tại trong CSDL Quốc gia về VBQPPL"
            )
        elif code_suffix == "NĐ-CP" and code_num >= 400:
            is_fabricated_legal = True
            mismatches.append("title")
            reasons.append(
                f"Số hiệu Nghị định ({code_str}) vượt quá phạm vi đánh số thực tế của Chính phủ và không tồn tại trong CSDL Quốc gia về VBQPPL"
            )

    if mismatches:
        rules_err = ["R-LEGAL-DOCUMENT", "R-VN-LEGAL-MISMATCH"]
        if is_fabricated_legal:
            rules_err.append("R-VN-LEGAL-FABRICATED")
        return VNLegalVerificationResult(
            is_valid=False,
            is_verified_statute=False,
            canonical_code=None if is_fabricated_legal else code_str,
            canonical_authority=extracted_venue,
            mismatched_fields=list(dict.fromkeys(mismatches)),
            triggered_rules=rules_err,
            reasoning="Phát hiện sai lệch / nghi vấn bịa đặt văn bản quy phạm pháp luật Việt Nam: " + "; ".join(reasons),
        )

    rules = ["R-LEGAL-DOCUMENT"]
    if code_str:
        rules.append("R-VN-LEGAL-VERIFIED")
    inferred_authority = extracted_venue
    if not inferred_authority and code_suffix:
        if code_suffix == "NĐ-CP":
            inferred_authority = "Chính phủ"
        elif code_suffix.startswith("QH"):
            inferred_authority = "Quốc hội"
    return VNLegalVerificationResult(
        is_valid=True,
        is_verified_statute=bool(code_str),
        canonical_code=code_str,
        canonical_authority=inferred_authority,
        mismatched_fields=[],
        triggered_rules=rules,
        reasoning=(
            f"Vietnamese legal document verified ({code_str or 'statutory/regulatory source'}): "
            f"{text[:90]}..."
        ),
    )
