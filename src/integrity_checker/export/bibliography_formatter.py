"""1-Click Bibliography Auto-Remediation & Canonical Reference Formatter (Sprint 3.1).

Transforms extracted / verified references (including METADATA_ERROR entries) into
standardized academic bibliography entries using verified canonical metadata from
Semantic Scholar, OpenAlex, Crossref, PubMed, arXiv, and LocalDB.

Supported output formats:
- `apa`: APA 7th Edition
- `ieee`: IEEE Numeric Style
- `tdtu`: Harvard / TDTU Thesis Guideline Style
- `bibtex`: BibTeX (.bib)
- `ris`: Research Information Systems (.ris)
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})[a-z]?\b")
_DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\]\)\,;]+", re.IGNORECASE)
_URL_RE = re.compile(r"https?://[^\s\]\)\,;]+", re.IGNORECASE)


def _clean_text(val: Any) -> str:
    if not val:
        return ""
    s = str(val).strip()
    return " ".join(s.split())


def _split_raw_authors_str(raw_auth: str) -> list[str]:
    """Split a raw author string into individual author names across APA/IEEE/Vancouver/Chicago styles."""
    s = _clean_text(raw_auth).strip(" .,;")
    if not s:
        return []
    # Strip trailing et al.
    s = re.sub(r"\s*,?\s*(?:et\s+al\.?|và\s+cộng\s+sự|và\s+cs\.?)\s*$", "", s, flags=re.IGNORECASE).strip(" .,;")
    if not s:
        return []
    if _CORPORATE_AUTHOR_RE.search(s):
        return [s]

    # First split on explicit ";" or "&" or "and" or "và"
    chunks = [c.strip(" ,;") for c in re.split(r"\s*(?:;|&\s*|\band\b|\bvà\b)\s*", s) if c.strip(" ,;")]
    authors: list[str] = []
    for chunk in chunks:
        if _CORPORATE_AUTHOR_RE.search(chunk):
            authors.append(chunk)
            continue
        # Case 1: Multiple "Surname, Initials" pairs separated by commas:
        # e.g. "Vaswani, A., Shazeer, N., Parmar, N." or "Vaswani, A, Shazeer, N, Parmar, N"
        pair_splits = re.split(
            r",\s*(?=[A-ZÀ-ÝĂÂĐÊÔƠƯ][a-zà-ỹA-ZÀ-Ỹ'\u2019\-]+\s*,\s*(?:[A-ZÀ-ÝĂÂĐÊÔƠƯ]\.?\s*)+)",
            chunk,
        )
        if len(pair_splits) > 1:
            authors.extend(p.strip(" ,") for p in pair_splits if p.strip(" ,"))
            continue
        # Case 2: Comma-separated "I. Surname" or "First Surname" or "Surname AB" (no internal comma in each name)
        comma_parts = [p.strip() for p in chunk.split(",") if p.strip()]
        if len(comma_parts) > 1 and all(
            len(p.split()) >= 2 or re.fullmatch(r"[A-ZÀ-Ý][a-zà-ỹ]+", p) is None
            for p in comma_parts
        ):
            # Ensure it's not a single "Surname, First Middle" (2 parts where 1st is 1-word surname and 2nd is given name)
            if len(comma_parts) == 2 and len(comma_parts[0].split()) == 1 and not re.search(r"\b[A-Z]\.\s+[A-Z]", comma_parts[0]):
                authors.append(chunk)
            else:
                authors.extend(comma_parts)
        else:
            authors.append(chunk)
    return [a for a in authors if a]


def _clean_venue_str(venue: str) -> str:
    """Clean extracted venue string and remove dangling URL/retrieval prefixes."""
    v = _clean_text(venue).strip(" .,;:")
    v = re.sub(r"^(?:in|trong)\s+", "", v, flags=re.IGNORECASE).strip(" .,;:")
    v = re.sub(
        r"(?:[,;.]?\s*)?\b(?:retrieved\s+from|available\s+(?:online\s+)?at:?|truy\s+cập\s+(?:tại|từ|ngày|lần).*|accessed\s+.*)$",
        "",
        v,
        flags=re.IGNORECASE,
    ).strip(" .,;:")
    v = re.sub(r"\s*(?:https?://\S+|doi:\s*\S+).*$", "", v, flags=re.IGNORECASE).strip(" .,;:")
    v = re.sub(r",\s*(?:vol\.|no\.|pp\.|p\.)\s*\d.*$", "", v, flags=re.IGNORECASE).strip(" .,;:")
    if re.fullmatch(r"(?:retrieved(?:\s+from)?|available(?:\s+at)?|online|truy\s+cập|n\.?d\.?)", v, flags=re.IGNORECASE):
        return ""
    return v


def _extract_raw_fallback_metadata(raw_text: str) -> dict[str, Any]:
    """Best-effort extraction from raw reference text when no external candidate matched."""
    cleaned = _clean_text(raw_text)
    # Strip leading [N] or N.
    cleaned_no_num = re.sub(r"^\s*(?:\[\d+\]|\d+[\.\)])\s*", "", cleaned)

    from integrity_checker.extraction.patterns.utils import extract_publication_year

    pub_yr, pub_suf = extract_publication_year(cleaned_no_num, prefer_last=True, allow_1800s=True)
    if pub_yr:
        year = pub_yr + (pub_suf or "")
    else:
        year_m = _YEAR_RE.search(cleaned_no_num)
        year = year_m.group(1) if year_m else ""

    doi_m = _DOI_RE.search(cleaned_no_num)
    doi = doi_m.group(0).rstrip(".,;)") if doi_m else ""

    url_m = _URL_RE.search(cleaned_no_num)
    url = url_m.group(0).rstrip(".,;)") if url_m else ""

    # Try Vietnamese legal reference parser first
    try:
        from integrity_checker.extraction.patterns.apa import (
            is_vn_legal_reference,
            parse_vn_legal_reference,
        )

        if is_vn_legal_reference(cleaned):
            legal_cit = parse_vn_legal_reference(cleaned)
            if legal_cit:
                authority = _clean_text(legal_cit.venue) or "Quốc hội / Cơ quan ban hành VBQPPL"
                return {
                    "title": _clean_text(legal_cit.title) or cleaned_no_num,
                    "authors": [authority],
                    "year": str(legal_cit.year) if legal_cit.year else year,
                    "venue": "Hệ thống Pháp luật Việt Nam (VBQPPL)",
                    "doi": doi,
                    "url": _clean_text(legal_cit.url) or url,
                }
    except Exception:
        pass

    authors: list[str] = []
    title = ""
    venue = ""

    # Try Author (Year). Title. Venue. (or Vietnamese: Author (Year), “Title”, Venue)
    apa_m = re.match(
        r"^(?P<authors>[^()]{2,180}?)\s*\(\s*(?:19|20)\d{2}[a-z]?(?:,\s*[A-Za-z]+\.?\s*\d{0,2})?\s*\)[.,:]?\s*(?P<rest>.+)$",
        cleaned_no_num,
    )
    if apa_m:
        raw_auth = apa_m.group("authors").strip(" .,;")
        authors = _split_raw_authors_str(raw_auth)
        rest = apa_m.group("rest").strip()
        # Strip trailing Retrieved from / truy cập tại / DOI / URL
        rest = re.sub(
            r"\s*(?:[,;.]?\s*(?:Retrieved\s+from|Available\s+(?:online\s+)?at:?|truy\s+cập\s+(?:tại|từ):?)\s*)?(?:https?://\S+|doi:\s*\S+).*$",
            "",
            rest,
            flags=re.IGNORECASE,
        ).strip()
        # Check if rest starts with a quoted title: “Title”, Venue
        q_rest_m = re.match(r"^[\"\u201c](?P<qt>[^\"\u201d]{4,240})[\"\u201d]\s*[.,;]\s*(?P<qv>.*)$", rest)
        if q_rest_m:
            title = q_rest_m.group("qt").strip(" .,")
            venue = _clean_venue_str(q_rest_m.group("qv"))
        else:
            parts = [p.strip() for p in rest.split(". ") if p.strip()]
            if parts:
                title = parts[0].strip(" .\"“”'")
                if len(parts) > 1:
                    venue = _clean_venue_str(parts[1])
    else:
        # Try quoted title (IEEE, Chicago, MLA)
        q_m = re.search(r"[\"\u201c]([^\"\u201d]{6,220})[\"\u201d]", cleaned_no_num)
        if q_m:
            title = q_m.group(1).strip(" .,")
            prefix = cleaned_no_num[: q_m.start()].strip(" .,;")
            if prefix:
                authors = _split_raw_authors_str(prefix)
            suffix = cleaned_no_num[q_m.end() :].strip(" .,;\"”'")
            if suffix:
                suffix = re.sub(r"^(?:in|trong)\s+", "", suffix, flags=re.IGNORECASE).strip()
                suffix = re.sub(
                    r"\s*(?:,\s*)?(?:vol\.|no\.|pp\.|p\.|\(\s*(?:19|20)\d{2}\s*\)|(?:19|20)\d{2}\b|doi:\s*\S+|https?://\S+).*$",
                    "",
                    suffix,
                    flags=re.IGNORECASE,
                ).strip(" .,;")
                venue = _clean_venue_str(suffix)
        else:
            parts = [p.strip() for p in cleaned_no_num.split(". ") if p.strip()]
            if len(parts) >= 2:
                authors = _split_raw_authors_str(parts[0])
                title = re.sub(r"\s*(?:https?://\S+|doi:\s*\S+).*$", "", parts[1], flags=re.IGNORECASE).strip(" .")
                if len(parts) >= 3:
                    venue = _clean_venue_str(parts[2])
            else:
                no_url_tail = re.sub(r"\s*(?:https?://\S+|doi:\s*\S+).*$", "", cleaned_no_num, flags=re.IGNORECASE).strip(" .,;")
                title = (no_url_tail or cleaned_no_num)[:160]

    # Supplement missing fields from ReferenceListParser if needed
    if not title or not authors:
        try:
            from integrity_checker.extraction.reference_parser import ReferenceListParser

            parsed_cit = ReferenceListParser()._parse_entry(cleaned, order_index=1, page_num=1)
            if parsed_cit:
                if parsed_cit.title and (not title or not authors):
                    title = _clean_text(parsed_cit.title).strip(" .\"“”'")
                if not authors and parsed_cit.authors:
                    authors = _normalize_author_list(parsed_cit.authors)
                if not venue and parsed_cit.venue:
                    venue = _clean_venue_str(parsed_cit.venue)
        except Exception:
            pass

    return {
        "title": title,
        "authors": authors,
        "year": str(year) if year else "",
        "venue": venue,
        "doi": doi,
        "url": url,
    }


def _capitalize_surname(s: str) -> str:
    s_clean = s.strip()
    if not s_clean:
        return s_clean
    if s_clean[0].islower() and not s_clean.startswith(("van ", "de ", "der ", "von ", "le ", "la ")):
        return s_clean[0].upper() + s_clean[1:]
    return s_clean


def _normalize_author_list(raw_authors: Any) -> list[str]:
    if not raw_authors:
        return []
    if isinstance(raw_authors, str):
        items = _split_raw_authors_str(raw_authors)
    elif isinstance(raw_authors, list):
        items = []
        for item in raw_authors:
            if isinstance(item, dict):
                last = _capitalize_surname(_clean_text(item.get("last_name") or ""))
                first = _clean_text(item.get("first_name") or item.get("initials") or "").rstrip(".")
                if last and first:
                    name = f"{last}, {first}."
                else:
                    name = item.get("name") or item.get("raw") or last or ""
                if name:
                    items.append(re.sub(r"\.{2,}", ".", str(name).strip()))
            elif hasattr(item, "raw") or hasattr(item, "last_name"):
                raw_attr = _clean_text(getattr(item, "raw", "") or "")
                last = _capitalize_surname(_clean_text(getattr(item, "last_name", "") or ""))
                first = _clean_text(getattr(item, "first_name", "") or getattr(item, "initials", "") or "").rstrip(".")
                if raw_attr and not raw_attr.islower():
                    name = raw_attr
                elif last and first:
                    name = f"{last}, {first}."
                else:
                    name = raw_attr or last
                if name:
                    items.append(re.sub(r"\.{2,}", ".", str(name).strip()))
            elif item:
                items.append(re.sub(r"\.{2,}", ".", str(item).strip()))
    else:
        return []
    return [a for a in items if a]


_CORPORATE_AUTHOR_RE = re.compile(
    r"(?:\b(?:quốc\s+hội|chính\s+phủ|thủ\s+tướng(?:\s+chính\s+phủ)?|"
    r"bộ\s+[\wÀ-ỹ]+|ủy\s+ban|uỷ\s+ban|tòa\s+án|toà\s+án|"
    r"viện\s+kiểm\s+sát|viện\s+hàn\s+lâm|viện\s+nghiên\s+cứu|ngân\s+hàng\s+nhà\s+nước|"
    r"tổng\s+cục|trường\s+đại\s+học|đại\s+học|học\s+viện|trung\s+tâm|ban\s+chấp\s+hành|đảng\s+cộng\s+sản|"
    r"hiệp\s+hội|liên\s+đoàn|tập\s+đoàn|công\s+ty|nhà\s+xuất\s+bản|"
    r"world\s+health\s+organization|united\s+nations|european\s+commission|world\s+bank|"
    r"ministry\s+of|national\s+institute|university|institute|institution|foundation|"
    r"association|organization|organisation|society|council|commission|committee|"
    r"department\s+of|agency|bureau|laboratory|labs|archive|consortium|corporation|"
    r"federation|press|library|crossref|openalex|unesco|unicef|oecd|asean|ieee|acm)\b)",
    re.IGNORECASE,
)


def _split_surname_initials(author_str: str) -> tuple[str, str]:
    """Return (Surname, Initials_With_Dots) for a single author string."""
    s = _clean_text(author_str).strip(".,;")
    if not s:
        return ("Unknown", "")
    if _CORPORATE_AUTHOR_RE.search(s):
        return (s, "")
    if "," in s:
        parts = [p.strip() for p in s.split(",", 1)]
        surname = _capitalize_surname(parts[0])
        given = parts[1] if len(parts) > 1 else ""
    else:
        tokens = s.split()
        if len(tokens) == 1:
            return (_capitalize_surname(tokens[0]), "")
        # Check if trailing token is uppercase initials like "Ackerman JD"
        if re.fullmatch(r"[A-Z]{1,3}", tokens[-1]) and len(tokens[0]) > 1:
            surname = _capitalize_surname(" ".join(tokens[:-1]))
            given = " ".join(list(tokens[-1]))
        else:
            surname = _capitalize_surname(tokens[-1])
            given = " ".join(tokens[:-1])

    initials: list[str] = []
    for tok in re.split(r"[\s.]+", given):
        tok = tok.strip()
        if tok and tok[0].isalpha():
            initials.append(f"{tok[0].upper()}.")
    return (surname, " ".join(initials))


def _format_authors_apa(authors: list[str]) -> str:
    if not authors:
        return "Anonymous"
    formatted: list[str] = []
    for a in authors[:20]:
        surname, inits = _split_surname_initials(a)
        formatted.append(f"{surname}, {inits}".strip(", "))
    if len(formatted) == 1:
        return formatted[0]
    if len(formatted) == 2:
        return f"{formatted[0]}, & {formatted[1]}"
    return ", ".join(formatted[:-1]) + f", & {formatted[-1]}"


def _format_authors_ieee(authors: list[str]) -> str:
    if not authors:
        return "Anonymous"
    if len(authors) > 6:
        surname, inits = _split_surname_initials(authors[0])
        first = f"{inits} {surname}".strip()
        return f"{first} et al."
    formatted: list[str] = []
    for a in authors:
        surname, inits = _split_surname_initials(a)
        formatted.append(f"{inits} {surname}".strip())
    if len(formatted) == 1:
        return formatted[0]
    if len(formatted) == 2:
        return f"{formatted[0]} and {formatted[1]}"
    return ", ".join(formatted[:-1]) + f", and {formatted[-1]}"


def _format_authors_tdtu(authors: list[str]) -> str:
    if not authors:
        return "Anonymous"
    formatted: list[str] = []
    for a in authors[:6]:
        surname, inits = _split_surname_initials(a)
        formatted.append(f"{surname}, {inits}".strip(", "))
    if len(authors) > 6:
        return f"{formatted[0]} et al."
    if len(formatted) == 1:
        return formatted[0]
    if len(formatted) == 2:
        return f"{formatted[0]} and {formatted[1]}"
    return ", ".join(formatted[:-1]) + f" and {formatted[-1]}"


def _make_bibtex_key(authors: list[str], year: str, title: str, index: int) -> str:
    surname = "ref"
    if authors:
        s, _ = _split_surname_initials(authors[0])
        s_ascii = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
        s_clean = re.sub(r"[^a-zA-Z0-9]", "", s_ascii).lower()
        if s_clean:
            surname = s_clean[:18]
    yr = year if year and year.isdigit() else "nd"
    first_word = "work"
    for w in re.findall(r"[A-Za-zÀ-ỹ]{4,}", title or ""):
        w_ascii = unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode("ascii")
        w_clean = re.sub(r"[^a-zA-Z0-9]", "", w_ascii).lower()
        if len(w_clean) >= 4 and w_clean not in {"with", "from", "that", "this", "using", "based", "study", "analysis"}:
            first_word = w_clean
            break
    return f"{surname}{yr}{first_word}{index}"


def format_canonical_entry(
    meta: dict[str, Any],
    index: int,
    style: str = "apa",
) -> dict[str, str]:
    """Render a canonical metadata dictionary into APA, IEEE, TDTU, BibTeX, and RIS."""
    title = _clean_text(meta.get("title")) or "Untitled Source"
    authors = _normalize_author_list(meta.get("authors"))
    year = _clean_text(meta.get("year")) or "n.d."
    venue = _clean_venue_str(meta.get("venue") or "")
    doi = _clean_text(meta.get("doi"))
    if doi.lower().startswith("https://doi.org/"):
        doi = doi[16:].strip()
    elif doi.lower().startswith("doi:"):
        doi = doi[4:].strip()
    url = _clean_text(meta.get("url"))

    # 1. APA 7th
    apa_authors = _format_authors_apa(authors)
    apa_parts = [f"{apa_authors} ({year}). {title.rstrip('.')}."]
    if venue:
        apa_parts.append(f"{venue.rstrip('.')}.")
    if doi:
        apa_parts.append(f"https://doi.org/{doi}")
    elif url:
        apa_parts.append(url)
    apa_str = " ".join(apa_parts)

    # 2. IEEE
    ieee_authors = _format_authors_ieee(authors)
    ieee_parts = [f"[{index}] {ieee_authors}, \"{title.rstrip('.')},\""]
    if venue:
        ieee_parts.append(f"{venue.rstrip('.')},")
    ieee_parts.append(f"{year}.")
    if doi:
        ieee_parts[-1] = f"{year}, doi: {doi}."
    elif url:
        ieee_parts.append(f"[Online]. Available: {url}")
    ieee_str = " ".join(ieee_parts)

    # 3. Harvard / TDTU Standard
    tdtu_authors = _format_authors_tdtu(authors)
    tdtu_parts = [f"{tdtu_authors} ({year}), '{title.rstrip('.')}'"]
    if venue:
        tdtu_parts.append(venue.rstrip("."))
    if doi:
        tdtu_parts.append(f"DOI: {doi}")
    elif url:
        tdtu_parts.append(f"URL: {url}")
    tdtu_str = ", ".join(tdtu_parts) + "."

    # 4. BibTeX
    bib_key = _make_bibtex_key(authors, year, title, index)
    if authors:
        bib_author_items: list[str] = []
        for a in authors:
            if _CORPORATE_AUTHOR_RE.search(a):
                bib_author_items.append(f"{{{a}}}")
            elif "," in a:
                s_part, g_part = a.split(",", 1)
                bib_author_items.append(f"{_capitalize_surname(s_part.strip())}, {g_part.strip()}")
            else:
                parts = a.split()
                if parts:
                    parts[-1] = _capitalize_surname(parts[-1])
                bib_author_items.append(" ".join(parts))
        bib_authors = " and ".join(bib_author_items)
    else:
        bib_authors = "Anonymous"
    bib_lines = [
        f"@article{{{bib_key},",
        f"  author = {{{bib_authors}}},",
        f"  title = {{{title}}},",
    ]
    if venue:
        bib_lines.append(f"  journal = {{{venue}}},")
    if year and year != "n.d.":
        bib_lines.append(f"  year = {{{year}}},")
    if doi:
        bib_lines.append(f"  doi = {{{doi}}},")
    if url:
        bib_lines.append(f"  url = {{{url}}},")
    bib_lines.append("}")
    bibtex_str = "\n".join(bib_lines)

    # 5. RIS
    ris_lines = [
        "TY  - JOUR",
        f"TI  - {title}",
    ]
    for a in (authors or ["Anonymous"]):
        surname, inits = _split_surname_initials(a)
        ris_lines.append(f"AU  - {surname}, {inits}".strip(", "))
    if year and year != "n.d.":
        ris_lines.append(f"PY  - {year}")
    if venue:
        ris_lines.append(f"JO  - {venue}")
    if doi:
        ris_lines.append(f"DO  - {doi}")
    if url:
        ris_lines.append(f"UR  - {url}")
    ris_lines.append("ER  - ")
    ris_str = "\n".join(ris_lines)

    by_style = {
        "apa": apa_str,
        "ieee": ieee_str,
        "tdtu": tdtu_str,
        "bibtex": bibtex_str,
        "ris": ris_str,
    }
    selected = by_style.get(style.lower(), apa_str)
    return {
        "remediated_text": selected,
        "apa": apa_str,
        "ieee": ieee_str,
        "tdtu": tdtu_str,
        "bibtex": bibtex_str,
        "ris": ris_str,
    }


def build_remediated_bibliography(
    essay_id: int,
    verdicts: list[Any],
    style: str = "apa",
    citations: list[Any] | None = None,
) -> dict[str, Any]:
    """Generate auto-remediated bibliography entries and diffs for an essay."""
    normalized_style = (style or "apa").strip().lower()
    if normalized_style not in {"apa", "ieee", "tdtu", "bibtex", "ris"}:
        normalized_style = "apa"

    entries: list[dict[str, Any]] = []
    remediated_count = 0
    hallucination_count = 0
    error_count = 0

    cit_by_raw: dict[str, Any] = {}
    if citations:
        for c in citations:
            c_raw = _clean_text(getattr(c, "raw_text", "") if not isinstance(c, dict) else c.get("raw_text", ""))
            if c_raw and c_raw not in cit_by_raw:
                cit_by_raw[c_raw] = c

    for idx, v in enumerate(verdicts, start=1):
        raw_text = _clean_text(getattr(v, "citation_raw", "") if not isinstance(v, dict) else v.get("citation_raw", ""))
        label = _clean_text(getattr(v, "label", "") if not isinstance(v, dict) else v.get("label", "")).lower()
        verdict_id = getattr(v, "id", idx) if not isinstance(v, dict) else v.get("citation_id", f"v{idx}")
        reasoning = _clean_text(getattr(v, "reasoning", "") if not isinstance(v, dict) else v.get("reasoning", ""))

        mismatched_raw = (
            getattr(v, "mismatched_fields", "")
            if not isinstance(v, dict)
            else v.get("mismatched_fields", [])
        )
        if isinstance(mismatched_raw, str):
            s_raw = mismatched_raw.strip()
            if s_raw.startswith("["):
                try:
                    parsed_mf = json.loads(s_raw)
                    mismatched_fields = (
                        [str(f).strip() for f in parsed_mf if str(f).strip()]
                        if isinstance(parsed_mf, list)
                        else []
                    )
                except (json.JSONDecodeError, TypeError):
                    mismatched_fields = []
            else:
                mismatched_fields = [f.strip() for f in s_raw.split(",") if f.strip()]
        elif isinstance(mismatched_raw, list):
            mismatched_fields = [str(f).strip() for f in mismatched_raw if str(f).strip()]
        else:
            mismatched_fields = []

        features_dict: dict[str, Any] = {}
        if isinstance(v, dict):
            features_dict = v.get("features") if isinstance(v.get("features"), dict) else {}
            matched_sources = v.get("matched_sources") or features_dict.get("matched_sources") or []
        else:
            try:
                features_dict = json.loads(getattr(v, "features", None) or "{}")
            except (json.JSONDecodeError, TypeError):
                features_dict = {}
            matched_sources = features_dict.get("matched_sources", [])

        fallback_meta = _extract_raw_fallback_metadata(raw_text)
        matched_cit = cit_by_raw.get(raw_text)
        if matched_cit is not None:
            c_title = _clean_text(getattr(matched_cit, "title", "") if not isinstance(matched_cit, dict) else matched_cit.get("title", ""))
            c_authors_raw = getattr(matched_cit, "authors", None) if not isinstance(matched_cit, dict) else matched_cit.get("authors")
            if isinstance(c_authors_raw, str) and c_authors_raw.strip().startswith("["):
                try:
                    c_authors_raw = json.loads(c_authors_raw)
                except (json.JSONDecodeError, TypeError):
                    pass
            c_authors = _normalize_author_list(c_authors_raw)
            c_year = _clean_text(getattr(matched_cit, "year", "") if not isinstance(matched_cit, dict) else matched_cit.get("year", ""))
            c_venue = _clean_venue_str(getattr(matched_cit, "venue", "") if not isinstance(matched_cit, dict) else matched_cit.get("venue", ""))
            c_doi = _clean_text(getattr(matched_cit, "doi", "") if not isinstance(matched_cit, dict) else matched_cit.get("doi", ""))
            c_url = _clean_text(getattr(matched_cit, "url", "") if not isinstance(matched_cit, dict) else matched_cit.get("url", ""))
            if c_authors and not fallback_meta["authors"]:
                fallback_meta["authors"] = c_authors
            if c_title and (not fallback_meta["title"] or len(c_title) < len(fallback_meta["title"])):
                fallback_meta["title"] = c_title
            if c_year and not fallback_meta["year"]:
                fallback_meta["year"] = c_year
            if c_venue and not fallback_meta["venue"]:
                fallback_meta["venue"] = c_venue
            if c_doi and not fallback_meta["doi"]:
                fallback_meta["doi"] = c_doi
            if c_url and not fallback_meta["url"]:
                fallback_meta["url"] = c_url
        canonical_meta = dict(fallback_meta)
        diff_fields: list[str] = list(mismatched_fields)
        source_used: str | None = None

        is_hallucination = label == "suspected_hallucination"
        is_metadata_error = label == "metadata_error"
        is_error = is_hallucination or is_metadata_error
        if is_hallucination:
            hallucination_count += 1
        if is_error:
            error_count += 1

        # Choose the highest-confidence found source candidate
        found_candidates = [
            s for s in matched_sources
            if isinstance(s, dict) and s.get("found", True) is not False and s.get("title")
        ]

        # Only apply candidate canonical metadata for verified or metadata_error entries
        # (Never overwrite suspected_hallucination, unresolved, or resource entries with external candidates)
        if found_candidates and label in ("verified", "metadata_error"):
            def _remediation_cand_rank(s: dict[str, Any]) -> tuple[int, float]:
                c_doi = _clean_text(s.get("doi")).lower()
                c_venue = _clean_text(s.get("venue")).lower()
                is_review = (
                    c_doi.startswith("10.5860/choice")
                    or "choice reviews" in c_venue
                    or "book review" in c_venue
                )
                return (0 if is_review else 1, float(s.get("score") or s.get("confidence") or 0.0))

            best = max(
                found_candidates,
                key=_remediation_cand_rank,
            )
            best_score = float(best.get("score") or best.get("confidence") or 0.0)
            best_source = str(best.get("source_name") or best.get("source") or "scholarly_db")
            title_sim = float(features_dict.get("title_sim_fuzzy") or 0.0)
            cand_doi_raw = _clean_text(best.get("doi"))
            cand_title_raw = _clean_text(best.get("title"))

            # Compute significant word overlap between raw title and candidate title
            t1_words = {
                w for w in re.findall(r"[a-zA-ZÀ-ỹ0-9]{3,}", fallback_meta["title"].lower())
                if w not in {"the", "and", "for", "with", "from", "into", "của", "trong", "các", "với"}
            }
            t2_words = {
                w for w in re.findall(r"[a-zA-ZÀ-ỹ0-9]{3,}", cand_title_raw.lower())
                if w not in {"the", "and", "for", "with", "from", "into", "của", "trong", "các", "với"}
            }
            token_overlap = (
                len(t1_words & t2_words) / max(1, min(len(t1_words), len(t2_words)))
                if (t1_words and t2_words)
                else 1.0
            )

            # Verify that the candidate refers to the same underlying work before overwriting fields
            doi_matches = bool(
                fallback_meta["doi"]
                and cand_doi_raw
                and fallback_meta["doi"].lower() == cand_doi_raw.lower()
            )
            is_same_work = (
                best_source in ("vn_legal_registry", "known_papers", "acl", "local_db")
                or doi_matches
                or token_overlap >= 0.70
                or ((title_sim >= 0.65 or best_score >= 0.65) and token_overlap >= 0.55)
            )
            if is_same_work:
                source_used = best_source
                cand_title = cand_title_raw
                cand_authors = _normalize_author_list(best.get("authors"))
                cand_year = _clean_text(best.get("year"))
                cand_venue = _clean_venue_str(best.get("venue") or "")
                cand_doi = cand_doi_raw

                if cand_title:
                    if is_metadata_error or not fallback_meta["title"]:
                        if fallback_meta["title"] and cand_title.lower() != fallback_meta["title"].lower():
                            if "title" not in diff_fields:
                                diff_fields.append("title")
                        canonical_meta["title"] = cand_title
                    elif label == "verified":
                        canonical_meta["title"] = cand_title

                if cand_authors:
                    cand_has_given = any(" " in a or "," in a for a in cand_authors)
                    fallback_has_given = any(" " in a or "," in a for a in fallback_meta["authors"])
                    has_author_mismatch = "authors" in diff_fields or "author" in diff_fields
                    should_replace_authors = (
                        not fallback_meta["authors"]
                        or has_author_mismatch
                        or best_source == "vn_legal_registry"
                        or (cand_has_given and (not fallback_has_given or "et al" in raw_text.lower() or len(cand_authors) > len(fallback_meta["authors"])))
                    )
                    if should_replace_authors:
                        if has_author_mismatch and "authors" not in diff_fields:
                            diff_fields.append("authors")
                        canonical_meta["authors"] = cand_authors

                if cand_year:
                    if fallback_meta["year"] and cand_year[:4] != fallback_meta["year"][:4]:
                        if is_metadata_error and "year" not in diff_fields:
                            diff_fields.append("year")
                    elif not fallback_meta["year"] and is_metadata_error:
                        if "year" not in diff_fields:
                            diff_fields.append("year")
                    if is_metadata_error or not fallback_meta["year"] or cand_year[:4] == fallback_meta["year"][:4]:
                        canonical_meta["year"] = cand_year[:4]

                if cand_venue:
                    if not fallback_meta["venue"] or "venue" in diff_fields:
                        if "venue" in diff_fields and "venue" not in diff_fields:
                            diff_fields.append("venue")
                        canonical_meta["venue"] = cand_venue
                    elif is_metadata_error or label == "verified":
                        canonical_meta["venue"] = cand_venue

                if cand_doi:
                    if not fallback_meta["doi"]:
                        if label in ("verified", "metadata_error") and "doi" not in diff_fields:
                            diff_fields.append("doi")
                    elif fallback_meta["doi"].lower() != cand_doi.lower():
                        if "doi" not in diff_fields:
                            diff_fields.append("doi")
                    canonical_meta["doi"] = cand_doi

        rendered = format_canonical_entry(canonical_meta, index=idx, style=normalized_style)

        if is_hallucination:
            was_modified = False
            remediation_status = "hallucination"
            warn_comment = (
                "% [CẢNH BÁO ĐỎ / SUSPECTED HALLUCINATION: Nguồn trích dẫn bịa đặt hoặc không tồn tại trong CSDL học thuật — Cần kiểm tra / loại bỏ]\n"
            )
            rendered["bibtex"] = warn_comment + rendered["bibtex"]
            rendered["ris"] = rendered["ris"].replace(
                "ER  - ",
                "N1  - [WARNING: SUSPECTED HALLUCINATION / UNVERIFIED SOURCE - REMOVE FROM MANUSCRIPT]\nER  - ",
            )
            if normalized_style == "bibtex":
                rendered["remediated_text"] = rendered["bibtex"]
            elif normalized_style == "ris":
                rendered["remediated_text"] = rendered["ris"]
        elif is_metadata_error:
            was_modified = True
            remediation_status = "repaired"
            remediated_count += 1
        elif label == "resource":
            was_modified = False
            remediation_status = "verified"
            diff_fields = []
        else:
            was_modified = bool(diff_fields)
            remediation_status = "repaired" if was_modified else "verified"
            if was_modified:
                remediated_count += 1

        entries.append(
            {
                "index": idx,
                "verdict_id": str(verdict_id),
                "label": label or "unresolved",
                "remediation_status": remediation_status,
                "is_error": is_error,
                "is_hallucination": is_hallucination,
                "reasoning": reasoning,
                "source_used": source_used,
                "original_raw": raw_text,
                "remediated_text": rendered["remediated_text"],
                "apa": rendered["apa"],
                "ieee": rendered["ieee"],
                "tdtu": rendered["tdtu"],
                "bibtex": rendered["bibtex"],
                "ris": rendered["ris"],
                "diff_fields": diff_fields,
                "was_modified": was_modified,
                "canonical_metadata": canonical_meta,
            }
        )

    combined_text = "\n\n".join(e["remediated_text"] for e in entries)
    combined_bibtex = "\n\n".join(e["bibtex"] for e in entries)
    combined_ris = "\n\n".join(e["ris"] for e in entries)

    return {
        "essay_id": essay_id,
        "style": normalized_style,
        "total_entries": len(entries),
        "remediated_count": remediated_count,
        "hallucination_count": hallucination_count,
        "error_count": error_count,
        "entries": entries,
        "combined_text": combined_text,
        "combined_bibtex": combined_bibtex,
        "combined_ris": combined_ris,
    }
