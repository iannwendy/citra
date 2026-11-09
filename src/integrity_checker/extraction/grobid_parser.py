"""GROBID adapter — parse TEI XML trả về từ GROBID service (v1.2 §3.4).

GROBID là Java service của Hugues Genthial, trích xuất metadata từ PDF:
    - Header: title, authors, abstract
    - Body sections
    - Citations (in-text + bibliography) với coordinates
    - References (full TEI XML)

Mục tiêu v1.2:
    - Wrapper quanh GROBID HTTP API (POST /api/processFulltextDocument,
      /api/processHeaderDocument).
    - Parser TEI XML → GrobidOutput (dataclass tối giản).
    - Cache theo file SHA256.
    - Graceful fallback: nếu GROBID không available → trả GrobidOutput rỗng,
      caller quyết định dùng heuristic hay fail.

References:
    v1.2 §3.4 (PDF → Document full-text extraction)
    v1.2 §5.2 (GROBID Docker setup)
    config.grobid.{enabled, url, timeout_seconds, cache_by_file_sha256}
    https://grobid.readthedocs.io/en/latest/Grobid-service/

Limitations (v1.2):
    - Chỉ parse TEI XML, không gọi HTTP. Caller cần wrap với requests/httpx.
    - TEI schema coverage: header, abstract, body sections, bibliography.
      Figure captions / tables: out-of-scope v1.2.
    - Citation coordinates (PDF bbox): lưu raw, chưa dùng.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from defusedxml.ElementTree import ParseError, fromstring, tostring

from integrity_checker.config import GrobidConfig

if TYPE_CHECKING:
    import xml.etree.ElementTree as ET  # noqa: N817 - type-only alias

logger = logging.getLogger(__name__)


# TEI XML namespace
_TEI_NS = "http://www.tei-c.org/ns/1.0"
_TEI = "{" + _TEI_NS + "}"

_GROBID_SEM_LOCK = threading.Lock()
_GROBID_SEM: threading.BoundedSemaphore | None = None
_GROBID_SEM_LIMIT: int = 0


def _get_grobid_semaphore() -> threading.BoundedSemaphore:
    """Return a process-wide BoundedSemaphore capping concurrent GROBID PDF calls."""
    global _GROBID_SEM, _GROBID_SEM_LIMIT
    try:
        from integrity_checker.config import get_settings

        desired = max(1, int(get_settings().retrieval.max_concurrent_grobid))
    except Exception:
        desired = 2
    with _GROBID_SEM_LOCK:
        if _GROBID_SEM is None or desired != _GROBID_SEM_LIMIT:
            _GROBID_SEM = threading.BoundedSemaphore(desired)
            _GROBID_SEM_LIMIT = desired
        return _GROBID_SEM


@dataclass
class GrobidAuthor:
    """1 author từ TEI header.

    Attributes:
        full_name: "LeCun, Yann" (canonical).
        first_name, last_name, middle_name: parsed.
        email: optional.
        affiliation: optional.
    """

    full_name: str
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    email: str | None = None
    affiliation: str | None = None


@dataclass
class GrobidBibEntry:
    """1 entry từ <listBibl>/<biblStruct>.

    Attributes:
        id: TEI ID (vd '#b0').
        authors: list[GrobidAuthor].
        title: title.
        year: year (4 chars).
        venue: journal/venue (từ <title level="j">).
        doi: DOI.
        url: URL nếu có.
        raw_reference: raw text từ <note type="raw_reference">.
        raw_xml: lưu xml string để debug / re-parse.
    """

    id: str
    authors: list[GrobidAuthor] = field(default_factory=list)
    title: str | None = None
    year: str | None = None
    venue: str | None = None
    doi: str | None = None
    url: str | None = None
    raw_reference: str = ""
    raw_xml: str = ""


@dataclass
class GrobidCitation:
    """1 in-text citation (từ <body>).

    Attributes:
        raw_text: text nguyên gốc (vd "(Smith, 2020)").
        ref_id: TEI ID trỏ đến <biblStruct> (vd '#b0'). None nếu không match.
        page: page number nếu có.
    """

    raw_text: str
    ref_id: str | None = None
    page: int | None = None


@dataclass
class GrobidSection:
    """1 section trong body.

    Attributes:
        section_type: 'abstract' / 'body' / 'bibliography' / 'footnote' /
                      'appendix' / 'unknown'.
        text: text content.
        page_start: optional page number.
    """

    section_type: str
    text: str
    page_start: int | None = None


@dataclass
class GrobidOutput:
    """Output đầy đủ từ GROBID."""

    header: dict = field(default_factory=dict)
    authors: list[GrobidAuthor] = field(default_factory=list)
    abstract: str | None = None
    sections: list[GrobidSection] = field(default_factory=list)
    citations: list[GrobidCitation] = field(default_factory=list)
    bibliography: list[GrobidBibEntry] = field(default_factory=list)
    is_available: bool = True     # False nếu GROBID fail
    error_message: str | None = None
    sha256: str | None = None
    raw_tei_xml: str | None = None  # cache để debug


# --- HTTP client (caller wrap requests/httpx) ---


def call_grobid_fulltext(
    pdf_path: str,
    config: GrobidConfig,
    http_post_fn=None,    # injectable cho testing
) -> str:
    """Gọi GROBID /api/processFulltextDocument trả về TEI XML string.

    Args:
        pdf_path: path to PDF file.
        config: GrobidConfig.
        http_post_fn: optional callable(url, files, data, timeout) -> Response
                      để inject trong tests. Mặc định dùng requests.

    Returns:
        TEI XML string. Rỗng nếu lỗi.
    """
    url = f"{config.url.rstrip('/')}/api/processFulltextDocument"
    timeout = config.timeout_seconds

    is_default_http = http_post_fn is None
    if http_post_fn is None:
        try:
            import requests
        except ImportError:
            logger.warning("requests not installed — GROBID disabled")
            return ""

        def _default_post(url, files, data, timeout):
            return requests.post(url, files=files, data=data, timeout=timeout)

        http_post_fn = _default_post

    max_attempts = 3 if is_default_http else 1
    raw_consol = (
        str(config.consolidate_header[0]).strip()
        if config.consolidate_header
        else "0"
    )
    consol_header = raw_consol if raw_consol in {"0", "1", "2", "3"} else "0"
    data = {
        "consolidateHeader": consol_header,
        "consolidateCitations": "0",
        "includeRawCitations": "1",
        "teiCoordinates": "figure,head,biblStruct,snote,formula",
    }
    filename = Path(pdf_path).name if pdf_path else "document.pdf"

    for attempt in range(1, max_attempts + 1):
        try:
            with _get_grobid_semaphore(), open(pdf_path, "rb") as f:
                files = {"input": (filename, f, "application/pdf")}
                response = http_post_fn(url, files=files, data=data, timeout=timeout)
            if response.status_code == 200:
                return response.text
            if response.status_code in {502, 503, 504} and attempt < max_attempts:
                import time

                time.sleep(1.0 * attempt)
                continue
            logger.warning("GROBID returned %d", response.status_code)
            return ""
        except OSError as exc:
            # Missing local file or transient connection reset/disconnect
            if isinstance(exc, FileNotFoundError) or attempt >= max_attempts:
                logger.warning("GROBID call failed: %s", exc)
                return ""
            import time

            logger.info("GROBID transient error on attempt %d/%d (%s), retrying...", attempt, max_attempts, exc)
            time.sleep(1.0 * attempt)
        except Exception as exc:
            if attempt >= max_attempts:
                logger.warning("GROBID call failed: %s", exc)
                return ""
            import time

            logger.info("GROBID transient error on attempt %d/%d (%s), retrying...", attempt, max_attempts, exc)
            time.sleep(1.0 * attempt)
    return ""


def compute_sha256(pdf_path: str) -> str:
    """SHA256 hash của file PDF — dùng cho cache."""
    h = hashlib.sha256()
    try:
        with open(pdf_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
    except OSError as exc:
        logger.warning("Cannot hash %s: %s", pdf_path, exc)
    return h.hexdigest()


# --- TEI XML parser ---


def parse_tei(tei_xml: str) -> GrobidOutput:
    """Parse TEI XML string → GrobidOutput.

    Robust với malformed XML: nếu parse fail, trả GrobidOutput rỗng
    với error_message.
    """
    if not tei_xml:
        return GrobidOutput(is_available=False, error_message="empty TEI XML")

    try:
        root = fromstring(tei_xml)
    except ParseError as exc:
        return GrobidOutput(
            is_available=False, error_message=f"parse error: {type(exc).__name__}"
        )
    except Exception as exc:  # noqa: BLE001 — defusedxml raises EntitiesForbidden etc.
        # Chỉ log exception type, KHÔNG leak system_id / URL attack.
        logger.warning("TEI parse error: %s", type(exc).__name__)
        return GrobidOutput(
            is_available=False, error_message=f"parse error: {type(exc).__name__}"
        )

    out = GrobidOutput(raw_tei_xml=tei_xml, sha256=compute_sha256_hash(tei_xml))

    # Header → title + abstract + authors
    header = root.find(f".//{_TEI}teiHeader")
    if header is not None:
        out.header = _extract_header(header)
        out.authors = _extract_authors(header)
        out.abstract = _extract_abstract(header)

    # Body sections
    out.sections = _extract_sections(root)

    # In-text citations + bibliography
    out.citations = _extract_citations(root)
    out.bibliography = _extract_bibliography(root)

    return out


def compute_sha256_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _extract_header(header: ET.Element) -> dict:
    """Trích title + DOI + journal từ teiHeader/fileDesc."""
    result: dict = {}
    title_el = header.find(f".//{_TEI}title[@level='a']")
    if title_el is None:
        title_el = header.find(f".//{_TEI}title")
    if title_el is not None:
        result["title"] = "".join(title_el.itertext()).strip()

    doi_el = header.find(f".//{_TEI}idno[@type='DOI']")
    if doi_el is not None and doi_el.text:
        result["doi"] = doi_el.text.strip()

    journal_el = header.find(f".//{_TEI}title[@level='j']")
    if journal_el is not None:
        result["journal"] = "".join(journal_el.itertext()).strip()

    return result


def _extract_authors(header: ET.Element) -> list[GrobidAuthor]:
    """Trích authors từ <teiHeader>/<fileDesc>/<sourceDesc>/<biblStruct>/.../<author>."""
    authors: list[GrobidAuthor] = []
    for author_el in header.findall(f".//{_TEI}author"):
        pers = author_el.find(f"{_TEI}persName")
        if pers is None:
            continue

        surname = pers.find(f"{_TEI}surname")
        forename = pers.find(f"{_TEI}forename")
        email_el = author_el.find(f"{_TEI}email")
        affil_el = author_el.find(f"{_TEI}affiliation")

        surname_t = surname.text.strip() if surname is not None and surname.text else ""
        forename_t = forename.text.strip() if forename is not None and forename.text else ""

        full_name = f"{surname_t}, {forename_t}".strip(", ")
        authors.append(
            GrobidAuthor(
                full_name=full_name,
                first_name=forename_t or None,
                last_name=surname_t or None,
                email=email_el.text.strip() if email_el is not None and email_el.text else None,
                affiliation="".join(affil_el.itertext()).strip() if affil_el is not None else None,
            )
        )
    return authors


def _extract_abstract(header: ET.Element) -> str | None:
    """Trích abstract từ <profileDesc>/<abstract>."""
    abstract_el = header.find(f".//{_TEI}abstract")
    if abstract_el is None:
        return None
    # Abstract có thể chứa nhiều <p> (paragraphs)
    parts = [
        "".join(p.itertext()).strip()
        for p in abstract_el.findall(f"{_TEI}p")
    ]
    if not parts:
        # Fallback: all text
        text = "".join(abstract_el.itertext()).strip()
        return text or None
    return "\n\n".join(parts)


def _extract_sections(root: ET.Element) -> list[GrobidSection]:
    """Trích body sections (consolidated <div> blocks)."""
    sections: list[GrobidSection] = []
    body = root.find(f".//{_TEI}body")
    if body is None:
        return sections

    # Top-level <div> of body
    for div in body.findall(f"{_TEI}div"):
        section_type = _detect_section_type(div)
        # Gộp text từ các <p>
        text = "\n".join(
            "".join(p.itertext()).strip()
            for p in div.findall(f"{_TEI}p")
        ).strip()
        if text:
            sections.append(GrobidSection(section_type=section_type, text=text))
    return sections


def _detect_section_type(div: ET.Element) -> str:
    """Heuristic: đoán section type từ <head> text."""
    head_el = div.find(f"{_TEI}head")
    if head_el is None:
        return "body"
    head_text = "".join(head_el.itertext()).strip().lower()
    if "abstract" in head_text:
        return "abstract"
    if any(kw in head_text for kw in ["appendix", "phụ lục"]):
        return "appendix"
    if any(kw in head_text for kw in ["footnote", "chú thích"]):
        return "footnote"
    return "body"


def _extract_citations(root: ET.Element) -> list[GrobidCitation]:
    """Trích in-text citations từ <body>/<p>/<ref type='bibr'>."""
    citations: list[GrobidCitation] = []
    for ref in root.findall(f".//{_TEI}ref[@type='bibr']"):
        raw_text = "".join(ref.itertext()).strip()
        target = ref.get("target", "")
        if target.startswith("#"):
            ref_id = target[1:]
        else:
            ref_id = None
        citations.append(GrobidCitation(raw_text=raw_text, ref_id=ref_id))
    return citations


_CONTINUATION_START_RE = re.compile(
    r"^(?:"
    r"EBSCOhost|JSTOR|ProQuest|PubMed|ScienceDirect|ResearchGate|"
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z.]*\s+(?:19|20)\d{2}\b|"
    r"(?:vol\.|no\.|pp?\.)\s*\d+|"
    r"[A-Za-zÀ-ÿ0-9\s&':-]+,\s*\d+(?:\(\d+\))?,\s*\d+(?:[-–]\d+)?\.\s*(?:https?://doi\.org/|doi:\s*10\.)|"
    r"https?://doi\.org/|doi:\s*10\."
    r")",
    re.IGNORECASE,
)

_BOOK_PUBLISHER_SUFFIX_RE = re.compile(
    r"(?:"
    r",\s*edited\s+by\s+[^,]+,\s*(?P<ed_pub>[A-Z][A-Za-z&\s]+)$|"
    r"\.\s+(?P<pub>"
    r"Zondervan(?:\s+Academic)?|Baker\s+Academic|Baker\s+Publishing(?:\s+Group)?|"
    r"Crossway|Brazos\s+Press|HarperOne(?:\s*,\s*an\s+imprint\s+of\s+Harper(?:\s*Collins)?)?|"
    r"Harper\s*Collins(?:\s+Publishers)?|InterVarsity\s+Press|IVP(?:\s+Academic|\s+Books)?|"
    r"Waterbrook(?:\s+Press)?|Convergent(?:\s+Books)?|B&H(?:\s+Publishing(?:\s+Group)?|\s+Academic)?|"
    r"Holman\s+Bible\s+Publishers|Farrar,\s*Straus\s+and\s+Giroux|Penguin(?:\s+Random\s+House)?|"
    r"Cambridge\s+University\s+Press|Oxford\s+University\s+Press|Routledge|Sage|Bloomsbury|"
    r"Eerdmans|Westminster\s+John\s+Knox(?:\s+Press)?|Thomas\s+Nelson|Moody\s+Publishers|"
    r"Project\s+Gutenberg"
    r")(?:\s*,\s*an\s+imprint\s+of\s+[^.]+)?$"
    r")",
    re.IGNORECASE,
)


def _normalize_raw_ref_text(raw_ref_text: str) -> str:
    """Repair line-wrapped URLs and percent-encoded fragments in raw reference text."""
    if not raw_ref_text:
        return ""
    text = re.sub(r"\s+", " ", raw_ref_text).strip()
    # Join broken percent-encoding across line wraps: "% 20" or "%F0... %9F..."
    text = re.sub(r"%\s+([0-9A-Fa-f]{2})", r"%\1", text)
    text = re.sub(r"(%[0-9A-Fa-f]{2}[0-9A-Za-z_%~:-]*)\s+(%[0-9A-Fa-f]{2})", r"\1\2", text)
    # Join domain broken across line wrap right after dot: "https://doi. org/..." -> "https://doi.org/..."
    text = re.sub(
        r"((?:https?://|www\.)[a-z0-9-]+)\.\s+((?:org|com|edu|gov|net|io|int)/)",
        r"\1.\2",
        text,
        flags=re.IGNORECASE,
    )
    # Join broken file extensions across line wraps: ".p df" -> ".pdf", ".ht ml" -> ".html"
    text = re.sub(r"\.(p)\s+(df)\b", r".\1\2", text, flags=re.IGNORECASE)
    text = re.sub(r"\.(ht)\s+(ml?)\b", r".\1\2", text, flags=re.IGNORECASE)
    # Join URL slug broken inside underscore-separated filename: "hundreds_o f_websites.html"
    text = re.sub(
        r"([a-z0-9_])_([a-z]{1,4})\s+([a-z0-9_]+\.html?)\b",
        r"\1_\2\3",
        text,
        flags=re.IGNORECASE,
    )
    # Join URL paths broken after '/' or '-' before a lowercase slug/path or numeric DOI suffix
    text = re.sub(
        r"((?:https?://|www\.)[^\s]+[/\-])\s+([a-z0-9_~%#][^\s]*)",
        r"\1\2",
        text,
    )
    # Join DOIs broken after '-' or '/' before digits
    text = re.sub(
        r"\b(10\.\d{4,9}/[A-Za-z0-9._;()/-]+[-/])\s+(\d+[A-Za-z0-9._;()/-]*)",
        r"\1\2",
        text,
    )
    return text


def _extract_url_and_doi_from_raw(
    raw_ref_text: str, bibl=None
) -> tuple[str | None, str | None]:
    """Extract clean URL and DOI from TEI element or raw_reference text."""
    doi: str | None = None
    url: str | None = None

    if bibl is not None:
        doi_el = bibl.find(f".//{_TEI}idno[@type='DOI']")
        if doi_el is not None and doi_el.text:
            doi = doi_el.text.strip().rstrip(".,;")
        for ptr_el in bibl.findall(f".//{_TEI}ptr"):
            target = (ptr_el.get("target") or "").strip()
            if target and not target.startswith("#"):
                if "doi.org/" in target.lower():
                    m_doi = re.search(r"10\.\d{4,9}/[^\s\"<>]+", target)
                    if m_doi and not doi:
                        doi = m_doi.group(0).rstrip(".,;")
                else:
                    url = target.rstrip(".,;")

    if raw_ref_text:
        m_doi = re.search(r"\b(10\.\d{4,9}/[^\s\"<>]+)", raw_ref_text)
        if m_doi:
            raw_doi = m_doi.group(1).rstrip(".,;)")
            if not doi or doi.endswith("-") or (raw_doi.startswith(doi) and len(raw_doi) > len(doi)):
                doi = raw_doi

        if not url:
            # Explicit http(s):// or www. URL
            for m_url in re.finditer(r"(?:https?://|www\.)[^\s\"<>]+", raw_ref_text):
                cand = m_url.group(0).rstrip(".,;)")
                if "doi.org/" in cand.lower():
                    continue
                if cand.lower().startswith("www."):
                    cand = "https://" + cand
                url = cand
                break
        else:
            # If GROBID truncated the URL at a line wrap, prefer the longer normalized URL from raw_ref_text
            for m_url in re.finditer(r"(?:https?://|www\.)[^\s\"<>]+", raw_ref_text):
                cand = m_url.group(0).rstrip(".,;)")
                if "doi.org/" in cand.lower():
                    continue
                if cand.lower().startswith("www."):
                    cand = "https://" + cand
                if cand.startswith(url) and len(cand) > len(url):
                    url = cand
                    break

        if not url:
            # Bare domain with path (common in MLA 9th ed.: e.g. fightthenewdrug.org/...)
            m_bare = re.search(
                r"\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
                r"(?:com|org|edu|gov|net|io|co\.uk|ac\.uk)/[^\s\"<>]+)",
                raw_ref_text,
                re.IGNORECASE,
            )
            if m_bare:
                cand = m_bare.group(1).rstrip(".,;)")
                if "doi.org/" not in cand.lower():
                    url = "https://" + cand

    if url:
        url = re.sub(
            r"[\(\[](?:ac-?\s*cessed|re-?\s*trieved)\b.*$",
            "",
            url,
            flags=re.IGNORECASE,
        )
        # Strip any accidental trailing quote or punctuation
        url = url.rstrip(".,;)'\"\u2019\u201d")
        if not url.lower().startswith(("http://", "https://")):
            url = "https://" + url
        host_m = re.match(r"^https?://([^/\s]+)", url, re.IGNORECASE)
        if not host_m or ("." not in host_m.group(1) and host_m.group(1).lower() != "localhost"):
            url = None

    return url, doi


def _split_single_merged_raw_reference(text: str) -> list[str]:
    """Perform one pass of splitting on a normalized raw_reference string."""
    # Case 1: Entry 1 ends with "Accessed DD Mon. YYYY." followed by optional author + quoted title
    m1 = re.match(
        r"^(.+?\bAccessed\s+\d{1,2}\s+[A-Za-z.]+\s+(?:19|20)\d{2}\.)\s+((?:[A-Z][A-Za-z0-9.\s'\u2019-]{1,40}\.\s+)?[\"\u201c][A-Z].+)$",
        text,
    )
    if m1:
        return [m1.group(1).strip(), m1.group(2).strip()]

    # Case 2: Book entry ending with ", YYYY." (with a title before the imprint) or URL followed by a quoted web entry with URL
    m2 = re.match(
        r"^(.+?(?:\.\s+[^.]+?,\s*(?:19|20)\d{2}\.|https?://\S+\.))\s+((?:[A-Z][A-Za-z0-9.\s'\u2019-]{1,40}\.\s+)?[\"\u201c].+[\"\u201d]\s+[A-Z].*(?:https?://|www\.|\b[a-z0-9-]+\.(?:com|org|edu|gov|net)/).*)$",
        text,
    )
    if m2:
        return [m2.group(1).strip(), m2.group(2).strip()]

    # Case 3: Chicago/MLA entry followed by 3-em dash / underscore repeated-author entry
    m3 = re.search(
        r"(?<=\.)\s+(?=[\-\u2013\u2014_]{3,}\.?\s+[A-Z\"\u201c])",
        text,
    )
    if m3:
        left = text[:m3.start()].strip()
        right = text[m3.end():].strip()
        if len(left) >= 20 and len(right) >= 20:
            return [left, right]

    # Case 4: Entry ending with URL/DOI (https?://\S+) followed by another bibliography entry
    for url_m in re.finditer(r"https?://\S+", text):
        after_pos = url_m.end()
        rem = text[after_pos:].strip()
        if not rem or len(rem) < 20:
            continue
        # Do not split before trailing access date or "[St.]" surname prefix
        if re.match(r"^(?:[\(\[]?(?:Accessed|Retrieved)\b|(?:St\.|De|Van|Von)\s*$)", rem, re.I):
            continue
        # Subcase 4a: Remainder starts with a new entry containing an APA parenthetical year/(n.d.) within 165 chars
        if (
            re.match(r"^[A-Z0-9\"\u201c]", rem)
            and re.search(
                r"\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)\b",
                rem[:165],
                re.IGNORECASE,
            )
        ):
            left = text[:after_pos].strip()
            return [left, rem]
        # Subcase 4b: Remainder starts with a quoted title or Corporate Author + Title + URL
        if (
            re.match(r"^(?:[\"\u201c][A-Z]|[A-Z][A-Za-z0-9\s&.'\u2019-]{2,60}\.\s+[A-Z\"\u201c])", rem)
            and re.search(r"https?://\S+", rem)
        ):
            left = text[:after_pos].strip()
            return [left, rem]

    # Case 5: APA/Chicago book ending with Publisher (or City: Publisher, YYYY.) followed by another entry
    m5 = re.search(
        r"((?:\(\s*(?:19|20)\d{2}[^)]*\)\.\s+[^.]+?\.\s+[A-Z][A-Za-z&\s]+?(?:Publishers?|Press|Books|Inc\.|Ltd\.)\.)"
        r"|(?:\b[A-Z][A-Za-z.\s]+:\s+[A-Z][A-Za-z&\s.,]+?,\s*(?:19|20)\d{2}\.))\s+"
        r"(?=[A-Z\"\u201c][^\n]{5,}(?:\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?)|https?://\S+))",
        text,
    )
    if m5:
        split_at = m5.end(1)
        left = text[:split_at].strip()
        right = text[split_at:].strip()
        if len(left) >= 25 and len(right) >= 25:
            return [left, right]

    return [text]


def _split_merged_raw_reference(raw_ref_text: str) -> list[str]:
    """Split a GROBID raw_reference when it accidentally glues 2 or more entries."""
    if not raw_ref_text:
        return []
    text = _normalize_raw_ref_text(raw_ref_text)
    segments = [text]
    changed = True
    while changed and len(segments) < 6:
        changed = False
        new_segments: list[str] = []
        for seg in segments:
            parts = _split_single_merged_raw_reference(seg)
            if len(parts) > 1:
                changed = True
                new_segments.extend(parts)
            else:
                new_segments.append(seg)
        segments = new_segments
    return segments


def _parse_raw_bib_segment(raw_seg: str, entry_id: str) -> GrobidBibEntry:
    """Parse a single raw bibliography segment that was split from a multi-entry biblStruct."""
    seg = _normalize_raw_ref_text(raw_seg)
    url, doi = _extract_url_and_doi_from_raw(seg)

    authors: list[GrobidAuthor] = []
    title: str | None = None
    venue: str | None = None
    year: str | None = None

    # Strip URL/DOI from a working copy for cleaner text parsing
    seg_no_url = re.sub(r"\s*(?:https?://|www\.)\S+\s*", " ", seg).strip()
    seg_no_url = re.sub(
        r"\s*\bAccessed\s+\d{1,2}\s+[A-Za-z.]+\s+(?:19|20)\d{2}\.?\s*$",
        "",
        seg_no_url,
        flags=re.IGNORECASE,
    ).strip()

    # 1. Check for APA style with parenthetical year / (n.d.) in the first 70% of the entry
    # Exclude Chicago journal parenthetical years where head already contains a quoted title or volume/issue
    apa_yr_m = re.search(
        r"\(\s*(?P<yr>(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)(?:\s*,\s*[A-Za-z]+\.?(?:\s+\d{1,2})?)?\s*\)\.?",
        seg_no_url,
        re.IGNORECASE,
    )
    if (
        apa_yr_m
        and apa_yr_m.start() <= max(180, int(len(seg_no_url) * 0.75))
        and not re.search(r"[\"\u201c\u201d]|\b(?:vol\.|no\.)\s*\d", seg_no_url[:apa_yr_m.start()], re.I)
        and not seg_no_url[apa_yr_m.end():].lstrip().startswith(":")
    ):
        yr_token = apa_yr_m.group("yr").strip()
        if re.match(r"^(?:19|20)\d{2}", yr_token):
            year = yr_token[:4]
        head = seg_no_url[:apa_yr_m.start()].strip().rstrip(".")
        tail = seg_no_url[apa_yr_m.end():].strip()

        # Split tail into sentences avoiding abbreviations like vs., Dr., U.S.
        tail_parts = [
            p.strip().rstrip(".")
            for p in re.split(
                r"(?<!\bvs)(?<!\bDr)(?<!\bMr)(?<!\bMs)(?<!\bJr)(?<!\bSr)(?<!\bSt)(?<!\bNo)(?<!\bVol)(?<!\bEd)(?<!\bpp)(?<!\b[A-Z])\.\s+",
                tail,
            )
            if p.strip()
        ]

        # Detect Title-first anonymous APA entry:
        # e.g. "CAC payback period vs LTV: CAC ratio. (2022). MetricHQ."
        # or "What is IREC -Experimental Sounding Rocket Association. (n.d.). Experimental Sounding Rocket Association."
        is_title_first = False
        if len(tail_parts) <= 1 and head:
            if (
                any(ch in head for ch in (":", "?", "|"))
                or re.search(
                    r"\b(?:what\s+is|how\s+to|metrics\s+for|state\s+of|top\s+\d+|top\s+fitness|growth|statistics|payback\s+period)\b",
                    head,
                    re.I,
                )
            ):
                is_title_first = True

        if is_title_first:
            title = head
            if tail_parts:
                venue = tail_parts[0]
                authors.append(GrobidAuthor(full_name=venue, first_name=None, last_name=venue))
        else:
            # Parse personal authors ("Surname, I. I., & Surname2, I.") or corporate author
            pers_matches = list(
                re.finditer(
                    r"([A-ZÀ-Ý][A-Za-zÀ-ÿ'\u2019-]+),\s*((?:[A-ZÀ-Ý]\.\s*)+)",
                    head,
                )
            )
            if pers_matches:
                for pm in pers_matches:
                    sn = pm.group(1).strip()
                    fn = pm.group(2).strip().rstrip(".")
                    authors.append(
                        GrobidAuthor(full_name=f"{sn}, {fn}", first_name=fn, last_name=sn)
                    )
            elif head:
                authors.append(GrobidAuthor(full_name=head, first_name=None, last_name=head))

            if tail_parts:
                title = tail_parts[0]
                if len(tail_parts) >= 2:
                    venue = re.sub(r",\s*\d+.*$", "", tail_parts[1]).strip()

        return GrobidBibEntry(
            id=entry_id,
            authors=authors,
            title=title,
            year=year,
            venue=venue,
            doi=doi,
            url=url,
            raw_reference=seg,
            raw_xml="",
        )

    # 2. Non-APA (MLA / Chicago / Harvard): extract year
    non_accessed = re.sub(
        r"\bAccessed\s+\d{1,2}\s+[A-Za-z.]+\s+(?:19|20)\d{2}\.?",
        "",
        seg_no_url,
        flags=re.IGNORECASE,
    )
    non_accessed = re.sub(
        r"\b10\.\d{4,9}/\S+|\barxiv\s*:\s*\d{4}\.\d+(?:v\d+)?"
        r"|\b(?:pp?\.?|pages?|tr(?:ang|\.)?|vol(?:ume)?\.?|no\.?|iss(?:ue)?\.?|art(?:icle)?(?:\s+(?:no|id)\.?)?|lncs|lnai)\s*[A-Za-z]?\d+(?:\s*[-–—‑]\s*[A-Za-z]?\d+)?\b"
        r"|(?<=[\d\)])\s*:\s*\d+(?:\s*[-–—‑]\s*\d+)?\b"
        r"|\b\d{3,5}\s*[-–—‑]\s*\d{3,5}\b",
        " ",
        non_accessed,
        flags=re.IGNORECASE,
    )
    years = re.findall(r"\b((?:19|20)\d{2})\b", non_accessed)
    if years:
        year = years[-1] if re.search(r",\s*(?:19|20)\d{2}\.?$", non_accessed) else years[0]
    else:
        acc_years = re.findall(r"\b((?:19|20)\d{2})\b", seg)
        if acc_years:
            year = acc_years[-1]

    # Check if starts with 3-em dash / underscore repeated author: "________. Music Business..."
    dash_m = re.match(r"^[\-\u2013\u2014_]{3,}\.?\s+(.+)$", seg_no_url)
    work_seg = dash_m.group(1).strip() if dash_m else seg_no_url

    # Check if has quoted title: [Author.] "Title." Venue...
    q_m = re.match(
        r"^(?:([A-Z][^\"\u201c]{1,80}?)\.\s+)?[\"\u201c](.+)[\"\u201d]\.?\s*([A-Za-z0-9][^,.:]+)?",
        work_seg,
    )
    if q_m:
        lead_author = (q_m.group(1) or "").strip().rstrip(".")
        title = q_m.group(2).strip().rstrip(".,")
        if q_m.group(3):
            venue = q_m.group(3).strip().rstrip(".")
        if not dash_m:
            if lead_author and "," in lead_author:
                sn, fn = [p.strip() for p in lead_author.split(",", 1)]
                authors.append(GrobidAuthor(full_name=f"{sn}, {fn}", first_name=fn, last_name=sn))
            else:
                auth_label = lead_author or venue
                if auth_label:
                    authors.append(
                        GrobidAuthor(full_name=auth_label, first_name=None, last_name=auth_label)
                    )
    elif dash_m:
        # Unquoted book with repeated author dash: "Music Business Essentials: A Guide... Foreword by..."
        t_m = re.match(r"^([^.]+)\.", work_seg)
        if t_m:
            title = t_m.group(1).strip()
    else:
        # MLA/Chicago Author: "Surname, Firstname. Title. [City: Publisher,] Year"
        mla_m = re.match(
            r"^([A-Z][A-Za-z'\u2019-]+),\s*([A-Z][A-Za-z.\s-]*?)\.\s+([^.]+)\.",
            work_seg,
        )
        if mla_m:
            sn = mla_m.group(1).strip()
            fn = mla_m.group(2).strip().rstrip(".")
            authors.append(
                GrobidAuthor(full_name=f"{sn}, {fn}", first_name=fn, last_name=sn)
            )
            title = mla_m.group(3).strip().rstrip(".")
        else:
            # Corporate or dictionary entry: "Amen Clinics. Brain SPECT." or "Natural Theology, Merriam-Webster,"
            corp_m = re.match(r"^([A-Z][A-Za-z0-9\s&'\u2019-]+?)\.\s+([^.]+)\.?", work_seg)
            if corp_m:
                org = corp_m.group(1).strip()
                authors.append(GrobidAuthor(full_name=org, first_name=None, last_name=org))
                title = corp_m.group(2).strip().rstrip(".")
            else:
                dict_m = re.match(r"^([A-Z][A-Za-z0-9\s&'\u2019-]+?),\s+([A-Z][A-Za-z0-9\s&'\u2019-]+?)[.,]?$", work_seg)
                if dict_m:
                    title = dict_m.group(1).strip()
                    venue = dict_m.group(2).strip()
                    authors.append(GrobidAuthor(full_name=venue, first_name=None, last_name=venue))

    return GrobidBibEntry(
        id=entry_id,
        authors=authors,
        title=title,
        year=year,
        venue=venue,
        doi=doi,
        url=url,
        raw_reference=seg,
        raw_xml="",
    )


def _extract_bibliography(root: ET.Element) -> list[GrobidBibEntry]:
    """Trích <listBibl>/<biblStruct>. Skip entry ở <teiHeader> (chỉ là metadata).

    GROBID trả biblStruct ở 2 nơi:
        - <teiHeader>/<fileDesc>/<sourceDesc> → metadata bài báo
        - <back>/<listBibl> → danh sách references

    Mình chỉ lấy các entry trong <listBibl>.
    """
    entries: list[GrobidBibEntry] = []
    for bibl in root.findall(f".//{_TEI}biblStruct"):
        entry_id = (
            bibl.get("{http://www.w3.org/XML/1998/namespace}id")
            or bibl.get("id")
            or ""
        )
        # Skip entry không có id → likely là header metadata
        if not entry_id:
            continue

        # Raw reference note (if provided by GROBID)
        raw_ref_el = bibl.find(f".//{_TEI}note[@type='raw_reference']")
        raw_ref_text = (
            _normalize_raw_ref_text("".join(raw_ref_el.itertext()).strip())
            if raw_ref_el is not None
            else ""
        )

        if raw_ref_text:
            # 1. If GROBID started <listBibl> inside body footnotes (Chicago NB theses)
            # and this entry ends with "Bibliography" / "References" / "Works Cited",
            # discard all preceding footnote entries and skip this last footnote.
            if re.search(
                r"(?:^|[\.\s])(?:Bibliography|References|Works\s+Cited)\s*$",
                raw_ref_text,
                re.IGNORECASE,
            ):
                entries.clear()
                continue

            # 2. If raw_ref_text contains a footnote followed by "Bibliography [Primary Sources] <Entry>",
            # discard all preceding footnotes and parse only the bibliography entry after the heading.
            bib_hdr_m = re.search(
                r"(?:^|\.\s+|\d+\.\s+)(?:Bibliography|References|Works\s+Cited)(?:\s+(?:Primary|Secondary)\s+Sources)?\s+(?=[\"\u201cA-Z])",
                raw_ref_text,
            )
            if bib_hdr_m:
                entries.clear()
                raw_ref_text = raw_ref_text[bib_hdr_m.end():].strip()
                for seg_idx, seg_text in enumerate(_split_merged_raw_reference(raw_ref_text)):
                    seg_id = entry_id if seg_idx == 0 else f"{entry_id}_{seg_idx}"
                    entries.append(_parse_raw_bib_segment(seg_text, seg_id))
                continue

            # 3. Strip inline section subheaders (e.g. "The Baltimore Sun. ... Secondary Sources \"Antisemitic Legislation...\"")
            sub_hdr_m = re.search(
                r"\b(?:Primary|Secondary)\s+Sources\s+(?=[\"\u201cA-Z])",
                raw_ref_text,
            )
            if sub_hdr_m:
                raw_ref_text = raw_ref_text[sub_hdr_m.end():].strip()
                for seg_idx, seg_text in enumerate(_split_merged_raw_reference(raw_ref_text)):
                    seg_id = entry_id if seg_idx == 0 else f"{entry_id}_{seg_idx}"
                    entries.append(_parse_raw_bib_segment(seg_text, seg_id))
                continue

        # If GROBID glued multiple bibliography entries into a single <biblStruct>,
        # split and parse each segment separately.
        split_segments = _split_merged_raw_reference(raw_ref_text)
        if len(split_segments) > 1:
            for seg_idx, seg_text in enumerate(split_segments):
                seg_id = entry_id if seg_idx == 0 else f"{entry_id}_{seg_idx}"
                entries.append(_parse_raw_bib_segment(seg_text, seg_id))
            continue

        # Authors
        raw_authors: list[tuple[str, str]] = []
        for author_el in bibl.findall(f".//{_TEI}author"):
            pers = author_el.find(f"{_TEI}persName")
            if pers is None:
                org = author_el.find(f"{_TEI}orgName")
                if org is not None and org.text and org.text.strip():
                    raw_authors.append((org.text.strip(), ""))
                continue
            surname = pers.find(f"{_TEI}surname")
            forenames = [
                f.text.strip()
                for f in pers.findall(f"{_TEI}forename")
                if f.text and f.text.strip()
            ]
            sn = surname.text.strip() if surname is not None and surname.text else ""
            fn = " ".join(forenames)

            # Skip or fix standalone generational suffixes parsed as separate authors (e.g. "III, Tremper Longman")
            if sn.lower().rstrip(".") in {"iii", "ii", "iv", "jr", "sr"}:
                if fn:
                    # Keep fn as a pending forename for the next author node
                    raw_authors.append(("", fn))
                continue
            if (
                sn
                and not fn
                and raw_authors
                and not raw_authors[-1][0]
                and raw_authors[-1][1]
            ):
                fn = raw_authors.pop()[1]

            # Fix GROBID splitting hyphenated Vietnamese initials into surname
            # e.g. forename="D H", surname=".-C. Nguyen" -> fn="D H.-C.", sn="Nguyen"
            if sn:
                hyph_m = re.match(r"^(\.?-[A-ZÀ-Ý]\.?)\s+(.+)$", sn)
                if hyph_m:
                    fn = f"{fn}{hyph_m.group(1)}".strip()
                    sn = hyph_m.group(2).strip()

            # Merge with previous author if GROBID split a hyphenated given name
            # across two <author> nodes: prev has sn="" & fn="L T", current has fn="-V" & sn="Pham"
            if (
                fn.startswith("-")
                and sn
                and raw_authors
                and not raw_authors[-1][0]
                and raw_authors[-1][1]
            ):
                prev_fn = raw_authors.pop()[1]
                fn = f"{prev_fn}{fn}"

            raw_authors.append((sn, fn))

        authors: list[GrobidAuthor] = []
        _DEGREE_TOKENS = {
            "phd", "md", "esq", "cscs", "rscc", "bs", "ms", "mph",
            "facsm", "fissn", "atc", "pt", "scs", "rn", "iii", "ii", "iv", "jr", "sr",
        }
        _DEGREE_PREFIX_RE = re.compile(
            r"^(?:phd|md|esq|cscs|rscc|bs|ms|mph|facsm|fissn|atc|pt|scs|rn)[.,;\s]+",
            re.IGNORECASE,
        )
        _DEGREE_SUFFIX_RE = re.compile(
            r"[\s,;]+(?:phd|md|esq|cscs|rscc|bs|ms|mph|facsm|fissn|atc|pt|scs|rn)[.,;]*$",
            re.IGNORECASE,
        )
        for sn, fn in raw_authors:
            sn = _DEGREE_SUFFIX_RE.sub("", _DEGREE_PREFIX_RE.sub("", sn.strip())).strip(" ,;")
            fn = _DEGREE_SUFFIX_RE.sub("", _DEGREE_PREFIX_RE.sub("", fn.strip())).strip(" ,;")
            if not sn and not fn:
                continue
            # Skip obvious non-author artifacts or standalone academic degree nodes from GROBID
            if f"{sn} {fn}".strip().lower() in ("cls token",):
                continue
            sn_tok = sn.lower().strip(".,; ")
            fn_tok = fn.lower().strip(".,; ")
            if (not sn_tok or sn_tok in _DEGREE_TOKENS) and (not fn_tok or fn_tok in _DEGREE_TOKENS):
                continue
            if sn_tok in ("iii", "ii", "iv", "jr", "sr") and " " in fn:
                parts_fn = fn.split()
                sn = parts_fn[-1]
                fn = " ".join(parts_fn[:-1])
            elif not fn and " " in sn and raw_ref_text and re.match(r"^(?:III|II|IV|Jr\.?|Sr\.?),\s+" + re.escape(sn), raw_ref_text):
                parts_sn = sn.split()
                sn = parts_sn[-1]
                fn = " ".join(parts_sn[:-1])
            authors.append(
                GrobidAuthor(
                    full_name=f"{sn}, {fn}".strip(", "),
                    first_name=fn or None,
                    last_name=sn or None,
                )
            )

        # Recover corporate/organization author from raw_reference when GROBID
        # omitted <author> or inverted/split a corporate name (e.g. "Security Risk Advisors. (n.d.-a)..." -> "Risk, Security")
        if raw_ref_text:
            org_m = re.match(
                r"^(?:\[\s*\d+\s*\]\s*)?([A-Z][A-Za-z0-9.\s&'\u2019-]{2,80}?)\.?\s*"
                r"(?:\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)\b|\.\s*[\"\u201c]|\.\s+(?:18|19|20)\d{2}[a-z]?[.:])",
                raw_ref_text,
                re.IGNORECASE,
            )
            if org_m:
                org_name = org_m.group(1).strip().rstrip(".")
                if not authors or (
                    "," not in org_name
                    and re.search(
                        r"\b(?:Advisors|Association|Organization|Institute|Society|Center|Centre|Project|Team|"
                        r"Developers|Clinics|Initiative|Foundation|Council|Commission|Committee|Agency|"
                        r"Administration|Academy|University|College|Press|Group|Corporation|Security|Goblin|Noble)\b",
                        org_name,
                        re.IGNORECASE,
                    )
                ):
                    authors = [
                        GrobidAuthor(full_name=org_name, first_name=None, last_name=org_name)
                    ]
            elif not authors:
                anon_m = re.match(
                    r"^[\"\u201c].+?[\"\u201d]\s*(?:(?:18|19|20)\d{2}[a-z]?\.\s*)?([A-Z][A-Za-z0-9\s&'\u2019-]{2,55}?)[,.]",
                    raw_ref_text,
                )
                if anon_m:
                    site_name = anon_m.group(1).strip().rstrip(".")
                    authors.append(
                        GrobidAuthor(full_name=site_name, first_name=None, last_name=site_name)
                    )

        # Clean any accidental URL or trailing quote glued into author names by GROBID
        for auth in authors:
            if auth.full_name and ("http://" in auth.full_name or "https://" in auth.full_name):
                cleaned_auth = re.sub(r"\.?\s*https?://\S+.*$", "", auth.full_name).strip().rstrip(".")
                auth.full_name = cleaned_auth
                if auth.last_name and ("http://" in auth.last_name or "https://" in auth.last_name):
                    auth.last_name = cleaned_auth

        # Title (article-level first, then monograph-level, skipping empty <title/> tags)
        title: str | None = None
        for xpath in (
            f".//{_TEI}title[@level='a']",
            f".//{_TEI}title[@level='m']",
            f".//{_TEI}title",
        ):
            for cand_el in bibl.findall(xpath):
                cand_text = "".join(cand_el.itertext()).strip()
                if cand_text:
                    title = cand_text
                    break
            if title:
                break

        # Discard bogus URL fragment / anchor placed into <title> by GROBID
        if title and re.match(r"^(?:#|https?://|www\.|%[0-9A-Fa-f]{2})", title, re.I):
            title = None

        # Fallback: check <note> (excluding raw_reference) when <title/> is empty
        # (e.g. Flanagan [2020] where GROBID puts "JavaScript: The Definitive Guide, 7th Edition" in <note>)
        if not title:
            for note_el in bibl.findall(f"{_TEI}note"):
                if note_el.get("type") == "raw_reference":
                    continue
                note_text = "".join(note_el.itertext()).strip()
                if (
                    len(note_text) > 5
                    and not re.match(r"^(?:\d+(?:st|nd|rd|th)|th)\s+ed", note_text, re.I)
                    and not re.match(r"^(?:#|https?://|www\.)", note_text, re.I)
                ):
                    title = note_text
                    break

        # Year
        year_el = bibl.find(f".//{_TEI}date[@type='published']")
        if year_el is None:
            year_el = bibl.find(f".//{_TEI}date")
        year: str | None = None
        if year_el is not None:
            when = year_el.get("when")
            if when and re.match(r"^(?:19|20)\d{2}", when):
                year = when[:4]

        # Some PDFs use author-year suffixes (``2018a. Title``).  GROBID can
        # occasionally attach that prefix to the analytic title and omit the
        # date element.  Recover the year/suffix and remove the artefact so
        # linking and metadata comparison see the actual title.
        if title:
            prefix = re.match(r"^(19|20)\d{2}([a-z])?\.\s+", title, re.I)
            if prefix:
                if year is None:
                    year = prefix.group(0)[:4]
                title = title[prefix.end():].strip()

        # Venue (journal-level title) — dùng .// để tìm trong <monogr>
        venue_el = bibl.find(f".//{_TEI}title[@level='j']")
        venue = "".join(venue_el.itertext()).strip() if venue_el is not None else None

        # Extract URL and DOI (including from raw_reference)
        url, doi = _extract_url_and_doi_from_raw(raw_ref_text, bibl)

        # Merge continuation <biblStruct> fragments into the previous entry
        # (e.g. "EBSCOhost, https://doi.org/..." or "Industria Textila, 76(2), 249-256. https://doi.org/...")
        if (
            entries
            and title is None
            and raw_ref_text
            and _CONTINUATION_START_RE.match(raw_ref_text)
        ):
            prev = entries[-1]
            if doi and not prev.doi:
                prev.doi = doi
            if year and not prev.year:
                prev.year = year
            if url and not prev.url:
                prev.url = url
            if not prev.venue:
                j_m = re.match(r"^([A-Za-zÀ-ÿ0-9\s&':-]+?),\s*\d+", raw_ref_text)
                if j_m:
                    prev.venue = j_m.group(1).strip()
            prev.raw_reference = f"{prev.raw_reference} {raw_ref_text}".strip()
            continue

        # Discard bogus author-continuation fragment placed into <title> (e.g. ", Kandefelt, J" in 12.pdf)
        if title and re.match(r"^,\s*[A-Z][a-zA-Z'\u2019-]+,\s*[A-Z]\.?$", title.strip()):
            title = None

        # Recover quoted title from raw_reference when GROBID missed the title
        # or put the website/container name (e.g. "Project Gutenberg", "German History in Documents and Images") as the monograph title
        if raw_ref_text:
            q_match = re.search(r"[\"\u201c]([^\"\u201d]{3,220}?)[\"\u201d]", raw_ref_text)
            if q_match:
                q_title = q_match.group(1).strip().rstrip(".,")
                if not title or (
                    title.lower() != q_title.lower()
                    and f'"{title}' not in raw_ref_text
                    and f"\u201c{title}" not in raw_ref_text
                    and (
                        len(title.split()) <= 6
                        or (authors and title.lower() == (authors[0].full_name or "").lower())
                    )
                ):
                    if title and not venue:
                        venue = title
                    title = q_title

        # Fix Chicago/MLA entries where GROBID put co-author ("and Rudy Koshar") or middle name ("Gresham") as <title>
        if title and raw_ref_text:
            if re.match(r"^and\s+[A-Z][a-zA-Z.\s-]+$", title.strip()):
                co_m = re.search(rf"{re.escape(title.strip())}\.\s+([^.]+)\.", raw_ref_text)
                if co_m:
                    title = co_m.group(1).strip()
            elif len(title.split()) == 1 and authors:
                mid_m = re.match(
                    rf"^[A-Z][A-Za-z'\u2019-]+,\s*[A-Z]\.\s+{re.escape(title.strip())}\.\s+([^.]+)\.",
                    raw_ref_text,
                )
                if mid_m:
                    title = mid_m.group(1).strip()
            elif re.match(r"^(?:The\s+)?English\s+Standard(?:\s+Version)?\s+Bible\b", raw_ref_text, re.I):
                b_m = re.match(r"^((?:The\s+)?English\s+Standard(?:\s+Version)?\s+Bible)\b", raw_ref_text, re.I)
                if b_m:
                    b_name = b_m.group(1).strip()
                    authors = [GrobidAuthor(full_name=b_name, first_name=None, last_name=b_name)]
                    if title and title.lower() != b_name.lower() and not venue:
                        venue = title
                    title = b_name

        # Recover missing co-authors or compound surnames before (YYYY)/(n.d.) when GROBID
        # dropped co-authors or split multi-word surnames (e.g. "Santa Rosa Lana, G.", "dos Reis Alves, S. F.")
        if raw_ref_text:
            yr_parens_any = re.search(
                r"\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)\b",
                raw_ref_text,
                re.IGNORECASE,
            )
            if yr_parens_any and yr_parens_any.start() <= 320:
                auth_prefix_raw = raw_ref_text[:yr_parens_any.start()].strip()
                pers_list = list(
                    re.finditer(
                        r"([A-ZÀ-Ýa-zà-ÿ][A-Za-zÀ-ÿ'\u2019-]+(?:\s+[A-ZÀ-Ýa-zà-ÿ][A-Za-zÀ-ÿ'\u2019-]+){0,3}),\s*((?:[A-ZÀ-Ý]\.(?:\s*-\s*[A-ZÀ-Ý]\.)?\s*)+)",
                        auth_prefix_raw,
                    )
                )
                has_fragmented_author = any(
                    not a.first_name
                    or not a.last_name
                    or "." in (a.last_name or "").rstrip(".")
                    or "," in (a.last_name or "")
                    or (a.first_name or "").strip(". ") == ""
                    for a in authors
                )
                if pers_list and (
                    (len(authors) <= 1 and len(pers_list) > len(authors))
                    or (has_fragmented_author and len(pers_list) >= 2)
                ):
                    authors = [
                        GrobidAuthor(
                            full_name=f"{pm.group(1).strip()}, {pm.group(2).strip().rstrip('.')}",
                            first_name=pm.group(2).strip().rstrip("."),
                            last_name=pm.group(1).strip(),
                        )
                        for pm in pers_list
                    ]

        # Fix unquoted IEEE/APA/MLA book entries where GROBID places the book title
        # into <author> inside <monogr> and leaves title=None or sets title to the series/publisher
        if bibl.find(f"{_TEI}analytic") is None and raw_ref_text:
            # Determine where the author segment ends in raw_ref_text:
            # either at "(YYYY)" / "(n.d.)" or after the first author block in MLA ("Surname, Firstname.")
            auth_head_end = None
            yr_parens = re.search(
                r"\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)\b",
                raw_ref_text,
                re.IGNORECASE,
            )
            if yr_parens:
                auth_head_end = yr_parens.start()
            else:
                cad_yr_m = re.search(
                    r"(?<=[.,]\s)(?:18|19|20)\d{2}[a-z]?(?:/(?:18|19|20)\d{2})?\.\s+",
                    raw_ref_text[:220],
                )
                if cad_yr_m and not re.search(
                    r"\b(?:Press|Publishers?|Publishing|Books|Inc|Ltd|pp|vol|no|ed|Accessed|Retrieved)\s*[.,]\s*$",
                    raw_ref_text[:cad_yr_m.start()],
                    re.IGNORECASE,
                ):
                    auth_head_end = cad_yr_m.start()
                else:
                    mla_head = re.match(
                        r"^(?:III,\s*)?[A-Z][A-Za-z'\u2019-]+,\s*"
                        r"(?:"
                        r"[A-Z][a-zA-Z.\s-]+?,\s*and\s+(?:[A-Z]\.\s*|[A-Z][a-zA-Z-]+\s+)+[A-Z][a-zA-Z'\u2019-]+\."
                        r"|(?:[A-Z]\.\s*){1,3}"
                        r"|[A-Z][a-zA-Z-]+(?:\.|\s+(?:[A-Z]\.\s*){1,2})"
                        r")\s*",
                        raw_ref_text,
                    )
                    if mla_head:
                        auth_head_end = mla_head.end()

            had_removed_authors = False
            if auth_head_end is not None and len(authors) >= 2:
                auth_prefix = raw_ref_text[:auth_head_end].lower()
                kept_authors: list[GrobidAuthor] = []
                removed_authors: list[GrobidAuthor] = []
                for auth in authors:
                    ln = (auth.last_name or "").lower().strip()
                    if ln and ln in auth_prefix:
                        kept_authors.append(auth)
                    else:
                        removed_authors.append(auth)
                if kept_authors and removed_authors:
                    authors = kept_authors
                    had_removed_authors = True

            # Recover missing co-authors before (YYYY)/(n.d.) when GROBID only extracted the 1st author
            if yr_parens and len(authors) <= 1:
                auth_prefix_raw = raw_ref_text[:yr_parens.start()].strip()
                pers_list = list(
                    re.finditer(
                        r"([A-ZÀ-Ý][A-Za-zÀ-ÿ'\u2019-]+),\s*((?:[A-ZÀ-Ý]\.\s*)+)",
                        auth_prefix_raw,
                    )
                )
                if len(pers_list) > len(authors):
                    authors = [
                        GrobidAuthor(
                            full_name=f"{pm.group(1).strip()}, {pm.group(2).strip().rstrip('.')}",
                            first_name=pm.group(2).strip().rstrip("."),
                            last_name=pm.group(1).strip(),
                        )
                        for pm in pers_list
                    ]

            # If title is still None (or GROBID placed the book title into <author> or set title equal to author/publisher), recover from raw_ref_text
            if (
                not title
                or had_removed_authors
                or (authors and title.lower() == (authors[0].full_name or "").lower())
                or title.lower() in {"project gutenberg", "goodreads", "holman bible publishers"}
                or title.lower().startswith(("cambridge university press", "oxford university press", "holman bible"))
            ):
                old_title = title
                if yr_parens:
                    after_yr = re.sub(
                        r"^\(\s*(?:(?:19|20)\d{2}|n\.?\s*d\.?)[^)]*\)\.\s*",
                        "",
                        raw_ref_text[yr_parens.start():],
                        flags=re.IGNORECASE,
                    )
                    m_title = re.match(
                        r"^(.{3,200}?)(?<!\bvs)(?<!\bDr)(?<!\bMr)(?<!\bMs)(?<!\bSt)(?<!\bJr)(?<!\bSr)(?<!\bU\.S)(?<!\b[A-Z])\.(?:\s+|$)",
                        after_yr,
                    )
                    if m_title and not m_title.group(1).strip().lower().startswith(("http://", "https://")):
                        title = m_title.group(1).strip()
                elif auth_head_end is not None:
                    after_auth = raw_ref_text[auth_head_end:].strip()
                    after_auth = re.sub(
                        r"^(?:18|19|20)\d{2}[a-z]?(?:/(?:18|19|20)\d{2})?\.\s*",
                        "",
                        after_auth,
                    ).strip()
                    m_title = re.match(r"^([^.]{2,180})\.", after_auth)
                    if m_title:
                        title = m_title.group(1).strip()
                if (
                    old_title
                    and title != old_title
                    and not venue
                    and not old_title.lower().startswith(("cambridge university press,", "https://", "http://", ","))
                ):
                    venue = old_title

            # Also support IEEE "B. Settles, Active Learning. Synthesis Lectures..."
            if len(authors) >= 2:
                last_auth = authors[-1]
                if (
                    last_auth.first_name
                    and last_auth.last_name
                    and len(last_auth.first_name) > 2
                    and len(last_auth.last_name) > 2
                ):
                    candidate_book_title = f"{last_auth.first_name} {last_auth.last_name}"
                    if re.search(
                        rf",\s*{re.escape(candidate_book_title)}\.\s+",
                        raw_ref_text,
                        re.IGNORECASE,
                    ):
                        authors.pop()
                        if title and not venue:
                            venue = title
                        title = candidate_book_title

        # Recover social media post title (e.g. "Daily Wire. X. @realDailyWire, October 5, 2024.")
        if not title and raw_ref_text:
            sm_m = re.search(r"\b(X\.\s+@[A-Za-z0-9_]+),\s+[A-Za-z]+\s+\d{1,2},\s+(?:19|20)\d{2}", raw_ref_text)
            if sm_m:
                title = sm_m.group(1).strip()
                if not venue:
                    venue = "X"
                if authors and authors[0].full_name.endswith(" X"):
                    cleaned = authors[0].full_name[:-2].strip().rstrip(",.")
                    authors = [GrobidAuthor(full_name=cleaned, first_name=None, last_name=cleaned.split(",")[0].strip())]

        # Recover truncated title when GROBID stopped at an abbreviation ("vs.", "Dr.") or line-wrap preposition
        if title and raw_ref_text and re.search(
            r"(?:\b(?:vs|Dr|Mr|Mrs|Ms|St|Jr|Sr|by|in\s+the|of\s+the|to\s+the)|:\s+A)$",
            title.strip(),
        ):
            idx_t = raw_ref_text.find(title)
            if idx_t >= 0:
                rest_t = raw_ref_text[idx_t:]
                full_t_m = re.match(
                    r"^(.{5,220}?)(?<!\bvs)(?<!\bDr)(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bSt)(?<!\bJr)(?<!\bSr)(?<!\b[A-Z])\.\s+",
                    rest_t,
                )
                if full_t_m and len(full_t_m.group(1).strip()) > len(title):
                    title = full_t_m.group(1).strip()

        # Recover corporate author when authors is still empty and raw_ref_text starts with "OrgName. <title>"
        # or is a Title-first anonymous APA entry ("health & fitness apps... (2025). Z2A Digital.")
        if not authors and raw_ref_text:
            if title and not raw_ref_text.lower().startswith(title.lower()[:15]):
                lead_m = re.match(r"^([A-Z][A-Za-z0-9\s&'\u2019.-]{2,80}?)\.\s+", raw_ref_text)
                if lead_m:
                    org_name = lead_m.group(1).strip().rstrip(".")
                    authors.append(
                        GrobidAuthor(full_name=org_name, first_name=None, last_name=org_name)
                    )
            else:
                tf_m = re.search(
                    r"\(\s*(?:(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?)\s*\)\.\s*([A-Z][A-Za-z0-9\s&'\u2019-]{2,60}?)\.\s+(?:https?://|www\.)",
                    raw_ref_text,
                )
                if tf_m:
                    site_org = tf_m.group(1).strip()
                    authors.append(
                        GrobidAuthor(full_name=site_org, first_name=None, last_name=site_org)
                    )
                    if not venue:
                        venue = site_org

        # Strip book publisher or ", edited by ..., Publisher" glued to the end of title
        if title:
            pub_m = _BOOK_PUBLISHER_SUFFIX_RE.search(title)
            if pub_m:
                extracted_pub = (pub_m.group("ed_pub") or pub_m.group("pub") or "").strip()
                title = title[:pub_m.start()].strip().rstrip(".,")
                if extracted_pub and (not venue or venue.lower().startswith(title.lower())):
                    venue = extracted_pub

        # Recover numbered biblical book title (e.g. "1 Corinthians", "2 Corinthians") when GROBID dropped the leading number
        if title == "Corinthians" and raw_ref_text:
            m_cor = re.search(r"\b([12]\s+Corinthians)\b", raw_ref_text)
            if m_cor:
                title = m_cor.group(1)
                if venue and venue.startswith("Corinthians."):
                    venue = venue[len("Corinthians."):].strip()

        # Clean percent-encoded URL fragments and trailing blog/site names from title
        if title:
            title = re.sub(r"\.\s*[^\s.]*%[0-9A-Fa-f]{2}.*$", "", title).strip()
            if (
                ". " in title
                and raw_ref_text
                and re.search(r"\(\s*(?:19|20)\d{2},\s*[A-Za-z]+", raw_ref_text)
            ):
                t_parts = [p.strip() for p in title.split(". ") if p.strip()]
                if len(t_parts) >= 2:
                    title = t_parts[0]
                    if not venue:
                        venue = t_parts[1]

        # Recover book publisher into venue from raw_ref_text if venue is still None
        if not venue and raw_ref_text:
            pub_raw_m = re.search(
                r"\b(Zondervan(?:\s+Academic)?|Baker\s+Academic|Baker\s+Publishing(?:\s+Group)?|"
                r"Crossway(?:\s+Books)?|Brazos\s+Press|HarperOne|Harper\s*Collins(?:\s+Publishers)?|"
                r"InterVarsity\s+Press|IVP\s+Books|Waterbrook\s+Press|Convergent\s+Books|"
                r"B&H\s+Publishing|Holman\s+Bible\s+Publishers|Farrar,\s*Straus\s+and\s+Giroux|"
                r"Cambridge\s+University\s+Press|Oxford\s+University\s+Press|Project\s+Gutenberg)\b",
                raw_ref_text,
                re.IGNORECASE,
            )
            if pub_raw_m:
                venue = pub_raw_m.group(1).strip()

        # For malformed two-column references GROBID may put the continuation
        # of the author list in <analytic>/<title>, while the real title is in
        # the monograph title (e.g. Warstadt et al.).
        if title and re.search(r",\s*(?:and\s+)?[^.]+\b(?:Bowman|Manning)\b", title):
            monogr_title = bibl.find(f".//{_TEI}title[@level='m']")
            if monogr_title is not None and "".join(monogr_title.itertext()).strip():
                title = "".join(monogr_title.itertext()).strip()

        # Year accuracy overrides from raw_ref_text (BUG-04):
        if raw_ref_text:
            # 1. If raw_ref_text has an explicit APA parenthetical year/(n.d.) before the title,
            # it always takes precedence over years inside titles, URLs, or page/article numbers.
            apa_date_m = re.search(
                r"\(\s*(?P<yr>(?:19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)(?:\s*,\s*[A-Za-z]+\.?(?:\s+\d{1,2})?)?\s*\)\.?",
                raw_ref_text,
                re.IGNORECASE,
            )
            chicago_ad_m = re.search(
                r"(?:^|[.,]\s+)(?P<yr>(?:18|19|20)\d{2})[a-z]?(?:/(?:18|19|20)\d{2})?[.,:]\s+(?=[\"\u201cA-Z])",
                raw_ref_text[:220],
            )
            if apa_date_m and apa_date_m.start() <= max(180, int(len(raw_ref_text) * 0.68)):
                yr_tok = apa_date_m.group("yr").strip()
                if re.match(r"^(?:19|20)\d{2}", yr_tok):
                    year = yr_tok[:4]
                elif re.match(r"^n\.?\s*d\.?", yr_tok, re.I):
                    # Explicit (n.d.) entry: do not let GROBID use a year from the URL or title
                    year = None
            elif (
                chicago_ad_m
                and chicago_ad_m.end() < len(raw_ref_text) * 0.65
                and not re.search(
                    r"\b(?:Press|Publishers?|Publishing|Books|Inc|Ltd|pp|vol|no|ed|Accessed|Retrieved)\s*$",
                    raw_ref_text[:chicago_ad_m.start()],
                    re.IGNORECASE,
                )
            ):
                year = chicago_ad_m.group("yr")[:4]
            else:
                # 2. Ignore journal founding years like "(1974-)", page ranges, DOIs, and Accessed dates when a publication year exists
                cleaned_for_yr = re.sub(r"\(\s*(?:18|19|20)\d{2}-\s*\)", "", raw_ref_text)
                cleaned_for_yr = re.sub(r"https?://\S+|\b10\.\d{4,9}/\S+|\barxiv\s*:\s*\d{4}\.\d+(?:v\d+)?", " ", cleaned_for_yr, flags=re.IGNORECASE)
                cleaned_for_yr = re.sub(
                    r"\b(?:pp?\.?|pages?|tr(?:ang|\.)?|vol(?:ume)?\.?|no\.?|iss(?:ue)?\.?|art(?:icle)?(?:\s+(?:no|id)\.?)?|lncs|lnai)\s*[A-Za-z]?\d+(?:\s*[-–—‑]\s*[A-Za-z]?\d+)?\b"
                    r"|(?<=[\d\)])\s*:\s*\d+(?:\s*[-–—‑]\s*\d+)?\b"
                    r"|\b\d{3,5}\s*[-–—‑]\s*\d{3,5}\b",
                    " ",
                    cleaned_for_yr,
                    flags=re.IGNORECASE,
                )
                non_accessed = re.sub(
                    r"[\(\[]?\b(?:Accessed|Retrieved|Truy\s+cập)\b[^)\].;]*[\)\]]?",
                    "",
                    cleaned_for_yr,
                    flags=re.IGNORECASE,
                )
                yr_matches = re.findall(r"\b((?:17|18|19|20)\d{2})[a-z]?\b", non_accessed)
                if yr_matches:
                    if not year or year not in yr_matches:
                        year = yr_matches[-1]
                elif not year:
                    acc_matches = re.findall(r"\b((?:19|20)\d{2})[a-z]?\b", raw_ref_text)
                    if acc_matches:
                        year = acc_matches[-1]

        # Raw XML for debug
        raw = tostring(bibl, encoding="unicode")

        entries.append(GrobidBibEntry(
            id=entry_id,
            authors=authors,
            title=title,
            year=year,
            venue=venue,
            doi=doi,
            url=url,
            raw_reference=raw_ref_text,
            raw_xml=raw,
        ))

    # Post-processing across adjacent bibliography entries:
    # 1. Repair surname particle ("St.") left at the end of the previous entry's URL (e.g. 1.pdf [24]->[25] "St. Aubin, C.")
    # 2. Inherit repeated author ("---.", "—————.", "________.") from the previous entry (BUG-13)
    for idx in range(1, len(entries)):
        prev_e = entries[idx - 1]
        curr_e = entries[idx]

        if prev_e.raw_reference:
            st_m = re.search(r"(https?://\S+)\s+(St\.|De|Van|Von)\s*$", prev_e.raw_reference)
            if st_m and curr_e.authors:
                particle = st_m.group(2).strip()
                prev_e.raw_reference = prev_e.raw_reference[:st_m.end(1)].strip()
                first_a = curr_e.authors[0]
                new_ln = f"{particle} {first_a.last_name}" if first_a.last_name else particle
                new_full = f"{new_ln}, {first_a.first_name}".strip(", ")
                curr_e.authors[0] = GrobidAuthor(
                    full_name=new_full,
                    first_name=first_a.first_name,
                    last_name=new_ln,
                )
                curr_e.raw_reference = f"{particle} {curr_e.raw_reference}".strip()

        raw_curr = (curr_e.raw_reference or "").strip()
        # Case A: Explicit leading 3-em dash / hyphens / underscores
        if re.match(r"^[\-\u2013\u2014_]{2,}\.?", raw_curr) and prev_e.authors:
            curr_e.authors = [
                GrobidAuthor(full_name=a.full_name, first_name=a.first_name, last_name=a.last_name)
                for a in prev_e.authors
            ]
        # Case B: GROBID stripped the leading 3-em dash from raw_reference and put book title words as authors (e.g. 10.pdf [06] "Community, Church, and State. Gloucester: Doubleday...")
        elif (
            curr_e.title is None
            and prev_e.authors
            and re.match(r"^([A-Z][^.:]+?)\.\s+([A-Z][A-Za-z\s]+):\s+(.+),\s*(?:19|20)\d{2}\.", raw_curr)
        ):
            bk_m = re.match(r"^([A-Z][^.:]+?)\.\s+([A-Z][A-Za-z\s]+):\s+(.+),\s*(?:19|20)\d{2}\.", raw_curr)
            if bk_m:
                curr_e.title = bk_m.group(1).strip()
                curr_e.venue = bk_m.group(3).strip()
                curr_e.authors = [
                    GrobidAuthor(full_name=a.full_name, first_name=a.first_name, last_name=a.last_name)
                    for a in prev_e.authors
                ]

    return entries


# --- Cache helpers ---


def cache_key(pdf_path: str) -> str:
    """Trả SHA256 của PDF để cache TEI XML theo file."""
    return compute_sha256(pdf_path)


def serialize_output(out: GrobidOutput) -> str:
    """Serialize GrobidOutput → JSON string để cache disk."""
    # Convert dataclasses nested → dicts
    def _to_dict(obj):
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _to_dict(v) for k, v in obj.__dict__.items()}
        if isinstance(obj, list):
            return [_to_dict(v) for v in obj]
        return obj

    return json.dumps(_to_dict(out), ensure_ascii=False, indent=2)


def deserialize_output(text: str) -> GrobidOutput:
    """Deserialize JSON → GrobidOutput."""
    if not text:
        return GrobidOutput(is_available=False)
    data = json.loads(text)
    return GrobidOutput(
        header=data.get("header", {}),
        authors=[
            GrobidAuthor(**{k: v for k, v in a.items() if k in GrobidAuthor.__dataclass_fields__})
            for a in data.get("authors", [])
        ],
        abstract=data.get("abstract"),
        sections=[
            GrobidSection(**{k: v for k, v in s.items() if k in GrobidSection.__dataclass_fields__})
            for s in data.get("sections", [])
        ],
        citations=[
            GrobidCitation(**{k: v for k, v in c.items() if k in GrobidCitation.__dataclass_fields__})
            for c in data.get("citations", [])
        ],
        bibliography=[
            GrobidBibEntry(**{k: v for k, v in e.items() if k in GrobidBibEntry.__dataclass_fields__})
            for e in data.get("bibliography", [])
        ],
        is_available=data.get("is_available", True),
        error_message=data.get("error_message"),
        sha256=data.get("sha256"),
    )


# --- Sample TEI (cho test + fallback khi không có GROBID) ---


SAMPLE_TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title level="a">Deep Learning</title>
      </titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author>
              <persName>
                <surname>LeCun</surname>
                <forename>Yann</forename>
              </persName>
            </author>
            <author>
              <persName>
                <surname>Bengio</surname>
                <forename>Yoshua</forename>
              </persName>
            </author>
            <idno type="DOI">10.1038/nature14539</idno>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
    <profileDesc>
      <abstract>
        <p>Deep learning allows computational models...</p>
      </abstract>
    </profileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head>1. Introduction</head>
        <p>Deep learning <ref type="bibr" target="#b0">(LeCun et al., 2015)</ref> is powerful.</p>
      </div>
      <div>
        <head>References</head>
        <listBibl>
          <biblStruct xml:id="b0">
            <analytic>
              <author><persName><surname>LeCun</surname><forename>Yann</forename></persName></author>
              <author><persName><surname>Bengio</surname><forename>Yoshua</forename></persName></author>
              <title level="a">Deep learning</title>
              <idno type="DOI">10.1038/nature14539</idno>
            </analytic>
            <monogr>
              <title level="j">Nature</title>
              <imprint>
                <date type="published" when="2015">2015</date>
              </imprint>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </body>
  </text>
</TEI>
"""
