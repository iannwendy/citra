"""FeatureCalculator -- gộp fuzzy + semantic + author/year/DOI thành MatchFeatures.

v1.3: Bổ sung content alignment features cho Neural layer.
"""

from __future__ import annotations

import re
from typing import Optional

from integrity_checker.matching.author_matcher import author_match_score
from integrity_checker.matching.fuzzy import FuzzyMatcher
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures


class FeatureCalculator:
    """Tính vector features giữa Citation và SourceCandidate tốt nhất.

    v1.2 task #29: Author matching dùng ``author_matcher`` (diacritics-fold +
    particle strip + last-name canonical). Trước đó dùng naive lowercase
    (sẽ fail cho "Nguyễn" vs "Nguyen" / "van der Berg" / "Smith J. K.").

    2026-09-15: SemanticMatcher uses singleton pattern to avoid reloading
    the ML model on each instantiation (~5s speedup per pipeline run).

    v1.3: Bổ sung content alignment check -- so sánh citation context
    với source metadata bằng Neural embeddings.
    """

    def __init__(
        self,
        fuzzy: FuzzyMatcher | None = None,
        semantic: SemanticMatcher | None = None,
        enable_content_alignment: bool = True,
    ) -> None:
        self.fuzzy = fuzzy or FuzzyMatcher()
        self.semantic = semantic or SemanticMatcher.get_instance()
        self.enable_content_alignment = enable_content_alignment

    def compute(
        self,
        citation: Citation,
        source: SourceResult,
        citation_context: str | None = None,
    ) -> MatchFeatures:
        """Tính features dựa trên candidate tốt nhất (highest confidence).

        Args:
            citation: Citation từ PDF extraction
            source: SourceResult từ retrieval
            citation_context: Optional context xung quanh citation (cho content alignment)
        """
        # Author Jaccard -- upgraded to author_matcher (task #29)
        # Fallback: if citation.authors is empty, try to extract from raw_text
        cited_authors = list(citation.authors or [])
        if not cited_authors and citation.raw_text:
            # Try to extract first author from raw text like "(Peters et al., 2018)"
            # Skip when raw_text starts directly with citation.title (title-first / authorless entry)
            raw = citation.raw_text or ""
            raw = re.sub(r'[\r\n]+', ' ', raw)  # Handle line breaks
            raw_no_idx = re.sub(r"^\s*(?:\[\s*\d+\s*\]\.?|\d{1,3}\s*[\.\)])\s*", "", raw).strip()
            t_prefix = (citation.title or "").strip().lower()[:15]
            is_title_first = bool(t_prefix and len(t_prefix) >= 6 and raw_no_idx.lower().startswith(t_prefix))
            if not is_title_first:
                match = re.search(
                    r"^[\(\s]*([A-ZÀ-ÖØ-ÞĐ][a-zà-ÿđ'-]+)",
                    raw,
                )
                if match:
                    extracted_author = match.group(1)
                    cited_authors = [extracted_author]

        best = self._select_best_candidate(citation, source, cited_authors)
        if best is None:
            return MatchFeatures(source_consensus=source.consensus_count())

        # Cross-candidate metadata fusion: enrich missing fields on `best` from consensus candidates
        best = self._fuse_consensus_metadata(best, source, cited_authors=cited_authors)

        # Title sim
        c_title = (citation.title or citation.raw_text).lower().strip()
        cand_title = (best.title or "").lower().strip()

        # FIX v1.11: Improved title matching for partial matches
        fuzzy_sim = self._compute_title_similarity(
            c_title, cand_title, is_raw_fallback=not bool(citation.title)
        )
        c_primary, c_alts = self._strip_medium_tags_and_extract_alt_titles(citation.title or citation.raw_text)
        cand_primary, cand_alts = self._strip_medium_tags_and_extract_alt_titles(best.title or "")
        semantic_sim = self.semantic.similarity(c_primary, cand_primary)
        for alt_c in c_alts:
            semantic_sim = max(semantic_sim, self.semantic.similarity(alt_c, cand_primary))
        for alt_cand in cand_alts:
            semantic_sim = max(semantic_sim, self.semantic.similarity(c_primary, alt_cand))

        cross_lingual_title_detected = False
        cross_lingual_title_sim = 0.0
        title_bridged_concepts: list[str] = []
        if fuzzy_sim < 0.65 and hasattr(self.semantic, "cross_lingual_title_similarity"):
            is_xl_t, xl_t_sim, xl_t_concepts = self.semantic.cross_lingual_title_similarity(
                c_primary, cand_primary
            )
            if is_xl_t and xl_t_sim >= 0.55:
                cross_lingual_title_detected = True
                cross_lingual_title_sim = xl_t_sim
                title_bridged_concepts = xl_t_concepts
                # Cap at 0.85 so translated-only titles fall into METADATA_ERROR band [0.60, 0.90)
                semantic_sim = max(semantic_sim, min(0.85, xl_t_sim))

        author_sim = author_match_score(
            cited_authors,
            list(best.authors or []),
        )

        # DOI exact match (normalized + known arXiv/ACL equivalent DOIs + explicit arXiv ID)
        from integrity_checker.retrieval.arxiv_client import ArxivClient

        cit_arxiv_id = ArxivClient.extract_arxiv_id(citation)
        cit_doi_effective = citation.doi
        if not cit_doi_effective and cit_arxiv_id:
            cit_doi_effective = f"10.48550/arxiv.{cit_arxiv_id}"
        doi_match = self._doi_matches(cit_doi_effective, best.doi)

        # Year distance
        year_dist = self._year_distance(citation.year, best.year)
        if year_dist > 1 and fuzzy_sim >= 0.95 and author_sim >= 0.80:
            same_work_dists = [
                self._year_distance(citation.year, c.year)
                for c in source.candidates
                if c.found
                and (not doi_match or self._doi_matches(cit_doi_effective, c.doi))
                and self._compute_title_similarity(
                    c_title,
                    (c.title or "").lower().strip(),
                    is_raw_fallback=not bool(citation.title),
                )
                >= 0.95
            ]
            if same_work_dists:
                year_dist = min(year_dist, min(same_work_dists))

        # FIX Phase 3 (BUG-21): Recognize exact arXiv ID match when candidate returned its
        # published conference/journal DOI alongside external_ids["arxiv"] (or vice versa)
        if not doi_match and cit_arxiv_id:
            cand_arxiv_id = None
            if best.external_ids:
                cand_arxiv_id = best.external_ids.get("arxiv") or best.external_ids.get("ArXiv")
            if not cand_arxiv_id and (best.doi or best.url):
                cand_arxiv_id = ArxivClient.extract_arxiv_id(
                    Citation(raw_text="", doi=best.doi, url=best.url)
                )
            if cand_arxiv_id and cand_arxiv_id.lower() == cit_arxiv_id.lower():
                doi_match = True
        if (
            not doi_match
            and cit_doi_effective
            and best.doi
            and fuzzy_sim >= 0.90
            and author_sim >= 0.70
        ):
            d1_norm = self._normalize_doi_str(cit_doi_effective)
            d2_norm = self._normalize_doi_str(best.doi)
            if d1_norm.startswith("10.48550/arxiv") != d2_norm.startswith("10.48550/arxiv"):
                doi_match = True

        # Venue similarity
        venue_sim = 0.0
        if citation.venue and best.venue:
            from integrity_checker.matching.venue_normalizer import VenueNormalizer

            venue_sim = VenueNormalizer().similarity(citation.venue, best.venue)

        # Content alignment (NEW v1.3 / v2.1) - Deep Neural Layer
        content_alignment_score = 0.0
        content_alignment_confidence = ""
        content_is_aligned = False
        title_context_sim = 0.0
        abstract_context_sim = 0.0
        best_evidence_sentence = ""
        best_evidence_score = 0.0
        best_cited_sentence = ""
        citation_intent = ""
        stance_label = ""
        cross_lingual_detected = bool(cross_lingual_title_detected)
        bridged_concepts: list[str] = list(title_bridged_concepts)
        context_source = str(getattr(citation, "_context_source", "") or "")
        occurrence_alignments: list[dict] = []

        if self.enable_content_alignment and citation_context:
            # Resolve abstract across all agreeing candidates if best.abstract is missing
            resolved_abstract = getattr(best, "abstract", None)
            if not resolved_abstract:
                for cand in source.candidates:
                    cand_abs = getattr(cand, "abstract", None)
                    if cand.found and cand_abs:
                        cand_t = (cand.title or "").lower().strip()
                        if (
                            self._doi_matches(best.doi, cand.doi)
                            or self._compute_title_similarity(cand_title, cand_t) >= 0.80
                        ):
                            resolved_abstract = cand_abs
                            best.abstract = cand_abs
                            break

            inferred_marker = citation.raw_in_text_citation
            if not inferred_marker and citation.authors and citation.year:
                a0 = citation.authors[0]
                first_surname = (
                    getattr(a0, "last_name", None)
                    or getattr(a0, "family", None)
                    or str(a0).split(",")[0].split()[0].strip()
                )
                if first_surname:
                    inferred_marker = f"({first_surname}, {citation.year})"
            alignment_result = self.semantic.check_content_alignment(
                cited_context=citation_context,
                source_title=best.title or "",
                source_abstract=resolved_abstract,
                citation_marker=inferred_marker,
            )
            content_alignment_score = alignment_result.similarity
            content_alignment_confidence = alignment_result.confidence
            content_is_aligned = alignment_result.is_aligned
            title_context_sim = getattr(alignment_result, "title_context_sim", 0.0)
            abstract_context_sim = getattr(alignment_result, "abstract_context_sim", 0.0)
            best_evidence_sentence = getattr(alignment_result, "best_evidence_sentence", "")
            best_evidence_score = getattr(alignment_result, "best_evidence_score", 0.0)
            best_cited_sentence = getattr(alignment_result, "best_cited_sentence", "")
            citation_intent = getattr(alignment_result, "citation_intent", "")
            stance_label = getattr(alignment_result, "stance_label", "")
            cross_lingual_detected = bool(
                cross_lingual_detected or getattr(alignment_result, "cross_lingual_detected", False)
            )
            for bc in getattr(alignment_result, "bridged_concepts", None) or []:
                if bc not in bridged_concepts:
                    bridged_concepts.append(bc)

            # Evaluate multi-occurrence neural alignment when reference is cited multiple times
            occ_contexts = getattr(citation, "_occurrence_contexts", None)
            if (
                isinstance(occ_contexts, list)
                and len(occ_contexts) >= 1
                and hasattr(self.semantic, "check_multi_context_alignment")
            ):
                occurrence_alignments = self.semantic.check_multi_context_alignment(
                    occ_contexts,
                    source_title=best.title or "",
                    source_abstract=resolved_abstract,
                )
                if len(occurrence_alignments) >= 2:
                    if not context_source:
                        context_source = "multi_occurrence"
                    best_occ = max(occurrence_alignments, key=lambda o: float(o.get("score") or 0.0))
                    best_occ_score = float(best_occ.get("score") or 0.0)
                    if best_occ_score > content_alignment_score:
                        content_alignment_score = best_occ_score
                        content_alignment_confidence = str(best_occ.get("confidence") or content_alignment_confidence)
                        content_is_aligned = bool(best_occ.get("is_aligned"))
                        best_cited_sentence = str(best_occ.get("focal_sentence") or best_cited_sentence)
                        citation_intent = str(best_occ.get("intent") or citation_intent)
                        stance_label = str(best_occ.get("stance") or stance_label)
                        if best_occ.get("best_evidence_sentence"):
                            best_evidence_sentence = str(best_occ["best_evidence_sentence"])
                    for occ_item in occurrence_alignments:
                        if occ_item.get("cross_lingual_detected"):
                            cross_lingual_detected = True
                        for bc in occ_item.get("bridged_concepts") or []:
                            if bc not in bridged_concepts:
                                bridged_concepts.append(bc)
                    # Preserve polarity contradiction if any occurrence explicitly refutes the paper
                    if any(
                        o.get("stance") == "contradiction_risk" and float(o.get("score") or 0.0) >= 0.30
                        for o in occurrence_alignments
                    ):
                        stance_label = "contradiction_risk"
            if not context_source:
                context_source = "in_text_citation"

        return MatchFeatures(
            title_sim_fuzzy=fuzzy_sim,
            title_sim_semantic=semantic_sim,
            author_jaccard=author_sim,
            year_distance=year_dist,
            doi_exact_match=doi_match,
            venue_sim=venue_sim,
            source_consensus=source.consensus_count(),
            content_alignment_score=content_alignment_score,
            content_alignment_confidence=content_alignment_confidence,
            content_is_aligned=content_is_aligned,
            title_context_sim=title_context_sim,
            abstract_context_sim=abstract_context_sim,
            best_evidence_sentence=best_evidence_sentence,
            best_evidence_score=best_evidence_score,
            best_cited_sentence=best_cited_sentence,
            citation_intent=citation_intent,
            stance_label=stance_label,
            cross_lingual_detected=cross_lingual_detected,
            bridged_concepts=bridged_concepts,
            cross_lingual_title_detected=cross_lingual_title_detected,
            cross_lingual_title_sim=cross_lingual_title_sim,
            context_source=context_source,
            occurrence_alignments=occurrence_alignments,
        )

    @staticmethod
    def _year_distance(y1: str | int | None, y2: str | int | None) -> int:
        if not y1 or not y2:
            return 999
        m1 = re.search(r"\d{4}", str(y1))
        m2 = re.search(r"\d{4}", str(y2))
        if not m1 or not m2:
            return 999
        return abs(int(m1.group(0)) - int(m2.group(0)))

    @staticmethod
    def _normalize_doi_str(doi: str | None) -> str:
        if not doi:
            return ""
        d = doi.strip().lower()
        for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
            if d.startswith(prefix):
                d = d[len(prefix):].strip()
        return d.rstrip(".")

    @classmethod
    def _doi_matches(cls, doi1: str | None, doi2: str | None) -> bool:
        d1 = cls._normalize_doi_str(doi1)
        d2 = cls._normalize_doi_str(doi2)
        if not d1 or not d2:
            return False
        if d1 == d2:
            return True
        # Handle Elsevier/Lancet PII DOIs with parentheses (e.g. 10.1016/s0140-6736(20)31180-6)
        # where regex extraction stopped at the closing parenthesis
        shorter, longer = (d1, d2) if len(d1) <= len(d2) else (d2, d1)
        if "(" in shorter and ")" not in shorter and longer.startswith(shorter + ")"):
            return True
        # Known equivalent canonical DOIs (e.g., BERT NAACL vs arXiv)
        equiv_sets = (
            {"10.18653/v1/n19-1423", "10.48550/arxiv.1810.04805"},
        )
        for eq in equiv_sets:
            if d1 in eq and d2 in eq:
                return True
        return False

    @staticmethod
    def _is_book_review_candidate(cand: SourceCandidate) -> bool:
        doi_l = (cand.doi or "").lower()
        venue_l = (cand.venue or "").lower()
        return (
            doi_l.startswith("10.5860/choice")
            or "choice reviews" in venue_l
            or "book review" in venue_l
        )

    def _select_best_candidate(
        self,
        citation: Citation,
        source: SourceResult,
        cited_authors: list,
    ) -> SourceCandidate | None:
        """Select the candidate from source.candidates that best matches citation metadata."""
        valid = [c for c in source.candidates if c.found]
        if not valid:
            return None
        if len(valid) == 1:
            return valid[0]

        c_title = (citation.title or citation.raw_text or "").lower().strip()
        is_raw = not bool(citation.title)
        cit_is_choice = "10.5860/choice" in (citation.doi or "").lower() or "choice reviews" in (citation.venue or "").lower()

        def _score_cand(cand: SourceCandidate) -> float:
            doi_bonus = 2.0 if self._doi_matches(citation.doi, cand.doi) else 0.0
            cand_title = (cand.title or "").lower().strip()
            t_sim = self._compute_title_similarity(c_title, cand_title, is_raw_fallback=is_raw)
            a_sim = author_match_score(cited_authors, list(cand.authors or []))
            y_dist = self._year_distance(citation.year, cand.year)
            if t_sim < 0.55 and a_sim >= 0.60 and y_dist <= 1 and c_title and cand_title:
                from integrity_checker.matching.vn_en_academic_bridge import (
                    compute_cross_lingual_concept_overlap,
                    is_vietnamese_text,
                )

                if is_vietnamese_text(c_title) != is_vietnamese_text(cand_title):
                    xl_ov, _ = compute_cross_lingual_concept_overlap(
                        c_title if is_vietnamese_text(c_title) else cand_title,
                        cand_title if is_vietnamese_text(c_title) else c_title,
                    )
                    t_sim = max(t_sim, xl_ov * 0.85)
            y_bonus = 0.2 if y_dist <= 1 else 0.0
            review_penalty = -0.5 if (not cit_is_choice and self._is_book_review_candidate(cand)) else 0.0
            return doi_bonus + t_sim * 1.0 + a_sim * 0.5 + y_bonus + review_penalty + (cand.confidence or 0.0) * 0.05

        best = max(valid, key=_score_cand)
        # Ensure source.best_candidate() and source.candidates[0] (serialized as matched_sources[0] for the UI)
        # point to this exact selected best candidate without mutating best.confidence
        source._selected_best = best  # type: ignore[attr-defined]
        if source.candidates and source.candidates[0] is not best and best in source.candidates:
            source.candidates.remove(best)
            source.candidates.insert(0, best)
        return best

    _MEDIUM_TAG_RE = re.compile(
        r"\s*\[(?:"
        r"online|internet|preprint|computer\s+software|software|data\s*set|dataset|"
        r"audio\s+podcast|podcast|video|film|white\s+paper|working\s+paper|"
        r"master'?s\s+thesis|doctoral\s+dissertation|dissertation|thesis|"
        r"tech\.?\s*rep\.?|technical\s+report|monograph|electronic\s+resource|"
        r"cd-rom|báo\s+cáo|luận\s+văn(?:\s+thạc\s+sĩ)?|luận\s+án(?:\s+tiến\s+sĩ)?|trực\s+tuyến"
        r")\]",
        re.IGNORECASE,
    )
    _TRANSLATED_BRACKET_RE = re.compile(r"^(?P<main>.+?)\s*\[(?P<alt>[^\]]{4,})\]\s*$")
    _TRANSLATED_PAREN_RE = re.compile(
        r"^(?P<main>.+?)\s*\(\s*(?:bản\s+dịch|dịch|tiếng\s+việt|translated|english\s+title)\s*[:\-–]\s*(?P<alt>[^)]{4,})\)\s*$",
        re.IGNORECASE,
    )
    _PARALLEL_TITLE_EQ_RE = re.compile(r"^(?P<main>[^=]{6,}?)\s+=\s+(?P<alt>[^=]{4,})$")

    @classmethod
    def _strip_medium_tags_and_extract_alt_titles(cls, title: str) -> tuple[str, list[str]]:
        """Strip bracketed medium tags (e.g. [Online], [Computer software]) and extract bracketed/parallel translated titles."""
        if not title:
            return "", []
        cleaned = cls._MEDIUM_TAG_RE.sub("", title).strip()
        alts: list[str] = []
        for pat in (cls._TRANSLATED_BRACKET_RE, cls._TRANSLATED_PAREN_RE, cls._PARALLEL_TITLE_EQ_RE):
            m = pat.match(cleaned)
            if m:
                main_part = m.group("main").strip().rstrip(".,;:")
                alt_part = m.group("alt").strip().rstrip(".,;:")
                if len(main_part) >= 5 and len(alt_part) >= 4:
                    return main_part, [alt_part]
        return cleaned, alts

    def _fuse_consensus_metadata(
        self,
        best: SourceCandidate,
        source: SourceResult,
        cited_authors: list | None = None,
    ) -> SourceCandidate:
        """Fuse missing metadata fields (authors, year, doi, venue, abstract) from agreeing candidates."""
        valid_others = [c for c in source.candidates if c.found and c is not best]
        if not valid_others:
            return best

        best_title = (best.title or "").lower().strip()
        best_is_review = self._is_book_review_candidate(best)
        for cand in valid_others:
            if not best_is_review and self._is_book_review_candidate(cand):
                continue
            same_doi = bool(best.doi and cand.doi and self._doi_matches(best.doi, cand.doi))
            cand_title = (cand.title or "").lower().strip()
            t_sim = self._compute_title_similarity(best_title, cand_title) if (best_title and cand_title) else 0.0
            y_dist = self._year_distance(best.year, cand.year)
            compatible_year = (best.year is None or cand.year is None or y_dist <= 1)
            if not (same_doi or (t_sim >= 0.92 and compatible_year)):
                continue

            authors_agree = (
                not best.authors
                or not cand.authors
                or author_match_score(list(best.authors), list(cand.authors)) >= 0.50
            )
            if not best.authors and cand.authors and compatible_year:
                best.authors = list(cand.authors)
            elif (
                best.authors
                and cand.authors
                and len(best.authors) < len(cand.authors)
                and compatible_year
                and authors_agree
            ):
                if not cited_authors or (
                    author_match_score(cited_authors, list(cand.authors))
                    >= author_match_score(cited_authors, list(best.authors))
                ):
                    best.authors = list(cand.authors)
            if not best.year and cand.year and same_doi:
                best.year = cand.year
            if not best.doi and cand.doi and compatible_year and authors_agree:
                best.doi = cand.doi
            if not best.venue and cand.venue and authors_agree:
                best.venue = cand.venue
            if not getattr(best, "abstract", None) and getattr(cand, "abstract", None):
                best.abstract = cand.abstract
        return best

    def _compute_title_similarity(
        self,
        citation_title: str,
        candidate_title: str,
        *,
        is_raw_fallback: bool = False,
    ) -> float:
        """Compute title similarity with safe partial match support.

        Strategy:
        1. Exact match (case/punctuation-insensitive) → 1.0
        2. Safe prefix match (subtitle delimiter or high length ratio) → 0.95
        3. Safe substring match (high length ratio, or candidate title inside unparsed raw_text) → 0.90
        4. Fallback to fuzzy token_set_ratio
        """
        if not citation_title or not candidate_title:
            return 0.0

        c_main, c_alts = self._strip_medium_tags_and_extract_alt_titles(citation_title)
        cand_main, cand_alts = self._strip_medium_tags_and_extract_alt_titles(candidate_title)
        if c_alts or cand_alts:
            best_alt_sim = self._compute_single_title_similarity(
                c_main, cand_main, is_raw_fallback=is_raw_fallback
            )
            for ac in [c_main, *c_alts]:
                for acand in [cand_main, *cand_alts]:
                    best_alt_sim = max(
                        best_alt_sim,
                        self._compute_single_title_similarity(
                            ac, acand, is_raw_fallback=is_raw_fallback
                        ),
                    )
            return best_alt_sim
        return self._compute_single_title_similarity(
            c_main, cand_main, is_raw_fallback=is_raw_fallback
        )

    def _compute_single_title_similarity(
        self,
        citation_title: str,
        candidate_title: str,
        *,
        is_raw_fallback: bool = False,
    ) -> float:
        if not citation_title or not candidate_title:
            return 0.0

        # Normalize case, whitespace, ampersands, dashes, and trailing punctuation
        c_clean = re.sub(r"\s+", " ", citation_title.lower().strip().rstrip(".,;:?!"))
        cand_clean = re.sub(r"\s+", " ", candidate_title.lower().strip().rstrip(".,;:?!"))
        c_clean = re.sub(r"\s*&\s*", " and ", c_clean).replace("\u2013", "-").replace("\u2014", "-")
        cand_clean = re.sub(r"\s*&\s*", " and ", cand_clean).replace("\u2013", "-").replace("\u2014", "-")
        if not c_clean or not cand_clean:
            return 0.0

        # 1. Direct match (or match after removing hyphens/edition suffix, e.g. "Book Title, 5th Edition" vs "Book Title")
        if c_clean == cand_clean:
            return 1.0
        c_dehyph = re.sub(r"(?<=\w)-(?=\w)", "", c_clean)
        cand_dehyph = re.sub(r"(?<=\w)-(?=\w)", "", cand_clean)
        if c_dehyph == cand_dehyph:
            return 1.0
        from integrity_checker.retrieval.openlibrary_client import OpenLibraryClient
        c_no_ed = OpenLibraryClient.strip_edition_suffix(c_clean).lower().strip()
        cand_no_ed = OpenLibraryClient.strip_edition_suffix(cand_clean).lower().strip()
        if c_no_ed and cand_no_ed and c_no_ed == cand_no_ed:
            return 0.98

        c_base = c_no_ed or c_clean
        cand_base = cand_no_ed or cand_clean
        shorter, longer = (
            (c_base, cand_base)
            if len(c_base) <= len(cand_base)
            else (cand_base, c_base)
        )
        len_ratio = len(shorter) / len(longer) if longer else 0.0

        # 2. Safe prefix/colon-split match: either length ratio >= 0.65, or followed/preceded by a subtitle separator
        if len(shorter) >= 12 and longer.startswith(shorter):
            remainder = longer[len(shorter):].lstrip()
            if len_ratio >= 0.65 or (remainder and remainder[0] in ".:,-—–("):
                return 0.95
        if len(shorter) >= 12 and ":" in longer:
            parts = [p.strip() for p in longer.split(":", 1)]
            if shorter in parts:
                return 0.95

        # 3. Safe substring match: require length ratio >= 0.70 (or candidate title in raw_text fallback)
        if len(shorter) >= 15 and shorter in longer:
            if len_ratio >= 0.70:
                return 0.90
            if is_raw_fallback and cand_clean == shorter and len(cand_clean) >= 15:
                return 0.90

        # 4. Fallback to fuzzy matching
        raw_tset = max(
            self.fuzzy.token_set_ratio(c_clean, cand_clean),
            self.fuzzy.token_set_ratio(c_dehyph, cand_dehyph),
        )
        if len_ratio < 0.65 and not is_raw_fallback:
            return raw_tset * (0.35 + 0.65 * len_ratio)
        return raw_tset
