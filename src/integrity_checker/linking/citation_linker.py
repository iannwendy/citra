"""CitationLinker — bidirectional linker in-text ↔ reference entry (v1.2 §3.5).

Mục tiêu:
    Với danh sách body citations (in-text occurrences) và bibliography entries,
    tạo citation graph bằng cách match mỗi in-text occurrence với ≥0 reference
    entry, và mỗi reference entry với ≥0 in-text occurrence.

Match logic (theo priority):
    1. **DOI exact** — cả 2 đều có DOI trích dẫn trong raw_text → chắc chắn nhất.
    2. **NUMERIC_INDEX** (IEEE) — in-text `[N]` ↔ bib `numeric_index == N`.
    3. **AUTHOR_YEAR** (APA) — `(Author, Year)` ↔ bib `author.last_name` + `year`.
    4. **FUZZY** — normalized title similarity fallback.

Outputs:
    - list[CitationLink] (1 per in-text occurrence)
    - list of unmatched in-text (→ MISSING_REFERENCE)
    - list of unmatched reference entries (→ UNCITED_REFERENCE)
    - duplicate groups (→ DUPLICATE_REFERENCE)

References:
    v1.2 §3.5 (bidirectional linking)
    v1.2 §3.7 (linking styles — style consistency)
"""

from __future__ import annotations

import difflib
import logging
import re
import unicodedata

from integrity_checker.linking.statuses import (
    CitationMappingStatus,
    LinkingResult,
)
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.validation import CitationLink, MappingMethod

logger = logging.getLogger(__name__)

# Regex cho in-text APA / Harvard / Chicago / CSE pattern:
# (Author, Year) / (Author Year) / [Author, Year] / [Author Year] / (Author, Year, tr. 15) / (Author 2020, 25) / (Author, 2020: 25) / (Author, n.d.)
_APA_YEAR_RE = re.compile(
    r"[\(\[][\"\u201c\u201d'\u2018\u2019]?([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ0-9/'\u2019\u2018.\s,&\-\u2013\u2014\[\]:]*?)(?:,[\"\u201d\u2019']?\s*|\s+)((?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)"
    r"(?:\s*[,:]\s*(?:pp?\.?|tr\.?|trang|с\.?|p\.?)?\s*\d+(?:\s*[,–\-]\s*\d+)*)?[\)\]]",
    re.IGNORECASE,
)
# Regex cho MLA / Chicago in-text author-page: (Smith 25), [Cole, p. 247], (Smith and Doe 42), (Smith et al. 105),
# (L'Engle 72-73), (Longman III 57), (Lewis XXII), (Mulvey et al. 17, 19), (Smith et al.)
_MLA_AUTHOR_PAGE_RE = re.compile(
    r"^[\(\[]([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ'\u2019.\s,&\-]*?)(?:,\s*(?:pp?\.?|tr\.?|с\.?)\s*|\s+)(?!(?:18|19|20)\d{2}\b)(?:\d{1,4}(?:[-–]\d{1,4})?(?:,\s*\d{1,4}(?:[-–]\d{1,4})?)*|[IVXLCDMivxlcdm]{1,7})[\)\]]$"
    r"|^[\(\[]([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ'\u2019.\s,&\-]*?\s+et\s+a?l\.)[\)\]]$"
    r"|^([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ'\u2019.\s,&\-]*?)\s+[\(\[](?:pp?\.?|tr\.?|с\.?)\s*\d{1,4}(?:[-–]\d{1,4})?[\)\]]$"
)
# Regex cho Author et al. / và cộng sự (Year) or Author et al. Year format
_APA_ETAL_YEAR_RE = re.compile(
    r"([A-Za-zÀ-ỹ'\u2019.\s,&\-]+?)\s+(?:et\s+a?l\.?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên)\s*"
    r"(?:[\(\[]\s*((?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)(?:\s*,\s*[^)\]]*)?\s*[\)\]]|((?:18|19|20)\d{2}[a-z]?)\b)",
    re.IGNORECASE,
)
# Narrative citation: ``Author et al. (2018)`` or ``Author (2018)`` or ``Author [2018]`` or ``Author A và Author B (2018)``.
_NARRATIVE_YEAR_RE = re.compile(
    r"([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ0-9/'\u2019.\s,&\-\[\]]*?)\s*[\(\[]\s*((?:18|19|20)\d{2}[a-z]?|n\.?\s*d\.?(?:-[a-z])?)(?:\s*,\s*[^)\]]*)?\s*[\)\]]",
    re.IGNORECASE,
)
# Secondary citation (trích dẫn gián tiếp): "(Smith, 2005, dẫn theo Tran, 2016)" / "Smith (2005, as cited in Tran, 2016)"
_SECONDARY_CITATION_RE = re.compile(
    r"(?:dẫn\s+theo|trích\s+dẫn\s+(?:trong|từ)|as\s+cited\s+in|cited\s+in)\s+([^)]+)\)?",
    re.IGNORECASE,
)
# Institutional / Corporate / Legal author indicator
_INSTITUTIONAL_AUTHOR_RE = re.compile(
    r"^(?:Bộ|Tổng\s+cục|Ủy\s+ban|Uỷ\s+ban|Chính\s+phủ|Quốc\s+hội|Thủ\s+tướng|Ban\s+|Đảng\s+|Tòa\s+án|Toà\s+án|Văn\s+phòng|Thanh\s+tra|Kiểm\s+toán|Ngân\s+hàng|Tổ\s+chức|Hiệp\s+hội"
    r"|Hiến\s+pháp|Bộ\s+luật|Luật|Pháp\s+lệnh|Nghị\s+định|Thông\s+tư|Quyết\s+định|Nghị\s+quyết|Chỉ\s+thị|Bản\s+án|Án\s+lệ|Công\s+ước"
    r"|Viện|Trường|Cục|Vụ|Sở|Department|Ministry|Association|Organization|Organisation"
    r"|Institute|Council|World\s+Health|United\s+Nations|Reserve\s+Bank|National\s+Institute"
    r"|National\s+Academ(?:ies|ics)|American\s+Psychiatric|American\s+Library|American\s+College"
    r"|Substance\s+Abuse|Centers?\s+for\s+Disease|Pew\s+Research|Media\s+Helping|Local\s+News"
    r"|News\s+Literacy|Security\s+Risk|Microsoft|OpenRocket|RocketPy|RocketSerializer|Wikipedia\s+Contributors)\b"
    r"|\b(?:of|for|Association|Organization|Institute|Initiative|Project|Advisors|Clinics|Contributors|Developers)\b",
    re.IGNORECASE,
)
# Regex cho in-text IEEE numeric: [N] or [N, M] or [N-M] or [N, Tr. 124]
_IEEE_NUM_RE = re.compile(
    r"\[(\d+(?:\s*[-–,]\s*\d+)*)(?:\s*[,;:]\s*(?:tr\.?|trang|pp?\.?)\s*\d+(?:\s*[,–\-—]\s*\d+)*)?\]",
    re.IGNORECASE,
)
# Regex cho year extraction từ bib entry
_BIB_YEAR_RE = re.compile(r"\((?:19|20)\d{2}[a-z]?\)|(?:19|20)\d{2}[a-z]?")


class CitationLinker:
    """Bidirectional linker in-text ↔ reference entry."""

    def __init__(
        self,
        fuzzy_threshold: float = 0.80,
        author_year_confidence: float = 0.90,
        numeric_confidence: float = 0.90,
        doi_confidence: float = 0.95,
        fuzzy_confidence: float = 0.65,
    ) -> None:
        """
        Args:
            fuzzy_threshold: ngưỡng similarity cho fuzzy match.
            author_year_confidence: confidence khi match by author+year.
            numeric_confidence: confidence khi match by numeric index.
            doi_confidence: confidence khi match by DOI.
            fuzzy_confidence: confidence khi fuzzy fallback.
        """
        self.fuzzy_threshold = fuzzy_threshold
        self.author_year_confidence = author_year_confidence
        self.numeric_confidence = numeric_confidence
        self.doi_confidence = doi_confidence
        self.fuzzy_confidence = fuzzy_confidence

    def link(
        self,
        body_citations: list[Citation],
        bib_citations: list[Citation],
    ) -> LinkingResult:
        """Link in-text occurrences ↔ reference entries.

        Args:
            body_citations: Citation[] từ body (IN_TEXT / NUMERIC type).
            bib_citations: Citation[] từ bibliography (REFERENCE_LIST type).

        Returns:
            LinkingResult với:
            - links: list[CitationLink] (1 per body_citations)
            - unmatched_in_text: IDs của in-text không match bib nào
            - unmatched_reference_ids: IDs của bib không match in-text nào
            - status_counts: summary
        """
        result = LinkingResult(
            total_citations=len(body_citations),
            total_references=len(bib_citations),
        )

        # Index bib citations by different keys
        bib_by_doi = self._index_by_doi(bib_citations)
        bib_by_index = self._index_by_numeric(bib_citations)
        bib_by_author_year = self._index_by_author_year(bib_citations)
        bib_by_author_year_suffix = self._index_by_author_year_suffix(bib_citations)

        # Learn corporate acronym definitions introduced in body citations
        # e.g. "(National Institute of Mental Health [NIMH], 2022)" -> map ("nimh", "2022") to same bib
        for cit in body_citations:
            acr_m = re.search(
                r"([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s,&\-]{5,80}?)\s*\[([A-ZĐ]{2,12})\]",
                cit.raw_text or "",
            )
            if acr_m:
                full_org = self._fold_author_key(acr_m.group(1).strip(" ()[].,"))
                acr_key = acr_m.group(2).strip().lower()
                if full_org and acr_key:
                    for (k_auth, k_yr), k_bibs in list(bib_by_author_year.items()):
                        if k_auth == full_org or full_org in k_auth:
                            for kb in k_bibs:
                                if kb not in bib_by_author_year.setdefault((acr_key, k_yr), []):
                                    bib_by_author_year[(acr_key, k_yr)].append(kb)

        # Track which bib entries are matched (by index) — each entry is
        # matched when at least one occurrence resolves to it; multiple
        # occurrences (and multiple indices inside one "[9, 10]") may point
        # at the same entry, which is valid.
        bib_matched: set[int] = set()
        prev_matched_links: list[CitationLink] | None = None

        for i, cit in enumerate(body_citations):
            occ_id = cit.reference_id or f"occ-{i:04d}"

            # Support sequential Ibid. / Id. footnote inheritance
            if (
                prev_matched_links
                and re.match(r"^[\(\[]?\s*(?:ibid\.?|id\.?)\b", (cit.raw_text or "").strip(), re.IGNORECASE)
            ):
                links = [
                    CitationLink(
                        occurrence_id=occ_id,
                        reference_id=prev_matched_links[0].reference_id,
                        status=CitationMappingStatus.MATCHED,
                        confidence=prev_matched_links[0].confidence,
                        method=prev_matched_links[0].method,
                    )
                ]
            else:
                # Try match methods in priority order.  One occurrence may resolve
                # to several references at once ("[9, 10]" cites both 9 and 10), so
                # this returns a list.
                links = self._try_match(
                    cit, occ_id, bib_by_doi, bib_by_index,
                    bib_by_author_year, bib_by_author_year_suffix,
                    bib_citations
                )

            if links:
                if any(lnk.status == CitationMappingStatus.MATCHED for lnk in links):
                    prev_matched_links = [lnk for lnk in links if lnk.status == CitationMappingStatus.MATCHED]
                for link in links:
                    # Populate evidence['raw'] so downstream lookups can find
                    # this link by the in-text citation's raw_text (the pipeline
                    # indexes links by lowercased raw_text).
                    link.evidence["raw"] = cit.raw_text
                    result.add_link(link)
                    # Track matched bibs (without blocking reuse)
                    if link.reference_id:
                        for idx, bib in enumerate(bib_citations):
                            if (bib.reference_id or f"ref-{idx:04d}") == link.reference_id:
                                bib_matched.add(idx)
                                break
                best_link = next(
                    (lnk for lnk in links if lnk.status == CitationMappingStatus.MATCHED),
                    links[0],
                )
                cit.mapping_status = (
                    best_link.status.value
                    if hasattr(best_link.status, "value")
                    else str(best_link.status)
                )
                cit.mapping_confidence = best_link.confidence
                cit.citation_link = best_link
                cit.citation_links = list(links)
            else:
                # No match → MISSING_REFERENCE. Also set raw so lookups succeed.
                missing_link = CitationLink(
                    occurrence_id=occ_id,
                    reference_id=None,
                    status=CitationMappingStatus.MISSING_REFERENCE,
                    confidence=0.0,
                    method=MappingMethod.NO_KEYS,
                    evidence={"raw": cit.raw_text},
                )
                result.add_link(missing_link)
                cit.mapping_status = CitationMappingStatus.MISSING_REFERENCE.value
                cit.mapping_confidence = 0.0
                cit.citation_link = missing_link
                cit.citation_links = [missing_link]

        # Find unmatched bib entries → UNCITED_REFERENCE, and populate mapping
        # metadata on matched/unmatched bib entries.
        for i, bib in enumerate(bib_citations):
            ref_id = bib.reference_id or f"ref-{i:04d}"
            matched_links = [
                lnk
                for lnk in result.links
                if lnk.reference_id == ref_id
                and getattr(lnk.status, "value", lnk.status) == "matched"
            ]
            if i in bib_matched and matched_links:
                bib.mapping_status = CitationMappingStatus.MATCHED.value
                bib.mapping_confidence = max(lnk.confidence for lnk in matched_links)
                bib.citation_link = matched_links[0]
                bib.citation_links = list(matched_links)
            else:
                result.unmatched_reference_ids.append(ref_id)
                bib.mapping_status = CitationMappingStatus.UNCITED_REFERENCE.value
                bib.mapping_confidence = 1.0
                bib.citation_link = None
                bib.citation_links = []

        return result

    # -- internal helpers --

    def _try_match(
        self,
        cit: Citation,
        occ_id: str,
        bib_by_doi: dict[str, Citation],
        bib_by_index: dict[int, Citation],
        bib_by_author_year: dict[tuple[str, str], list[Citation]],
        bib_by_author_year_suffix: dict[tuple[str, str, str], list[Citation]],
        bib_citations: list[Citation],
    ) -> list[CitationLink] | None:
        """Try matching in priority: TEI_LINK → DOI → NUMERIC → AUTHOR_YEAR → FUZZY.

        TEI_LINK (v1.10 GROBID adapter): Sử dụng grobid_ref_id từ TEI XML
        để map trực tiếp in-text → reference. Đây là authoritative link
        từ GROBID's structured extraction.

        Returns a LIST of links: ``None`` when nothing matched, otherwise one
        link per reference the occurrence cites (a single numeric occurrence
        such as ``[9, 10]`` cites two).

        NOTE: No blocking — same reference entry can match multiple in-text
        occurrences. This is valid: the same source may be cited multiple times.
        Unmatched references (uncited entries) are detected after all linking.
        """

        def _one(link: CitationLink) -> list[CitationLink]:
            """Wrap a single-link decision in the list contract."""
            return [link]

        def _bib_link(bib_match: Citation, confidence: float, method) -> list[CitationLink]:
            """Build a MATCHED link pointing at ``bib_match``."""
            bib_idx = self._find_bib_index(bib_match, bib_citations)
            return _one(
                CitationLink(
                    occurrence_id=occ_id,
                    reference_id=bib_match.reference_id or f"ref-{bib_idx:04d}",
                    status=CitationMappingStatus.MATCHED,
                    confidence=confidence,
                    method=method,
                )
            )

        # 0. TEI_LINK (GROBID adapter v1.10) — highest priority
        # GROBID provides authoritative xml:id links between in-text and bib
        # e.g. in-text cites "b0" and bib has id="b0" → direct match
        if hasattr(cit, 'grobid_ref_id') and cit.grobid_ref_id:
            cit_grobid_id = str(cit.grobid_ref_id).strip().lstrip("#")
            cit_yr_m = re.search(r"\b((?:19|20)\d{2})\b", str(cit.year or cit.raw_text or ""))
            cit_yr_int = int(cit_yr_m.group(1)) if cit_yr_m else None
            # Build bib index by grobid_ref_id
            for bib in bib_citations:
                bib_grobid_id = getattr(bib, 'grobid_ref_id', None)
                if bib_grobid_id and str(bib_grobid_id).strip().lstrip("#") == cit_grobid_id:
                    bib_yr_m = re.search(r"\b((?:19|20)\d{2})\b", str(bib.year or ""))
                    bib_yr_int = int(bib_yr_m.group(1)) if bib_yr_m else None
                    if cit_yr_int and bib_yr_int and abs(cit_yr_int - bib_yr_int) > 9:
                        break
                    return _bib_link(
                        bib, 0.98, MappingMethod.TEI_LINK  # type: ignore
                    )

        # 1. DOI exact
        doi = self._extract_doi(cit.raw_text)
        if doi and doi in bib_by_doi:
            return _bib_link(
                bib_by_doi[doi], self.doi_confidence, MappingMethod.DOI_EXACT
            )

        # 2. NUMERIC_INDEX (IEEE)
        #
        # A single occurrence may cite SEVERAL references at once — "[9, 10]",
        # "[3, 25]", "[26-28]".  Every resolvable index gets its OWN link: the
        # report must show the occurrence linked to all of them, and the
        # "cited in text" count of each reference must include this occurrence.
        # Returning inside the loop (the previous behaviour) dropped every
        # index after the first.
        if cit.citation_type == CitationType.NUMERIC:
            links: list[CitationLink] = []
            for idx in self._extract_numeric_indices(cit.raw_text):
                bib_ref = bib_by_index.get(idx)
                if bib_ref is None:
                    continue
                bib_idx = self._find_bib_index(bib_ref, bib_citations)
                links.append(
                    CitationLink(
                        occurrence_id=occ_id,
                        reference_id=bib_ref.reference_id or f"ref-{bib_idx:04d}",
                        status=CitationMappingStatus.MATCHED,
                        confidence=self.numeric_confidence,
                        method=MappingMethod.NUMERIC_INDEX,
                    )
                )
            if links:
                return links

        # 3. AUTHOR_YEAR (APA-like)
        # A single parenthetical citation often contains several independent
        # author-year keys separated by semicolons.  The extractor keeps this
        # as one occurrence (important for audit/UI), but the occurrence must
        # still link to every cited bibliography entry.
        if cit.citation_type == CitationType.IN_TEXT and ";" in cit.raw_text:
            multi_links: list[CitationLink] = []
            has_trailing_secondary = bool(_SECONDARY_CITATION_RE.search(cit.raw_text))
            for part in cit.raw_text.split(";"):
                # Splitting removes the outer closing parenthesis from every
                # component except the last one.  Parse each component as a
                # standalone APA key and repair PDF line-break hyphenation.
                part = re.sub(r"(?<=\w)-\s+(?=\w)", "", part).strip().strip("()[]")
                if not part:
                    continue
                sec_part_m = _SECONDARY_CITATION_RE.search(part)
                if sec_part_m:
                    part = sec_part_m.group(1).strip().strip("()[]")
                part = f"({part})"
                author_part, year_part, suffix_part = self._extract_author_year(part)
                if not author_part or not year_part:
                    mla_part_links = self._match_mla_author_page(part, occ_id, bib_citations)
                    if mla_part_links:
                        multi_links.extend(mla_part_links)
                    continue
                folded_part = self._fold_author_key(author_part)
                candidates = (
                    (
                        bib_by_author_year_suffix.get((author_part.lower(), year_part, suffix_part), [])
                        or bib_by_author_year_suffix.get((folded_part, year_part, suffix_part), [])
                    )
                    if suffix_part
                    else (
                        bib_by_author_year.get((author_part.lower(), year_part), [])
                        or bib_by_author_year.get((folded_part, year_part), [])
                    )
                )
                if candidates:
                    bib_idx = self._find_bib_index(candidates[0], bib_citations)
                    multi_links.append(CitationLink(
                        occurrence_id=occ_id,
                        reference_id=candidates[0].reference_id or f"ref-{bib_idx:04d}",
                        status=CitationMappingStatus.MATCHED,
                        confidence=self.author_year_confidence,
                        method=MappingMethod.AUTHOR_YEAR,
                    ))
                else:
                    fuzzy_semi = self._try_fuzzy_author_year(occ_id, author_part, year_part, bib_citations)
                    if fuzzy_semi is not None:
                        multi_links.append(fuzzy_semi)
                    elif not has_trailing_secondary:
                        multi_links.append(CitationLink(
                            occurrence_id=occ_id,
                            reference_id=None,
                            status=CitationMappingStatus.MISSING_REFERENCE,
                            confidence=0.0,
                            method=MappingMethod.NO_KEYS,
                        ))
            if any(lnk.status == CitationMappingStatus.MATCHED for lnk in multi_links):
                return multi_links

        # 3a. Secondary citation (trích dẫn gián tiếp): "(Smith, 2005, dẫn theo Tran, 2016)"
        # hoặc "Smith (2005, as cited in Tran, 2016)". Ưu tiên link tới nguồn thứ cấp
        # (tài liệu thực sự được liệt kê trong Danh mục TLTK theo chuẩn TDTU/APA).
        sec_m = _SECONDARY_CITATION_RE.search(cit.raw_text)
        if sec_m:
            sec_raw = sec_m.group(1).strip().strip("()")
            sec_probe = sec_raw if "(" in sec_raw else f"({sec_raw})"
            sec_author, sec_year, sec_suffix = self._extract_author_year(sec_probe)
            if sec_author and sec_year:
                sec_folded = self._fold_author_key(sec_author)
                if sec_suffix:
                    sec_cands = (
                        bib_by_author_year_suffix.get((sec_author.lower().strip(), sec_year, sec_suffix), [])
                        or bib_by_author_year_suffix.get((sec_folded, sec_year, sec_suffix), [])
                    )
                    if sec_cands:
                        return _bib_link(
                            sec_cands[0],
                            self.author_year_confidence,
                            MappingMethod.AUTHOR_YEAR,
                        )
                sec_cands = (
                    bib_by_author_year.get((sec_author.lower().strip(), sec_year), [])
                    or bib_by_author_year.get((sec_folded, sec_year), [])
                )
                if sec_cands:
                    return _bib_link(
                        sec_cands[0],
                        self.author_year_confidence,
                        MappingMethod.AUTHOR_YEAR,
                    )
                fuzzy_sec = self._try_fuzzy_author_year(occ_id, sec_author, sec_year, bib_citations)
                if fuzzy_sec is not None:
                    return _one(fuzzy_sec)

        author, year, year_suffix = self._extract_author_year(cit.raw_text)
        if not author and cit.authors:
            author = self._normalize_last_name(cit.authors[0])
            if not year and cit.year:
                year = str(cit.year)
        if author and year:
            folded_auth = self._fold_author_key(author)
            # Try exact match first (author + year + suffix)
            if year_suffix:
                candidates_suffix = (
                    bib_by_author_year_suffix.get((author.lower().strip(), year, year_suffix), [])
                    or bib_by_author_year_suffix.get((folded_auth, year, year_suffix), [])
                )
                if candidates_suffix:
                    return _bib_link(
                        candidates_suffix[0],
                        self.author_year_confidence,
                        MappingMethod.AUTHOR_YEAR,
                    )
            # Fallback: author + year only
            candidates = (
                bib_by_author_year.get((author.lower().strip(), year), [])
                or bib_by_author_year.get((folded_auth, year), [])
            )
            if not candidates:
                for alt_yr in re.findall(r"\b((?:19|20)\d{2})\b", cit.raw_text or ""):
                    if alt_yr != year:
                        candidates = (
                            bib_by_author_year.get((author.lower().strip(), alt_yr), [])
                            or bib_by_author_year.get((folded_auth, alt_yr), [])
                        )
                        if candidates:
                            break
            if candidates:
                if cit.title and len(candidates) > 1:
                    cit_t_low = cit.title.strip().lower()
                    t_matched = [c for c in candidates if (c.title or "").strip().lower() == cit_t_low]
                    if t_matched:
                        candidates = t_matched
                if len(candidates) > 1:
                    cit_raw_folded = self._fold_author_key(cit.raw_text or "")
                    co_matched = []
                    for c in candidates:
                        if c.authors and len(c.authors) >= 2:
                            co_raw = self._fold_author_key(
                                getattr(c.authors[1], "raw", None) or self._normalize_last_name(c.authors[1])
                            )
                            co_last = self._fold_author_key(self._normalize_last_name(c.authors[1]))
                            if (co_raw and len(co_raw) >= 3 and co_raw in cit_raw_folded) or (
                                co_last and len(co_last) >= 3 and co_last in cit_raw_folded
                            ):
                                co_matched.append(c)
                    if len(co_matched) == 1:
                        candidates = co_matched
                if not year_suffix and len(candidates) > 1 and (
                    year == "n.d." or not any(c.year_suffix for c in candidates)
                ):
                    return [
                        CitationLink(
                            occurrence_id=occ_id,
                            reference_id=c.reference_id or f"ref-{self._find_bib_index(c, bib_citations):04d}",
                            status=CitationMappingStatus.MATCHED,
                            confidence=self.author_year_confidence,
                            method=MappingMethod.AUTHOR_YEAR,
                        )
                        for c in candidates
                    ]
                return _bib_link(
                    candidates[0],
                    self.author_year_confidence,
                    MappingMethod.AUTHOR_YEAR,
                )

        # 3b. Fuzzy author-year & ORGANIZATION_AS_AUTHOR — handles 1-edit/transposition
        # surname typos, (n.d.) references, ±year slips on personal authors, and
        # publisher/institution or article title citations.
        if author and year:
            fuzzy_ay = self._try_fuzzy_author_year(occ_id, author, year, bib_citations)
            if fuzzy_ay is not None:
                return _one(fuzzy_ay)
            org = self._try_org_author(cit, occ_id, author, year, bib_citations)
            if org is not None:
                return _one(org)

        # 3c. MLA Author-Page linking: "(Smith 25)", "(Smith and Doe 42)", "(Smith et al. 105)"
        if cit.citation_type == CitationType.IN_TEXT and not year:
            mla_links = self._match_mla_author_page(
                cit.raw_text, occ_id, bib_citations, cit_authors=cit.authors
            )
            if mla_links:
                return mla_links

        # 4. FUZZY — title similarity (if bib entries have title_normalized)
        best = self._try_fuzzy(cit, occ_id, bib_by_doi, bib_citations)
        if best is not None:
            return _one(best)

        # No match
        return None

    @staticmethod
    def _fold_author_key(text: str) -> str:
        """Fold ligatures, diacritics, curly apostrophes, hyphens, and generational suffixes for author matching."""
        if not text:
            return ""
        pre = (
            text.replace("\u2019", "'")
            .replace("\u2018", "'")
            .replace("`", "'")
            .replace("æ", "ae")
            .replace("Æ", "ae")
            .replace("œ", "oe")
            .replace("Œ", "oe")
            .replace("ø", "o")
            .replace("Ø", "o")
            .replace("ł", "l")
            .replace("Ł", "l")
            .replace("ß", "ss")
            .replace("đ", "d")
            .replace("Đ", "d")
        )
        folded = unicodedata.normalize("NFKD", pre).encode("ascii", "ignore").decode("ascii")
        folded = folded.lower().strip()
        folded = re.sub(r"\s*[-–]\s*", "-", folded)
        folded = re.sub(r"\s+\b(?:iii|ii|iv|jr|sr)\.?$", "", folded)
        folded = re.sub(r"\s+", " ", folded)
        return folded.strip()

    def _try_fuzzy_author_year(
        self,
        occ_id: str,
        author: str,
        year: str,
        bib_citations: list[Citation],
    ) -> CitationLink | None:
        """Fallback for 1-edit/transposition surname typos on same year, (n.d.) bibs, or year slip on unique personal author."""
        author_folded = self._fold_author_key(author)
        if not author_folded or len(author_folded) < 3:
            return None

        # Pass 1: Exact surname match against an (n.d.) entry (bib.year is None)
        for bib_idx, bib in enumerate(bib_citations):
            if not bib.authors or bib.year is not None:
                continue
            bib_first = self._fold_author_key(self._normalize_last_name(bib.authors[0]))
            if author_folded == bib_first or (
                len(author_folded) >= 5 and author_folded in bib_first
            ):
                return CitationLink(
                    occurrence_id=occ_id,
                    reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                    status=CitationMappingStatus.MATCHED,
                    confidence=self.author_year_confidence,
                    method=MappingMethod.AUTHOR_YEAR,
                )

        # Pass 2: Minor spelling/transposition typo on surname when year agrees (e.g. Beauvias/Beauvais, Adizogel/Adigozel, Kato-Katoaka/Kato-Kataoka, Shet/Shen, Zade/Zadeh)
        if len(author_folded) >= 3:
            for bib_idx, bib in enumerate(bib_citations):
                if not bib.authors or (bib.year or "") != year:
                    continue
                bib_first = self._fold_author_key(self._normalize_last_name(bib.authors[0]))
                cand_firsts = [bib_first] + [p for p in bib_first.split("-") if len(p) >= 4]
                if len(author_folded) >= 4:
                    for bf in cand_firsts:
                        if not bf or len(bf) < 4 or author_folded[0] != bf[0]:
                            continue
                        ratio = difflib.SequenceMatcher(None, author_folded, bf).ratio()
                        one_char_diff = (
                            len(author_folded) == len(bf)
                            and sum(a != b for a, b in zip(author_folded, bf, strict=False)) == 1
                        ) or (
                            abs(len(author_folded) - len(bf)) == 1
                            and (bf.startswith(author_folded) or author_folded.startswith(bf))
                        ) or (
                            len(author_folded) >= 5
                            and sorted(author_folded) == sorted(bf)
                            and sum(a != b for a, b in zip(author_folded, bf, strict=False)) <= 3
                        )
                        if ratio >= 0.84 or one_char_diff:
                            return CitationLink(
                                occurrence_id=occ_id,
                                reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                                status=CitationMappingStatus.MATCHED,
                                confidence=self.fuzzy_confidence,
                                method=MappingMethod.FUZZY,
                            )
                # Co-author surname fallback when year agrees and student cited a co-author with et al.
                for co_auth in bib.authors[1:]:
                    co_last = self._fold_author_key(self._normalize_last_name(co_auth))
                    if co_last and co_last == author_folded:
                        return CitationLink(
                            occurrence_id=occ_id,
                            reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                            status=CitationMappingStatus.MATCHED,
                            confidence=self.fuzzy_confidence,
                            method=MappingMethod.FUZZY,
                        )

        # Pass 3: Personal author with year difference when author surname uniquely matches in bib.authors
        if year.isdigit() and len(author_folded) >= 4 and not _INSTITUTIONAL_AUTHOR_RE.search(author):
            yr_int = int(year)
            for bib_idx, bib in enumerate(bib_citations):
                if not bib.authors or not bib.year or not str(bib.year).isdigit():
                    continue
                bib_first = self._fold_author_key(self._normalize_last_name(bib.authors[0]))
                bib_raw_folded = self._fold_author_key(getattr(bib.authors[0], "raw", "") or "")
                short_first = bib_first.split()[-1] if " " in bib_first else bib_first
                max_yr_diff = 15 if (len(author_folded.split()) >= 3 and len(bib.authors) >= 2) else 9
                if author_folded in (bib_first, short_first, bib_raw_folded) and abs(int(bib.year) - yr_int) <= max_yr_diff:
                    return CitationLink(
                        occurrence_id=occ_id,
                        reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                        status=CitationMappingStatus.MATCHED,
                        confidence=self.fuzzy_confidence,
                        method=MappingMethod.AUTHOR_YEAR,
                    )

        return None

    def _match_mla_author_page(
        self,
        raw_text: str,
        occ_id: str,
        bib_citations: list[Citation],
        cit_authors: list | None = None,
    ) -> list[CitationLink]:
        """Match an MLA author-page citation against bibliography entries."""
        mla_m = _MLA_AUTHOR_PAGE_RE.match(raw_text.strip())
        if mla_m:
            raw_mla_author = (mla_m.group(1) or mla_m.group(2) or mla_m.group(3) or "").strip()
            norm_mla_author = self._fold_author_key(self._clean_intext_author(raw_mla_author))
        elif cit_authors:
            raw_mla_author = self._normalize_last_name(cit_authors[0])
            norm_mla_author = self._fold_author_key(raw_mla_author)
        else:
            return []
        if not norm_mla_author:
            return []

        matched_bibs: list[Citation] = []
        for bib in bib_citations:
            if not bib.authors:
                continue
            first_last = self._fold_author_key(self._normalize_last_name(bib.authors[0]))
            short_last = first_last.split()[-1] if " " in first_last else first_last
            if norm_mla_author in (first_last, short_last) or (
                len(norm_mla_author) >= 5
                and len(first_last) >= 5
                and norm_mla_author[0] == first_last[0]
                and difflib.SequenceMatcher(None, norm_mla_author, first_last).ratio() >= 0.85
            ) or bib.title_normalized and norm_mla_author == bib.title_normalized.strip() or (
                bib.title
                and len(norm_mla_author) >= 4
                and re.search(rf"\b{re.escape(norm_mla_author)}\b", bib.title.lower())
                and any("euripides" in str(a).lower() or "sophocles" in str(a).lower() or "shakespeare" in str(a).lower() for a in bib.authors)
            ):
                matched_bibs.append(bib)

        if not matched_bibs:
            return []

        return [
            CitationLink(
                occurrence_id=occ_id,
                reference_id=bib.reference_id or f"ref-{self._find_bib_index(bib, bib_citations):04d}",
                status=CitationMappingStatus.MATCHED,
                confidence=self.author_year_confidence,
                method=MappingMethod.AUTHOR_YEAR,
            )
            for bib in matched_bibs
        ]

    def _try_org_author(
        self,
        cit: Citation,
        occ_id: str,
        author: str,
        year: str,
        bib_citations: list[Citation],
    ) -> CitationLink | None:
        """Match an organization or title-first in-text name against entry title/venue/authors/raw_text."""
        token = re.sub(r"^the\s+", "", author.strip(), flags=re.IGNORECASE).lower().strip()
        if not token or len(token) < 2:
            return None
        is_multi_word = " " in token
        compact_token = re.sub(r"[^a-z0-9]", "", token)

        for bib_idx, bib in enumerate(bib_citations):
            bib_yr = bib.year or "n.d."
            if bib_yr != year and not (bib.year is None and year in (bib.raw_text or "")):
                continue
            haystack = " ".join(
                str(part or "")
                for part in (bib.title, bib.venue, " ".join(str(a) for a in (bib.authors or [])), bib.raw_text)
            ).lower()

            # Check corporate acronym (e.g. "spj", "spj national president...", "nimh", "cisa")
            org_acronyms: set[str] = set()
            for auth in bib.authors or []:
                auth_str = auth if isinstance(auth, str) else getattr(auth, "last_name", "") or ""
                words = [w for w in re.split(r"\W+", auth_str) if w and len(w) > 2 and w.lower() not in ("and", "the", "for", "of")]
                if len(words) >= 2:
                    org_acronyms.add("".join(w[0].lower() for w in words))

            first_tok = token.split()[0]
            if first_tok in org_acronyms and (not is_multi_word or "president" in token):
                return CitationLink(
                    occurrence_id=occ_id,
                    reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                    status=CitationMappingStatus.MATCHED,
                    confidence=self.fuzzy_confidence,
                    method=MappingMethod.FUZZY,
                )

            if is_multi_word:
                if token in haystack or self._org_token_in_haystack(token, haystack):
                    return CitationLink(
                        occurrence_id=occ_id,
                        reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                        status=CitationMappingStatus.MATCHED,
                        confidence=self.author_year_confidence,
                        method=MappingMethod.AUTHOR_YEAR,
                    )
                if bib.title:
                    compact_title = re.sub(r"[^a-z0-9]", "", bib.title.lower())
                    if compact_token and compact_title and (
                        compact_token in compact_title
                        or compact_title in compact_token
                        or difflib.SequenceMatcher(None, compact_token, compact_title).ratio() >= 0.85
                    ):
                        return CitationLink(
                            occurrence_id=occ_id,
                            reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                            status=CitationMappingStatus.MATCHED,
                            confidence=self.author_year_confidence,
                            method=MappingMethod.AUTHOR_YEAR,
                        )
                if bib.authors:
                    compact_auth = re.sub(r"[^a-z0-9]", "", str(bib.authors[0]).lower())
                    if len(compact_token) >= 8 and len(compact_auth) >= 8 and difflib.SequenceMatcher(None, compact_token, compact_auth).ratio() >= 0.85:
                        return CitationLink(
                            occurrence_id=occ_id,
                            reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                            status=CitationMappingStatus.MATCHED,
                            confidence=self.author_year_confidence,
                            method=MappingMethod.AUTHOR_YEAR,
                        )
                continue

            if token in org_acronyms or self._org_token_in_haystack(token, haystack):
                return CitationLink(
                    occurrence_id=occ_id,
                    reference_id=bib.reference_id or f"ref-{bib_idx:04d}",
                    status=CitationMappingStatus.MATCHED,
                    confidence=self.fuzzy_confidence,
                    method=MappingMethod.FUZZY,
                )
        return None

    @staticmethod
    def _org_token_in_haystack(token: str, haystack: str) -> bool:
        """True if an organization name appears in an entry.

        Handles exact words ("revenuecat") and slightly mangled concatenations
        ("sportsfitnessapps" vs "sport fitness apps"). Each alphanumeric run of
        the haystack is compared with a high similarity threshold so ordinary
        surnames appearing in a title do not match.
        """
        if re.search(rf"\b{re.escape(token)}\b", haystack):
            return True
        compact_token = re.sub(r"[^a-z0-9]", "", token)
        for word in re.split(r"[^a-z0-9]+", haystack):
            if not word:
                continue
            if len(word) >= 4 and difflib.SequenceMatcher(
                None, compact_token, word
            ).ratio() >= 0.9:
                return True
        return False

    def _try_fuzzy(
        self,
        cit: Citation,
        occ_id: str,
        bib_by_doi: dict[str, Citation],
        bib_citations: list[Citation],
    ) -> CitationLink | None:
        """Fuzzy match: normalized title similarity."""
        if not cit.title_normalized:
            return None

        best_bib_idx = None
        best_score = 0.0

        for bib_idx, bib in enumerate(bib_citations):
            if bib.title_normalized:
                score = self._title_similarity(cit.title_normalized, bib.title_normalized)
                if score > best_score:
                    best_score = score
                    best_bib_idx = bib_idx

        if best_bib_idx is not None and best_score >= self.fuzzy_threshold:
            bib = bib_citations[best_bib_idx]
            return CitationLink(
                occurrence_id=occ_id,
                reference_id=bib.reference_id or f"ref-{best_bib_idx:04d}",
                status=CitationMappingStatus.MATCHED,
                confidence=best_score * self.fuzzy_confidence,
                method=MappingMethod.FUZZY,
            )
        return None

    def _find_bib_index(self, bib: Citation, bib_citations: list[Citation]) -> int:
        """Tìm index của bib trong bib_citations."""
        for i, b in enumerate(bib_citations):
            if b is bib:
                return i
        return 0

    # -- index builders --

    def _index_by_doi(self, bibs: list[Citation]) -> dict[str, Citation]:
        out: dict[str, Citation] = {}
        for bib in bibs:
            doi = (bib.doi or "").strip()
            if doi:
                out[doi.lower()] = bib
        return out

    def _index_by_numeric(self, bibs: list[Citation]) -> dict[int, Citation]:
        out: dict[int, Citation] = {}
        for bib in bibs:
            if bib.numeric_index is not None and bib.numeric_index not in out:
                out[bib.numeric_index] = bib
        return out

    def _index_by_author_year(
        self, bibs: list[Citation]
    ) -> dict[tuple[str, str], list[Citation]]:
        out: dict[tuple[str, str], list[Citation]] = {}
        for bib in bibs:
            bib_yr = bib.year or "n.d."
            years_to_index = [bib_yr]
            if bib.year is None or bib.matched_pattern == "vn_legal_document":
                for yr_m in re.findall(r"\b((?:18|19|20)\d{2})\b", bib.raw_text or ""):
                    if yr_m not in years_to_index:
                        years_to_index.append(yr_m)
            for yr in years_to_index:
                if bib.authors:
                    for auth_idx, auth_obj in enumerate(bib.authors):
                        if auth_idx > 0 and bib.matched_pattern != "vn_legal_document":
                            raw_co = (getattr(auth_obj, "raw", None) or (auth_obj if isinstance(auth_obj, str) else "")).strip()
                            if "," in raw_co or len(raw_co.split()) < 2:
                                continue
                        last_name = self._normalize_last_name(auth_obj)
                        raw_auth = (getattr(auth_obj, "raw", None) or (auth_obj if isinstance(auth_obj, str) else "")).strip()
                        candidate_names = [last_name]
                        if raw_auth and "," not in raw_auth and raw_auth.lower() != (last_name or "").lower():
                            candidate_names.append(raw_auth)
                        # Extract explicit parenthesized/bracketed acronym in corporate author name (e.g. "World Health Organization (WHO)")
                        for acr_m in re.findall(r"[\(\[]([A-ZĐ]{2,12})[\)\]]", raw_auth):
                            candidate_names.append(acr_m)
                        if _INSTITUTIONAL_AUTHOR_RE.search(raw_auth):
                            org_words = [
                                w for w in re.split(r"\W+", raw_auth)
                                if len(w) >= 2 and w.lower() not in {"of", "for", "the", "and", "in", "on", "to", "va", "và", "của", "về", "các"}
                            ]
                            if 3 <= len(org_words) <= 8:
                                candidate_names.append("".join(w[0] for w in org_words))
                        for cname in candidate_names:
                            if not cname:
                                continue
                            folded = self._fold_author_key(cname)
                            for ln_variant in {cname.lower(), folded, folded.replace("-", " "), folded.replace(" ", "-")}:
                                if not ln_variant:
                                    continue
                                key = (ln_variant, yr)
                                if bib not in out.setdefault(key, []):
                                    out[key].append(bib)
                            if " " in folded and bib.matched_pattern != "vn_legal_document" and auth_idx == 0:
                                for short_tok in (folded.split()[-1], folded.removeprefix("national ")):
                                    short_key = (short_tok.lower(), yr)
                                    if bib not in out.setdefault(short_key, []):
                                        out[short_key].append(bib)
                # Also index raw institutional author head before (Year)/(n.d.) if present
                raw_head_m = re.match(
                    r"^([^\(]+?)\s*\(\s*(?:(?:18|19|20)\d{2}|n\.?\s*d\.?)",
                    bib.raw_text or "",
                    re.IGNORECASE,
                )
                if raw_head_m:
                    raw_head = raw_head_m.group(1).strip().rstrip(".,").strip()
                    if _INSTITUTIONAL_AUTHOR_RE.search(raw_head):
                        for h_var in {raw_head.lower(), self._fold_author_key(raw_head)}:
                            inst_key = (h_var, yr)
                            if bib not in out.setdefault(inst_key, []):
                                out[inst_key].append(bib)
                # Also index main work title (before colon/parenthesis) for title-date citations like "Capitalism and Slavery (1944)"
                if bib.title and len(bib.title.strip()) >= 4:
                    main_title = re.split(r"[:(\[]", bib.title.strip())[0].strip().rstrip(".,")
                    for t_cand in {main_title, re.sub(r"^(?:the|a|an)\s+", "", main_title, flags=re.I).strip()}:
                        if 4 <= len(t_cand) <= 65:
                            for t_var in {t_cand.lower(), self._fold_author_key(t_cand)}:
                                if t_var:
                                    t_key = (t_var, yr)
                                    if bib not in out.setdefault(t_key, []):
                                        out[t_key].append(bib)
        return out

    def _index_by_author_year_suffix(
        self, bibs: list[Citation]
    ) -> dict[tuple[str, str, str], list[Citation]]:
        """Index bibs by (last_name, year, year_suffix) for 2020a/2020b/n.d.-a matching."""
        out: dict[tuple[str, str, str], list[Citation]] = {}
        for bib in bibs:
            bib_yr = bib.year or "n.d."
            year_suffix = bib.year_suffix or ""
            if bib.authors:
                for auth_idx, auth_obj in enumerate(bib.authors):
                    if auth_idx > 0 and bib.matched_pattern != "vn_legal_document":
                        raw_co = (getattr(auth_obj, "raw", None) or (auth_obj if isinstance(auth_obj, str) else "")).strip()
                        if "," in raw_co or len(raw_co.split()) < 2:
                            continue
                    last_name = self._normalize_last_name(auth_obj)
                    raw_auth = (getattr(auth_obj, "raw", None) or (auth_obj if isinstance(auth_obj, str) else "")).strip()
                    candidate_names = [last_name]
                    if raw_auth and "," not in raw_auth and raw_auth.lower() != (last_name or "").lower():
                        candidate_names.append(raw_auth)
                    for cname in candidate_names:
                        if not cname:
                            continue
                        folded = self._fold_author_key(cname)
                        for ln_variant in {cname.lower(), folded, folded.replace("-", " "), folded.replace(" ", "-")}:
                            if not ln_variant:
                                continue
                            key = (ln_variant, bib_yr, year_suffix)
                            if bib not in out.setdefault(key, []):
                                out[key].append(bib)
                        if " " in folded and bib.matched_pattern != "vn_legal_document" and auth_idx == 0:
                            short_key = (folded.split()[-1].lower(), bib_yr, year_suffix)
                            if bib not in out.setdefault(short_key, []):
                                out[short_key].append(bib)
            raw_head_m = re.match(
                r"^([^\(]+?)\s*\(\s*(?:(?:19|20)\d{2}|n\.?\s*d\.?)",
                bib.raw_text or "",
                re.IGNORECASE,
            )
            if raw_head_m:
                raw_head = raw_head_m.group(1).strip().rstrip(".,").strip()
                if _INSTITUTIONAL_AUTHOR_RE.search(raw_head):
                    for h_var in {raw_head.lower(), self._fold_author_key(raw_head)}:
                        inst_key = (h_var, bib_yr, year_suffix)
                        if bib not in out.setdefault(inst_key, []):
                            out[inst_key].append(bib)
        return out

    def _normalize_last_name(self, raw: str | object) -> str:
        """Extract last name from author data.

        Handles:
            - str "Smith, J." → "Smith"
            - str "De Choudhury, M." → "De Choudhury"
            - str "Smith J." / "Ashwini L. H." → "Smith" / "Ashwini"
            - str "De Choudhury" → "De Choudhury"
            - Author object → .last_name attribute
        """
        # Handle Author object from author_parser.py
        if not isinstance(raw, str):
            return getattr(raw, "last_name", "") or ""

        # String: "Smith, J." → "Smith"
        if "," in raw:
            last = raw.split(",")[0].strip()
        else:
            tokens = raw.split()
            if not tokens:
                return ""
            # Strip trailing single-letter initials ("Smith J.", "Ashwini L. H.")
            while len(tokens) >= 2 and len(tokens[-1].rstrip(".")) == 1 and tokens[-1][0].isupper():
                tokens = tokens[:-1]
            if len(tokens) >= 2 and len(tokens[0].rstrip(".")) == 1 and tokens[0][0].isupper():
                # "J. Smith" → "Smith"
                non_init = [t for t in tokens if len(t.rstrip(".")) > 1]
                last = " ".join(non_init) if non_init else tokens[-1]
            else:
                last = " ".join(tokens)
        return last.strip()

    # -- extractors --

    def _extract_doi(self, text: str) -> str | None:
        """Trích DOI từ raw text."""
        doi_match = re.search(
            r"10\.\d{4,}/[^\s\])\"'>]+", text, re.IGNORECASE
        )
        if doi_match:
            return doi_match.group(0).rstrip(".,;:").lower()
        return None

    def _extract_numeric_indices(self, text: str) -> list[int]:
        """Trích numeric indices từ [N], [N, M], [N-M], hoặc superscript ^N, ^N-M."""
        m = _IEEE_NUM_RE.search(text)
        raw_spec = m.group(1) if m else None
        if raw_spec is None:
            sup_m = re.search(r"\^(\d+(?:\s*[-–,]\s*\d+)*)", text)
            if sup_m:
                raw_spec = sup_m.group(1)
        if not raw_spec:
            return []
        indices: list[int] = []
        for token in re.split(r"\s*,\s*", raw_spec.strip()):
            range_m = re.match(r"^(\d+)\s*[-–]\s*(\d+)$", token.strip())
            if range_m:
                start, end = int(range_m.group(1)), int(range_m.group(2))
                if start <= end and (end - start) <= 50:
                    indices.extend(range(start, end + 1))
                else:
                    indices.extend([start, end])
            else:
                try:
                    indices.append(int(token.strip()))
                except ValueError:
                    pass
        return indices

    def _clean_intext_author(self, raw_author: str) -> str:
        """Strip et al. / caption prefixes / bracketed acronyms / 2nd+ authors."""
        # Strip bracketed acronym definitions like "[NIMH]", "[SAMHSA]" and surrounding quotes/parens
        cleaned = re.sub(r"\s*\[[^\]]+\]", "", raw_author).strip(" \t()[]\"'\u201c\u201d\u2018\u2019,")
        # Strip leading figure/table caption or discourse prefixes ("Adapted from ", "for example in ", "see ", "Only ", "Both ")
        cleaned = re.sub(
            r"^(?:.*?\b(?:for\s+example\s+in|such\s+as\s+in|adapted\s+from|reprinted\s+from|modified\s+from|data\s+from|derived\s+from|based\s+on|source\s*:|see\s+also|see|e\.g\.,?|i\.e\.,?|cf\.?)\s+|(?:only|both|either|neither)\s+)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip(" \t()[]\"'\u201c\u201d\u2018\u2019,")
        author_stripped = re.sub(
            r",?\s*(?:et\s+a?l\.?|and\s+others?|và\s+cộng\s+sự|và\s+cs\.?|và\s+ctv\.?|và\s+cộng\s+tác\s+viên)\s*$",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip().rstrip(",").strip(" \t\"'\u201c\u201d\u2018\u2019")
        author_stripped = re.sub(r"(?:'s|\u2019s)\b", "", author_stripped).strip()

        if _INSTITUTIONAL_AUTHOR_RE.search(author_stripped) or ":" in author_stripped:
            return author_stripped.strip(" .,")

        # Multi-author in-text: "Zhang và Hanks", "Carr & Kemmis", "Simon, Smith & West"
        # Split on " và ", " and ", " & ", or comma followed by another surname (2+ letters)
        multi_parts = re.split(
            r"\s*,\s*(?:và|and|&)\s+|\s+(?:và|and|&)\s+|,\s*(?=[A-Za-zÀ-ỹ]{2,})",
            author_stripped,
            flags=re.IGNORECASE,
        )
        if multi_parts and multi_parts[0].strip():
            author_stripped = multi_parts[0].strip()

        return self._normalize_last_name(author_stripped)

    @staticmethod
    def _parse_year_token(year_raw: str) -> tuple[str, str | None]:
        """Normalize year token ('2020a' -> ('2020', 'a'), 'n.d.-a' -> ('n.d.', 'a'))."""
        yr = re.sub(r"\s+", "", year_raw.strip().lower())
        nd_m = re.match(r"^n\.?d\.?(?:-([a-z]))?$", yr)
        if nd_m:
            return "n.d.", nd_m.group(1)
        if len(yr) == 5 and yr[:4].isdigit() and yr[4] in "abcdefgh":
            return yr[:4], yr[4]
        return yr[:4] if len(yr) >= 4 and yr[:4].isdigit() else yr, None

    def _extract_author_year(self, text: str) -> tuple[str | None, str | None, str | None]:
        """Trích (author, year, year_suffix) từ APA-style (Author, Year) hoặc (Author, n.d.)."""
        # Normalize newlines to spaces to handle line breaks in extracted text
        text_normalized = text.replace("\n", " ").replace("\r", " ")

        # Try standard APA format: (Author, Year) or (Author et al., Year)
        m = _APA_YEAR_RE.search(text_normalized)
        if m:
            raw_author = m.group(1).strip()
            year_raw = m.group(2).strip()
            # If raw_author contains a secondary citation ("Smith, 2005, dẫn theo Tran"),
            # strip everything up to the secondary citation keyword or take primary author.
            if re.search(r"\b(?:19|20)\d{2}\b", raw_author):
                raw_author = re.split(r",\s*(?:19|20)\d{2}", raw_author)[0].strip()
            year, year_suffix = self._parse_year_token(year_raw)
            normalized = self._clean_intext_author(raw_author)
            return normalized, year, year_suffix

        # Try "Author et al. / và cộng sự (Year)" format (no parens around author)
        m2 = _APA_ETAL_YEAR_RE.search(text_normalized)
        if m2:
            raw_author = m2.group(1).strip()
            year_raw = (m2.group(2) or m2.group(3) or "").strip()
            year, year_suffix = self._parse_year_token(year_raw)
            normalized = self._clean_intext_author(raw_author)
            return normalized, year, year_suffix

        m3 = _NARRATIVE_YEAR_RE.search(text_normalized)
        if m3:
            raw_author = m3.group(1).strip()
            year, year_suffix = self._parse_year_token(m3.group(2))
            return self._clean_intext_author(raw_author), year, year_suffix

        return None, None, None

    def _title_similarity(self, a: str, b: str) -> float:
        """Normalized title similarity (0.0–1.0) dùng character overlap."""
        if not a or not b:
            return 0.0
        a_words = set(a.split())
        b_words = set(b.split())
        if not a_words or not b_words:
            return 0.0
        # Jaccard similarity
        intersection = len(a_words & b_words)
        union = len(a_words | b_words)
        return intersection / union if union > 0 else 0.0
