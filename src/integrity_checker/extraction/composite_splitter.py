"""Composite chemistry/physics bibliography splitter (Subsystem A5).

Expands multi-part ACS / RSC / APS / AIP reference-list entries such as:
    14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240;
        (b) Wang, L. Org. Lett. 2021, 23, 550–554.
into distinct ``Citation`` items carrying ``numeric_index=14``,
``sub_index="a"`` / ``"b"``, and ``composite_label="14a"`` / ``"14b"``,
while strictly guarding against chemical isomer names (``(a)-isomer``,
``poly(a)``) and prose enumerations inside single-paper titles.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from integrity_checker.extraction.patterns.utils import extract_doi, extract_url
from integrity_checker.models.citation import Citation, CitationType

if TYPE_CHECKING:
    from integrity_checker.extraction.reference_parser import ReferenceListParser

logger = logging.getLogger(__name__)

# Outer numeric prefix on a bibliography entry: "[14] ", "(14) ", or "14. " / "14) "
_LEADING_NUMERIC_RE = re.compile(
    r"^\s*(?P<prefix>"
    r"\[\s*(?P<b_num>\d{1,4})\s*\]"
    r"|\(\s*(?P<p_num>\d{1,4})\s*\)"
    r"|(?P<d_num>\d{1,4})\s*[\.\)]"
    r")\s*"
)

# First sub-marker "(a) " or "a) " right at start of entry body (after numeric prefix)
_DIRECT_FIRST_MARKER_RE = re.compile(
    r"^(?P<marker>\(\s*a\s*\)|a\))(?P<ws>\s+)(?=\S)"
)

# Brief editorial lead-in phrase before "(a) " / "a) ", e.g.:
#   "For recent reviews on C–H activation, see: (a) ..."
#   "See, for example, (a) ..."
#   "Reviews: a) ..."
_LEAD_IN_FIRST_MARKER_RE = re.compile(
    r"^(?P<lead_in>"
    r"(?:[^:;]{1,110}[:;]"
    r"|(?:for\b|see\b|cf\.?\b|e\.g\.?\b|reviews?\b|examples?\b|xem\b)[^:;]{0,100},\s*(?:see\b[^:;]{0,30},\s*)?)"
    r")\s*(?P<marker>\(\s*a\s*\)|a\))(?P<ws>\s+)(?=\S)",
    flags=re.IGNORECASE,
)

# Candidate boundary sub-markers inside the composite body.
# Requires:
#   - start of sub-body OR preceding clause delimiter (; . , : or newline, with optional "and")
#   - lowercase ASCII single letter a..z in "(x)" or "x)"
#   - mandatory trailing whitespace before non-whitespace content (blocks "(a)-isomer", "(a,b)", etc.)
_SUB_MARKER_CANDIDATE_RE = re.compile(
    r"(?:^|(?P<delim>;\s*(?:and\s+)?|\.\s+|,\s+and\s+|\n\s*))"
    r"(?P<marker>\(\s*(?P<p_letter>[a-z])\s*\)|(?P<b_letter>[a-z])\))"
    r"\s+(?=\S)"
)

# Independent bibliographic signals required inside sub-segments
_YEAR_SIGNAL_RE = re.compile(r"\b(?:18|19|20)\d{2}[a-z]?\b")
_DOI_SIGNAL_RE = re.compile(r"\b10\.\d{4,9}/[^\s,;]+", flags=re.IGNORECASE)
_URL_ARXIV_SIGNAL_RE = re.compile(
    r"(?:https?://\S+|\barxiv\s*:\s*\d{4}\.\d{4,5})",
    flags=re.IGNORECASE,
)
_VOL_PAGE_SIGNAL_RE = re.compile(
    r"(?:"
    r"\b\d{1,4}\s*(?:\([^)]{1,15}\)\s*)?,\s*(?:pp?\.\s*)?[A-Za-z]?\d{1,6}\s*[-–—]\s*[A-Za-z]?\d{1,6}\b"
    r"|\bpp?\.\s*\d{1,6}(?:\s*[-–—]\s*\d{1,6})?\b"
    r")",
    flags=re.IGNORECASE,
)
_IBID_SIGNAL_RE = re.compile(r"\b(?:ibid\.?|idem|loc\.\s*cit\.?)\b", flags=re.IGNORECASE)


def _has_bibliographic_signal(segment: str) -> bool:
    """Return True if ``segment`` independently exhibits bibliographic metadata."""
    if not segment or len(segment.strip()) < 8:
        return False
    return bool(
        _YEAR_SIGNAL_RE.search(segment)
        or _DOI_SIGNAL_RE.search(segment)
        or _URL_ARXIV_SIGNAL_RE.search(segment)
        or _VOL_PAGE_SIGNAL_RE.search(segment)
    )


def _extract_numeric_prefix(citation: Citation) -> tuple[int | None, str, str]:
    """Return ``(numeric_index, body_without_prefix, prefix_style)``.

    ``prefix_style`` is ``"bracket"`` for ``[14]`` or ``"dot"`` otherwise.
    """
    raw = (citation.raw_text or "").strip()
    m = _LEADING_NUMERIC_RE.match(raw)
    prefix_style = "dot"
    inferred_num: int | None = None
    body = raw
    if m:
        body = raw[m.end() :].strip()
        if m.group("b_num"):
            inferred_num = int(m.group("b_num"))
            prefix_style = "bracket"
        elif m.group("p_num"):
            inferred_num = int(m.group("p_num"))
        elif m.group("d_num"):
            inferred_num = int(m.group("d_num"))

    num_idx = citation.numeric_index if citation.numeric_index is not None else inferred_num
    return num_idx, body, prefix_style


def _locate_composite_sub_body(body: str) -> str | None:
    """Return the substring starting at the initial ``(a)`` / ``a)`` marker, or None."""
    if not body:
        return None
    if _DIRECT_FIRST_MARKER_RE.match(body):
        return body

    m_lead = _LEAD_IN_FIRST_MARKER_RE.match(body)
    if m_lead:
        lead_in = m_lead.group("lead_in")
        # Guard: a genuine lead-in ("For recent reviews, see:") never contains its own DOI
        # or full journal year+volume+page citation.
        if _DOI_SIGNAL_RE.search(lead_in) or (
            _YEAR_SIGNAL_RE.search(lead_in) and _VOL_PAGE_SIGNAL_RE.search(lead_in)
        ):
            return None
        marker_start = m_lead.start("marker")
        return body[marker_start:]

    return None


def _split_sequential_sub_segments(sub_body: str) -> list[tuple[str, str, str]] | None:
    """Split ``sub_body`` into ``[(sub_letter, marker_token, segment_text), ...]``.

    Enforces strict alphabetical progression ``a -> b -> c -> ...`` with at least
    2 sub-segments and rejects out-of-order or skipped boundary markers.
    """
    matches: list[tuple[str, str, int, int]] = []
    for m in _SUB_MARKER_CANDIDATE_RE.finditer(sub_body):
        letter = m.group("p_letter") or m.group("b_letter")
        marker_tok = m.group("marker").strip()
        delim = m.group("delim") or ""
        # Bare "x)" (without opening paren) after a comma inside prose is risky;
        # require start-of-string, ";", ":", ".", or newline for bare "x)".
        if m.group("b_letter") and m.start() > 0:
            if not re.match(r"^(?:[;:.]\s*|\n\s*)", delim):
                continue
        matches.append((letter, marker_tok, m.start("marker"), m.end()))

    if len(matches) < 2:
        return None

    # Must start at position 0 with 'a' and advance strictly a, b, c, ...
    if matches[0][0] != "a" or matches[0][2] != 0:
        return None

    expected_letters = [chr(ord("a") + idx) for idx in range(len(matches))]
    actual_letters = [item[0] for item in matches]
    if actual_letters != expected_letters:
        return None

    segments: list[tuple[str, str, str]] = []
    for idx, (letter, marker_tok, _m_start, content_start) in enumerate(matches):
        next_marker_start = matches[idx + 1][2] if idx + 1 < len(matches) else len(sub_body)
        raw_seg = sub_body[content_start:next_marker_start].strip()
        # Trim trailing clause separator (";" or ", and" or ",") left before next marker
        raw_seg = re.sub(r"(?:\s*,\s*and|\s*[;,])\s*$", "", raw_seg).strip()
        if not raw_seg:
            return None
        segments.append((letter, marker_tok, raw_seg))

    return segments


def _fallback_sub_citation(
    *,
    parent: Citation,
    numeric_index: int,
    sub_letter: str,
    display_raw: str,
    seg_text: str,
) -> Citation:
    """Construct a best-effort ``Citation`` when strict format patterns miss a sub-entry."""
    year_m = _YEAR_SIGNAL_RE.search(seg_text)
    doi = extract_doi(seg_text)
    url = extract_url(seg_text)
    if url and re.search(r"doi\.org/10\.\d{4,9}/", url, re.IGNORECASE):
        url = None

    authors: list[str] = []
    author_head = re.split(r"\b(?:18|19|20)\d{2}\b", seg_text, maxsplit=1)[0].strip()
    if author_head:
        first_chunk = author_head.split(".", 1)[0].strip()
        if first_chunk and len(first_chunk) <= 80:
            authors = [a.strip() for a in first_chunk.split(";") if a.strip()]

    return Citation(
        raw_text=display_raw,
        citation_type=CitationType.REFERENCE_LIST,
        style=parent.style,
        authors=authors,
        year=year_m.group(0) if year_m else None,
        title=seg_text[:120].rstrip(".;,"),
        doi=doi,
        url=url,
        numeric_index=numeric_index,
        sub_index=sub_letter,
        composite_label=f"{numeric_index}{sub_letter}",
        page_num=parent.page_num,
        paragraph_num=parent.paragraph_num,
        matched_pattern="composite_sub_fallback",
        confidence=0.7,
        source=parent.source,
        source_confidence=parent.source_confidence,
        grobid_ref_id=parent.grobid_ref_id,
    )


def expand_composite_reference(
    citation: Citation,
    ref_parser: ReferenceListParser | None = None,
) -> list[Citation]:
    """Expand a single composite ``REFERENCE_LIST`` citation into sub-citations.

    Returns ``[citation]`` unchanged when the entry is not a valid composite
    reference or is already expanded.
    """
    if citation.citation_type != CitationType.REFERENCE_LIST:
        return [citation]
    if citation.sub_index is not None or citation.composite_label is not None:
        return [citation]

    numeric_index, body, prefix_style = _extract_numeric_prefix(citation)
    if numeric_index is None or not body:
        return [citation]

    sub_body = _locate_composite_sub_body(body)
    if not sub_body:
        return [citation]

    segments = _split_sequential_sub_segments(sub_body)
    if not segments or len(segments) < 2:
        return [citation]

    # Chemical Isomer & Prose False-Split Guard:
    # At least 2 sub-segments must independently contain bibliographic signals,
    # and every segment must have either a bibliographic signal or an explicit ibid/idem token.
    signal_flags = [_has_bibliographic_signal(seg_text) for _, _, seg_text in segments]
    if sum(1 for flag in signal_flags if flag) < 2:
        return [citation]
    if not all(
        flag or bool(_IBID_SIGNAL_RE.search(seg_text))
        for flag, (_, _, seg_text) in zip(signal_flags, segments, strict=True)
    ):
        return [citation]

    if ref_parser is None:
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        ref_parser = ReferenceListParser()

    expanded: list[Citation] = []
    for offset, (sub_letter, marker_tok, seg_text) in enumerate(segments):
        display_raw = f"{marker_tok} {seg_text}".strip()
        parse_input = seg_text if seg_text.endswith(".") else f"{seg_text}."
        synth_entry = (
            f"[{numeric_index}] {parse_input}"
            if prefix_style == "bracket"
            else f"({numeric_index}) {parse_input}"
        )

        parsed = ref_parser.parse_single_entry(
            synth_entry,
            order_index=max(1, citation.order_index + offset),
            page_num=citation.page_num,
        )
        if parsed is None:
            parsed = _fallback_sub_citation(
                parent=citation,
                numeric_index=numeric_index,
                sub_letter=sub_letter,
                display_raw=display_raw,
                seg_text=seg_text,
            )
        else:
            parsed.raw_text = display_raw
            parsed.citation_type = CitationType.REFERENCE_LIST
            parsed.numeric_index = numeric_index
            parsed.sub_index = sub_letter
            parsed.composite_label = f"{numeric_index}{sub_letter}"
            parsed.page_num = citation.page_num
            parsed.paragraph_num = citation.paragraph_num
            parsed.source = citation.source
            parsed.source_confidence = citation.source_confidence
            parsed.grobid_ref_id = citation.grobid_ref_id

        if citation.reference_id:
            parsed.reference_id = f"{citation.reference_id}{sub_letter}"

        expanded.append(parsed)

    return expanded


def expand_composite_references(
    bib_citations: list[Citation],
    ref_parser: ReferenceListParser | None = None,
) -> list[Citation]:
    """Expand any composite entries across ``bib_citations`` and re-sequence ``order_index``."""
    if not bib_citations:
        return []

    out: list[Citation] = []
    any_expanded = False
    for cit in bib_citations:
        pieces = expand_composite_reference(cit, ref_parser=ref_parser)
        if len(pieces) > 1:
            any_expanded = True
        out.extend(pieces)

    if any_expanded:
        for idx, cit in enumerate(out, start=1):
            cit.order_index = idx

    return out
