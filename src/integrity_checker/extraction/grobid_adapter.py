"""GROBID Adapter — chuyển GrobidOutput → Citation[] với provenance + TEI link mapping.

Module này thực hiện:
    1. Map GrobidBibEntry → Citation[] (bibliography entries)
    2. Map GrobidCitation → Citation[] (in-text citations với TEI ref_id)
    3. Build grobid_ref_id → Citation map cho downstream linking
    4. Merge GROBID + regex extraction, deduplicate, track conflicts

Architecture (theo docs/plans/grobid-adapter.md):
    GROBID = structured extraction chính: metadata, sections, references, links
    PyMuPDF = text layer, page number, coordinates
    Regex = style evidence, citation bổ sung, validation, fallback

API:
    grobid_to_references(output) → list[Citation]
    grobid_to_in_text_citations(output) → list[Citation]
    build_grobid_id_map(citations) → dict[str, Citation]
    merge_extraction_results(grobid, regex, *, document_text="") → MergeResult

References:
    docs/plans/grobid-adapter.md (v1.6 — triển khai 2026-10-01)
    grobid_parser.py (GrobidOutput data model)
    models/citation.py (Citation data model)
    config.py (GrobidConfig)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from integrity_checker.extraction.grobid_parser import (
    GrobidBibEntry,
    GrobidCitation,
    GrobidOutput,
)

if TYPE_CHECKING:
    from integrity_checker.models.citation import Citation

logger = logging.getLogger(__name__)

# ===========================================================================
# Data Models
# ===========================================================================


@dataclass
class ProvenanceInfo:
    """Provenance tracking cho merged extraction results.

    Attributes:
        source: 'grobid' | 'regex' | 'pymupdf' | 'merged'
        source_confidence: 0.0-1.0 confidence của nguồn này
        grobid_ref_id: TEI xml:id nếu có (vd 'b0', 'b1')
        is_grobid_linked: True nếu citation có TEI link đến bibliography
        conflict_fields: list các fields bị conflict giữa GROBID và regex
    """

    source: str = "regex"
    source_confidence: float | None = None
    grobid_ref_id: str | None = None
    is_grobid_linked: bool = False
    conflict_fields: list[str] = field(default_factory=list)


@dataclass
class MergeResult:
    """Kết quả merge GROBID + regex extraction.

    Attributes:
        references: list merged Citation[] (bibliography entries)
        body_citations: list merged Citation[] (in-text citations)
        provenance_map: dict mapping citation raw_text → ProvenanceInfo
        conflicts: list các conflict được phát hiện
        grobid_used: True nếu GROBID được dùng
        grobid_fallback: True nếu chỉ dùng regex (GROBID unavailable/fail)
        statistics: dict với merge statistics
    """

    references: list = field(default_factory=list)
    body_citations: list = field(default_factory=list)
    provenance_map: dict = field(default_factory=dict)
    conflicts: list = field(default_factory=list)
    grobid_used: bool = False
    grobid_fallback: bool = False
    statistics: dict = field(default_factory=dict)


# ===========================================================================
# Bibliography: GrobidBibEntry → Citation
# ===========================================================================


def grobid_to_references(output: GrobidOutput) -> list:
    """Chuyển GrobidOutput.bibliography → list[Citation] (reference list entries).

    Mỗi GrobidBibEntry được chuyển thành Citation với:
        - Structured metadata: authors, year, title, venue, doi
        - Provenance: source='grobid', source_confidence cao (0.85-0.95)
        - grobid_ref_id: TEI xml:id (vd 'b0', 'b1')
        - raw_text: human-readable từ structured fields

    Args:
        output: GrobidOutput đã parse từ TEI XML

    Returns:
        list[Citation] — mỗi entry là một reference trong bibliography
    """

    citations: list[Citation] = []

    if not output or not output.is_available:
        return citations

    for idx, bib in enumerate(output.bibliography, start=1):
        citation = _grobid_bib_to_citation(bib, idx)
        citations.append(citation)

    return citations


def _grobid_bib_to_citation(bib: GrobidBibEntry, order_index: int) -> Citation:
    """Map 1 GrobidBibEntry → Citation với provenance info.

    Handles:
        - Author parsing từ GrobidAuthor[]
        - Year extraction với year_suffix support (2020a, 2020b)
        - Title cleanup (remove year prefix artefact từ GROBID)
        - Venue/DOI/volume/issue/pages extraction
        - Provenance tracking
    """
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    # Authors
    authors_raw = [a.full_name for a in bib.authors if a.full_name]

    # Year: extract year và year_suffix
    year = bib.year
    year_suffix = None
    if year and len(year) > 4:
        year_suffix = year[4:]
        year = year[:4]
    raw_ref_str = getattr(bib, "raw_reference", "") or ""
    if not year_suffix and raw_ref_str:
        suf_m = re.search(
            r"\(\s*(?:(?:19|20)\d{2}|n\.?\s*d\.?)-?([a-z])\b",
            raw_ref_str,
            re.IGNORECASE,
        )
        if suf_m:
            year_suffix = suf_m.group(1).lower()

    # Title: GROBID sometimes attaches year prefix to title
    # e.g. "2018a. Actual Title Here" → "Actual Title Here"
    title = bib.title
    if title:
        # Remove year prefix pattern: "2018. Title" or "2018a. Title"
        prefix_match = re.match(r"^(19|20)\d{2}[a-z]?\.\s+", title)
        if prefix_match:
            title = title[prefix_match.end():].strip()
        if not year:
            suffix_yr_m = re.search(
                r",\s*((?:19|20)\d{2})([a-z])?\.?$",
                title.strip(),
            )
            if suffix_yr_m:
                year = suffix_yr_m.group(1)
                if suffix_yr_m.group(2) and not year_suffix:
                    year_suffix = suffix_yr_m.group(2)
                title = title.strip()[: suffix_yr_m.start()].strip()

    venue = bib.venue
    if (
        title
        and venue
        and len(venue.strip()) >= 8
        and (
            re.match(r"^[,;\s]*(?:&\s*|and\b)", title.strip(), re.IGNORECASE)
            or re.match(r"^[-–.,;\s]*[A-Za-z]{1,3}\.?$", title.strip())
            or len(title.strip(" -–.,;:")) < 4
        )
    ):
        title = venue.strip()
        venue = None
    elif venue and title and venue.strip().rstrip(".,").lower() == title.strip().rstrip(".,").lower():
        venue = None

    url = getattr(bib, "url", None)
    if title and not re.match(r"^(?:https?://|www\.)", title.strip(), re.IGNORECASE):
        trailing_url_m = re.search(r"\s+(https?://\S+)\s*$", title.strip(), re.IGNORECASE)
        if trailing_url_m:
            if not url:
                url = trailing_url_m.group(1)
            title = title.strip()[: trailing_url_m.start()].strip().rstrip(".,;")
    if url:
        url = re.sub(r"[\(\[](?:ac-?\s*cessed|re-?\s*trieved)\b.*$", "", url, flags=re.IGNORECASE).rstrip(".,;)'\"\u2019\u201d")
        host_m = re.match(r"^https?://([^/\s]+)", url, re.IGNORECASE)
        if not host_m or "." not in host_m.group(1):
            url = None
    if not year and url:
        arxiv_yr_m = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{2})\d{2}\.\d{4,5}", url, re.IGNORECASE)
        if arxiv_yr_m:
            yy = int(arxiv_yr_m.group(1))
            year = f"20{yy:02d}" if yy <= 35 else f"19{yy:02d}"

    if not title and url:
        slug = url.rstrip("/").split("/")[-1].strip()
        if len(slug) >= 3:
            title = slug

    # Build human-readable raw_text từ structured fields
    raw_parts = []
    if authors_raw:
        raw_parts.append(", ".join(authors_raw))
    if year:
        suffix_str = year_suffix if year_suffix else ""
        slash_yr_m = (
            re.search(rf"\b({re.escape(year)}/(?:18|19|20)\d{{2}}|(?:18|19|20)\d{{2}}/{re.escape(year)})\b", raw_ref_str)
            if raw_ref_str
            else None
        )
        if slash_yr_m:
            raw_parts.append(f"({slash_yr_m.group(1)}{suffix_str})")
        else:
            raw_parts.append(f"({year}{suffix_str})")
    if title:
        raw_parts.append(title)
    if venue:
        raw_parts.append(venue)
    if bib.doi:
        raw_parts.append(f"DOI: {bib.doi}")
    if url:
        raw_parts.append(url)
    raw_text = " ".join(raw_parts) if raw_parts else title or raw_ref_str or ""
    if len(raw_text) < 35 and len(raw_ref_str) > len(raw_text):
        raw_text = raw_ref_str

    # Estimate confidence based on field completeness
    confidence = _estimate_bib_confidence(bib, authors_raw, title, year, bib.doi)

    # Create Citation with provenance stored in matched_pattern (backward compat)
    # NOTE: In Phase 2, we add provenance fields directly to Citation model
    c = Citation(
        raw_text=raw_text,
        citation_type=CitationType.REFERENCE_LIST,
        # GROBID bibliography is typically APA-like
        style=CitationStyle.APA,
        authors=authors_raw,
        year=year,
        title=title,
        venue=venue,
        doi=bib.doi,
        url=url,
        order_index=order_index,
        numeric_index=order_index,  # GROBID bib order = numeric reference index
        year_suffix=year_suffix,
        confidence=confidence,
        # Provenance fields (v1.10)
        source="grobid",
        source_confidence=confidence,
        grobid_ref_id=bib.id,  # Canonical field for TEI link mapping
    )

    return c


def _estimate_bib_confidence(
    bib: GrobidBibEntry,
    authors: list[str],
    title: str | None,
    year: str | None,
    doi: str | None,
) -> float:
    """Estimate extraction confidence dựa trên field completeness.

    Confidence ranges:
        - 0.95: có DOI + title + author + year (very reliable)
        - 0.85: có title + author + year (reliable)
        - 0.75: có title + year (moderate)
        - 0.60: chỉ có title hoặc raw text (uncertain)
        - 0.40: raw XML fallback
    """
    score = 0.0

    if doi:
        score += 0.35
    if authors:
        score += 0.20
    if title:
        score += 0.25
    if year:
        score += 0.15

    # GROBID structured extraction is generally reliable
    score += 0.05

    return min(0.95, max(0.40, score))


# ===========================================================================
# In-text: GrobidCitation → Citation
# ===========================================================================


def grobid_to_in_text_citations(output: GrobidOutput) -> list:
    """Chuyển GrobidOutput.citations → list[Citation] (in-text occurrences).

    Mỗi GrobidCitation được chuyển thành Citation với:
        - raw_text: text nguyên gốc (vd '(Smith, 2020)')
        - grobid_ref_id: TEI ref_id (vd 'b0') cho link mapping
        - page number nếu có
        - Provenance: source='grobid'

    Args:
        output: GrobidOutput đã parse từ TEI XML

    Returns:
        list[Citation] — mỗi entry là một in-text occurrence
    """

    citations: list[Citation] = []

    if not output or not output.is_available:
        return citations

    for idx, cit in enumerate(output.citations, start=1):
        citation = _grobid_cit_to_citation(cit, idx)
        citations.append(citation)

    return citations


def _grobid_cit_to_citation(cit: GrobidCitation, order_index: int) -> Citation:
    """Map 1 GrobidCitation → Citation với TEI link tracking.

    Handles:
        - Raw text preservation
        - TEI ref_id mapping (vd 'b0', 'b1')
        - Page number tracking
        - Citation type inference (IN_TEXT vs NUMERIC)
    """
    from integrity_checker.models.citation import Citation, CitationType

    # Infer citation type from raw_text pattern
    citation_type = CitationType.IN_TEXT
    raw = cit.raw_text.strip()
    if re.match(r"^\[\d+(?:\s*[-,]\s*\d+)*\]$", raw):
        citation_type = CitationType.NUMERIC

    c = Citation(
        raw_text=raw,
        citation_type=citation_type,
        page_num=cit.page or 0,
        order_index=order_index,
        confidence=0.90,  # GROBID structured extraction is reliable
        # Provenance fields (v1.10)
        source="grobid",
        source_confidence=0.90,
        grobid_ref_id=cit.ref_id,  # Canonical field for TEI link mapping
    )

    return c


# ===========================================================================
# ID Mapping
# ===========================================================================


def build_grobid_id_map(citations: list) -> dict[str, list]:
    """Build map: grobid_ref_id → list[Citation] cho TEI link mapping.

    TEI links sử dụng xml:id (vd '#b0', '#b1'). GROBID trả ref_id không có '#',
    nên normalize: 'b0' → 'b0' (giữ nguyên, map sẽ tìm với và không có '#').

    Args:
        citations: list[Citation] đã extract từ GROBID (references + in-text)

    Returns:
        dict[str, list[Citation]] — map từ grobid_ref_id → citations
    """
    id_map: dict[str, list] = {}

    for cit in citations:
        ref_id = getattr(cit, "grobid_ref_id", None)
        if ref_id:
            id_map.setdefault(ref_id, []).append(cit)

    return id_map


# ===========================================================================
# Merge: GROBID + Regex
# ===========================================================================


def merge_extraction_results(
    grobid_output: GrobidOutput | None,
    regex_references: list,
    regex_intext: list,
    *,
    document_text: str = "",
) -> MergeResult:
    """Merge GROBID và regex extraction results.

    Strategy:
        1. GROBID ưu tiên khi có structured metadata (title, authors, year, DOI)
        2. Regex bổ sung entries bị GROBID bỏ sót
        3. Deduplicate theo DOI → title+author+year → raw_text similarity
        4. Track provenance và conflicts

    Args:
        grobid_output: GrobidOutput từ GROBID TEI parsing
        regex_references: list[Citation] từ regex reference parser
        regex_intext: list[Citation] từ regex citation extractor
        document_text: raw text từ PyMuPDF (optional, cho fuzzy dedup)

    Returns:
        MergeResult với merged references, body_citations, provenance, conflicts
    """

    result = MergeResult()

    # Step 1: GROBID → Citations
    grobid_refs: list[Citation] = []
    grobid_intext: list[Citation] = []
    grobid_id_map: dict[str, list] = {}

    if grobid_output and grobid_output.is_available:
        grobid_refs = grobid_to_references(grobid_output)
        grobid_intext = grobid_to_in_text_citations(grobid_output)
        grobid_id_map = build_grobid_id_map(grobid_refs + grobid_intext)
        result.grobid_used = True

    # Step 2: Merge references
    merged_refs, ref_conflicts, ref_provenance = _merge_references(
        grobid_refs, regex_references, grobid_id_map
    )
    result.references = merged_refs
    result.conflicts.extend(ref_conflicts)
    result.provenance_map.update(ref_provenance)

    # Step 3: Merge in-text citations
    merged_intext, intext_conflicts, intext_provenance = _merge_intext_citations(
        grobid_intext, regex_intext, grobid_id_map
    )
    result.body_citations = merged_intext
    result.conflicts.extend(intext_conflicts)
    result.provenance_map.update(intext_provenance)

    # Step 4: Set fallback flag properly
    if not grobid_output or not (grobid_output and grobid_output.is_available):
        result.grobid_fallback = True

    # Step 5: Statistics
    result.statistics = {
        "grobid_references": len(grobid_refs),
        "grobid_intext": len(grobid_intext),
        "regex_references": len(regex_references),
        "regex_intext": len(regex_intext),
        "merged_references": len(merged_refs),
        "merged_intext": len(merged_intext),
        "conflicts_detected": len(result.conflicts),
    }

    return result


def _merge_references(
    grobid_refs: list,
    regex_refs: list,
    grobid_id_map: dict[str, list],
) -> tuple[list, list, dict]:
    """Merge reference list entries từ GROBID và regex.

    Priority:
        1. GROBID entries (structured, reliable)
        2. Regex entries không trùng với GROBID entries
        3. Conflict tracking cho entries trùng nhưng khác metadata

    Returns:
        (merged_refs, conflicts, provenance_map)
    """

    merged: list[Citation] = []
    conflicts: list = []
    provenance: dict = {}

    # Track which regex entries have been merged
    merged_grobid_ids: set = set()

    # Step 1: Add GROBID references first (higher priority)
    for cit in grobid_refs:
        ref_id = getattr(cit, "grobid_ref_id", None)

        # Add provenance info
        provenance[cit.raw_text[:100]] = ProvenanceInfo(
            source="grobid",
            source_confidence=cit.confidence,
            grobid_ref_id=ref_id,
            is_grobid_linked=ref_id in grobid_id_map,
        )

        merged.append(cit)
        if ref_id:
            merged_grobid_ids.add(ref_id)

    # Step 2: Add regex entries không trùng với GROBID
    for cit in regex_refs:
        if _is_duplicate_reference(cit, merged):
            # Track duplicate but don't add
            conflicts.append({
                "type": "duplicate_reference",
                "citation": cit.raw_text[:100],
                "reason": "Duplicate of GROBID entry",
            })
            provenance[cit.raw_text[:100]] = ProvenanceInfo(
                source="regex",
                source_confidence=cit.confidence,
                conflict_fields=["duplicate"],
            )
        else:
            merged.append(cit)
            provenance[cit.raw_text[:100]] = ProvenanceInfo(
                source="regex",
                source_confidence=cit.confidence,
            )

    return merged, conflicts, provenance


def _merge_intext_citations(
    grobid_intext: list,
    regex_intext: list,
    grobid_id_map: dict[str, list],
) -> tuple[list, list, dict]:
    """Merge in-text citations từ GROBID và regex.

    Priority:
        1. GROBID citations (có TEI link IDs, reliable)
        2. Regex citations bổ sung (GROBID có thể miss citations trong complex layouts)

    Returns:
        (merged_intext, conflicts, provenance_map)
    """

    merged: list[Citation] = []
    conflicts: list = []
    provenance: dict = {}

    # Track raw_text patterns already seen
    seen_raw: set = set()

    # Step 1: Add GROBID in-text first (higher priority)
    for cit in grobid_intext:
        ref_id = getattr(cit, "grobid_ref_id", None)

        provenance[cit.raw_text[:100]] = ProvenanceInfo(
            source="grobid",
            source_confidence=cit.confidence,
            grobid_ref_id=ref_id,
            is_grobid_linked=ref_id in grobid_id_map if ref_id else False,
        )

        merged.append(cit)
        seen_raw.add(cit.raw_text.lower().strip())

    # Step 2: Add regex entries không trùng
    for cit in regex_intext:
        raw_key = cit.raw_text.lower().strip()

        if raw_key in seen_raw:
            conflicts.append({
                "type": "duplicate_intext",
                "citation": cit.raw_text[:100],
                "reason": "Duplicate of GROBID entry",
            })
            provenance[cit.raw_text[:100]] = ProvenanceInfo(
                source="regex",
                source_confidence=cit.confidence,
                conflict_fields=["duplicate"],
            )
        else:
            merged.append(cit)
            seen_raw.add(raw_key)
            provenance[cit.raw_text[:100]] = ProvenanceInfo(
                source="regex",
                source_confidence=cit.confidence,
            )

    return merged, conflicts, provenance


def _normalize_url_for_dedup(url: str | None) -> str:
    if not url:
        return ""
    u = url.strip().lower().rstrip("/.,;)")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u


def _is_duplicate_reference(cit: Citation, existing: list[Citation]) -> bool:
    """Check if citation is a duplicate of an existing entry.

    Deduplication priority:
        1. DOI exact match
        2. URL exact match
        3. Title + Author + Year match (fuzzy)
    """
    # DOI exact match
    if cit.doi:
        for existing_cit in existing:
            if existing_cit.doi and existing_cit.doi.lower() == cit.doi.lower():
                return True

    # URL exact match (only allow prefix match when titles do not diverge)
    cit_url = _normalize_url_for_dedup(getattr(cit, "url", None))
    if cit_url:
        for existing_cit in existing:
            ex_url = _normalize_url_for_dedup(getattr(existing_cit, "url", None))
            if not ex_url:
                continue
            if cit_url == ex_url:
                return True
            if cit_url in ex_url or ex_url in cit_url:
                c_title = (cit.title or "").lower().strip()
                e_title = (existing_cit.title or "").lower().strip()
                if not c_title or not e_title or c_title == e_title or c_title in e_title or e_title in c_title:
                    return True

    # Title + Author + Year fuzzy match (also handles cases where one source
    # missed authors or year on corporate/book/web entries)
    if cit.title:
        for existing_cit in existing:
            if existing_cit.title:
                if _title_author_year_match(cit, existing_cit):
                    return True

    return False


def _title_author_year_match(a: Citation, b: Citation) -> bool:
    """Check if two citations match on title + author + year."""
    # Year must match when both have a year, unless one side picked up an "Accessed YYYY" year
    if a.year and b.year and a.year != b.year:
        raw_comb = f"{a.raw_text or ''} {b.raw_text or ''}".lower()
        if "accessed" not in raw_comb:
            return False

    # Author must have significant overlap when both citations have authors
    def _get_author_names(authors_list) -> set:
        """Extract author names as strings from author list."""
        if not authors_list:
            return set()
        out = set()
        for auth in authors_list:
            if isinstance(auth, str):
                tokens = [t.strip().lower() for t in re.split(r"[,\s]+", auth) if len(t.strip()) >= 2]
                if tokens:
                    out.add(tokens[0])
                    out.add(tokens[-1])
            elif hasattr(auth, "last_name") and auth.last_name:
                ln = auth.last_name.lower().strip()
                out.add(ln)
                for tok in ln.split():
                    if len(tok) >= 2:
                        out.add(tok)
        return out

    a_authors = _get_author_names(a.authors)
    b_authors = _get_author_names(b.authors)
    both_have_authors = bool(a_authors and b_authors)

    if both_have_authors:
        overlap = len(a_authors & b_authors)
        if overlap == 0:
            return False

    # Title similarity (word overlap on normalized alphanumeric tokens)
    if a.title and b.title:
        _STOP = {"the", "in", "of", "on", "to", "for", "and", "or", "with", "from", "by", "an", "as", "at", "into"}
        a_all = {w for w in re.split(r"\W+", a.title.lower()) if len(w) >= 2}
        b_all = {w for w in re.split(r"\W+", b.title.lower()) if len(w) >= 2}
        a_words = (a_all - _STOP) or a_all
        b_words = (b_all - _STOP) or b_all
        if not a_words or not b_words:
            return False
        overlap = len(a_words & b_words)
        min_words = min(len(a_words), len(b_words))
        max_words = max(len(a_words), len(b_words))
        if both_have_authors:
            first_a = _get_author_names(a.authors[:1])
            first_b = _get_author_names(b.authors[:1])
            same_first_author = bool(first_a & first_b)
            if same_first_author:
                if overlap >= 3 or (overlap > 0 and overlap >= min_words * 0.5):
                    return True
            else:
                if overlap >= 3 and overlap >= max_words * 0.65:
                    return True
        else:
            # When one side lacks authors, require stronger title agreement
            if a.title.lower().strip() == b.title.lower().strip():
                return True
            if overlap >= 3 and overlap >= min_words * 0.7:
                return True

    return False


# ===========================================================================
# TEI Link Utilities
# ===========================================================================


def normalize_grobid_id(raw_id: str) -> str:
    """Normalize TEI xml:id to stable form.

    Handles:
        - '#b0' → 'b0' (strip leading #)
        - 'b0' → 'b0' (keep as-is)

    Args:
        raw_id: TEI ref target (vd '#b0', 'b0')

    Returns:
        Normalized id (without # prefix)
    """
    if raw_id.startswith("#"):
        return raw_id[1:]
    return raw_id


def resolve_tei_links(
    intext_citations: list,
    ref_citations: list,
    grobid_id_map: dict[str, list],
) -> list:
    """Resolve TEI links: map in-text citations → reference entries.

    Sử dụng grobid_ref_id từ TEI XML để map trực tiếp
    citation ↔ reference thay vì fuzzy matching.

    Args:
        intext_citations: list[Citation] từ GROBID in-text extraction
        ref_citations: list[Citation] từ GROBID reference extraction
        grobid_id_map: dict[str, list[Citation]] — ref_id → ref citations

    Returns:
        list[dict] — list of link mappings với metadata
    """
    links: list[dict] = []

    # Build reverse map: ref_id → REFERENCE citations only (not in-text)
    ref_by_id: dict[str, list] = {}
    for cit in ref_citations:
        ref_id = getattr(cit, "grobid_ref_id", None)
        if ref_id:
            ref_by_id.setdefault(ref_id, []).append(cit)

    for cit in intext_citations:
        ref_id = getattr(cit, "grobid_ref_id", None)
        if not ref_id:
            continue

        normalized_id = normalize_grobid_id(ref_id)
        refs = ref_by_id.get(normalized_id, [])

        if refs:
            # Direct TEI link found
            for ref in refs:
                links.append({
                    "intext": cit.raw_text,
                    "ref_id": normalized_id,
                    "reference": ref.raw_text[:100],
                    "method": "tei_link",
                    "confidence": 0.95,  # TEI links are authoritative
                    "direct": True,
                })
        else:
            # TEI link but no matching reference found
            links.append({
                "intext": cit.raw_text,
                "ref_id": normalized_id,
                "reference": None,
                "method": "tei_link_unresolved",
                "confidence": 0.0,
                "direct": False,
            })

    return links


# ===========================================================================
# Enrich regex body citations with GROBID TEI targets (Stage 1 linking)
# ===========================================================================

_MARKER_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)
_YEAR_TOKEN_RE = re.compile(r"\b((?:18|19|20)\d{2})([a-z])?\b")
_NUMERIC_INDEX_RE = re.compile(r"\d+")


def _fold(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFKD", text or "").replace("đ", "d").replace("Đ", "D")
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower()


def _marker_tokens(text: str) -> list[str]:
    toks = _MARKER_TOKEN_RE.findall(_fold(text))
    # Connector words carry no identity ("et al.", "and", "&", "và cộng sự").
    stop = {"et", "al", "and", "va", "cong", "su", "cs", "ctv", "p", "pp", "tr"}
    return [t for t in toks if t not in stop]


def _is_single_key_citation(cit: Citation) -> bool:
    """Only single-target occurrences may carry one ``grobid_ref_id``.

    Multi-key parentheticals ("(A, 2020; B, 2019)") and multi-index numeric
    markers ("[1, 2]", "[3-5]") resolve to several references; a single TEI
    target would hide the others, so they keep the regex linking path.
    """
    from integrity_checker.models.citation import CitationType

    raw = cit.raw_text or ""
    if cit.citation_type == CitationType.NUMERIC:
        return len(_NUMERIC_INDEX_RE.findall(raw)) == 1
    if cit.citation_type != CitationType.IN_TEXT:
        return False
    return ";" not in raw and len(_YEAR_TOKEN_RE.findall(raw)) <= 1


def _target_consistent(cit: Citation, bib: Citation) -> bool:
    """Sanity check: never let a misaligned TEI link override the regex path."""
    from integrity_checker.models.citation import CitationType

    raw = cit.raw_text or ""
    if cit.citation_type == CitationType.NUMERIC:
        nums = _NUMERIC_INDEX_RE.findall(raw)
        if bib.numeric_index is None:
            return True
        return bool(nums) and int(nums[0]) == int(bib.numeric_index)
    cit_year = _YEAR_TOKEN_RE.search(raw)
    bib_year = _YEAR_TOKEN_RE.search(f"{bib.year or ''} {bib.raw_text or ''}")
    if cit_year and bib_year:
        if cit_year.group(1) != bib_year.group(1):
            return False
        cit_suffix = cit_year.group(2)
        bib_suffix = (bib.year_suffix or "").strip().lower() or next(
            (m.group(2) for m in _YEAR_TOKEN_RE.finditer(f"{bib.year or ''} {bib.raw_text or ''}")
             if m.group(2)),
            None,
        )
        if cit_suffix and bib_suffix and cit_suffix != bib_suffix:
            return False
    return True


def _attach_reference_grobid_ids(references: list, grobid_output: GrobidOutput) -> None:
    """Give regex-derived references the TEI xml:id of their GROBID twin.

    References built by the regex parser (e.g. Vietnamese bibliographies, or
    entries GROBID merged away) carry no ``grobid_ref_id``. Match them to a
    GROBID biblStruct by normalized DOI, then by normalized title.
    """
    entries = [b for b in grobid_output.bibliography if getattr(b, "id", None)]
    if not entries:
        return
    taken = {
        normalize_grobid_id(str(r.grobid_ref_id)) for r in references if r.grobid_ref_id
    }

    def _norm_doi(d: str | None) -> str:
        d = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", (d or "").strip(), flags=re.I)
        return d.rstrip(".,;)").lower()

    def _norm_title(t: str | None) -> str:
        return " ".join(_MARKER_TOKEN_RE.findall(_fold(t or "")))

    by_doi = {_norm_doi(b.doi): b for b in entries if _norm_doi(b.doi)}
    by_title = {_norm_title(b.title): b for b in entries if len(_norm_title(b.title)) >= 12}
    for ref in references:
        if ref.grobid_ref_id:
            continue
        match = by_doi.get(_norm_doi(ref.doi)) if _norm_doi(ref.doi) else None
        if match is None:
            key = _norm_title(ref.title)
            match = by_title.get(key) if len(key) >= 12 else None
        if match is None:
            continue
        gid = normalize_grobid_id(str(match.id))
        if gid in taken:
            continue
        ref.grobid_ref_id = gid
        taken.add(gid)


def link_body_citations_to_grobid(
    body_citations: list,
    grobid_output: GrobidOutput | None,
    references: list | None = None,
) -> int:
    """Enrich regex body citations with GROBID TEI targets (Stage 1 linking).

    For each GROBID in-text ``<ref type="bibr" target="#bN">`` the matching
    regex occurrence is found by marker text (token containment, e.g. GROBID
    "Smith, 2020" ⊆ regex "(Smith, 2020)"; numeric "3" ⊆ "[3]" but not "[13]"),
    preferring the same page and document order. A regex citation gets
    ``grobid_ref_id`` + ``is_grobid_linked=True`` only when:

        * it is a single-key occurrence (multi-key / multi-index markers keep
          the regex path so no target is lost);
        * every GROBID marker mapped onto it points to the same target;
        * the target exists among ``references`` (when given) and is
          consistent with the occurrence (numeric index / year / suffix).

    When GROBID output is missing/unavailable this is a no-op, so the regex
    path is untouched.

    Returns:
        Number of body citations enriched.
    """
    if not body_citations or grobid_output is None or not grobid_output.is_available:
        return 0
    grobid_cits = [c for c in (grobid_output.citations or []) if c.ref_id]
    if not grobid_cits:
        return 0

    bib_by_gid: dict[str, Citation] = {}
    if references is not None:
        _attach_reference_grobid_ids(references, grobid_output)
        for ref in references:
            if ref.grobid_ref_id:
                bib_by_gid.setdefault(normalize_grobid_id(str(ref.grobid_ref_id)), ref)

    body_tokens = [set(_marker_tokens(c.raw_text or "")) for c in body_citations]
    assigned: dict[int, set[str]] = {}

    for gcit in grobid_cits:
        marker = _marker_tokens(gcit.raw_text or "")
        if not marker:
            continue
        has_alpha = any(not t.isdigit() for t in marker)
        if all(t.isdigit() and len(t) == 4 for t in marker):
            # A bare "2020" (narrative "Smith (2020)") is too ambiguous.
            continue
        marker_set = set(marker)
        candidates = []
        for idx, (cit, toks) in enumerate(zip(body_citations, body_tokens, strict=True)):
            if not marker_set <= toks:
                continue
            if not has_alpha and getattr(cit.citation_type, "value", "") != "numeric":
                continue
            candidates.append(idx)
        if not candidates:
            continue
        same_page = [
            i for i in candidates
            if gcit.page and body_citations[i].page_num == gcit.page
        ]
        pool = same_page or candidates
        chosen = next((i for i in pool if i not in assigned), pool[0])
        assigned.setdefault(chosen, set()).add(normalize_grobid_id(str(gcit.ref_id)))

    enriched = 0
    for idx, gids in assigned.items():
        cit = body_citations[idx]
        if len(gids) != 1 or cit.grobid_ref_id or not _is_single_key_citation(cit):
            continue
        gid = next(iter(gids))
        if references is not None:
            bib = bib_by_gid.get(gid)
            if bib is None or not _target_consistent(cit, bib):
                continue
        cit.grobid_ref_id = gid
        cit.is_grobid_linked = True
        enriched += 1
    if enriched:
        logger.info("GROBID TEI: enriched %d regex body citations with ref targets", enriched)
    return enriched


# ===========================================================================
# Sample TEI fixtures for testing
# ===========================================================================

SAMPLE_GROBID_OUTPUT = GrobidOutput(
    is_available=True,
    bibliography=[
        GrobidBibEntry(
            id="b0",
            authors=[],
            title="Deep learning",
            year="2015",
            venue="Nature",
            doi="10.1038/nature14539",
        ),
        GrobidBibEntry(
            id="b1",
            authors=[],
            title="Attention Is All You Need",
            year="2017",
            venue="NeurIPS",
            doi="10.48550/arXiv.1706.03762",
        ),
    ],
    citations=[
        GrobidCitation(raw_text="(LeCun et al., 2015)", ref_id="b0", page=1),
        GrobidCitation(raw_text="(Vaswani et al., 2017)", ref_id="b1", page=3),
    ],
)


# ===========================================================================
# Backward Compatibility Export
# ===========================================================================

__all__ = [
    # Core API
    "grobid_to_references",
    "grobid_to_in_text_citations",
    "build_grobid_id_map",
    "merge_extraction_results",
    "resolve_tei_links",
    "normalize_grobid_id",
    "link_body_citations_to_grobid",
    # Data Models
    "ProvenanceInfo",
    "MergeResult",
    # Fixtures
    "SAMPLE_GROBID_OUTPUT",
]
